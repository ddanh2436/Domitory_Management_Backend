import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express'; // Thêm dòng import này

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  // Tăng giới hạn dung lượng payload lên 10MB để chứa vừa ảnh Base64
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  await app.listen(3001);
}
bootstrap();