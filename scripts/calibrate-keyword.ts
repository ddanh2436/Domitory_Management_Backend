/**
 * Đo phân bố điểm textScore của nhánh tìm theo từ khoá, để chọn
 * CHATBOT_KEYWORD_MIN_SCORE dựa trên số liệu thật thay vì đoán.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/calibrate-keyword.ts
 */
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import { ChatbotService } from '../src/chatbot/chatbot.service';
import { Knowledge } from '../src/chatbot/knowledge.schema';

// Câu ĐÚNG ĐỀ: nhánh từ khoá phải bắt được đoạn liên quan.
// Viết đúng như sinh viên gõ thật (cả câu, có dấu lẫn không dấu) — không phải
// từ khoá đã được làm sạch sẵn.
const ON_TOPIC = [
  'hoa don thang 7 cua toi',
  'noi quy ky tuc xa gom nhung muc nao',
  'gio dong cua ktx la may gio',
  'dinh muc va don gia dien nuoc la bao nhieu',
  'dang ky ve xe can nhung gi',
  'thiết bị điện 1000W có được dùng không?',
  'thủ tục trả phòng gồm những gì?',
];

// Câu LẠC ĐỀ: lý tưởng là không đoạn nào vượt ngưỡng.
const OFF_TOPIC = [
  'nấu phở bò thế nào?',
  'ty gia usd hom nay',
  'lịch thi đấu bóng đá',
  'hoc phi dai hoc bao nhieu',
  'thời tiết hôm nay ra sao',
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });

  try {
    const model = app.get<Model<Knowledge>>(getModelToken(Knowledge.name));

    const probe = async (raw: string) => {
      // Dùng đúng hàm tiền xử lý của service (bỏ dấu + loại hư từ), nếu không thì
      // đo một đằng mà lúc chạy thật lại một nẻo.
      const q = ChatbotService.buildKeywordQuery(raw);
      const hits = await model
        .find({ $text: { $search: q } }, { content: 1, score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' } })
        .limit(8)
        .lean<{ content: string; score: number }[]>();
      return hits;
    };

    for (const [label, queries] of [
      ['ĐÚNG ĐỀ', ON_TOPIC],
      ['LẠC ĐỀ', OFF_TOPIC],
    ] as const) {
      console.log(`\n${'='.repeat(70)}\n${label}\n${'='.repeat(70)}`);

      for (const q of queries) {
        const hits = await probe(q);
        const top = hits[0];
        console.log(`\n"${q}" → ${hits.length} kết quả, cao nhất ${top?.score.toFixed(3) ?? '—'}`);
        for (const hit of hits.slice(0, 4)) {
          const label = hit.content.match(/^\[([^\]]+)\]/)?.[1] ?? '(không nhãn)';
          console.log(`    ${hit.score.toFixed(3)}  ${label.slice(0, 62)}`);
        }
      }
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
