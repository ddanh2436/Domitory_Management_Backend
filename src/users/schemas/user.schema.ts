import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true })
  email!: string;

  @Prop()
  mssv?: string; 

  @Prop({ required: true })
  passwordHash!: string;

  @Prop({ required: true, enum: ['STUDENT', 'ADMIN'], default: 'STUDENT' })
  role!: string;

  @Prop({ required: true })
  fullName!: string;

  @Prop()
  phone?: string;

  @Prop()
  cccd?: string;

  @Prop({ default: false })
  isTempResident!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Room' })
  room?: Types.ObjectId;
}

export const UserSchema = SchemaFactory.createForClass(User);
