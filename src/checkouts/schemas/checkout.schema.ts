import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { CheckoutStatus } from '../checkouts.enum';

export type CheckoutDocument = Checkout & Document;

// Một hạng mục hư hỏng ghi nhận khi kiểm tra tài sản lúc trả phòng (FR19/FR20).
// VD: { itemName: 'Bàn học', fee: 200000, note: 'Gãy chân bàn' }
@Schema({ _id: false })
export class DamageItem {
  @Prop({ required: true, trim: true })
  itemName!: string;

  @Prop({ required: true, min: 0 })
  fee!: number;

  @Prop({ trim: true })
  note?: string;
}

const DamageItemSchema = SchemaFactory.createForClass(DamageItem);

// Yêu cầu trả phòng (FR18-FR21): sinh viên gửi yêu cầu, quản lý kiểm tra
// tài sản, tính phí bồi thường trừ vào tiền cọc rồi hoàn số còn lại.
// Khi hoàn tất: hợp đồng bị thanh lý, phòng được trả chỗ, user rời phòng.
@Schema({ timestamps: true })
export class Checkout {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  room!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contract', required: true })
  contract!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  reason!: string;

  // Ngày sinh viên dự kiến rời khỏi phòng
  @Prop({ required: true })
  expectedDate!: Date;

  @Prop({
    required: true,
    enum: Object.values(CheckoutStatus),
    default: CheckoutStatus.PENDING,
  })
  status!: string;

  // ── Kết quả xử lý của quản lý (chỉ có khi COMPLETED/REJECTED) ──────────────
  @Prop({ type: [DamageItemSchema], default: [] })
  damages!: DamageItem[];

  // Tiền cọc snapshot lúc tạo yêu cầu (mặc định = 1 tháng tiền phòng của hợp
  // đồng); quản lý được điều chỉnh lại khi hoàn tất nếu mức cọc thực tế khác.
  @Prop({ required: true, min: 0 })
  depositAmount!: number;

  // Tổng phí bồi thường = tổng fee các hạng mục hư hỏng
  @Prop({ min: 0 })
  compensationAmount?: number;

  // Số tiền hoàn lại = max(0, depositAmount - compensationAmount)
  @Prop({ min: 0 })
  refundAmount?: number;

  // Ghi chú của quản lý khi hoàn tất/từ chối
  @Prop({ trim: true })
  adminNote?: string;

  @Prop()
  processedAt?: Date;
}

export const CheckoutSchema = SchemaFactory.createForClass(Checkout);
