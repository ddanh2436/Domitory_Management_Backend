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

  // Bản sao của content đã bỏ dấu + viết thường, dùng cho tìm kiếm từ khoá.
  // Nhờ nó sinh viên gõ "hoa don thang 7" vẫn khớp được "hoá đơn tháng 7".
  @Prop({ default: '' })
  searchText!: string;
}

export const KnowledgeSchema = SchemaFactory.createForClass(Knowledge);

// Index full-text cho nhánh tìm theo từ khoá (bổ trợ cho vector search).
// default_language: 'none' — Mongo không có bộ phân tích tiếng Việt; để 'none'
// thì nó chỉ tách từ theo khoảng trắng, không cắt gốc từ và không loại stopword
// tiếng Anh (nếu không, "cho", "la", "co"... sẽ bị ném đi mất).
KnowledgeSchema.index({ searchText: 'text' }, { default_language: 'none' });