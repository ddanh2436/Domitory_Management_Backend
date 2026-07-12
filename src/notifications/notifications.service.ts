import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Notification, NotificationDocument } from './schemas/notification.schema';
import { Announcement, AnnouncementDocument } from './schemas/announcement.schema';
import { NotificationsGateway } from './notifications.gateway';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly unreadRetentionDays = 30;
  private readonly readRetentionDays = 10;

  constructor(
    @InjectModel(Notification.name) private notifModel: Model<NotificationDocument>,
    @InjectModel(Announcement.name) private announcementModel: Model<AnnouncementDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly gateway: NotificationsGateway,
  ) {}

  async onModuleInit() {
    await this.backfillMissingExpireAt();
  }

  private addDays(date: Date, days: number) {
    const expireAt = new Date(date);
    expireAt.setDate(expireAt.getDate() + days);
    return expireAt;
  }

  private getUnreadExpireAt(from = new Date()) {
    return this.addDays(from, this.unreadRetentionDays);
  }

  private getReadExpireAt(from = new Date()) {
    return this.addDays(from, this.readRetentionDays);
  }

  private async backfillMissingExpireAt() {
    const now = new Date();

    await Promise.all([
      this.notifModel.updateMany(
        { expireAt: { $exists: false }, isRead: true },
        { $set: { expireAt: this.getReadExpireAt(now) } },
      ),
      this.notifModel.updateMany(
        {
          expireAt: { $exists: false },
          $or: [{ isRead: false }, { isRead: { $exists: false } }],
        },
        { $set: { expireAt: this.getUnreadExpireAt(now) } },
      ),
    ]);
  }

  // Hàm quan trọng nhất: Vừa lưu DB, vừa bắn Socket "ngay lập tức"
  async createAndSend(data: { recipient: string; title: string; message: string; type: string; link?: string }) {
    // 1. Lưu vào Database
    const newNotif = await this.notifModel.create({
      recipient: new Types.ObjectId(data.recipient),
      title: data.title,
      message: data.message,
      type: data.type,
      link: data.link,
      expireAt: this.getUnreadExpireAt(),
    });

    // 2. Bắn tín hiệu Real-time qua Socket
    this.gateway.sendToUser(data.recipient, newNotif);
    
    return newNotif;
  }

  // Danh sách thông báo có phân trang, kèm tổng số và số chưa đọc
  // để frontend hiển thị badge chuông mà không cần tải toàn bộ.
  async getMyNotifications(userId: string, page = 1, limit = 10) {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(50, Math.max(1, Math.floor(limit) || 10));
    const recipient = new Types.ObjectId(userId);

    const [data, total, unreadCount] = await Promise.all([
      this.notifModel
        .find({ recipient })
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      this.notifModel.countDocuments({ recipient }),
      this.notifModel.countDocuments({ recipient, isRead: false }),
    ]);

    return {
      data,
      total,
      unreadCount,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    };
  }

  // Đánh dấu toàn bộ thông báo chưa đọc là đã đọc (dùng cho nút trên chuông)
  async markAllAsRead(userId: string) {
    const readAt = new Date();
    const result = await this.notifModel.updateMany(
      { recipient: new Types.ObjectId(userId), isRead: false },
      { isRead: true, readAt, expireAt: this.getReadExpireAt(readAt) },
    );
    return { message: 'Đã đánh dấu tất cả là đã đọc.', modified: result.modifiedCount };
  }

  // Lịch sử các thông báo chung đã gửi (mới nhất trước)
  async getBroadcastHistory() {
    return this.announcementModel
      .find()
      .populate('sentBy', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
  }

  // Gửi thông báo cho TOÀN BỘ sinh viên: lưu mỗi người một bản ghi rồi bắn socket riêng
  // để badge/danh sách của từng người đều chính xác.
  async broadcastToStudents(data: { title: string; message: string; link?: string; senderId?: string }) {
    if (!data.title?.trim() || !data.message?.trim()) {
      throw new BadRequestException('Vui lòng nhập đầy đủ tiêu đề và nội dung.');
    }

    const students = await this.userModel
      .find({ role: 'STUDENT', accessStatus: { $ne: 'LOCKED' } })
      .select('_id')
      .lean();

    if (students.length === 0) {
      return { message: 'Không có sinh viên nào để gửi.', sent: 0 };
    }

    const expireAt = this.getUnreadExpireAt();
    const docs = await this.notifModel.insertMany(
      students.map((student) => ({
        recipient: student._id,
        title: data.title.trim(),
        message: data.message.trim(),
        type: 'SYSTEM',
        link: data.link,
        expireAt,
      })),
    );

    for (const doc of docs) {
      this.gateway.sendToUser(String(doc.recipient), doc);
    }

    // Lưu lịch sử để admin xem lại — lỗi lưu lịch sử không làm hỏng việc gửi
    try {
      await this.announcementModel.create({
        title: data.title.trim(),
        message: data.message.trim(),
        sentBy: data.senderId ? new Types.ObjectId(data.senderId) : undefined,
        sentCount: docs.length,
      });
    } catch (err) {
      console.error('Lỗi lưu lịch sử thông báo:', err);
    }

    return { message: `Đã gửi thông báo đến ${docs.length} sinh viên.`, sent: docs.length };
  }

  async markAsRead(notifId: string, userId: string) {
    if (!isValidObjectId(notifId)) {
      throw new BadRequestException('ID thông báo không hợp lệ');
    }

    const readAt = new Date();
    const notification = await this.notifModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(notifId),
        recipient: new Types.ObjectId(userId),
      },
      {
        isRead: true,
        readAt,
        expireAt: this.getReadExpireAt(readAt),
      },
      { returnDocument: 'after' },
    );

    if (!notification) {
      throw new NotFoundException('Không tìm thấy thông báo cần cập nhật');
    }

    return notification;
  }

  async deleteMyNotification(notifId: string, userId: string) {
    if (!isValidObjectId(notifId)) {
      throw new BadRequestException('ID thông báo không hợp lệ');
    }

    const result = await this.notifModel.deleteOne({
      _id: new Types.ObjectId(notifId),
      recipient: new Types.ObjectId(userId),
    });

    if (result.deletedCount === 0) {
      throw new NotFoundException('Không tìm thấy thông báo cần xóa');
    }

    return { message: 'Da xoa thong bao', deletedId: notifId };
  }
}
