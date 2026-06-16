import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { MaintenanceStatus, MaintenancePriority } from '../maintenance.enum';

export type MaintenanceDocument = Maintenance & Document;

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

  // Thời gian admin cập nhật trạng thái RESOLVED
  @Prop()
  resolvedAt?: Date;
}

export const MaintenanceSchema = SchemaFactory.createForClass(Maintenance);