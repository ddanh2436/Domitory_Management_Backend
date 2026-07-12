import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  email!: string;

  @IsString()
  @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự' })
  password!: string;

  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập họ tên' })
  fullName!: string;

  @IsOptional()
  @IsString()
  mssv?: string;
}

export class LoginDto {
  // Frontend có thể gửi email, mssv riêng lẻ hoặc gộp chung 1 biến identifier
  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  mssv?: string;

  @IsOptional()
  @IsString()
  identifier?: string;

  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập mật khẩu' })
  password!: string;
}

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Thiếu mã đặt lại mật khẩu' })
  token!: string;

  @IsString()
  @MinLength(6, { message: 'Mật khẩu mới phải có ít nhất 6 ký tự' })
  newPassword!: string;
}

export class ResetPasswordSandboxDto {
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  email!: string;

  @IsString()
  @MinLength(6, { message: 'Mật khẩu mới phải có ít nhất 6 ký tự' })
  newPassword!: string;
}
