import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type NotificationDocument = Notification & Document;

@Schema({ timestamps: true })
export class Notification {
  // Gửi cho ai? (Nếu null thì là thông báo hệ thống chung)
  @Prop({ type: Types.ObjectId, ref: 'User' })
  recipient?: Types.ObjectId;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  message!: string;

  // Loại thông báo: MAINTENANCE, BOOKING, INVOICE... để đổi icon/màu sắc
  @Prop({ required: true })
  type!: string;

  @Prop({ default: false })
  isRead!: boolean;

  // Đường link để khi click vào thông báo sẽ chuyển hướng
  @Prop()
  link?: string;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);