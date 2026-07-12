import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AnnouncementDocument = Announcement & Document;

// Lịch sử các thông báo chung đã gửi đến toàn bộ sinh viên
@Schema({ timestamps: true })
export class Announcement {
  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ required: true, trim: true })
  message!: string;

  // Người bấm gửi (admin/quản lý)
  @Prop({ type: Types.ObjectId, ref: 'User' })
  sentBy?: Types.ObjectId;

  // Số sinh viên đã nhận tại thời điểm gửi
  @Prop({ required: true, default: 0 })
  sentCount!: number;
}

export const AnnouncementSchema = SchemaFactory.createForClass(Announcement);
