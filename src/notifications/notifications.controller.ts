import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
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
  markAsRead(@Param('id') id: string, @Req() req: any) {
    return this.notificationsService.markAsRead(id, req.user.sub);
  }

  @Delete(':id')
  deleteNotification(@Param('id') id: string, @Req() req: any) {
    return this.notificationsService.deleteMyNotification(id, req.user.sub);
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
