import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { TransferStatus } from '../transfers.enum';

export type TransferDocument = Transfer & Document;

// Yêu cầu đổi phòng: sinh viên đang ở fromRoom xin chuyển sang toRoom,
// admin duyệt thì mới thực sự chuyển (cập nhật occupancy, user.room, hợp đồng).
@Schema({ timestamps: true })
export class Transfer {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  fromRoom!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  toRoom!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  reason!: string;

  @Prop({
    required: true,
    enum: Object.values(TransferStatus),
    default: TransferStatus.PENDING,
  })
  status!: string;

  // Thời điểm admin duyệt/từ chối
  @Prop()
  processedAt?: Date;
}

export const TransferSchema = SchemaFactory.createForClass(Transfer);
