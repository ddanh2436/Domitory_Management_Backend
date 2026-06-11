import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { InvoiceStatus } from '../invoices.enum';

export type InvoiceDocument = Invoice & Document;

@Schema({ timestamps: true })
export class Invoice {
  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  room!: Types.ObjectId;

  @Prop({ required: true })
  month!: number;

  @Prop({ required: true })
  year!: number;

  @Prop({ required: true, min: 0 })
  roomFee!: number;

  @Prop({ required: true, min: 0, default: 0 })
  electricityFee!: number;

  @Prop({ required: true, min: 0, default: 0 })
  waterFee!: number;

  // Tổng tiền (Sẽ được tự động tính toán)
  @Prop({ required: true, min: 0 })
  totalAmount!: number;

  // Trạng thái hóa đơn
  @Prop({
    required: true,
    enum: Object.values(InvoiceStatus),
    default: InvoiceStatus.PENDING,
  })
  status!: string;

  @Prop()
  paidAt?: Date;
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);