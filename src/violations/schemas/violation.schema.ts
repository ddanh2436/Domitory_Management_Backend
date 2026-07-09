import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ViolationDocument = Violation & Document;

@Schema({ timestamps: true })
export class Violation {
  // Sinh viên bị ghi nhận vi phạm
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  student!: Types.ObjectId;

  // Lỗi vi phạm gì
  @Prop({ required: true })
  reason!: string;

  // Số điểm hành vi bị trừ
  @Prop({ required: true, min: 1, max: 100 })
  points!: number;

  // Admin đã ghi nhận vi phạm này
  @Prop({ type: Types.ObjectId, ref: 'User' })
  markedBy?: Types.ObjectId;

  // Điểm hành vi còn lại sau khi trừ (lưu vết tại thời điểm ghi nhận)
  @Prop()
  scoreAfter?: number;
}

export const ViolationSchema = SchemaFactory.createForClass(Violation);
