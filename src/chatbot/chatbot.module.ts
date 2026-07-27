import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { Knowledge, KnowledgeSchema } from './knowledge.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Contract, ContractSchema } from '../contracts/schemas/contract.schema';
import { Invoice, InvoiceSchema } from '../invoices/schemas/invoice.schema';
import { Room, RoomSchema } from '../rooms/schemas/room.schema';

@Module({
  imports: [
    // Knowledge: kho tri thức (vector). User: cho JwtAuthGuard.
    // Contract/Invoice/Room: cho tính năng cá nhân hóa (bot đọc dữ liệu thật của sinh viên).
    MongooseModule.forFeature([
      { name: Knowledge.name, schema: KnowledgeSchema },
      { name: User.name, schema: UserSchema },
      { name: Contract.name, schema: ContractSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Room.name, schema: RoomSchema },
    ]),
  ],
  controllers: [ChatbotController],
  providers: [ChatbotService],
})
export class ChatbotModule {}
