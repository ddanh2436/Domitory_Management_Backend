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

  @Prop()
  dueDate?: Date;

  // Trạng thái hóa đơn
  @Prop({
    required: true,
    enum: Object.values(InvoiceStatus),
    default: InvoiceStatus.PENDING,
  })
  status!: string;

  @Prop()
  paidAt?: Date;

  @Prop()
  overdueAt?: Date;
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);

// Mỗi phòng chỉ có duy nhất 1 hóa đơn cho mỗi kỳ tháng/năm —
// chặn tạo trùng ở tầng CSDL kể cả khi 2 request chạy song song.
InvoiceSchema.index({ room: 1, month: 1, year: 1 }, { unique: true });
