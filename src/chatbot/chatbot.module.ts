import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { Knowledge, KnowledgeSchema } from './knowledge.schema';
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [
    // Import Schema để ChatbotService có thể tiêm (inject) vào và gọi Database.
    // User schema cần cho JwtAuthGuard (guard load user từ Mongo để kiểm accessStatus/role).
    MongooseModule.forFeature([
      { name: Knowledge.name, schema: KnowledgeSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [ChatbotController],
  providers: [ChatbotService],
})
export class ChatbotModule {}
