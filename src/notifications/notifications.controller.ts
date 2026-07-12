import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('api/notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('me')
  getMyNotifications(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = req.user.sub; // Trích xuất ID người dùng từ Token
    return this.notificationsService.getMyNotifications(
      userId,
      Number(page) || 1,
      Number(limit) || 10,
    );
  }

  @Patch('read-all')
  markAllAsRead(@Req() req: any) {
    return this.notificationsService.markAllAsRead(req.user.sub);
  }

  @Patch(':id/read')
  markAsRead(@Param('id') id: string, @Req() req: any) {
    return this.notificationsService.markAsRead(id, req.user.sub);
  }

  @Delete(':id')
  deleteNotification(@Param('id') id: string, @Req() req: any) {
    return this.notificationsService.deleteMyNotification(id, req.user.sub);
  }

  // Lịch sử các thông báo chung đã gửi
  @Get('broadcast/history')
  @Roles('ADMIN', 'DORMITORY_MANAGER')
  getBroadcastHistory() {
    return this.notificationsService.getBroadcastHistory();
  }

  // Gửi thông báo chung đến TOÀN BỘ sinh viên (chỉ quản lý cấp cao)
  @Post('broadcast')
  @Roles('ADMIN', 'DORMITORY_MANAGER')
  broadcast(@Req() req: any, @Body() body: { title: string; message: string; link?: string }) {
    return this.notificationsService.broadcastToStudents({ ...body, senderId: req.user.sub });
  }

  // Endpoint để nhận yêu cầu tạo thông báo từ Frontend
  @Post()
  createNotification(@Body() body: { userId: string; title: string; message: string }) {
    // Gọi hàm createAndSend đã viết sẵn trong service
    return this.notificationsService.createAndSend({
      recipient: body.userId,
      title: body.title,
      message: body.message,
      type: 'SYSTEM', // Gán cứng type là SYSTEM hoặc truyền từ frontend lên tùy bạn
    });
  }
}
