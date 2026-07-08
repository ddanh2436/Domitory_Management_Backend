import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express'; // Thêm dòng import này

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  // Bật validate toàn cục cho mọi DTO có decorator class-validator
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Tự loại bỏ các field lạ không khai báo trong DTO
      transform: true, // Tự ép kiểu (VD: "5" trên query string -> number 5)
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Tăng giới hạn dung lượng payload lên 10MB để chứa vừa ảnh Base64
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  await app.listen(3001);
}
void bootstrap();
