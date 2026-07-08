import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { QueryInvoiceDto } from './dto/query-invoice.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('api/invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  // 1. Admin tạo hóa đơn mới
  @Post()
  @Roles('ADMIN', 'DORMITORY_MANAGER')
  create(@Body() createInvoiceDto: CreateInvoiceDto) {
    return this.invoicesService.createInvoice(createInvoiceDto);
  }

  // 2. Admin xem danh sách toàn bộ hóa đơn (Có phân trang & Lọc)
  @Get()
  @Roles('ADMIN', 'DORMITORY_MANAGER')
  findAll(@Query() query: QueryInvoiceDto) {
    // ValidationPipe (transform: true) đã tự ép kiểu page/limit/month/year sang number
    return this.invoicesService.getAllInvoices(query);
  }

  // 3. Xem danh sách hóa đơn theo ID phòng (Admin hoặc Student đều xem được)
  @Get('room/:roomId')
  @Roles('ADMIN', 'DORMITORY_MANAGER', 'FLOOR_MANAGER', 'STUDENT')
  findByRoom(@Param('roomId') roomId: string, @Req() req: any) {
    return this.invoicesService.getInvoicesByRoom(roomId, {
      userId: req.user.sub,
      role: req.user.role,
    });
  }

  @Get('stats/revenue')
  @Roles('ADMIN')
  getRevenueStats() {
    return this.invoicesService.getRevenueStats();
  }

  // 4. Admin đánh dấu hóa đơn đã thanh toán
  @Patch(':id/pay')
  @Roles('ADMIN', 'DORMITORY_MANAGER')
  markAsPaid(@Param('id') id: string) {
    return this.invoicesService.markAsPaid(id);
  }

  // 5. Nút thủ công để Admin kích hoạt cập nhật hóa đơn quá hạn (Thay vì đợi Cron job)
  @Post('trigger-overdue')
  @Roles('ADMIN', 'DORMITORY_MANAGER')
  triggerOverdue() {
    return this.invoicesService.markOverdueInvoices();
  }

  @Patch(':id/pay-mock')
  @Roles('STUDENT')
  mockPayInvoice(@Param('id') id: string, @Req() req: any) {
    return this.invoicesService.mockPay(id, req.user.sub);
  }
}
