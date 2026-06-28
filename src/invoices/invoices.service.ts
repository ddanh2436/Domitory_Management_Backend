import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types, isValidObjectId } from 'mongoose';
import { Invoice, InvoiceDocument } from './schemas/invoice.schema';
import { Room, RoomDocument } from '../rooms/schemas/room.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { InvoiceStatus } from './invoices.enum';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { QueryInvoiceDto } from './dto/query-invoice.dto';
import { NotificationsService } from '../notifications/notifications.service';

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface OverdueInvoiceSnapshot {
  _id: Types.ObjectId;
  room: Types.ObjectId;
  month: number;
  year: number;
  totalAmount: number;
  dueDate?: Date;
}

@Injectable()
export class InvoicesService {
  constructor(
    @InjectModel(Invoice.name) private invoiceModel: Model<InvoiceDocument>,
    @InjectModel(Room.name) private roomModel: Model<RoomDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ─── Helper ────────────────────────────────────────────────────────────────

  private validateObjectId(id: string, label = 'ID'): void {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`${label} "${id}" không đúng định dạng`);
    }
  }

  private parseDueDate(value?: string): Date {
    if (!value) {
      throw new BadRequestException('Vui lòng chọn hạn đóng tiền cho hóa đơn');
    }

    const dueDate = new Date(value);
    if (Number.isNaN(dueDate.getTime())) {
      throw new BadRequestException('Hạn đóng tiền không hợp lệ');
    }

    if (dueDate <= new Date()) {
      throw new BadRequestException('Hạn đóng tiền phải sau thời điểm hiện tại');
    }

    return dueDate;
  }

  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
    }).format(amount);
  }

  private formatDateTime(date?: Date): string {
    if (!date) return 'hạn đóng tiền đã đặt';

    return new Intl.DateTimeFormat('vi-VN', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date);
  }

  // ─── 1. Tạo hóa đơn mới ────────────────────────────────────────────────────

  async createInvoice(dto: CreateInvoiceDto): Promise<Invoice> {
    const { roomId, month, year, electricityFee, waterFee, dueDate } = dto;

    this.validateObjectId(roomId, 'roomId');
    const parsedDueDate = this.parseDueDate(dueDate);

    // Kiểm tra phòng tồn tại
    const room = await this.roomModel.findById(roomId).lean();
    if (!room) {
      throw new NotFoundException(`Không tìm thấy phòng có ID "${roomId}"`);
    }

    // Kiểm tra hóa đơn tháng này đã tồn tại chưa
    const duplicate = await this.invoiceModel.findOne({
      room: roomId,
      month,
      year,
    });
    if (duplicate) {
      throw new ConflictException(
        `Phòng "${room.name}" đã có hóa đơn tháng ${month}/${year}`,
      );
    }

    const totalAmount = room.price + electricityFee + waterFee;

    return this.invoiceModel.create({
      room: new Types.ObjectId(roomId),
      month,
      year,
      roomFee: room.price,
      electricityFee,
      waterFee,
      totalAmount,
      dueDate: parsedDueDate,
      status: InvoiceStatus.PENDING,
    });
  }

  // ─── 2. Lấy danh sách hóa đơn (có filter + pagination) ─────────────────────

  async getAllInvoices(
    query: QueryInvoiceDto,
  ): Promise<PaginatedResult<Invoice>> {
    const { page = 1, limit = 20, roomId, month, year, status } = query;

    const filter: any = {};

    if (roomId) {
      this.validateObjectId(roomId, 'roomId');
      filter.room = new Types.ObjectId(roomId);
    }
    if (month) filter.month = month;
    if (year) filter.year = year;
    if (status) filter.status = status;

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.invoiceModel
        .find(filter)
        .populate('room', 'name building')
        .sort({ year: -1, month: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.invoiceModel.countDocuments(filter),
    ]);

    return {
      data: data as Invoice[],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ─── 3. Lấy toàn bộ hóa đơn của một phòng ──────────────────────────────────

  async getInvoicesByRoom(roomId: string): Promise<Invoice[]> {
    this.validateObjectId(roomId, 'roomId');

    const roomExists = await this.roomModel.exists({ _id: roomId });
    if (!roomExists) {
      throw new NotFoundException(`Không tìm thấy phòng có ID "${roomId}"`);
    }

    return this.invoiceModel
      .find({ room: new Types.ObjectId(roomId) })
      .sort({ year: -1, month: -1 })
      .lean() as Promise<Invoice[]>;
  }

  // ─── 4. Xác nhận đã thu tiền ────────────────────────────────────────────────

  async markAsPaid(
    invoiceId: string,
  ): Promise<{ message: string; invoice: Invoice }> {
    this.validateObjectId(invoiceId, 'invoiceId');

    // Lấy invoice hiện tại để kiểm tra trạng thái
    const invoice = await this.invoiceModel.findById(invoiceId);
    if (!invoice) {
      throw new NotFoundException(
        `Không tìm thấy hóa đơn có ID "${invoiceId}"`,
      );
    }

    // Idempotency: tránh update thừa nếu đã PAID
    if (invoice.status === InvoiceStatus.PAID) {
      throw new ConflictException('Hóa đơn này đã được thanh toán trước đó');
    }

    invoice.status = InvoiceStatus.PAID;
    invoice.paidAt = new Date(); // Ghi nhận thời điểm thanh toán
    await invoice.save();

    return { message: 'Xác nhận thanh toán thành công', invoice };
  }

  // ─── 5. Đánh dấu hóa đơn quá hạn (chạy bằng Cron Job) ─────────────────────

  @Cron(CronExpression.EVERY_MINUTE)
  async handleOverdueInvoicesCron(): Promise<void> {
    const result = await this.markOverdueInvoices();
    if (result.updated > 0) {
      console.log(
        `Marked ${result.updated} overdue invoice(s), sent ${result.notified} notification(s).`,
      );
    }
  }

  async markOverdueInvoices(): Promise<{ updated: number; notified: number }> {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const candidates = await this.invoiceModel
      .find({
        status: InvoiceStatus.PENDING,
        $or: [
          { dueDate: { $lte: now } },
          {
            $and: [
              { $or: [{ dueDate: { $exists: false } }, { dueDate: null }] },
              {
                $or: [
                  { year: { $lt: currentYear } },
                  { year: currentYear, month: { $lt: currentMonth } },
                ],
              },
            ],
          },
        ],
      })
      .select('_id room month year totalAmount dueDate')
      .lean();

    let updated = 0;
    let notified = 0;

    for (const invoice of candidates) {
      const overdueInvoice = await this.invoiceModel
        .findOneAndUpdate(
          { _id: invoice._id, status: InvoiceStatus.PENDING },
          { status: InvoiceStatus.OVERDUE, overdueAt: now },
          { returnDocument: 'after' },
        )
        .lean();

      if (!overdueInvoice) {
        continue;
      }

      updated += 1;
      notified += await this.notifyStudentsAboutOverdueInvoice(overdueInvoice);
    }

    return { updated, notified };
  }

  private async notifyStudentsAboutOverdueInvoice(
    invoice: OverdueInvoiceSnapshot,
  ): Promise<number> {
    try {
      const students = await this.userModel
        .find({ room: invoice.room, role: 'STUDENT' })
        .select('_id')
        .lean();

      const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : undefined;
      const results = await Promise.allSettled(
        students.map((student) =>
          this.notificationsService.createAndSend({
            recipient: student._id.toString(),
            title: 'Hóa đơn đã quá hạn thanh toán',
            message: `Hóa đơn tháng ${invoice.month}/${invoice.year} trị giá ${this.formatCurrency(invoice.totalAmount)} đã hết hạn đóng tiền lúc ${this.formatDateTime(dueDate)}. Vui lòng thanh toán sớm để tránh phát sinh xử lý tiếp theo.`,
            type: 'INVOICE',
            link: '/student/invoices',
          }),
        ),
      );

      return results.filter((result) => result.status === 'fulfilled').length;
    } catch (err) {
      console.error('Lỗi gửi thông báo hóa đơn quá hạn:', err);
      return 0;
    }
  }

async mockPay(invoiceId: string) {
    const invoice = await this.invoiceModel.findById(invoiceId);
    if (!invoice) throw new NotFoundException('Không tìm thấy hóa đơn');
    if (invoice.status === 'PAID') throw new BadRequestException('Hóa đơn này đã được thanh toán');

    // 1. Đổi trạng thái thành PAID dưới DB
    invoice.status = 'PAID';
    invoice.paidAt = new Date();
    await invoice.save();

    // 2. TỰ ĐỘNG BẮN THÔNG BÁO REAL-TIME NGAY KHI VỪA ĐỔI TRẠNG THÁI XONG
    try {
      // Tìm tên phòng để hiển thị nội dung thông báo cho sinh động
      const room = await this.roomModel.findById(invoice.room).lean();
      const roomName = room ? room.name : 'của phòng';

      // Tìm tất cả sinh viên đang thuộc phòng này để bắn thông báo đồng loạt
      const students = await this.userModel.find({ room: invoice.room }).select('_id').lean();
      for (const student of students) {
        await this.notificationsService.createAndSend({
          recipient: student._id.toString(),
          title: 'Thanh toán hóa đơn thành công! 💳',
          message: `Hóa đơn kỳ tháng ${invoice.month}/${invoice.year} đã được gạch nợ thành công.`,
          type: 'INVOICE',
          link: '/student/invoices'
        });
      }

      // Bắn thông báo cho toàn bộ Admin để biết phòng này đã đóng tiền
      const admins = await this.userModel.find({ role: 'ADMIN' }).select('_id').lean();
      for (const admin of admins) {
        await this.notificationsService.createAndSend({
          recipient: admin._id.toString(),
          title: 'Hóa đơn đã được đóng 💰',
          message: `Phòng ${roomName} đã hoàn tất thanh toán hóa đơn kỳ tháng ${invoice.month}/${invoice.year}.`,
          type: 'INVOICE',
          link: '/admin/invoices'
        });
      }
    } catch (err) {
      console.error("Lỗi gửi thông báo real-time khi thanh toán hóa đơn:", err);
    }

    return { message: 'Thanh toán thành công!', invoice };
  }

  async getRevenueStats() {
    const stats = await this.invoiceModel.aggregate([
      {
        $group: {
          _id: { month: '$month', year: '$year' },
          roomFee: { $sum: '$roomFee' },
          electricityFee: { $sum: '$electricityFee' },
          waterFee: { $sum: '$waterFee' },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    return stats.map(s => ({
      name: `Tháng ${s._id.month}/${s._id.year}`,
      'Phòng': s.roomFee,
      'Điện': s.electricityFee,
      'Nước': s.waterFee,
    })).slice(-6); 
  }
}
