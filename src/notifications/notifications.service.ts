import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Notification, NotificationDocument } from './schemas/notification.schema';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly unreadRetentionDays = 30;
  private readonly readRetentionDays = 10;

  constructor(
    @InjectModel(Notification.name) private notifModel: Model<NotificationDocument>,
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

  async getMyNotifications(userId: string) {
    return this.notifModel
      .find({ recipient: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
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
