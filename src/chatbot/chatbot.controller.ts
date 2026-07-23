import { Controller, Post, Body } from '@nestjs/common';
import { ChatbotService } from './chatbot.service';

@Controller('api/chatbot')
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Post('ask')
  async askChatbot(@Body('message') message: string) {
    if (!message) {
      return { reply: "Bạn cần nhập nội dung tin nhắn." };
    }
    const reply = await this.chatbotService.getChatResponse(message);
    return { reply };
  }

  // Thêm API mới này để trigger việc nạp dữ liệu
  @Post('ingest')
  async triggerIngest() {
    const result = await this.chatbotService.ingestData();
    return { status: "success", message: result };
  }
}