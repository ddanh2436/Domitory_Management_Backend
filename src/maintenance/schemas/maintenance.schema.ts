import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { MaintenanceStatus, MaintenancePriority } from '../maintenance.enum';

export type MaintenanceDocument = Maintenance & Document;

// Một mốc trong nhật ký đổi trạng thái của yêu cầu bảo trì.
// Denormalize tên + vai trò người thực hiện để hiển thị nhật ký không cần populate.
@Schema({ _id: false })
export class StatusHistoryEntry {
  @Prop({ required: true, enum: Object.values(MaintenanceStatus) })
  status!: string;

  // Ghi chú kèm mốc: lý do từ chối hoặc nội dung đã xử lý
  @Prop()
  note?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  changedBy?: Types.ObjectId;

  @Prop()
  changedByName?: string;

  @Prop()
  changedByRole?: string;

  @Prop({ required: true, default: Date.now })
  at!: Date;
}

export const StatusHistoryEntrySchema =
  SchemaFactory.createForClass(StatusHistoryEntry);

@Schema({ timestamps: true })
export class Maintenance {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  room!: Types.ObjectId;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  description!: string;

  // Link ảnh (nếu sinh viên có chụp ảnh gửi lên - ở mức đồ án có thể để string trống)
  @Prop()
  imageUrl?: string;

  @Prop({
    required: true,
    enum: Object.values(MaintenancePriority),
    default: MaintenancePriority.MEDIUM,
  })
  priority!: string;

  @Prop({
    required: true,
    enum: Object.values(MaintenanceStatus),
    default: MaintenanceStatus.PENDING,
  })
  status!: string;

  // Nhân viên bảo trì được phân công xử lý yêu cầu này
  @Prop({ type: Types.ObjectId, ref: 'User' })
  assignedTo?: Types.ObjectId;

  // Thời gian admin cập nhật trạng thái RESOLVED
  @Prop()
  resolvedAt?: Date;

  // Sinh viên đánh giá chất lượng sửa chữa (1-5 sao), chỉ chấm được khi đã RESOLVED
  @Prop({ min: 1, max: 5 })
  rating?: number;

  @Prop()
  ratedAt?: Date;

  // Lý do từ chối — bắt buộc (ở tầng service) khi status chuyển sang REJECTED
  @Prop({ maxlength: 500 })
  rejectionReason?: string;

  // Nội dung nhân viên đã xử lý — nhập tùy chọn khi hoàn thành (RESOLVED)
  @Prop({ maxlength: 500 })
  resolutionNote?: string;

  // Nhật ký các lần đổi trạng thái (mới nhất được đẩy vào cuối mảng)
  @Prop({ type: [StatusHistoryEntrySchema], default: [] })
  statusHistory!: StatusHistoryEntry[];
}

export const MaintenanceSchema = SchemaFactory.createForClass(Maintenance);