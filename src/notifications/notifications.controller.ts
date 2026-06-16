import { Controller, Get, Patch, Post, Body, Param, Req, UseGuards } from '@nestjs/common'; // Thêm Post, Body
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/notifications')
@UseGuards(JwtAuthGuard) 
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('me')
  getMyNotifications(@Req() req: any) {
    const userId = req.user.sub; // Trích xuất ID người dùng từ Token
    return this.notificationsService.getMyNotifications(userId);
  }

  @Patch(':id/read')
  markAsRead(@Param('id') id: string) {
    return this.notificationsService.markAsRead(id);
  }
  // Endpoint để nhận yêu cầu tạo thông báo từ Frontend
  @Post()
  createNotification(@Body() body: { userId: string; title: string; message: string }) {
    // Gọi hàm createAndSend đã viết sẵn trong service
    return this.notificationsService.createAndSend({
      recipient: body.userId,
      title: body.title,
      message: body.message,
      type: 'SYSTEM' // Gán cứng type là SYSTEM hoặc truyền từ frontend lên tùy bạn
    });
  }
}