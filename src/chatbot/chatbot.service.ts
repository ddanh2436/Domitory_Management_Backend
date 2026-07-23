import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Knowledge } from './knowledge.schema';
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

  constructor(
    @InjectModel(Knowledge.name) private knowledgeModel: Model<Knowledge>
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

    // Dùng $vectorSearch của MongoDB Atlas
    const results = await this.knowledgeModel.aggregate([
      {
        $vectorSearch: {
          index: "vector_index", // Tên Index đã tạo trên MongoDB Atlas
          path: "embedding", // Cột chứa vector
          queryVector: queryVector,
          numCandidates: 10,
          limit: 3 // Chỉ lấy 3 đoạn tài liệu khớp nhất
        }
      },
      {
        $project: { content: 1, score: { $meta: "vectorSearchScore" } }
      }
    ]);

    // Lọc bỏ các đoạn điểm thấp: câu chào hỏi / ngoài phạm vi vẫn luôn trả về 3 kết quả
    // vô nghĩa, khiến model bị "lú" và trả lời lạc đề. Chỉ giữ đoạn thực sự liên quan.
    const relevant = results.filter(r => r.score >= this.scoreThreshold);

    if (relevant.length === 0) return "";
    return relevant.map(r => r.content).join("\n\n---\n\n");
  }

  // 3. RAG Pipeline: Ép model trả lời theo Context
  async getChatResponse(userMessage: string): Promise<string> {
    try {
      // Bóc tách tài liệu từ DB ("" nếu không có đoạn nào đủ liên quan)
      const context = await this.searchKnowledge(userMessage);

      // Chọn prompt theo việc có tìm được tài liệu liên quan hay không.
      // Tách 2 nhánh để câu chào hỏi / xã giao không bị nhồi tài liệu vô nghĩa.
      const fullPrompt = context
        ? `Bạn là trợ lý ảo Dormify của hệ thống ký túc xá.
Hãy trả lời sinh viên ngắn gọn, thân thiện và chính xác, CHỈ dựa vào tài liệu sau đây:
<tai_lieu>
${context}
</tai_lieu>

Nếu tài liệu không đủ để trả lời, hãy nói: "Xin lỗi, hiện tại tôi chưa có thông tin về vấn đề này." Tuyệt đối không tự bịa ra thông tin.

Sinh viên: ${userMessage}
Trợ lý:`
        : `Bạn là trợ lý ảo Dormify của hệ thống ký túc xá.
Người dùng vừa nói: "${userMessage}"
Hệ thống không tìm thấy tài liệu nào liên quan.
- Nếu đây là lời chào hỏi hoặc câu xã giao, hãy đáp lại thân thiện, ngắn gọn và mời họ đặt câu hỏi về ký túc xá.
- Nếu đây là câu hỏi cần thông tin, hãy trả lời đúng nguyên văn: "Xin lỗi, hiện tại tôi chưa có thông tin về vấn đề này."
Tuyệt đối không tự bịa ra thông tin.

Trợ lý:`;

      // Gọi Ollama chạy model chat
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.chatModel, // Model trả lời (mặc định qwen2.5:3b)
          prompt: fullPrompt,
          stream: false, // Nhận 1 cục kết quả luôn, không stream từng chữ
          options: { temperature: 0.2 } // Hạ nhiệt độ để trả lời bám sát tài liệu, ít bịa
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return (data.response ?? '').trim();

    } catch (error) {
      console.error("Lỗi RAG Pipeline:", error);
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

      // Băm nhỏ văn bản theo các đoạn (xuống dòng 2 lần)
      const chunks = content.split(/\n\s*\n/).filter(chunk => chunk.trim().length > 30);

      for (const chunk of chunks) {
        try {
          const embedding = await this.getEmbedding(chunk.trim());

          await this.knowledgeModel.create({
            title: fileName.replace('.md', ''),
            content: chunk.trim(),
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