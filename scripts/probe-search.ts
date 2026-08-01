/**
 * Thử toàn bộ đường truy xuất thật (vector + từ khoá + trộn) trên DB đang chạy.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/probe-search.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ChatbotService } from '../src/chatbot/chatbot.service';

const CASES = [
  { q: 'Nội quy KTX gồm những mục nào?', mong: 'có kết quả (câu thường, có dấu)' },
  { q: 'hoa don thang 7 cua toi', mong: 'CÓ kết quả — trước đây gõ không dấu là trượt' },
  { q: 'gio dong cua ktx la may gio', mong: 'CÓ kết quả (không dấu)' },
  { q: 'thiết bị điện 1000W có được dùng không?', mong: 'có kết quả (từ khoá hiếm)' },
  { q: 'nấu phở bò thế nào?', mong: 'RỖNG — câu lạc đề' },
  { q: 'tỷ giá USD hôm nay', mong: 'RỖNG — câu lạc đề' },
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const service = app.get(ChatbotService);

    for (const { q, mong } of CASES) {
      const { context, sources } = await service.searchKnowledgeDetailed(q);
      const chunks = context ? context.split('\n\n---\n\n').length : 0;
      const flag = chunks > 0 ? 'CÓ  ' : 'RỖNG';
      console.log(`\n${flag} "${q}"`);
      console.log(`     mong đợi: ${mong}`);
      console.log(`     → ${chunks} đoạn | nguồn: ${sources.join(' | ') || '(không)'}`);
    }
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
