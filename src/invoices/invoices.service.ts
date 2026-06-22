import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
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

  // ─── 1. Tạo hóa đơn mới ────────────────────────────────────────────────────

  async createInvoice(dto: CreateInvoiceDto): Promise<Invoice> {
    const { roomId, month, year, electricityFee, waterFee } = dto;

    this.validateObjectId(roomId, 'roomId');

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

  async markOverdueInvoices(): Promise<{ updated: number }> {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Tất cả hóa đơn PENDING của tháng trước trở về trước → OVERDUE
    const result = await this.invoiceModel.updateMany(
      {
        status: InvoiceStatus.PENDING,
        $or: [
          { year: { $lt: currentYear } },
          { year: currentYear, month: { $lt: currentMonth } },
        ],
      },
      { status: InvoiceStatus.OVERDUE },
    );

    return { updated: result.modifiedCount };
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