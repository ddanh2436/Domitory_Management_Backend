import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

// Phản hồi 👍/👎 của sinh viên cho một câu trả lời của bot.
//
// Mục đích: có số liệu THẬT để biết câu nào bot trả lời tệ, thay vì phải đoán mà
// chỉnh CHATBOT_SCORE_THRESHOLD. Lưu kèm câu hỏi + câu trả lời + nguồn đã trích
// vì nếu chỉ lưu "thích/không thích" thì lúc xem lại không tài nào tái hiện được
// bot đã đọc gì mà trả lời như vậy.
@Schema({ timestamps: true })
export class ChatFeedback extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user!: Types.ObjectId;

  @Prop({ required: true })
  question!: string;

  @Prop({ required: true })
  answer!: string;

  @Prop({ type: [String], default: [] })
  sources!: string[];

  @Prop({ required: true, enum: ['UP', 'DOWN'] })
  verdict!: 'UP' | 'DOWN';

  // Bot có báo "không có trong tài liệu" ở lượt đó không — tách riêng để lọc
  // nhanh nhóm câu hỏi tài liệu còn thiếu, khác với nhóm bot trả lời sai.
  @Prop({ default: false })
  notFound!: boolean;
}

export const ChatFeedbackSchema = SchemaFactory.createForClass(ChatFeedback);

// Mỗi sinh viên chỉ giữ một phản hồi cho mỗi câu hỏi — bấm 👍 rồi đổi sang 👎
// thì ghi đè, không đẻ thêm bản ghi rác.
ChatFeedbackSchema.index({ user: 1, question: 1 }, { unique: true });
