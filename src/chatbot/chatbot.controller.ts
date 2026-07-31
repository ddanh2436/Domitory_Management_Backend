import { Controller, Post, Body, UseGuards, Req, Res } from '@nestjs/common';
import { ChatbotService } from './chatbot.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { Response, Request } from 'express';

@Controller('api/chatbot')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Post('ask')
  async askChatbot(@Body('message') message: string, @Req() req: any) {
    if (!message?.trim()) {
      return { reply: 'Bạn cần nhập nội dung tin nhắn.' };
    }

    const userId = req.user?.sub || req.user?.userId || req.user?._id || req.user?.id;
    const reply = await this.chatbotService.getChatResponse(message, userId);
    return { reply };
  }

  @Post('ingest')
  @Roles('ADMIN')
  async triggerIngest() {
    const result = await this.chatbotService.ingestData();
    return { status: 'success', message: result };
  }

  @Post('stream')
  async streamChat(
    @Body() body: { message?: string },
    @Res() res: Response,
    @Req() req: Request,
  ) {
    try {
      const message = body?.message?.trim();

      if (!message) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.write(
          `data: ${JSON.stringify({ type: 'text', text: 'Bạn cần nhập nội dung tin nhắn.' })}\n\n`,
        );
        res.end();
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      const userId = (req as any).user?.sub || (req as any).user?.userId || (req as any).user?._id || (req as any).user?.id;

      const stream$ = await this.chatbotService.streamChatResponse(message, userId);

      const subscription = stream$.subscribe({
        next: (event) => {
          // Sự kiện chữ vẫn giữ nguyên khoá `text` như trước; các sự kiện mới
          // (status/sources/invoice/notfound) phân biệt bằng khoá `type`.
          if (event.type === 'text' && !event.text) return;
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        },
        error: (err) => {
          console.error('Lỗi luồng stream:', err);
          res.write(
            `data: ${JSON.stringify({ type: 'text', text: '\n\n[Đã có lỗi xảy ra trong quá trình sinh văn bản.]' })}\n\n`,
          );
          res.end();
        },
        complete: () => {
          res.end();
        },
      });

      req.on('close', () => {
        subscription.unsubscribe();
      });
    } catch (error) {
      console.error('Lỗi khởi tạo chatbot stream:', error);
      res.write(
        `data: ${JSON.stringify({ type: 'text', text: 'Xin lỗi, hệ thống AI hiện không phản hồi. Vui lòng kiểm tra lại kết nối.' })}\n\n`,
      );
      res.end();
    }
  }
}