import { 
  Controller, 
  Get, 
  Post, 
  Patch, 
  Param, 
  Body, 
  Req, 
  UseGuards 
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('api/bookings')
@UseGuards(JwtAuthGuard, RolesGuard) // Bắt buộc đăng nhập cho toàn bộ Controller
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

@Post()
  @Roles('STUDENT')
  createBooking(@Req() req: any, @Body('roomId') roomId: string) {
    // Lấy chính xác trường 'sub' từ JWT Payload
    const userId = req.user.sub; 
    return this.bookingsService.createBooking(userId, roomId);
  }

  @Get('me')
  @Roles('STUDENT')
  getMyBookings(@Req() req: any) {
    const userId = req.user.sub;
    return this.bookingsService.getBookingsByUser(userId);
  }

  @Patch(':id/cancel')
  @Roles('STUDENT')
  cancelBooking(@Req() req: any, @Param('id') bookingId: string) {
    const userId = req.user.sub;
    return this.bookingsService.cancelBooking(userId, bookingId);
  }
  @Get()
  @Roles('ADMIN', 'DORMITORY_MANAGER', 'FLOOR_MANAGER')
  getAllBookings() {
    return this.bookingsService.getAllBookings();
  }

  @Patch(':id/approve')
  @Roles('ADMIN', 'DORMITORY_MANAGER', 'FLOOR_MANAGER')
  approveBooking(@Param('id') bookingId: string) {
    return this.bookingsService.approveBooking(bookingId);
  }

  @Patch(':id/reject')
  @Roles('ADMIN', 'DORMITORY_MANAGER', 'FLOOR_MANAGER')
  rejectBooking(@Param('id') bookingId: string) {
    return this.bookingsService.rejectBooking(bookingId);
  }
}
