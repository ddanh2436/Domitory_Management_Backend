import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { Knowledge } from './knowledge.schema';
import { User } from '../users/schemas/user.schema';
import { Contract } from '../contracts/schemas/contract.schema';
import { Invoice } from '../invoices/schemas/invoice.schema';
import * as fs from 'fs';
import * as path from 'path';
import { Observable } from 'rxjs';

// Thẻ hoá đơn có cấu trúc: gửi thẳng số liệu cho giao diện vẽ bảng, thay vì
// bắt model 3B tự kẻ bảng Markdown (hay sai số, hay bịa dòng).
export interface InvoiceCard {
  id: string;
  month: number;
  year: number;
  roomName: string;
  roomFee: number;
  electricityFee: number;
  waterFee: number;
  totalAmount: number;
  dueDate?: string;
  status: string;
}

// Các sự kiện đẩy về client qua SSE. Giao diện dựa vào `type` để biết vẽ gì:
// dòng trạng thái, chữ, chip nguồn, bảng hoá đơn, hay khối "không có trong tài liệu".
export type ChatStreamEvent =
  | { type: 'status'; status: string }
  | { type: 'text'; text: string }
  | { type: 'sources'; sources: string[] }
  | { type: 'invoice'; invoice: InvoiceCard }
  | { type: 'notfound'; suggestions: string[] };

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  private readonly ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  private readonly chatModel = process.env.CHAT_MODEL || 'qwen2.5:3b';
  private readonly embedModel = process.env.EMBED_MODEL || 'nomic-embed-text';
  // Ngưỡng điểm tương đồng. Đo thực nghiệm với nomic-embed-text: câu lạc đề
  // ("xin chào", "nấu phở bò") đạt 0.80–0.84, câu đúng đề đạt 0.88+. Ngưỡng 0.6
  // cũ khiến mọi câu đều lọt, nên lời chào cũng bị nhồi 8 đoạn nội quy.
  // Đặt 0.82 để loại lời chào/cảm ơn (context rỗng → trả lời nhanh hơn nhiều),
  // vẫn còn biên an toàn cho câu hỏi thật. Hạ xuống nếu bot hay báo "chưa có thông tin".
  private readonly scoreThreshold = Number(process.env.CHATBOT_SCORE_THRESHOLD ?? 0.82);
  // Số đoạn tài liệu tối đa đưa vào ngữ cảnh. Câu hỏi tổng quát ("nội quy gồm những
  // gì") cần nhiều mục mới trả lời đủ — riêng file nội quy đã có 6 mục.
  private readonly searchLimit = Number(process.env.CHATBOT_SEARCH_LIMIT ?? 8);

  private readonly personalKeywords = [
    'của tôi', 'của mình', 'của em', 'tôi đang', 'mình đang', 'em đang',
    'phòng tôi', 'phòng mình', 'phòng em', 'phòng của',
    'hóa đơn', 'tiền phòng', 'tiền điện', 'tiền nước', 'công nợ', 'còn nợ', 'chưa đóng', 'đã đóng', 'thanh toán', 'đóng tiền',
    'hợp đồng', 'gia hạn', 'hết hạn', 'hạn hợp đồng',
    'điểm hành vi', 'điểm của tôi', 'điểm nề nếp',
    'mssv', 'mã số sinh viên', 'thông tin của tôi', 'tài khoản của tôi',
    'tôi ở phòng', 'tôi ở đâu', 'phòng nào',
  ];

  constructor(
    @InjectModel(Knowledge.name) private knowledgeModel: Model<Knowledge>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Contract.name) private contractModel: Model<Contract>,
    @InjectModel(Invoice.name) private invoiceModel: Model<Invoice>,
  ) {}

  async getEmbedding(text: string): Promise<number[]> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.embedModel,
          prompt: text,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama Embedding failed: ${response.status}`);
      }

      const data = await response.json();
      return data.embedding;
    } catch (error) {
      console.error('Lỗi tạo Vector:', error);
      throw error;
    }
  }

  // Rút nhãn "[Tên tài liệu — Mục]" ở đầu mỗi đoạn để hiện chip "NGUỒN" dưới câu
  // trả lời. Gom các mục cùng một tài liệu lại ("Nội quy KTX — 1, 3") cho gọn,
  // giữ tối đa 3 chip vì khung chat chỉ rộng 400px.
  private extractSources(contents: string[]): string[] {
    const sections = new Map<string, string[]>();

    for (const content of contents) {
      const match = content.match(/^\[([^\]]+)\]/);
      if (!match) continue;

      const [docTitle, section] = match[1].split('—').map((part) => part.trim());
      if (!docTitle) continue;

      const list = sections.get(docTitle) ?? [];
      if (section && !list.includes(section)) list.push(section);
      sections.set(docTitle, list);
    }

    return [...sections.entries()].slice(0, 3).map(([docTitle, list]) => {
      if (list.length === 0) return docTitle;
      // "1. Quy định về Giờ giấc sinh hoạt" → "1" để chip đủ ngắn
      const numbers = list.map((s) => s.match(/^(\d+)\./)?.[1]).filter(Boolean);
      if (numbers.length === list.length) return `${docTitle} · §${numbers.join(', ')}`;
      return `${docTitle} · ${list[0]}${list.length > 1 ? ` +${list.length - 1}` : ''}`;
    });
  }

  async searchKnowledge(queryText: string): Promise<string> {
    return (await this.searchKnowledgeDetailed(queryText)).context;
  }

  async searchKnowledgeDetailed(
    queryText: string,
  ): Promise<{ context: string; sources: string[] }> {
    const queryVector = await this.getEmbedding(queryText);

    const results = await this.knowledgeModel.aggregate([
      {
        $vectorSearch: {
          index: 'vector_index',
          path: 'embedding',
          queryVector,
          numCandidates: 100,
          limit: this.searchLimit,
        },
      },
      {
        $project: { content: 1, score: { $meta: 'vectorSearchScore' } },
      },
    ]);

    const relevant = results.filter((r) => r.score >= this.scoreThreshold);

    // Log điểm số để chẩn đoán: biết đoạn nào được chọn, đoạn nào bị ngưỡng loại.
    // Nhờ đó tinh chỉnh CHATBOT_SCORE_THRESHOLD dựa trên số liệu thật thay vì đoán.
    if (results.length === 0) {
      this.logger.warn(`Truy vấn "${queryText}" — vector search không trả về kết quả nào`);
    } else {
      const lines = results.map((r) => {
        const kept = r.score >= this.scoreThreshold ? 'GIỮ ' : 'loại';
        const preview = String(r.content).replace(/\s+/g, ' ').slice(0, 70);
        return `    ${kept} ${r.score.toFixed(4)}  ${preview}…`;
      });
      this.logger.log(
        `Truy vấn "${queryText}" — ${relevant.length}/${results.length} đoạn vượt ngưỡng ${this.scoreThreshold}:\n${lines.join('\n')}`,
      );
    }

    if (relevant.length === 0) return { context: '', sources: [] };

    const contents = relevant.map((r) => String(r.content));
    return {
      context: contents.join('\n\n---\n\n'),
      sources: this.extractSources(contents),
    };
  }

  private isPersonalQuery(message: string): boolean {
    const lower = message.toLowerCase();
    return this.personalKeywords.some((kw) => lower.includes(kw));
  }

  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
  }

  private formatDate(date?: Date | string): string {
    if (!date) return 'chưa có';
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return 'chưa có';
    return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' }).format(d);
  }

  private invoiceStatusLabel(status: string): string {
    switch (status) {
      case 'PAID':
        return 'Đã thanh toán';
      case 'OVERDUE':
        return 'QUÁ HẠN';
      default:
        return 'Chưa thanh toán';
    }
  }

  async getPersonalContext(userId?: string): Promise<string> {
    try {
      if (!userId || !isValidObjectId(userId)) return '';

      const user: any = await this.userModel
        .findById(userId)
        .select('fullName mssv phone gender behaviorScore room')
        .populate('room', 'name building floor price')
        .lean();

      if (!user) return '';

      const lines: string[] = [];
      lines.push(`- Họ tên: ${user.fullName}${user.mssv ? ` (MSSV: ${user.mssv})` : ''}`);
      if (typeof user.behaviorScore === 'number') {
        lines.push(`- Điểm hành vi/nề nếp: ${user.behaviorScore}/100`);
      }

      if (user.room) {
        const r = user.room;
        lines.push(
          `- Phòng đang ở: ${r.name}${r.building ? `, tòa ${r.building}` : ''}${r.floor ? `, tầng ${r.floor}` : ''}` +
            `${typeof r.price === 'number' ? ` (giá phòng ${this.formatCurrency(r.price)}/tháng)` : ''}`,
        );
      } else {
        lines.push('- Phòng đang ở: chưa được xếp phòng');
      }

      const contract: any = await this.contractModel
        .findOne({ user: new Types.ObjectId(userId) })
        .sort({ createdAt: -1 })
        .lean();

      if (contract) {
        lines.push(
          `- Hợp đồng: ${contract.contractNumber}, hiệu lực ${this.formatDate(contract.startDate)} → ${this.formatDate(contract.endDate)}, ` +
            `trạng thái ${contract.status}${typeof contract.rentalFee === 'number' ? `, tiền thuê ${this.formatCurrency(contract.rentalFee)}/tháng` : ''}`,
        );
      } else {
        lines.push('- Hợp đồng: chưa có hợp đồng nào');
      }

      if (user.room?._id) {
        const invoices: any[] = await this.invoiceModel
          .find({ room: user.room._id })
          .sort({ year: -1, month: -1 })
          .limit(4)
          .lean();

        if (invoices.length > 0) {
          lines.push('- Hóa đơn gần đây:');
          for (const inv of invoices) {
            lines.push(
              `  + Tháng ${inv.month}/${inv.year}: ${this.formatCurrency(inv.totalAmount)} — ${this.invoiceStatusLabel(inv.status)}` +
                `${inv.dueDate ? ` (hạn ${this.formatDate(inv.dueDate)})` : ''}`,
            );
            // Chi tiết từng khoản: có sẵn thì bot trả lời được "tiền điện tháng 7
            // bao nhiêu" mà không phải hỏi lại, thay vì chỉ biết mỗi tổng tiền.
            lines.push(
              `    · Tiền phòng ${this.formatCurrency(inv.roomFee ?? 0)}` +
                `, tiền điện ${this.formatCurrency(inv.electricityFee ?? 0)}` +
                `, tiền nước ${this.formatCurrency(inv.waterFee ?? 0)}`,
            );
          }
        } else {
          lines.push('- Hóa đơn gần đây: chưa có hóa đơn nào');
        }
      }

      return lines.join('\n');
    } catch (error) {
      console.error('Lỗi lấy thông tin cá nhân cho chatbot:', error);
      return '';
    }
  }

  private readonly invoiceKeywords = [
    'hóa đơn', 'hoá đơn', 'tiền phòng', 'tiền điện', 'tiền nước',
    'công nợ', 'còn nợ', 'chưa đóng', 'phải đóng', 'đóng bao nhiêu', 'thanh toán',
  ];

  // Câu hỏi phải vừa nói về hoá đơn, vừa nhắm vào hoá đơn CỦA NGƯỜI HỎI (sở hữu
  // hoặc nêu rõ tháng). Nếu không, "Quy trình thanh toán hoá đơn thế nào?" sẽ bị
  // đính kèm bảng hoá đơn cá nhân — vừa lạc đề, vừa làm model rút gọn câu trả lời.
  private readonly invoiceOwnershipPattern =
    /của (tôi|mình|em)|phòng (tôi|mình|em)|tôi (còn|phải|đã) (nợ|đóng)|tháng\s*\d|tháng này/i;

  private isInvoiceQuery(message: string): boolean {
    const lower = message.toLowerCase();
    if (!this.invoiceKeywords.some((kw) => lower.includes(kw))) return false;
    return this.invoiceOwnershipPattern.test(message);
  }

  // Tìm hoá đơn mà câu hỏi nhắc tới. "Hoá đơn tháng 7 của tôi bao nhiêu?" → hoá đơn
  // tháng 7 của phòng sinh viên đang ở; không nêu tháng thì lấy kỳ gần nhất.
  // Trả về số liệu thô để giao diện tự kẻ bảng — model không đụng vào con số nào.
  async getInvoiceCard(message: string, userId?: string): Promise<InvoiceCard | null> {
    try {
      if (!userId || !isValidObjectId(userId)) return null;
      if (!this.isInvoiceQuery(message)) return null;

      const user: any = await this.userModel
        .findById(userId)
        .select('room')
        .populate('room', 'name building')
        .lean();

      if (!user?.room?._id) return null;

      const monthMatch = message.match(/tháng\s*(\d{1,2})/i);
      const yearMatch = message.match(/năm\s*(\d{4})|\/\s*(\d{4})/i);

      const filter: Record<string, unknown> = { room: user.room._id };
      if (monthMatch) {
        const month = Number(monthMatch[1]);
        if (month >= 1 && month <= 12) filter.month = month;
      }
      if (yearMatch) filter.year = Number(yearMatch[1] ?? yearMatch[2]);

      const invoice: any = await this.invoiceModel
        .findOne(filter)
        .sort({ year: -1, month: -1 })
        .lean();

      if (!invoice) return null;

      return {
        id: String(invoice._id),
        month: invoice.month,
        year: invoice.year,
        roomName: user.room.building ? `${user.room.name} · ${user.room.building}` : user.room.name,
        roomFee: invoice.roomFee ?? 0,
        electricityFee: invoice.electricityFee ?? 0,
        waterFee: invoice.waterFee ?? 0,
        totalAmount: invoice.totalAmount ?? 0,
        dueDate: invoice.dueDate ? this.formatDate(invoice.dueDate) : undefined,
        status: invoice.status,
      };
    } catch (error) {
      this.logger.error('Lỗi lấy hoá đơn cho chatbot:', error);
      return null;
    }
  }

  // Câu hỏi gợi ý khi bot không tra được: chỉ nêu những chủ đề CHẮC CHẮN có trong
  // bộ tài liệu, để sinh viên bấm một cái là ra kết quả thật thay vì lại bí tiếp.
  private readonly fallbackSuggestions: { keywords: string[]; questions: string[] }[] = [
    {
      keywords: ['cọc', 'trả phòng', 'checkout', 'hoàn tiền'],
      questions: ['Thủ tục trả phòng gồm những gì?', 'Hạn đóng tiền phòng là khi nào?', 'Đăng ký về muộn thế nào?'],
    },
    {
      keywords: ['xe', 'gửi xe', 'bãi xe'],
      questions: ['Đăng ký vé xe cần gì?', 'Quy định tại bãi xe ra sao?', 'Nội quy KTX gồm những mục nào?'],
    },
    {
      keywords: ['điện', 'nước', 'kwh', 'định mức'],
      questions: ['Định mức và đơn giá điện nước là bao nhiêu?', 'Xử lý sự cố điện nước thế nào?', 'Hoá đơn tháng này của tôi?'],
    },
  ];

  private getSuggestions(message: string): string[] {
    const lower = message.toLowerCase();
    const matched = this.fallbackSuggestions.find((group) =>
      group.keywords.some((kw) => lower.includes(kw)),
    );
    return matched
      ? matched.questions
      : ['Nội quy KTX gồm những mục nào?', 'Giờ đóng cửa KTX là mấy giờ?', 'Thủ tục trả phòng gồm những gì?'];
  }

  // Thông điệp `system`: chỉ giữ vai trò + ràng buộc cốt lõi.
  // Model instruct được huấn luyện theo định dạng system/user, nên đặt đúng khe
  // giúp tuân thủ tốt hơn hẳn so với nhồi tất cả vào một khối văn bản.
  private readonly systemPrompt = `Bạn là trợ lý ảo Dormify của hệ thống ký túc xá, chỉ giao tiếp bằng tiếng Việt.
Nguyên tắc: chỉ dùng thông tin trong tài liệu người dùng cung cấp, không bịa thêm. Toàn bộ câu trả lời phải viết bằng tiếng Việt, không được chèn từ của ngôn ngữ khác.`;

  // Thông điệp `user`: dữ liệu + câu hỏi + hướng dẫn trình bày.
  // Hướng dẫn định dạng đặt ngay cạnh câu hỏi (thay vì trong system) cho kết quả
  // đầy đủ hơn rõ rệt khi đo thực nghiệm.
  private buildUserMessage(
    userMessage: string,
    knowledgeContext: string,
    personalContext: string,
    hasInvoiceCard = false,
  ): string {
    // Không có nguồn nào → chào hỏi hoặc báo chưa có thông tin
    if (!knowledgeContext && !personalContext) {
      return `Người dùng vừa nói: "${userMessage}"
Hệ thống không tìm thấy tài liệu nào liên quan.
- Nếu đây là lời chào hỏi hoặc câu xã giao, hãy đáp lại thân thiện, ngắn gọn bằng tiếng Việt và mời họ đặt câu hỏi về ký túc xá.
- Nếu đây là câu hỏi cần thông tin, hãy trả lời đúng nguyên văn: "Xin lỗi, hiện tại tôi chưa có thông tin về vấn đề này."`;
    }

    const blocks: string[] = [];

    if (personalContext) {
      blocks.push(
        `Thông tin cá nhân của sinh viên đang hỏi (chỉ dùng khi câu hỏi liên quan đến bản thân họ):\n<thong_tin_ca_nhan>\n${personalContext}\n</thong_tin_ca_nhan>`,
      );
    }

    if (knowledgeContext) {
      blocks.push(
        `Tài liệu quy định của ký túc xá (mỗi đoạn mở đầu bằng nhãn [Tên tài liệu — Mục]):\n<tai_lieu>\n${knowledgeContext}\n</tai_lieu>`,
      );
    }

    return `${blocks.join('\n\n')}

Câu hỏi của sinh viên: ${userMessage}

Cách trả lời:
- Chỉ dùng những đoạn tài liệu LIÊN QUAN tới câu hỏi. Bỏ qua hoàn toàn các đoạn không liên quan.
- Nhãn trong ngoặc vuông chỉ để bạn nhận biết nguồn. TUYỆT ĐỐI không viết nhãn đó vào câu trả lời.
- Nếu câu hỏi hỏi MỘT chi tiết cụ thể: trả lời thẳng chi tiết đó trong 1–2 câu, không liệt kê thêm quy định khác.
- Nếu câu hỏi hỏi về MỘT LOẠI quy định (gửi xe, điện nước, nội quy...): nêu đủ các mục thuộc loại đó có trong tài liệu, mỗi mục một gạch đầu dòng kèm nội dung cụ thể.
- Viết bằng tiếng Việt. Không thêm lời xin lỗi ở cuối.${
      hasInvoiceCard
        ? `
- Giao diện ĐÃ hiển thị sẵn bảng chi tiết hoá đơn cho sinh viên. Chỉ viết 1 câu dẫn ngắn (ví dụ "Hoá đơn tháng X của phòng bạn như sau:") rồi dừng. TUYỆT ĐỐI không liệt kê lại từng khoản tiền, không viết lại con số tổng.`
        : ''
    }`;
  }

  // Cắt phần khung prompt bị model chép lại vào ĐẦU câu trả lời, ví dụ
  // "Câu hỏi của sinh viên: Nội quy điện nước như thế nào Định mức và đơn giá...".
  private stripEchoedQuestion(text: string, question: string): string {
    let out = text.replace(/^\s*Câu hỏi của sinh viên\s*:?\s*/i, '');

    // Model có thể chép lại chính câu hỏi ngay sau đó
    const q = question.trim();
    if (q && out.toLowerCase().startsWith(q.toLowerCase())) {
      out = out.slice(q.length);
    }

    // Dọn dấu câu thừa còn sót lại ở đầu
    return out.replace(/^[\s:.\-–—]+/, '');
  }

  // Cắt câu xin lỗi/rào đón thừa mà model 3B hay tự thêm vào CUỐI câu trả lời,
  // bất chấp prompt đã cấm. Chỉ cắt khi phía trước còn nội dung thật — nếu toàn bộ
  // câu trả lời chỉ là lời xin lỗi (trường hợp "không có thông tin") thì giữ nguyên.
  private stripTrailingApology(text: string): string {
    const trimmed = text.trim();
    // Khớp 1-2 câu cuối bắt đầu bằng "Xin lỗi"/"Rất tiếc" (cả khi thiếu dấu chấm cuối)
    const pattern = /(?:\n|\s)*(?:Xin lỗi|Rất tiếc)[^.!?\n]*[.!?]?\s*$/;
    let result = trimmed;
    // Lặp tối đa 2 lần phòng khi model viết 2 câu rào đón liên tiếp
    for (let i = 0; i < 2; i++) {
      const next = result.replace(pattern, '').trim();
      if (next === result || next.length === 0) break;
      result = next;
    }
    return result.length > 0 ? result : trimmed;
  }

  // Tham số sinh văn bản dùng chung cho cả /ask và /stream, để hai đường không lệch nhau.
  // temperature thấp: bám sát tài liệu, ít bịa. num_predict: chặn độ dài (phải nằm
  // trong options mới có hiệu lực). keep_alive là tham số top-level của Ollama nên
  // được đặt riêng ở payload, không nằm ở đây.
  private readonly generateOptions = {
    // temperature 0 = giải mã tham lam. Đo thực nghiệm: ở 0.2 model chèn 13 từ
    // tiếng Indonesia vào một câu trả lời (có đoạn chuyển hẳn sang tiếng Indonesia);
    // ở 0 thì còn 0 từ trên cả 5 câu kiểm thử, đồng thời nhanh hơn nhiều.
    temperature: 0,
    // Bảo hiểm chống lặp — điểm yếu cố hữu của giải mã tham lam.
    repeat_penalty: 1.15,
    // Trần độ dài (không phải mục tiêu): câu ngắn vẫn dừng sớm nên không chậm thêm.
    num_predict: 1536,
  };

  async getChatResponse(userMessage: string, userId?: string): Promise<string> {
    try {
      const wantsPersonal = this.isPersonalQuery(userMessage);
      const [knowledgeContext, personalContext] = await Promise.all([
        this.searchKnowledge(userMessage),
        wantsPersonal ? this.getPersonalContext(userId) : Promise.resolve(''),
      ]);

      // Dùng /api/chat (không phải /api/generate): đặt quy tắc vào khe `system`
      // và dữ liệu + câu hỏi vào khe `user`, đúng định dạng model instruct được
      // huấn luyện. Đo thực nghiệm cho thấy cách này loại sạch việc chèn từ nước ngoài.
      const response = await fetch(`${this.ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.chatModel,
          stream: false,
          keep_alive: '10m',
          messages: [
            { role: 'system', content: this.systemPrompt },
            {
              role: 'user',
              content: this.buildUserMessage(userMessage, knowledgeContext, personalContext),
            },
          ],
          options: this.generateOptions,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const raw = (data?.message?.content ?? '').trim();
      return this.stripTrailingApology(this.stripEchoedQuestion(raw, userMessage));
    } catch (error) {
      console.error('Lỗi RAG Pipeline:', error);
      throw new HttpException('Chatbot local đang bận hoặc chưa bật Ollama.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  private getAllMdFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
    if (!fs.existsSync(dirPath)) return arrayOfFiles;

    const files = fs.readdirSync(dirPath);

    files.forEach((file) => {
      const fullPath = path.join(dirPath, file);
      if (fs.statSync(fullPath).isDirectory()) {
        arrayOfFiles = this.getAllMdFiles(fullPath, arrayOfFiles);
      } else if (file.toLowerCase().endsWith('.md')) {
        arrayOfFiles.push(fullPath);
      }
    });

    return arrayOfFiles;
  }

  // Băm một file Markdown thành các chunk có mang ngữ cảnh phân cấp.
  //
  // So với cách cũ (chỉ tách theo dòng trống): mỗi chunk giờ biết mình thuộc tài
  // liệu nào, mục nào. Nhãn "[Tên tài liệu — Mục]" được ghi vào content nên model
  // nhìn thấy nguồn của từng đoạn và chọn đúng đoạn khớp chủ đề, đồng thời nhãn
  // cũng vào embedding giúp câu hỏi ngắn khớp đúng hơn. Mục quá dài bị tách tiếp
  // theo từng gạch đầu dòng để truy xuất chính xác thay vì trả về cả khối lớn.
  private buildChunksFromMarkdown(
    content: string,
    fileName: string,
  ): { docTitle: string; chunks: { content: string; embedText: string }[] } {
    const MAX_BODY = 700; // Ngưỡng ký tự: dài hơn thì tách theo dòng
    const MIN_BODY = 30; // Bỏ đoạn quá ngắn (giống hành vi cũ)

    // Chuẩn hóa " & " thành " và ": model đọc ký hiệu & thành "dan" (tiếng Indonesia),
    // gây ra lỗi kiểu "phòng cháy chữa cháy dan toàn". Chỉ thay khi & đứng giữa hai
    // dấu cách để không phá hỏng URL dạng "?page=1&limit=25" trong tài liệu kỹ thuật.
    content = content.replace(/ & /g, ' và ');

    const headingMatch = content.match(/^#\s+(.+)$/m);
    const docTitle = headingMatch ? headingMatch[1].trim() : fileName.replace('.md', '');

    const chunks: { content: string; embedText: string }[] = [];
    let section = ''; // Mục hiện tại (từ heading ## / ###)

    const label = () => (section ? `${docTitle} — ${section}` : docTitle);

    const push = (body: string) => {
      const text = body.trim();
      if (text.length < MIN_BODY) return;
      chunks.push({
        content: `[${label()}]\n${text}`,
        embedText: `${docTitle}\n${section}\n\n${text}`,
      });
    };

    // Tách theo dòng trống, nhưng bám theo heading để biết đang ở mục nào
    for (const rawBlock of content.split(/\n\s*\n/)) {
      const block = rawBlock.trim();
      if (!block) continue;

      const lines = block.split('\n');
      const bodyLines: string[] = [];

      for (const line of lines) {
        const h = line.match(/^(#{1,6})\s+(.+)$/);
        if (h) {
          // Gặp heading: cập nhật mục hiện tại, bản thân dòng heading không thành chunk
          // (nhờ vậy loại được các chunk rác chỉ chứa tiêu đề).
          const depth = h[1].length;
          const title = h[2].trim();
          section = depth === 1 ? '' : title;
          continue;
        }
        bodyLines.push(line);
      }

      const body = bodyLines.join('\n').trim();
      if (!body) continue;

      if (body.length <= MAX_BODY) {
        push(body);
        continue;
      }

      // Mục dài: gom từng dòng lại thành nhóm không vượt MAX_BODY
      let group: string[] = [];
      let len = 0;
      for (const line of body.split('\n')) {
        if (len > 0 && len + line.length > MAX_BODY) {
          push(group.join('\n'));
          group = [];
          len = 0;
        }
        group.push(line);
        len += line.length + 1;
      }
      if (group.length > 0) push(group.join('\n'));
    }

    return { docTitle, chunks };
  }

  async ingestData(): Promise<string> {
    const docsDir = path.join(process.cwd(), 'src', 'chatbot', 'docs');
    const filePaths = this.getAllMdFiles(docsDir);

    if (filePaths.length === 0) {
      return `Không tìm thấy file .md nào trong thư mục: ${docsDir}. Hãy kiểm tra xem bạn đã copy file .md vào chưa.`;
    }

    let totalChunks = 0;

    await this.knowledgeModel.deleteMany({});
    console.log(`Đã tìm thấy ${filePaths.length} file .md. Đang bắt đầu tạo Vector...`);

    for (const filePath of filePaths) {
      const fileName = path.basename(filePath);
      const content = fs.readFileSync(filePath, 'utf-8');

      // Băm theo mục, mỗi chunk mang nhãn "[Tên tài liệu — Mục]"
      const { docTitle, chunks } = this.buildChunksFromMarkdown(content, fileName);

      for (const chunk of chunks) {
        try {
          // Nhúng theo embedText (có tiêu đề + tên mục) để tăng ngữ cảnh chủ đề
          const embedding = await this.getEmbedding(chunk.embedText);

          await this.knowledgeModel.create({
            title: docTitle,
            content: chunk.content,
            embedding,
          });
          totalChunks++;
        } catch (err) {
          console.error(`Lỗi tạo vector cho file ${fileName}:`, err);
        }
      }
    }

    return `Quá trình hoàn tất! Đã băm nhỏ và nạp thành công ${totalChunks} đoạn dữ liệu từ ${filePaths.length} file vào MongoDB.`;
  }

  async streamChatResponse(
    userMessage: string,
    userId?: string,
  ): Promise<Observable<ChatStreamEvent>> {
    const wantsPersonal = this.isPersonalQuery(userMessage);
    const [knowledge, personalContext, invoiceCard] = await Promise.all([
      this.searchKnowledgeDetailed(userMessage),
      wantsPersonal ? this.getPersonalContext(userId) : Promise.resolve(''),
      this.getInvoiceCard(userMessage, userId),
    ]);

    const { context: knowledgeContext, sources } = knowledge;

    // Dòng trạng thái hiện trong khung chat lúc bot đang nghĩ. Nói đúng việc bot
    // đang làm (đọc tài liệu / tra hồ sơ) thay vì "..." vô nghĩa.
    const chunkCount = knowledgeContext ? knowledgeContext.split('\n\n---\n\n').length : 0;
    const status = invoiceCard
      ? 'Đang tra hoá đơn của bạn'
      : personalContext
        ? 'Đang tra hồ sơ của bạn'
        : chunkCount > 0
          ? `Đang đọc ${chunkCount} tài liệu KTX`
          : 'Đang tra cứu';

    // Dùng chung systemPrompt/buildUserMessage với /ask để hai đường không lệch nhau
    const payload = {
      model: this.chatModel,
      stream: true,
      // keep_alive là tham số top-level của Ollama: giữ model nóng trong RAM,
      // tránh mất vài chục giây nạp lại model ở câu hỏi sau.
      keep_alive: '10m',
      messages: [
        { role: 'system', content: this.systemPrompt },
        {
          role: 'user',
          content: this.buildUserMessage(
            userMessage,
            knowledgeContext,
            personalContext,
            invoiceCard !== null,
          ),
        },
      ],
      options: this.generateOptions,
    };

    const response = await fetch(`${this.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Ollama stream body not available');
    }

    const decoder = new TextDecoder();

    return new Observable<ChatStreamEvent>((subscriber) => {
      let buffer = '';

      subscriber.next({ type: 'status', status });
      if (invoiceCard) subscriber.next({ type: 'invoice', invoice: invoiceCard });

      // Giữ lại phần ĐUÔI của văn bản chưa xả ra client, để khi stream kết thúc
      // có thể cắt câu xin lỗi thừa (stripTrailingApology) TRƯỚC khi nó kịp hiện
      // lên màn hình. Đánh đổi: ~200 ký tự cuối hiện trễ hơn một chút.
      const HOLDBACK = 200;
      // Tương tự cho phần ĐẦU: đệm đủ dài để nhận diện và cắt đoạn model chép lại
      // câu hỏi, rồi mới bắt đầu xả. Chỉ đệm vừa đủ nên độ trễ đầu ra không đáng kể.
      const HEAD_MIN = Math.min(200, userMessage.length + 40);
      let headCleaned = false;
      let fullText = ''; // toàn bộ văn bản model đã sinh
      let emittedLen = 0; // số ký tự đã xả cho client

      const emitUpTo = (target: number) => {
        if (target > emittedLen) {
          subscriber.next({ type: 'text', text: fullText.slice(emittedLen, target) });
          emittedLen = target;
        }
      };

      const appendReply = (reply: string) => {
        fullText += reply;

        // Chưa đủ dài để xét phần đầu thì chưa xả gì cả
        if (!headCleaned) {
          if (fullText.length < HEAD_MIN) return;
          // Chưa xả ký tự nào nên thay thế fullText ở đây là an toàn
          fullText = this.stripEchoedQuestion(fullText, userMessage);
          headCleaned = true;
        }

        // Chỉ xả phần vượt quá vùng đuôi giữ lại
        emitUpTo(Math.max(emittedLen, fullText.length - HOLDBACK));
      };

      const finish = () => {
        // Câu trả lời ngắn hơn HEAD_MIN thì chưa qua bước lọc phần đầu — làm nốt ở đây
        if (!headCleaned) {
          fullText = this.stripEchoedQuestion(fullText, userMessage);
          headCleaned = true;
        }
        // Lọc lời xin lỗi thừa trên TOÀN VĂN rồi xả nốt phần đuôi còn giữ
        const cleaned = this.stripTrailingApology(fullText);
        if (cleaned.length > emittedLen) {
          subscriber.next({ type: 'text', text: cleaned.slice(emittedLen) });
        }

        // Không tra được gì → báo thẳng cho giao diện để nó dựng khối "Không có
        // trong tài liệu" kèm lối thoát (hỏi ban quản lý / câu hỏi thay thế),
        // thay vì để sinh viên đọc một câu xin lỗi cụt lủn rồi bỏ đi.
        const isNotFound =
          !knowledgeContext &&
          !personalContext &&
          !invoiceCard &&
          /chưa có thông tin/i.test(cleaned);

        if (isNotFound) {
          subscriber.next({ type: 'notfound', suggestions: this.getSuggestions(userMessage) });
        } else if (sources.length > 0) {
          subscriber.next({ type: 'sources', sources });
        }

        subscriber.complete();
      };

      const readStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              if (buffer.trim()) {
                try {
                  const json = JSON.parse(buffer.trim());
                  // /api/chat trả về message.content (khác /api/generate dùng response)
                  const reply = json?.message?.content ?? '';
                  if (reply) appendReply(reply);
                } catch {}
              }

              finish();
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine) continue;

              try {
                const json = JSON.parse(trimmedLine);
                const reply = json?.message?.content ?? '';
                if (reply) appendReply(reply);
              } catch {
                // Bỏ qua chunk không parse được
              }
            }
          }
        } catch (error) {
          subscriber.error(error);
        }
      };

      void readStream();
    });
  }
}