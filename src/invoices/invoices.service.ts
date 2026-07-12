import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
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
      throw new BadRequestException(
        'Hạn đóng tiền phải sau thời điểm hiện tại',
      );
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

    try {
      return await this.invoiceModel.create({
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
    } catch (error: any) {
      // Trường hợp 2 request tạo cùng lúc lọt qua findOne ở trên: unique index bắn E11000
      if (error?.code === 11000) {
        throw new ConflictException(
          `Phòng "${room.name}" đã có hóa đơn tháng ${month}/${year}`,
        );
      }
      throw error;
    }
  }

  // ─── 1b. Sinh hóa đơn hàng loạt theo chỉ số điện nước ──────────────────────

  async generateBulkInvoices(dto: {
    month: number;
    year: number;
    dueDate: string;
    electricityUnitPrice: number;
    waterUnitPrice: number;
    readings: { roomId: string; electricityKwh: number; waterM3: number }[];
  }) {
    const month = Number(dto.month);
    const year = Number(dto.year);
    const electricityUnitPrice = Number(dto.electricityUnitPrice);
    const waterUnitPrice = Number(dto.waterUnitPrice);

    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('Tháng phải là số nguyên từ 1 đến 12');
    }
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      throw new BadRequestException('Năm không hợp lệ');
    }
    if (
      !Number.isFinite(electricityUnitPrice) ||
      electricityUnitPrice < 0 ||
      !Number.isFinite(waterUnitPrice) ||
      waterUnitPrice < 0
    ) {
      throw new BadRequestException('Đơn giá điện/nước không hợp lệ');
    }
    if (!Array.isArray(dto.readings) || dto.readings.length === 0) {
      throw new BadRequestException('Vui lòng nhập chỉ số cho ít nhất một phòng');
    }

    const parsedDueDate = this.parseDueDate(dto.dueDate);

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];
    const notifyRoomIds: Types.ObjectId[] = [];

    for (const reading of dto.readings) {
      const kwh = Number(reading.electricityKwh);
      const m3 = Number(reading.waterM3);

      if (!isValidObjectId(reading.roomId) || !Number.isFinite(kwh) || kwh < 0 || !Number.isFinite(m3) || m3 < 0) {
        skipped += 1;
        errors.push(`Chỉ số không hợp lệ cho phòng ${reading.roomId}`);
        continue;
      }

      const room = await this.roomModel.findById(reading.roomId).lean();
      if (!room) {
        skipped += 1;
        errors.push(`Không tìm thấy phòng ${reading.roomId}`);
        continue;
      }

      // Check trùng tường minh — không phụ thuộc unique index có tồn tại trong DB hay không
      const duplicate = await this.invoiceModel
        .findOne({ room: room._id, month, year })
        .lean();
      if (duplicate) {
        skipped += 1;
        errors.push(`Phòng "${room.name}" đã có hóa đơn tháng ${month}/${year}`);
        continue;
      }

      const electricityFee = Math.round(kwh * electricityUnitPrice);
      const waterFee = Math.round(m3 * waterUnitPrice);

      try {
        await this.invoiceModel.create({
          room: room._id,
          month,
          year,
          roomFee: room.price,
          electricityFee,
          waterFee,
          totalAmount: room.price + electricityFee + waterFee,
          dueDate: parsedDueDate,
          status: InvoiceStatus.PENDING,
        });
        created += 1;
        notifyRoomIds.push(room._id as Types.ObjectId);
      } catch (error: any) {
        // Unique index (room, month, year): phòng đã có hóa đơn kỳ này thì bỏ qua
        if (error?.code === 11000) {
          skipped += 1;
          errors.push(`Phòng "${room.name}" đã có hóa đơn tháng ${month}/${year}`);
        } else {
          throw error;
        }
      }
    }

    // Báo cho sinh viên trong các phòng vừa phát hành hóa đơn — lỗi thông báo
    // không được làm hỏng kết quả sinh hóa đơn.
    if (notifyRoomIds.length > 0) {
      try {
        const students = await this.userModel
          .find({ room: { $in: notifyRoomIds } })
          .select('_id')
          .lean();
        for (const student of students) {
          await this.notificationsService.createAndSend({
            recipient: student._id.toString(),
            title: `Hóa đơn tháng ${month}/${year} đã phát hành 🧾`,
            message: `Hóa đơn tiền phòng và điện nước của phòng bạn đã được tạo. Hạn đóng: ${this.formatDateTime(parsedDueDate)}.`,
            type: 'INVOICE',
            link: '/student/invoices',
          });
        }
      } catch (err) {
        console.error('Lỗi gửi thông báo hóa đơn hàng loạt:', err);
      }
    }

    return {
      message: `Đã tạo ${created} hóa đơn tháng ${month}/${year}${skipped > 0 ? `, bỏ qua ${skipped} phòng` : ''}.`,
      created,
      skipped,
      errors,
    };
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
        .populate('room', 'name building floor')
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

  async getInvoicesByRoom(
    roomId: string,
    requester?: { userId: string; role: string },
  ): Promise<Invoice[]> {
    this.validateObjectId(roomId, 'roomId');

    // Sinh viên chỉ được xem hóa đơn của chính phòng mình đang ở
    if (requester && requester.role === 'STUDENT') {
      const user = await this.userModel
        .findById(requester.userId)
        .select('room')
        .lean();
      if (!user || !user.room || user.room.toString() !== roomId) {
        throw new ForbiddenException(
          'Bạn chỉ có thể xem hóa đơn của phòng mình đang ở',
        );
      }
    }

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

    // Gửi thông báo giống hệt luồng sinh viên tự thanh toán (thống nhất 2 đường)
    await this.sendPaymentNotifications(invoice);

    return { message: 'Xác nhận thanh toán thành công', invoice };
  }

  // Gửi thông báo real-time cho sinh viên trong phòng + toàn bộ Admin khi hóa đơn được thanh toán.
  // Lỗi gửi thông báo không được làm hỏng kết quả thanh toán đã lưu.
  private async sendPaymentNotifications(
    invoice: InvoiceDocument,
  ): Promise<void> {
    try {
      const room = await this.roomModel.findById(invoice.room).lean();
      const roomName = room ? room.name : 'của phòng';

      const students = await this.userModel
        .find({ room: invoice.room, role: 'STUDENT' })
        .select('_id')
        .lean();
      for (const student of students) {
        await this.notificationsService.createAndSend({
          recipient: student._id.toString(),
          title: 'Thanh toán hóa đơn thành công! 💳',
          message: `Hóa đơn kỳ tháng ${invoice.month}/${invoice.year} đã được gạch nợ thành công.`,
          type: 'INVOICE',
          link: '/student/invoices',
        });
      }

      const admins = await this.userModel
        .find({ role: 'ADMIN' })
        .select('_id')
        .lean();
      for (const admin of admins) {
        await this.notificationsService.createAndSend({
          recipient: admin._id.toString(),
          title: 'Hóa đơn đã được đóng 💰',
          message: `Phòng ${roomName} đã hoàn tất thanh toán hóa đơn kỳ tháng ${invoice.month}/${invoice.year}.`,
          type: 'INVOICE',
          link: '/admin/invoices',
        });
      }
    } catch (err) {
      console.error('Lỗi gửi thông báo real-time khi thanh toán hóa đơn:', err);
    }
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

  async mockPay(invoiceId: string, userId: string) {
    this.validateObjectId(invoiceId, 'invoiceId');

    const invoice = await this.invoiceModel.findById(invoiceId);
    if (!invoice) throw new NotFoundException('Không tìm thấy hóa đơn');
    if (invoice.status === InvoiceStatus.PAID)
      throw new BadRequestException('Hóa đơn này đã được thanh toán');

    // Sinh viên chỉ được thanh toán hóa đơn thuộc phòng của chính mình
    const user = await this.userModel.findById(userId).select('room').lean();
    if (
      !user ||
      !user.room ||
      user.room.toString() !== invoice.room.toString()
    ) {
      throw new ForbiddenException(
        'Bạn không có quyền thanh toán hóa đơn của phòng này',
      );
    }

    // Đổi trạng thái thành PAID dưới DB
    invoice.status = InvoiceStatus.PAID;
    invoice.paidAt = new Date();
    await invoice.save();

    // Bắn thông báo real-time (dùng chung một luồng với thao tác của Admin)
    await this.sendPaymentNotifications(invoice);

    return { message: 'Thanh toán thành công!', invoice };
  }

  async getRevenueStats() {
    const stats = await this.invoiceModel.aggregate([
      // Chỉ tính doanh thu THỰC THU (hóa đơn đã thanh toán), bỏ hóa đơn chưa đóng/quá hạn
      { $match: { status: InvoiceStatus.PAID } },
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

    return stats
      .map((s) => ({
        name: `Tháng ${s._id.month}/${s._id.year}`,
        Phòng: s.roomFee,
        Điện: s.electricityFee,
        Nước: s.waterFee,
      }))
      .slice(-6);
  }
}
