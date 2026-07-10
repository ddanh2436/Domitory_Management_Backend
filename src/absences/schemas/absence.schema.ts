import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { AbsenceStatus, AbsenceType } from '../absences.enum';

export type AbsenceDocument = Absence & Document;

// Đơn đăng ký tạm trú (khách ở qua đêm) hoặc tạm vắng (sinh viên vắng qua đêm).
@Schema({ timestamps: true })
export class Absence {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  room!: Types.ObjectId;

  @Prop({ required: true, enum: Object.values(AbsenceType) })
  type!: string;

  @Prop({ required: true })
  startDate!: Date;

  @Prop({ required: true })
  endDate!: Date;

  @Prop({ required: true, trim: true })
  reason!: string;

  // Chỉ dùng cho TAM_TRU: thông tin người khách ở qua đêm
  @Prop({ trim: true })
  guestName?: string;

  @Prop({ trim: true })
  guestIdNumber?: string;

  @Prop({
    required: true,
    enum: Object.values(AbsenceStatus),
    default: AbsenceStatus.PENDING,
  })
  status!: string;

  @Prop()
  processedAt?: Date;
}

export const AbsenceSchema = SchemaFactory.createForClass(Absence);
