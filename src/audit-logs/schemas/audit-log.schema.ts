import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AuditLogDocument = AuditLog & Document;

// FR06 — Nhật ký hệ thống: mỗi request THAY ĐỔI dữ liệu (POST/PATCH/PUT/DELETE)
// được interceptor toàn cục ghi lại một dòng: ai, làm gì, lúc nào, kết quả ra sao.
// Không lưu request body để tránh rò rỉ mật khẩu/dữ liệu nhạy cảm.
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class AuditLog {
  // Người thực hiện — có thể trống với request chưa đăng nhập (VD: login)
  @Prop({ type: Types.ObjectId, ref: 'User' })
  user?: Types.ObjectId;

  @Prop()
  userEmail?: string;

  @Prop()
  userRole?: string;

  @Prop({ required: true })
  method!: string;

  @Prop({ required: true })
  path!: string;

  // Mô tả hành động tiếng Việt suy ra từ method + path (VD: "Tạo yêu cầu trả phòng")
  @Prop({ required: true })
  action!: string;

  @Prop({ required: true })
  statusCode!: number;

  @Prop()
  ip?: string;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

// Truy vấn nhật ký luôn theo thời gian mới nhất; TTL 180 ngày để không phình CSDL
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 180 * 24 * 60 * 60 },
);
