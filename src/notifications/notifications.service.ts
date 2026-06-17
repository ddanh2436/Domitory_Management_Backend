import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Notification, NotificationDocument } from './schemas/notification.schema';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name) private notifModel: Model<NotificationDocument>,
    private readonly gateway: NotificationsGateway,
  ) {}

  // Hàm quan trọng nhất: Vừa lưu DB, vừa bắn Socket "ngay lập tức"
  async createAndSend(data: { recipient: string; title: string; message: string; type: string; link?: string }) {
    // 1. Lưu vào Database
    const newNotif = await this.notifModel.create({
      recipient: new Types.ObjectId(data.recipient),
      title: data.title,
      message: data.message,
      type: data.type,
      link: data.link,
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

  async markAsRead(notifId: string) {
    return this.notifModel.findByIdAndUpdate(notifId, { isRead: true }, { returnDocument: 'after' });
  }
}