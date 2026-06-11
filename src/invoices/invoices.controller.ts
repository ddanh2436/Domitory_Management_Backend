import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Patch, 
  Param, 
  Query, 
  UseGuards 
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
  @Roles('ADMIN')
  create(@Body() createInvoiceDto: CreateInvoiceDto) {
    return this.invoicesService.createInvoice(createInvoiceDto);
  }

  // 2. Admin xem danh sách toàn bộ hóa đơn (Có phân trang & Lọc)
  @Get()
  @Roles('ADMIN')
  findAll(@Query() query: any) {
    // Ép kiểu từ String trên URL sang Number cho đúng DTO
    const formattedQuery: QueryInvoiceDto = {
      ...query,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
      month: query.month ? Number(query.month) : undefined,
      year: query.year ? Number(query.year) : undefined,
    };
    return this.invoicesService.getAllInvoices(formattedQuery);
  }

  // 3. Xem danh sách hóa đơn theo ID phòng (Admin hoặc Student đều xem được)
  @Get('room/:roomId')
  @Roles('ADMIN', 'STUDENT')
  findByRoom(@Param('roomId') roomId: string) {
    return this.invoicesService.getInvoicesByRoom(roomId);
  }

  // 4. Admin đánh dấu hóa đơn đã thanh toán
  @Patch(':id/pay')
  @Roles('ADMIN')
  markAsPaid(@Param('id') id: string) {
    return this.invoicesService.markAsPaid(id);
  }

  // 5. Nút thủ công để Admin kích hoạt cập nhật hóa đơn quá hạn (Thay vì đợi Cron job)
  @Post('trigger-overdue')
  @Roles('ADMIN')
  triggerOverdue() {
    return this.invoicesService.markOverdueInvoices();
  }
}