import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ViolationStatus } from '../violations.enum';

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

  // Trạng thái vòng đời khiếu nại/thu hồi
  @Prop({
    required: true,
    enum: Object.values(ViolationStatus),
    default: ViolationStatus.ACTIVE,
  })
  status!: string;

  // Lý do sinh viên khiếu nại
  @Prop({ maxlength: 500 })
  appealReason?: string;

  @Prop()
  appealedAt?: Date;

  // Ghi chú của ban quản lý khi duyệt khiếu nại / thu hồi
  @Prop({ maxlength: 500 })
  reviewNote?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  reviewedBy?: Types.ObjectId;

  @Prop()
  reviewedAt?: Date;
}

export const ViolationSchema = SchemaFactory.createForClass(Violation);
