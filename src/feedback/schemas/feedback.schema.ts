import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { FeedbackCategory, FeedbackStatus, FeedbackType } from '../feedback.enum';

export type FeedbackDocument = Feedback & Document;

@Schema({ timestamps: true })
export class Feedback {
  // Sinh viên gửi — không hỗ trợ ẩn danh
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  student!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: Object.values(FeedbackType) })
  type!: string;

  @Prop({
    type: String,
    enum: Object.values(FeedbackCategory),
    default: FeedbackCategory.OTHER,
  })
  category!: string;

  @Prop({ required: true, maxlength: 1000 })
  message!: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(FeedbackStatus),
    default: FeedbackStatus.PENDING,
  })
  status!: string;

  // Chỉ có khi đã được ban quản lý phản hồi (bắt buộc khi rời PENDING)
  @Prop({ maxlength: 1000 })
  response?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  respondedBy?: Types.ObjectId;

  @Prop()
  respondedAt?: Date;
}

export const FeedbackSchema = SchemaFactory.createForClass(Feedback);

FeedbackSchema.index({ student: 1, createdAt: -1 });
FeedbackSchema.index({ status: 1, type: 1, createdAt: -1 });
