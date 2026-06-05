import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule,
    JwtModule.register({
      global: true, // Cho phép dùng JWT ở bất kỳ đâu trong app
      secret: 'DORMITORY_SECRET_KEY_2026', // Trong thực tế sau này sẽ dùng process.env.JWT_SECRET
      signOptions: { expiresIn: '1d' }, // Token có hạn 1 ngày
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}