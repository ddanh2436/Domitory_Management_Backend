import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  ResetPasswordSandboxDto,
} from './dto/auth.dto';

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

  // Quên mật khẩu: gửi link đặt lại qua email (token 15 phút)
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.forgotPassword(body.email);
  }

  // Đặt lại mật khẩu bằng token nhận qua email
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body.token, body.newPassword);
  }

  // TÍNH NĂNG MỚI: Quên mật khẩu (Sandbox — đã bị vô hiệu hóa trên production)
  @HttpCode(HttpStatus.OK)
  @Post('sandbox-reset-password')
  resetPasswordSandbox(@Body() body: ResetPasswordSandboxDto) {
    return this.authService.resetPasswordSandbox(body.email, body.newPassword);
  }
}
