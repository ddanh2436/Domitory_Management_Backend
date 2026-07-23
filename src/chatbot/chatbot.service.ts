import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Knowledge } from './knowledge.schema';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ChatbotService {
  constructor(
    @InjectModel(Knowledge.name) private knowledgeModel: Model<Knowledge>
  ) {}

  // 1. Gọi Ollama để biến câu chữ thành Vector số
  async getEmbedding(text: string): Promise<number[]> {
    try {
      const response = await fetch('http://localhost:11434/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'nomic-embed-text', // Model nhúng của Ollama
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

  // 2. Tìm kiếm nội dung liên quan trong MongoDB
  async searchKnowledge(queryText: string): Promise<string> {
    const queryVector = await this.getEmbedding(queryText);

    // Dùng $vectorSearch của MongoDB Atlas
    const results = await this.knowledgeModel.aggregate([
      {
        $vectorSearch: {
          index: "vector_index", // Tên Index sẽ tạo trên MongoDB Atlas
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

    if (results.length === 0) return "Không tìm thấy dữ liệu liên quan.";
    return results.map(r => r.content).join("\n\n---\n\n");
  }

  // 3. RAG Pipeline: Ép model Gemma trả lời theo Context
  async getChatResponse(userMessage: string): Promise<string> {
    try {
      // Bóc tách tài liệu từ DB
      const context = await this.searchKnowledge(userMessage);

      // Tạo prompt nhốt AI vào khuôn khổ
      const fullPrompt = `Bạn là trợ lý ảo của hệ thống ký túc xá Dormify.
Hãy trả lời sinh viên ngắn gọn, thân thiện và chính xác dựa HOÀN TOÀN vào tài liệu sau đây:
<tai_lieu>
${context}
</tai_lieu>

Nếu câu hỏi nằm ngoài tài liệu, hãy nói: "Xin lỗi, hiện tại tôi chưa có thông tin về vấn đề này." Tuyệt đối không tự bịa ra thông tin.

Sinh viên: ${userMessage}
Trợ lý:`;

      // Gọi Ollama chạy model Gemma
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gemma:2b', // Model trả lời
          prompt: fullPrompt,
          stream: false // Nhận 1 cục kết quả luôn, không stream từng chữ
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data.response;

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