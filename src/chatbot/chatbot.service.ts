import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { Knowledge } from './knowledge.schema';
import { User } from '../users/schemas/user.schema';
import { Contract } from '../contracts/schemas/contract.schema';
import { Invoice } from '../invoices/schemas/invoice.schema';
import * as fs from 'fs';
import * as path from 'path';
import { Observable } from 'rxjs';

@Injectable()
export class ChatbotService {
  private readonly ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  private readonly chatModel = process.env.CHAT_MODEL || 'qwen2.5:3b';
  private readonly embedModel = process.env.EMBED_MODEL || 'nomic-embed-text';
  private readonly scoreThreshold = Number(process.env.CHATBOT_SCORE_THRESHOLD ?? 0.6);

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

  async searchKnowledge(queryText: string): Promise<string> {
    const queryVector = await this.getEmbedding(queryText);

    const results = await this.knowledgeModel.aggregate([
      {
        $vectorSearch: {
          index: 'vector_index',
          path: 'embedding',
          queryVector,
          numCandidates: 100,
          limit: 5,
        },
      },
      {
        $project: { content: 1, score: { $meta: 'vectorSearchScore' } },
      },
    ]);

    const relevant = results.filter((r) => r.score >= this.scoreThreshold);

    if (relevant.length === 0) return '';
    return relevant.map((r) => r.content).join('\n\n---\n\n');
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

  async getChatResponse(userMessage: string, userId?: string): Promise<string> {
    try {
      const wantsPersonal = this.isPersonalQuery(userMessage);
      const [knowledgeContext, personalContext] = await Promise.all([
        this.searchKnowledge(userMessage),
        wantsPersonal ? this.getPersonalContext(userId) : Promise.resolve(''),
      ]);

      let fullPrompt: string;

      if (knowledgeContext || personalContext) {
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
        fullPrompt = `Bạn là trợ lý ảo Dormify của hệ thống ký túc xá.
Người dùng vừa nói: "${userMessage}"
Hệ thống không tìm thấy tài liệu nào liên quan.
- Nếu đây là lời chào hỏi hoặc câu xã giao, hãy đáp lại thân thiện, ngắn gọn và mời họ đặt câu hỏi về ký túc xá.
- Nếu đây là câu hỏi cần thông tin, hãy trả lời đúng nguyên văn: "Xin lỗi, hiện tại tôi chưa có thông tin về vấn đề này."
Tuyệt đối không tự bịa ra thông tin.

Trợ lý:`;
      }

      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.chatModel,
          prompt: fullPrompt,
          stream: false,
          options: { temperature: 0.2 },
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

      const headingMatch = content.match(/^#\\s+(.+)$/m);
      const docTitle = headingMatch ? headingMatch[1].trim() : fileName.replace('.md', '');

      const chunks = content.split(/\\n\\s*\\n/).filter((chunk) => chunk.trim().length > 30);

      for (const chunk of chunks) {
        try {
          const cleanChunk = chunk.trim();
          const embedding = await this.getEmbedding(`${docTitle}\\n\\n${cleanChunk}`);

          await this.knowledgeModel.create({
            title: docTitle,
            content: cleanChunk,
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

  async streamChatResponse(userMessage: string, userId?: string): Promise<Observable<{ data: string }>> {
    const wantsPersonal = this.isPersonalQuery(userMessage);
    const [knowledgeContext, personalContext] = await Promise.all([
      this.searchKnowledge(userMessage),
      wantsPersonal ? this.getPersonalContext(userId) : Promise.resolve(''),
    ]);

    let fullPrompt: string;

    if (knowledgeContext || personalContext) {
      const blocks: string[] = [];

      if (personalContext) {
        blocks.push(`Thông tin cá nhân của sinh viên đang hỏi:\n<thong_tin_ca_nhan>\n${personalContext}\n</thong_tin_ca_nhan>`);
      }

      if (knowledgeContext) {
        blocks.push(`Tài liệu quy định của ký túc xá:\n<tai_lieu>\n${knowledgeContext}\n</tai_lieu>`);
      }

      fullPrompt = `Bạn là trợ lý ảo Dormify của hệ thống ký túc xá.
${blocks.join('\n\n')}

Hãy trả lời sinh viên ngắn gọn, thân thiện và chính xác, CHỈ dựa vào thông tin ở trên.
Nếu thông tin không đủ để trả lời, hãy nói: "Xin lỗi, hiện tại tôi chưa có thông tin về vấn đề này." Tuyệt đối không tự bịa ra thông tin.

Sinh viên: ${userMessage}
Trợ lý:`;
    } else {
      fullPrompt = `Bạn là trợ lý ảo Dormify của hệ thống ký túc xá.
Người dùng vừa nói: "${userMessage}"
Hệ thống không tìm thấy tài liệu nào liên quan.
- Nếu đây là lời chào hỏi, hãy đáp lại thân thiện.
- Nếu đây là câu hỏi, hãy trả lời đúng nguyên văn: "Xin lỗi, hiện tại tôi chưa có thông tin về vấn đề này."
Tuyệt đối không tự bịa ra thông tin.

Trợ lý:`;
    }

    const payload = {
      model: this.chatModel,
      prompt: fullPrompt,
      stream: true,
      keep_alive: '10m',
      num_predict: 512,
      options: { temperature: 0.2 },
    };

    const response = await fetch(`${this.ollamaUrl}/api/generate`, {
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

    return new Observable((subscriber) => {
      let buffer = '';

      const readStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              if (buffer.trim()) {
                try {
                  const json = JSON.parse(buffer.trim());
                  const reply = json.response ?? '';
                  if (reply) {
                    subscriber.next({ data: reply });
                  }
                } catch {}
              }

              subscriber.complete();
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
                const reply = json.response ?? '';
                if (reply) {
                  subscriber.next({ data: reply });
                }
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