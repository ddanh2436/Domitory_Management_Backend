import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RoomDocument = Room & Document;

// BẮT BUỘC: Thêm toJSON và toObject để Mongoose tự động đính kèm các trường ảo khi API trả về kết quả
@Schema({ 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
}) 
export class Room {
  @Prop({ required: true, unique: true, trim: true })
  name!: string;

  @Prop({ required: true })
  building!: string;

  @Prop({ required: true, min: 1 })
  floor!: number;

  @Prop({ required: true, min: 1 })
  capacity!: number;

  @Prop({ default: 0, min: 0 })
  currentOccupancy!: number;

  @Prop({ required: true, min: 0 })
  price!: number;

  @Prop({
    required: true,
    enum: ['AVAILABLE', 'FULL', 'MAINTENANCE'],
    default: 'AVAILABLE',
  })
  status!: string;

  @Prop({ type: [String], default: [] })
  facilities!: string[];

  // Loại phòng theo giới tính — dùng cho phân phòng tự động (FR12).
  // MIXED = không phân biệt (mặc định cho dữ liệu cũ).
  @Prop({
    type: String,
    enum: ['MALE', 'FEMALE', 'MIXED'],
    default: 'MIXED',
  })
  genderType!: 'MALE' | 'FEMALE' | 'MIXED';
}

export const RoomSchema = SchemaFactory.createForClass(Room);

// TÍNH NĂNG MỚI: Định nghĩa Virtual Populate cho 'occupants'
// Mongoose sẽ tự động quét bảng 'User', tìm những người có trường 'room' bằng với '_id' của phòng này
RoomSchema.virtual('occupants', {
  ref: 'User',          // Tên model được tham chiếu (bảng User)
  localField: '_id',    // ID của phòng hiện tại
  foreignField: 'room', // Trường chứa ID phòng ở bên bảng User
});

RoomSchema.pre('save', function () {
  if (this.currentOccupancy >= this.capacity && this.status !== 'MAINTENANCE') {
    this.status = 'FULL';
  } else if (this.currentOccupancy < this.capacity && this.status === 'FULL') {
    this.status = 'AVAILABLE';
  }
});