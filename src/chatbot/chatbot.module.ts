import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { Knowledge, KnowledgeSchema } from './knowledge.schema';

@Module({
  imports: [
    // Import Schema để ChatbotService có thể tiêm (inject) vào và gọi Database
    MongooseModule.forFeature([{ name: Knowledge.name, schema: KnowledgeSchema }])
  ],
  controllers: [ChatbotController],
  providers: [ChatbotService],
})
export class ChatbotModule {}