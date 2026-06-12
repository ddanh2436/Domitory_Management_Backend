import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ContractDocument = Contract & Document;

@Schema({ timestamps: true })
export class Contract {
  @Prop({ type: Types.ObjectId, ref: 'Booking', required: true })
  booking!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  room!: Types.ObjectId;

  @Prop({ required: true })
  contractNumber!: string; // Số hợp đồng (Ví dụ: HD-2026-001)

  @Prop({ required: true })
  startDate!: Date;

  @Prop({ required: true })
  endDate!: Date;

  @Prop({ required: true })
  rentalFee!: number;

  @Prop({ required: true, default: 'ACTIVE' })
  status!: string; // ACTIVE, EXPIRED, TERMINATED

  @Prop({ required: true })
  terms!: string; // Các điều khoản quy định kí kết
}

export const ContractSchema = SchemaFactory.createForClass(Contract);