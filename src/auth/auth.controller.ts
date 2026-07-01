import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('api/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  register(@Body() registerDto: any) {
    return this.authService.register(registerDto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() loginDto: any) {
    return this.authService.login(loginDto);
  }
  
  @HttpCode(HttpStatus.OK)
  @Post('google')
  googleLogin(@Body('token') token: string) {
    return this.authService.googleLogin(token);
  }

  // TÍNH NĂNG MỚI: Quên mật khẩu (Sandbox)
  @HttpCode(HttpStatus.OK)
  @Post('sandbox-reset-password')
  resetPasswordSandbox(@Body() body: { email: string; newPassword: string }) {
    return this.authService.resetPasswordSandbox(body.email, body.newPassword);
  }
}