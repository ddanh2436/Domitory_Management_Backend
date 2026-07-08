import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserDocument = User & Document;
export const USER_ROLES = [
  'STUDENT',
  'ADMIN',
  'DORMITORY_MANAGER',
  'FLOOR_MANAGER',
  'MAINTENANCE_STAFF',
] as const;
export const USER_ACCESS_STATUSES = ['ACTIVE', 'LOCKED'] as const;
export type UserRole = (typeof USER_ROLES)[number];
export type UserAccessStatus = (typeof USER_ACCESS_STATUSES)[number];

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true })
  email!: string;

  @Prop()
  mssv?: string;

  // select: false — mặc định KHÔNG trả về passwordHash trong mọi query,
  // nơi nào thật sự cần (đăng nhập) phải chủ động .select('+passwordHash')
  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ required: true, enum: USER_ROLES, default: 'STUDENT' })
  role!: UserRole;

  @Prop({ required: true, enum: USER_ACCESS_STATUSES, default: 'ACTIVE' })
  accessStatus!: UserAccessStatus;

  // TÍNH NĂNG MỚI: Thêm trường lưu lý do khóa tài khoản
  @Prop()
  blockReason?: string;

  @Prop({ required: true })
  fullName!: string;

  @Prop()
  phone?: string;

  @Prop()
  cccd?: string;

  @Prop()
  avatar?: string;

  @Prop({ default: false })
  isTempResident!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Room' })
  room?: Types.ObjectId;
}

export const UserSchema = SchemaFactory.createForClass(User);
