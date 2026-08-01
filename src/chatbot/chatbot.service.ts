import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { Knowledge } from './knowledge.schema';
import { ChatFeedback } from './chat-feedback.schema';
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

// Một lượt hội thoại trước đó, do frontend gửi kèm để bot hiểu câu hỏi nối tiếp.
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

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
  // Ngưỡng điểm cho nhánh tìm theo từ khoá (Mongo textScore, KHÁC thang với điểm
  // vector ở trên — đừng so hai con số này với nhau).
  //
  // Đo trên chính bộ 309 đoạn của dự án (scripts/calibrate-keyword.ts), dùng câu
  // hỏi viết nguyên như sinh viên gõ:
  //   7 câu đúng đề — điểm cao nhất mỗi câu: 2.13 … 5.57 (thấp nhất "đăng ký vé xe" 2.13)
  //   5 câu lạc đề  — điểm cao nhất mỗi câu: 0.51 … 1.02 (cao nhất "nấu phở bò" 1.02)
  // Khoảng trống 1.02 → 2.13, chọn 1.6 nằm giữa.
  //
  // Lưu ý textScore phụ thuộc vào thống kê kho tài liệu VÀ vào bộ lọc hư từ ở
  // buildKeywordQuery — đổi một trong hai thì phải đo lại, đừng bê nguyên số này.
  private readonly keywordMinScore = Number(process.env.CHATBOT_KEYWORD_MIN_SCORE ?? 1.6);
  // Số chỗ trong searchLimit dành riêng cho nhánh từ khoá. Đặt 2/8: đủ để đoạn
  // khớp chính xác lọt vào, vẫn để phần lớn ngữ cảnh cho vector quyết định.
  private readonly keywordReservedSlots = Number(process.env.CHATBOT_KEYWORD_SLOTS ?? 2);

  private readonly personalKeywords = [
    'của tôi', 'của mình', 'của em', 'tôi đang', 'mình đang', 'em đang',
    'phòng tôi', 'phòng mình', 'phòng em', 'phòng của',
    'hóa đơn', 'tiền phòng', 'tiền điện', 'tiền nước', 'công nợ', 'còn nợ', 'chưa đóng', 'đã đóng', 'thanh toán', 'đóng tiền',
    'hợp đồng', 'gia hạn', 'hết hạn', 'hạn hợp đồng',
    'điểm hành vi', 'điểm của tôi', 'điểm nề nếp',
    'mssv', 'mã số sinh viên', 'thông tin của tôi', 'tài khoản của tôi',
    'tôi ở phòng', 'tôi ở đâu', 'phòng nào',
  ];

  // Số lượt hội thoại cũ đưa vào prompt. Giữ nhỏ vì model 3B: nhồi nhiều lượt cũ
  // vừa chậm vừa khiến nó lẫn giữa câu hỏi cũ và câu hỏi hiện tại.
  private readonly maxHistoryTurns = Number(process.env.CHATBOT_HISTORY_TURNS ?? 4);

  // Câu xã giao: không cần tra tài liệu, trả lời thẳng cho nhanh. Trước đây phải
  // dựa vào ngưỡng điểm vector để loại, giờ chặn sớm nên đỡ hẳn một lần gọi embedding.
  // Cho phép kèm từ xưng hô phía sau ("chào bạn", "cảm ơn nhé") — sinh viên hiếm
  // khi gõ đúng một từ trống không.
  private readonly smallTalkPattern =
    /^(chào|xin chào|hi|hello|hey|alo|ok|oke|okay|cảm ơn|cám ơn|thanks|thank you|tạm biệt|bye|good ?bye|ừ|uh|vâng|dạ)(\s+(bạn|ạ|à|nhé|nha|nhá|em|anh|chị|ad|admin))*[\s!.,?]*$/i;

  // Dấu hiệu câu hỏi nối tiếp: bản thân nó không đủ nghĩa để đi tra tài liệu.
  // "Còn tháng 6 thì sao?" — không có từ nào cho biết đang nói về hoá đơn.
  //
  // Cố tình KHÔNG bắt "thế nào" hay câu ngắn nói chung: rất nhiều câu hỏi đủ nghĩa
  // cũng kết thúc bằng "như thế nào?" ("Quy định gửi xe như thế nào?") hoặc rất
  // ngắn ("Giờ đóng cửa KTX?"). Ghép nhầm ngữ cảnh cũ vào những câu đó sẽ kéo
  // truy xuất lệch hẳn sang chủ đề trước — hại nhiều hơn lợi.
  private readonly followUpPattern =
    /^(còn|thế còn|vậy còn|vậy thì|nếu vậy|thế nếu|nó|cái đó|cái này|vụ đó|trường hợp đó)\b|\bthì sao\b/i;

  constructor(
    @InjectModel(Knowledge.name) private knowledgeModel: Model<Knowledge>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Contract.name) private contractModel: Model<Contract>,
    @InjectModel(Invoice.name) private invoiceModel: Model<Invoice>,
    @InjectModel(ChatFeedback.name) private feedbackModel: Model<ChatFeedback>,
  ) {}

  // Ghi nhận 👍/👎. Dùng upsert theo (user, question) để sinh viên đổi ý thì ghi đè
  // chứ không tạo bản ghi mới.
  async saveFeedback(input: {
    userId: string;
    question: string;
    answer: string;
    sources?: string[];
    verdict: 'UP' | 'DOWN';
    notFound?: boolean;
  }): Promise<void> {
    if (!isValidObjectId(input.userId)) {
      throw new HttpException('Người dùng không hợp lệ.', HttpStatus.BAD_REQUEST);
    }
    if (input.verdict !== 'UP' && input.verdict !== 'DOWN') {
      throw new HttpException('Phản hồi chỉ nhận UP hoặc DOWN.', HttpStatus.BAD_REQUEST);
    }
    if (!input.question?.trim()) {
      throw new HttpException('Thiếu câu hỏi tương ứng.', HttpStatus.BAD_REQUEST);
    }

    await this.feedbackModel.updateOne(
      { user: new Types.ObjectId(input.userId), question: input.question.trim().slice(0, 2000) },
      {
        $set: {
          answer: (input.answer ?? '').slice(0, 8000),
          sources: input.sources ?? [],
          verdict: input.verdict,
          notFound: input.notFound ?? false,
        },
      },
      { upsert: true },
    );
  }

  // Danh sách phản hồi cho quản trị viên. Ưu tiên 👎 lên đầu vì đó mới là thứ cần
  // xử lý — 👍 chỉ để đối chiếu tỉ lệ.
  async listFeedback(onlyNegative = false, limit = 100) {
    return this.feedbackModel
      .find(onlyNegative ? { verdict: 'DOWN' } : {})
      .sort({ verdict: 1, updatedAt: -1 })
      .limit(Math.min(limit, 500))
      .populate('user', 'fullName mssv')
      .lean();
  }

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

  // Bỏ dấu tiếng Việt + viết thường. Dùng cho cả lúc nạp tài liệu và lúc truy vấn,
  // nên hai bên luôn cùng một dạng chuẩn.
  static normalizeVietnamese(text: string): string {
    return (
      text
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '') // bỏ dấu thanh và dấu mũ
        .replace(/đ/gi, 'd')
        .toLowerCase()
        // Bỏ dấu câu, nếu không thì "nào?" không khớp với hư từ "nao" — mà dấu ?
        // lại luôn nằm ở cuối câu hỏi, đúng chỗ cần lọc nhất.
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );
  }

  async searchKnowledge(queryText: string): Promise<string> {
    return (await this.searchKnowledgeDetailed(queryText)).context;
  }

  // Nhánh tìm theo từ khoá, chạy song song với vector search.
  // Bắt được hai loại câu mà vector hay trượt:
  //   1. Gõ không dấu ("hoa don thang 7") — điểm tương đồng tụt dưới ngưỡng.
  //   2. Từ khoá hiếm, chính xác ("1000W", mã phòng B4-207) — vector làm nhoè đi.
  // Hư từ tiếng Việt (đã bỏ dấu). Index dùng default_language:'none' nên Mongo
  // KHÔNG tự loại hư từ; không lọc tay thì "nấu phở bò thế nào?" được cộng điểm
  // nhờ "the"/"nao" khớp khắp nơi và vượt ngưỡng dù hoàn toàn lạc đề.
  //
  // Cố tình KHÔNG có "cua" và "bi": bỏ dấu xong "của"/"cửa" trùng nhau, "bị"/"bị"
  // trong "thiết bị" cũng vậy — mà "cửa" ("giờ đóng cửa") và "thiết bị" đều là từ
  // khoá thật. Thà giữ lại vài hư từ còn hơn làm hỏng câu hỏi thật.
  private static readonly stopWords = new Set([
    'la', 'va', 'cho', 'co', 'khong', 'duoc', 'the', 'nao', 'gi', 'thi', 'ma',
    'den', 'voi', 've', 'nay', 'do', 'hay', 'hoac', 'neu', 'khi', 'sau',
    'truoc', 'tren', 'duoi', 'trong', 'boi', 'de', 'da', 'se', 'dang', 'cung',
    'chi', 'rat', 'qua', 'toi', 'minh', 'em', 'ban', 'a', 'o', 'mot', 'nhung',
    'nhu', 'sao', 'roi', 'nua', 'hon', 'moi', 'phai', 'bao', 'nhieu',
  ]);

  // Tách riêng và để public: script hiệu chuẩn ngưỡng phải dùng ĐÚNG cách tiền xử
  // lý này, nếu không đo một đằng chạy một nẻo (đã từng dính lỗi đó).
  static buildKeywordQuery(text: string): string {
    return ChatbotService.normalizeVietnamese(text)
      .split(' ')
      .filter((word) => word.length > 0 && !ChatbotService.stopWords.has(word))
      .join(' ');
  }

  private async searchByKeyword(
    queryText: string,
  ): Promise<{ _id: unknown; content: string; score: number }[]> {
    const normalized = ChatbotService.buildKeywordQuery(queryText);
    if (!normalized) return [];

    try {
      return await this.knowledgeModel
        .find({ $text: { $search: normalized } }, { content: 1, score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' } })
        .limit(this.searchLimit)
        .lean<{ _id: unknown; content: string; score: number }[]>();
    } catch (error) {
      // Chưa chạy lại ingest thì searchText còn rỗng / chưa có index — khi đó chỉ
      // cần lặng lẽ bỏ qua nhánh này, vector search vẫn chạy bình thường.
      this.logger.warn(`Tìm theo từ khoá thất bại (bỏ qua nhánh này): ${String(error)}`);
      return [];
    }
  }

  async searchKnowledgeDetailed(
    queryText: string,
  ): Promise<{ context: string; sources: string[] }> {
    const [queryVector, keywordHits] = await Promise.all([
      this.getEmbedding(queryText),
      this.searchByKeyword(queryText),
    ]);

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

    // Trộn hai nhánh: đoạn do vector chọn đứng trước (độ chính xác cao hơn), rồi
    // bù thêm đoạn từ khoá chưa có, tới khi đủ searchLimit. Nhờ vậy câu hỏi bình
    // thường giữ nguyên hành vi cũ, còn câu gõ không dấu / có từ khoá hiếm mới
    // được nhánh từ khoá cứu.
    const seen = new Set(relevant.map((r) => String(r._id)));
    const keywordKept = keywordHits.filter(
      (hit) => hit.score >= this.keywordMinScore && !seen.has(String(hit._id)),
    );

    if (keywordHits.length > 0) {
      // Ba trạng thái, không phải hai: đoạn bị loại vì điểm thấp khác hẳn đoạn bị
      // loại vì vector đã tìm ra rồi. Gộp chung sẽ khiến log tự mâu thuẫn (đếm 0
      // nhưng vẫn in dòng "GIỮ") và dẫn người đọc đi chỉnh nhầm ngưỡng.
      const lines = keywordHits.map((hit) => {
        const state =
          hit.score < this.keywordMinScore
            ? 'loại '
            : seen.has(String(hit._id))
              ? 'trùng'
              : 'THÊM ';
        const preview = String(hit.content).replace(/\s+/g, ' ').slice(0, 70);
        return `    ${state} ${hit.score.toFixed(4)}  ${preview}…`;
      });
      const overThreshold = keywordHits.filter((h) => h.score >= this.keywordMinScore).length;
      this.logger.log(
        `Nhánh từ khoá "${queryText}" — ${overThreshold}/${keywordHits.length} đoạn vượt ngưỡng ${this.keywordMinScore}, ` +
          `trong đó ${keywordKept.length} đoạn là MỚI (vector chưa tìm ra):\n${lines.join('\n')}`,
      );
    }

    // Dành sẵn chỗ cho nhánh từ khoá thay vì nối đuôi rồi cắt.
    //
    // Đo thực tế: với kho 309 đoạn hiện tại, vector luôn trả về đủ searchLimit đoạn
    // vượt ngưỡng, nên nếu chỉ nối đuôi rồi slice thì đoạn từ khoá KHÔNG BAO GIỜ
    // lọt vào — nhánh này thành code chết. Giữ lại vài chỗ để đoạn khớp từ khoá
    // chính xác (mã phòng, "1000W") vẫn có đường vào ngữ cảnh.
    const reserved = Math.min(keywordKept.length, this.keywordReservedSlots);
    const merged = [
      ...relevant.slice(0, this.searchLimit - reserved),
      ...keywordKept.slice(0, reserved),
    ];

    if (merged.length === 0) return { context: '', sources: [] };

    const contents = merged.map((r) => String(r.content));
    return {
      context: contents.join('\n\n---\n\n'),
      sources: this.extractSources(contents),
    };
  }

  private isSmallTalk(message: string): boolean {
    return this.smallTalkPattern.test(message.trim());
  }

  // Cắt lịch sử về N lượt gần nhất và bỏ lượt rỗng. Frontend là nguồn không đáng
  // tin (ai cũng gọi được API), nên chặn độ dài ở đây thay vì tin vào client.
  private sanitizeHistory(history?: ChatTurn[]): ChatTurn[] {
    if (!Array.isArray(history)) return [];

    return history
      .filter(
        (turn) =>
          turn &&
          (turn.role === 'user' || turn.role === 'assistant') &&
          typeof turn.content === 'string' &&
          turn.content.trim().length > 0,
      )
      .slice(-this.maxHistoryTurns)
      .map((turn) => ({ role: turn.role, content: turn.content.trim().slice(0, 2000) }));
  }

  // Câu hỏi nối tiếp ("còn tháng 6 thì sao?") không đủ nghĩa để tra vector — ghép
  // thêm câu hỏi trước của sinh viên để truy xuất đúng chủ đề. Chỉ ghép cho khâu
  // TÌM KIẾM; prompt vẫn nhận câu hỏi nguyên văn để bot không trả lời lạc sang câu cũ.
  //
  // Cách này thay cho việc gọi model viết lại câu hỏi: rẻ hơn hẳn (0 lượt suy luận)
  // và không có rủi ro model viết lại sai ý.
  buildSearchQuery(message: string, history: ChatTurn[]): string {
    const trimmed = message.trim();
    if (!this.followUpPattern.test(trimmed)) return trimmed;

    const lastUserQuestion = [...history].reverse().find((turn) => turn.role === 'user')?.content;

    return lastUserQuestion ? `${lastUserQuestion} ${trimmed}` : trimmed;
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
  async getInvoiceCard(
    message: string,
    searchQuery: string,
    userId?: string,
  ): Promise<InvoiceCard | null> {
    try {
      if (!userId || !isValidObjectId(userId)) return null;
      // Xét trên câu đã ghép ngữ cảnh: "còn tháng 6 thì sao?" tự nó không có chữ
      // "hoá đơn" nào, phải nhìn cả câu hỏi trước mới biết đang nói về hoá đơn.
      if (!this.isInvoiceQuery(searchQuery)) return null;

      const user: any = await this.userModel
        .findById(userId)
        .select('room')
        .populate('room', 'name building')
        .lean();

      if (!user?.room?._id) return null;

      // Ưu tiên tháng nêu trong câu HIỆN TẠI. Nếu lấy từ câu đã ghép thì
      // "Hoá đơn tháng 7... còn tháng 6 thì sao?" sẽ khớp nhầm tháng 7.
      const monthMatch =
        message.match(/tháng\s*(\d{1,2})/i) ?? searchQuery.match(/tháng\s*(\d{1,2})/i);
      const yearMatch =
        message.match(/năm\s*(\d{4})|\/\s*(\d{4})/i) ??
        searchQuery.match(/năm\s*(\d{4})|\/\s*(\d{4})/i);

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
Nguyên tắc: chỉ dùng thông tin trong tài liệu người dùng cung cấp, không bịa thêm. Toàn bộ câu trả lời phải viết bằng tiếng Việt, không được chèn từ của ngôn ngữ khác.
Các lượt hội thoại trước chỉ dùng để hiểu câu hỏi hiện tại đang nói về chủ đề gì. Luôn trả lời ĐÚNG câu hỏi mới nhất, không trả lời lại câu hỏi cũ.`;

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

  // Gom toàn bộ khâu chuẩn bị ngữ cảnh vào một chỗ để /ask và /stream không lệch
  // nhau — đây là điều file này vẫn cố giữ từ trước.
  private async prepareContext(userMessage: string, history: ChatTurn[], userId?: string) {
    // Câu xã giao: bỏ hẳn khâu truy xuất. Tiết kiệm một lần gọi embedding và một
    // lần truy vấn Mongo cho mỗi lời "chào bạn".
    if (this.isSmallTalk(userMessage)) {
      return {
        searchQuery: userMessage,
        knowledgeContext: '',
        sources: [] as string[],
        personalContext: '',
        invoiceCard: null as InvoiceCard | null,
      };
    }

    const searchQuery = this.buildSearchQuery(userMessage, history);
    if (searchQuery !== userMessage) {
      this.logger.log(`Câu hỏi nối tiếp — tra cứu theo: "${searchQuery}"`);
    }

    const wantsPersonal = this.isPersonalQuery(searchQuery);
    const [knowledge, personalContext, invoiceCard] = await Promise.all([
      this.searchKnowledgeDetailed(searchQuery),
      wantsPersonal ? this.getPersonalContext(userId) : Promise.resolve(''),
      this.getInvoiceCard(userMessage, searchQuery, userId),
    ]);

    return {
      searchQuery,
      knowledgeContext: knowledge.context,
      sources: knowledge.sources,
      personalContext,
      invoiceCard,
    };
  }

  async getChatResponse(
    userMessage: string,
    userId?: string,
    rawHistory?: ChatTurn[],
  ): Promise<string> {
    try {
      const history = this.sanitizeHistory(rawHistory);
      const { knowledgeContext, personalContext, invoiceCard } = await this.prepareContext(
        userMessage,
        history,
        userId,
      );

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
            ...history,
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
            // Bản bỏ dấu cho nhánh tìm theo từ khoá — phải sinh ở đây, cùng lúc
            // với embedding, để hai cách tìm luôn nhìn thấy đúng một tập tài liệu.
            searchText: ChatbotService.normalizeVietnamese(chunk.embedText),
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
    rawHistory?: ChatTurn[],
  ): Promise<Observable<ChatStreamEvent>> {
    const history = this.sanitizeHistory(rawHistory);
    const { knowledgeContext, sources, personalContext, invoiceCard } = await this.prepareContext(
      userMessage,
      history,
      userId,
    );

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
        // Lượt cũ đặt giữa system và câu hỏi hiện tại — nhờ đó bot hiểu được
        // "còn tháng 6 thì sao?" mà không cần nhắc lại chủ đề.
        ...history,
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