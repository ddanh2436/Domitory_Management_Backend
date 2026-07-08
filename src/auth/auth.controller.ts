import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto, ResetPasswordSandboxDto } from './dto/auth.dto';

@Controller('api/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('google')
  googleLogin(@Body('token') token: string) {
    return this.authService.googleLogin(token);
  }

  // TÍNH NĂNG MỚI: Quên mật khẩu (Sandbox — đã bị vô hiệu hóa trên production)
  @HttpCode(HttpStatus.OK)
  @Post('sandbox-reset-password')
  resetPasswordSandbox(@Body() body: ResetPasswordSandboxDto) {
    return this.authService.resetPasswordSandbox(body.email, body.newPassword);
  }
}
