import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { Knowledge } from './knowledge.schema';
import { User } from '../users/schemas/user.schema';
import { Contract } from '../contracts/schemas/contract.schema';
import { Invoice } from '../invoices/schemas/invoice.schema';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ChatbotService {
  // Cấu hình qua biến môi trường (có mặc định để chạy local ngay không cần .env).
  // Đổi model chỉ cần set CHAT_MODEL trong .env, không phải sửa code.
  private readonly ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  private readonly chatModel = process.env.CHAT_MODEL || 'qwen2.5:3b';
  private readonly embedModel = process.env.EMBED_MODEL || 'nomic-embed-text';
  // Ngưỡng điểm tương đồng (0..1). Kết quả dưới ngưỡng bị coi là không liên quan.
  private readonly scoreThreshold = Number(process.env.CHATBOT_SCORE_THRESHOLD ?? 0.6);

  // Từ khóa nhận biết câu hỏi liên quan tới bản thân sinh viên → cần nạp dữ liệu cá nhân.
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

  // 1. Gọi Ollama để biến câu chữ thành Vector số
  async getEmbedding(text: string): Promise<number[]> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.embedModel, // Model nhúng của Ollama
          prompt: text,
        }),
      });
      if (!response.ok) throw new Error('Ollama Embedding failed');
      const data = await response.json();
      return data.embedding;
    } catch (error) {
      console.error('Lỗi tạo Vector:', error);
      throw error;
    }
  }

  // 2. Tìm kiếm nội dung liên quan trong MongoDB.
  // Trả về chuỗi tài liệu ghép lại, hoặc "" nếu không có đoạn nào đủ liên quan.
  async searchKnowledge(queryText: string): Promise<string> {
    const queryVector = await this.getEmbedding(queryText);

    // Dùng $vectorSearch của MongoDB Atlas.
    // numCandidates lớn hơn nhiều lần limit giúp tăng độ chính xác (recall) của tìm kiếm.
    const results = await this.knowledgeModel.aggregate([
      {
        $vectorSearch: {
          index: 'vector_index', // Tên Index đã tạo trên MongoDB Atlas
          path: 'embedding', // Cột chứa vector
          queryVector: queryVector,
          numCandidates: 100, // Quét rộng hơn (trước là 10) để không bỏ sót đoạn khớp
          limit: 5, // Lấy 5 đoạn khớp nhất (trước là 3) để đủ ngữ cảnh trả lời
        },
      },
      {
        $project: { content: 1, score: { $meta: 'vectorSearchScore' } },
      },
    ]);

    // Lọc bỏ các đoạn điểm thấp: câu chào hỏi / ngoài phạm vi vẫn luôn trả về kết quả
    // vô nghĩa, khiến model bị "lú" và trả lời lạc đề. Chỉ giữ đoạn thực sự liên quan.
    const relevant = results.filter((r) => r.score >= this.scoreThreshold);

    if (relevant.length === 0) return '';
    return relevant.map((r) => r.content).join('\n\n---\n\n');
  }

  // 2b. Nhận biết câu hỏi có liên quan tới bản thân sinh viên hay không.
  private isPersonalQuery(message: string): boolean {
    const lower = message.toLowerCase();
    return this.personalKeywords.some((kw) => lower.includes(kw));
  }

  // ─── Helper định dạng ─────────────────────────────────────────────────────
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

  // 2c. Lấy thông tin cá nhân thật của sinh viên để nhồi vào ngữ cảnh trả lời.
  // Trả về "" nếu không xác định được user (chatbot vẫn hoạt động bình thường).
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

      // Hợp đồng mới nhất của sinh viên
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

      // Hóa đơn gần đây của phòng sinh viên (hóa đơn gắn theo phòng, không theo user)
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
          }
        } else {
          lines.push('- Hóa đơn gần đây: chưa có hóa đơn nào');
        }
      }

      return lines.join('\n');
    } catch (error) {
      // Cá nhân hóa lỗi thì bỏ qua, không được làm hỏng câu trả lời chung
      console.error('Lỗi lấy thông tin cá nhân cho chatbot:', error);
      return '';
    }
  }

  // 3. RAG Pipeline: kết hợp tài liệu quy định + thông tin cá nhân để trả lời.
  async getChatResponse(userMessage: string, userId?: string): Promise<string> {
    try {
      // Chạy song song: tìm tài liệu + (nếu là câu hỏi cá nhân) lấy dữ liệu sinh viên
      const wantsPersonal = this.isPersonalQuery(userMessage);
      const [knowledgeContext, personalContext] = await Promise.all([
        this.searchKnowledge(userMessage),
        wantsPersonal ? this.getPersonalContext(userId) : Promise.resolve(''),
      ]);

      let fullPrompt: string;

      if (knowledgeContext || personalContext) {
        // Có ít nhất một nguồn thông tin → ghép các khối ngữ cảnh vào prompt
        const blocks: string[] = [];
        if (personalContext) {
          blocks.push(
            `Thông tin cá nhân của sinh viên đang hỏi (chỉ dùng khi câu hỏi liên quan đến bản thân họ):\n<thong_tin_ca_nhan>\n${personalContext}\n</thong_tin_ca_nhan>`,
          );
        }
        if (knowledgeContext) {
          blocks.push(
            `Tài liệu quy định của ký túc xá:\n<tai_lieu>\n${knowledgeContext}\n</tai_lieu>`,
          );
        }

        fullPrompt = `Bạn là trợ lý ảo Dormify của hệ thống ký túc xá.
${blocks.join('\n\n')}

Hãy trả lời sinh viên ngắn gọn, thân thiện và chính xác, CHỈ dựa vào thông tin ở trên.
Nếu thông tin không đủ để trả lời, hãy nói: "Xin lỗi, hiện tại tôi chưa có thông tin về vấn đề này." Tuyệt đối không tự bịa ra thông tin.

Sinh viên: ${userMessage}
Trợ lý:`;
      } else {
        // Không có nguồn nào → chào hỏi hoặc báo không có thông tin
        fullPrompt = `Bạn là trợ lý ảo Dormify của hệ thống ký túc xá.
Người dùng vừa nói: "${userMessage}"
Hệ thống không tìm thấy tài liệu nào liên quan.
- Nếu đây là lời chào hỏi hoặc câu xã giao, hãy đáp lại thân thiện, ngắn gọn và mời họ đặt câu hỏi về ký túc xá.
- Nếu đây là câu hỏi cần thông tin, hãy trả lời đúng nguyên văn: "Xin lỗi, hiện tại tôi chưa có thông tin về vấn đề này."
Tuyệt đối không tự bịa ra thông tin.

Trợ lý:`;
      }

      // Gọi Ollama chạy model chat
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.chatModel, // Model trả lời (mặc định qwen2.5:3b)
          prompt: fullPrompt,
          stream: false, // Nhận 1 cục kết quả luôn, không stream từng chữ
          options: { temperature: 0.2 }, // Hạ nhiệt độ để trả lời bám sát dữ liệu, ít bịa
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return (data.response ?? '').trim();
    } catch (error) {
      console.error('Lỗi RAG Pipeline:', error);
      throw new HttpException('Chatbot local đang bận hoặc chưa bật Ollama.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // 4.1. Hàm phụ trợ: Đọc đệ quy lấy tất cả đường dẫn file .md (kể cả trong folder con)
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

  // 4.2. Hàm Nạp Dữ Liệu
  async ingestData(): Promise<string> {
    const docsDir = path.join(process.cwd(), 'src', 'chatbot', 'docs');

    // Tìm tất cả các file .md
    const filePaths = this.getAllMdFiles(docsDir);

    if (filePaths.length === 0) {
      return `Không tìm thấy file .md nào trong thư mục: ${docsDir}. Hãy kiểm tra xem bạn đã copy file .md vào chưa.`;
    }

    let totalChunks = 0;

    // Xóa dữ liệu cũ trong DB để nạp lại sạch đĩa
    await this.knowledgeModel.deleteMany({});
    console.log(`Đã tìm thấy ${filePaths.length} file .md. Đang bắt đầu tạo Vector...`);

    for (const filePath of filePaths) {
      const fileName = path.basename(filePath);
      const content = fs.readFileSync(filePath, 'utf-8');

      // Lấy tiêu đề tài liệu từ heading Markdown đầu tiên (# ...), fallback về tên file.
      // Tiêu đề giúp câu hỏi ngắn khớp đúng chủ đề hơn khi tìm kiếm vector.
      const headingMatch = content.match(/^#\s+(.+)$/m);
      const docTitle = headingMatch ? headingMatch[1].trim() : fileName.replace('.md', '');

      // Băm nhỏ văn bản theo các đoạn (xuống dòng 2 lần)
      const chunks = content.split(/\n\s*\n/).filter((chunk) => chunk.trim().length > 30);

      for (const chunk of chunks) {
        try {
          const cleanChunk = chunk.trim();
          // Nhúng kèm tiêu đề để tăng ngữ cảnh chủ đề cho vector, nhưng chỉ lưu nội dung gốc.
          const embedding = await this.getEmbedding(`${docTitle}\n\n${cleanChunk}`);

          await this.knowledgeModel.create({
            title: docTitle,
            content: cleanChunk,
            embedding: embedding,
          });
          totalChunks++;
        } catch (err) {
          console.error(`Lỗi tạo vector cho file ${fileName}:`, err);
        }
      }
    }

    return `Quá trình hoàn tất! Đã băm nhỏ và nạp thành công ${totalChunks} đoạn dữ liệu từ ${filePaths.length} file vào MongoDB.`;
  }
}
