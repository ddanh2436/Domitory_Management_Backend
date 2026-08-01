/**
 * Chạy lại quá trình nạp tài liệu cho chatbot mà không cần dựng server HTTP.
 *
 * Endpoint POST /api/chatbot/ingest yêu cầu JWT của ADMIN; script này gọi thẳng
 * ChatbotService qua application context nên dùng được cho việc bảo trì/CI mà
 * không phải đăng nhập.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/run-ingest.ts
 */
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import { ChatbotService } from '../src/chatbot/chatbot.service';
import { Knowledge } from '../src/chatbot/knowledge.schema';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const knowledgeModel = app.get<Model<Knowledge>>(getModelToken(Knowledge.name));

    const before = await knowledgeModel.countDocuments();
    const beforeWithSearchText = await knowledgeModel.countDocuments({
      searchText: { $exists: true, $ne: '' },
    });
    console.log(
      `\n[TRƯỚC] ${before} đoạn trong kho tri thức, ${beforeWithSearchText} đoạn đã có searchText\n`,
    );

    const chatbotService = app.get(ChatbotService);
    const result = await chatbotService.ingestData();
    console.log(`\n${result}\n`);

    const after = await knowledgeModel.countDocuments();
    const afterWithSearchText = await knowledgeModel.countDocuments({
      searchText: { $exists: true, $ne: '' },
    });
    console.log(
      `[SAU] ${after} đoạn trong kho tri thức, ${afterWithSearchText} đoạn đã có searchText`,
    );

    // Kiểm chứng nhánh tìm từ khoá thật sự chạy được: gõ không dấu phải ra kết quả.
    const probe = 'hoa don thang';
    const hits = await knowledgeModel
      .find({ $text: { $search: probe } }, { content: 1, score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } })
      .limit(3)
      .lean<{ content: string; score: number }[]>();

    console.log(`\n[KIỂM TRA] tìm không dấu "${probe}" → ${hits.length} kết quả:`);
    for (const hit of hits) {
      console.log(`   ${hit.score.toFixed(3)}  ${hit.content.replace(/\s+/g, ' ').slice(0, 80)}…`);
    }
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Ingest thất bại:', err);
    process.exit(1);
  });
