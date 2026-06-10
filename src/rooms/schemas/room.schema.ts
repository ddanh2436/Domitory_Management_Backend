import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RoomDocument = Room & Document;

@Schema({ timestamps: true }) // Tự động tạo createdAt và updatedAt
export class Room {
  @Prop({ required: true, unique: true, trim: true })
  name!: string; // Thêm dấu !

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
}

export const RoomSchema = SchemaFactory.createForClass(Room);

RoomSchema.pre('save', function () {
  if (this.currentOccupancy >= this.capacity && this.status !== 'MAINTENANCE') {
    this.status = 'FULL';
  } else if (this.currentOccupancy < this.capacity && this.status === 'FULL') {
    this.status = 'AVAILABLE';
  }
});
