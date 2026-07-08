import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      global: true, // Cho phép dùng JWT ở bất kỳ đâu trong app
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
          // Fail-fast: thiếu secret thì dừng app ngay thay vì ký token bằng undefined
          throw new Error('Thiếu biến môi trường JWT_SECRET trong file .env');
        }
        return {
          secret,
          signOptions: { expiresIn: '1d' }, // Token có hạn 1 ngày
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
