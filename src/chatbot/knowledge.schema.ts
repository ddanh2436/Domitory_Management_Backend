import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Knowledge extends Document {
  @Prop({ required: true })
  title!: string; // Ví dụ: "Quy định tài chính"

  @Prop({ required: true })
  content!: string; // Nội dung đoạn text (chunk)

  @Prop({ type: [Number], required: true })
  embedding!: number[]; // Vector số đại diện cho nội dung
}

export const KnowledgeSchema = SchemaFactory.createForClass(Knowledge);