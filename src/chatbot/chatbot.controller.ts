import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { ChatbotService } from './chatbot.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('api/chatbot')
// Mọi endpoint đều yêu cầu đăng nhập; RolesGuard chỉ chặn thêm khi có @Roles
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  // Bất kỳ user đã đăng nhập nào cũng hỏi được (không gắn @Roles).
  // Lấy userId từ token để cá nhân hóa câu trả lời (đọc phòng/hóa đơn/hợp đồng thật).
  @Post('ask')
  async askChatbot(@Body('message') message: string, @Req() req: any) {
    if (!message) {
      return { reply: "Bạn cần nhập nội dung tin nhắn." };
    }
    const userId = req.user?.sub || req.user?.userId || req.user?._id || req.user?.id;
    const reply = await this.chatbotService.getChatResponse(message, userId);
    return { reply };
  }

  // Nạp lại kho tri thức: xóa sạch DB rồi ingest lại nên chỉ ADMIN được phép
  @Post('ingest')
  @Roles('ADMIN')
  async triggerIngest() {
    const result = await this.chatbotService.ingestData();
    return { status: "success", message: result };
  }
}
