import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { User, UserDocument } from '../users/schemas/user.schema';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { MailService } from './mail.service';

@Injectable()
export class AuthService {
  // THAY MÃ CLIENT ID CỦA BẠN VÀO ĐÂY
  private googleClient = new OAuth2Client(
    '554498848939-6lfe3dqvl8ca1uaudvk9hqs0rm5irt26.apps.googleusercontent.com',
  );

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
    private mailService: MailService,
  ) {}

  // 1. Hàm Đăng ký thủ công
  async register(registerDto: RegisterDto) {
    const { email, mssv, password, fullName } = registerDto;

    // Kiểm tra trùng Email
    const existingUser = await this.userModel.findOne({ email });
    if (existingUser) {
      throw new ConflictException('Email này đã được sử dụng');
    }

    // TÍNH NĂNG MỚI: Kiểm tra trùng MSSV (nếu người dùng có nhập)
    if (mssv && mssv.trim() !== '') {
      const existingMssv = await this.userModel.findOne({ mssv });
      if (existingMssv) {
        throw new ConflictException(
          'MSSV này đã được đăng ký cho một tài khoản khác',
        );
      }
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = new this.userModel({
      email,
      mssv,
      passwordHash,
      fullName,
      role: 'STUDENT',
    });

    await newUser.save();
    return { message: 'Đăng ký thành công' };
  }

  // 2. Hàm Đăng nhập thủ công
  async login(loginDto: LoginDto) {
    // Lấy thêm identifier (từ Frontend gửi lên)
    const { email, mssv, identifier, password } = loginDto;

    const searchCondition: any[] = [];
    if (email) searchCondition.push({ email });
    if (mssv) searchCondition.push({ mssv });

    // TÍNH NĂNG MỚI: Hỗ trợ frontend truyền chung 1 biến identifier cho cả email/mssv
    if (identifier) {
      searchCondition.push({ email: identifier });
      searchCondition.push({ mssv: identifier });
    }

    if (searchCondition.length === 0) {
      throw new UnauthorizedException('Vui lòng nhập Email hoặc MSSV');
    }

    // passwordHash có select: false trong schema nên phải chủ động lấy thêm (+) để so sánh mật khẩu
    const user = await this.userModel
      .findOne({ $or: searchCondition })
      .select('+passwordHash');

    if (!user) {
      throw new UnauthorizedException(
        'Sai thông tin đăng nhập (Email/MSSV không tồn tại)',
      );
    }

    if (user.accessStatus === 'LOCKED') {
      const reason =
        user.blockReason || 'Vi phạm nội quy hoặc chưa thanh toán phí';
      throw new UnauthorizedException(`Tài khoản đã bị khóa. Lý do: ${reason}`);
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Sai mật khẩu');
    }

    const payload = {
      sub: user._id,
      email: user.email,
      role: user.role,
      accessStatus: user.accessStatus ?? 'ACTIVE',
    };
    return {
      access_token: await this.jwtService.signAsync(payload),
      user: {
        id: user._id,
        mssv: user.mssv,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        accessStatus: user.accessStatus ?? 'ACTIVE',
      },
    };
  }

  // 3. Hàm Đăng nhập bằng Google
  async googleLogin(googleToken: string) {
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: googleToken,
        // THAY MÃ CLIENT ID CỦA BẠN VÀO ĐÂY NỮA NHÉ
        audience:
          '554498848939-6lfe3dqvl8ca1uaudvk9hqs0rm5irt26.apps.googleusercontent.com',
      });
      const payload = ticket.getPayload();

      if (!payload || !payload.email) {
        throw new UnauthorizedException('Token Google không hợp lệ');
      }

      const { email, name } = payload;

      let user = await this.userModel.findOne({ email });

      if (!user) {
        const randomPassword = Math.random().toString(36).slice(-10);
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(randomPassword, salt);

        user = new this.userModel({
          email,
          fullName: name || 'Google User',
          passwordHash,
          role: 'STUDENT',
        });
        await user.save();
      } else if (user.accessStatus === 'LOCKED') {
        const reason =
          user.blockReason || 'Vi phạm nội quy hoặc chưa thanh toán phí';
        throw new UnauthorizedException(
          `Tài khoản đã bị khóa. Lý do: ${reason}`,
        );
      }

      const jwtPayload = {
        sub: user._id,
        email: user.email,
        role: user.role,
        accessStatus: user.accessStatus ?? 'ACTIVE',
      };
      return {
        access_token: await this.jwtService.signAsync(jwtPayload),
        user: {
          id: user._id,
          mssv: user.mssv,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          accessStatus: user.accessStatus ?? 'ACTIVE',
        },
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Xác thực Google thất bại');
    }
  }

  // 4a. Quên mật khẩu: sinh token 15 phút và gửi link đặt lại qua email
  async forgotPassword(email: string) {
    const user = await this.userModel.findOne({ email });

    // Luôn trả về cùng một thông điệp dù email có tồn tại hay không,
    // tránh để lộ danh sách email đã đăng ký (user enumeration).
    const genericResponse = {
      message:
        'Nếu email này đã đăng ký, một liên kết đặt lại mật khẩu vừa được gửi đến hộp thư của bạn. Vui lòng kiểm tra cả mục Spam.',
    };

    if (!user) return genericResponse;

    // Token thô chỉ nằm trong email; database chỉ lưu SHA-256 hash —
    // lộ database cũng không dùng được token để chiếm tài khoản.
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 phút

    user.set('resetPasswordToken', tokenHash);
    user.set('resetPasswordExpires', expires);
    await user.save();

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetLink = `${frontendUrl}/reset-password?token=${token}`;

    try {
      await this.mailService.sendPasswordResetEmail(
        user.email,
        user.fullName,
        resetLink,
      );
    } catch (err) {
      console.error('Lỗi gửi email đặt lại mật khẩu:', err);
      throw new BadRequestException(
        'Không gửi được email lúc này. Vui lòng thử lại sau.',
      );
    }

    return genericResponse;
  }

  // 4b. Đặt lại mật khẩu bằng token nhận qua email
  async resetPassword(token: string, newPassword: string) {
    // So sánh bằng hash — khớp với dạng đã lưu ở forgotPassword
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const user = await this.userModel
      .findOne({
        resetPasswordToken: tokenHash,
        resetPasswordExpires: { $gt: new Date() },
      })
      .select('+resetPasswordToken +resetPasswordExpires');

    if (!user) {
      throw new BadRequestException(
        'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu lại.',
      );
    }

    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(newPassword, salt);
    user.set('resetPasswordToken', undefined);
    user.set('resetPasswordExpires', undefined);
    await user.save();

    return {
      message: 'Mật khẩu đã được đặt lại thành công! Hãy đăng nhập bằng mật khẩu mới.',
    };
  }

  // 4. Hàm đặt lại mật khẩu trực tiếp cho Sandbox
  // CẢNH BÁO: endpoint này KHÔNG xác thực người gọi — chỉ được phép tồn tại ở môi trường dev.
  async resetPasswordSandbox(email: string, newPassword: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException(
        'Tính năng này đã bị vô hiệu hóa trên môi trường production',
      );
    }

    if (!email || !newPassword) {
      throw new BadRequestException(
        'Vui lòng cung cấp đầy đủ email và mật khẩu mới',
      );
    }

    if (newPassword.length < 6) {
      throw new BadRequestException('Mật khẩu mới phải có ít nhất 6 ký tự');
    }

    const user = await this.userModel.findOne({ email });

    if (!user) {
      throw new NotFoundException('Không tìm thấy tài khoản với email này.');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    user.passwordHash = passwordHash;
    await user.save();

    return {
      success: true,
      message: 'Mật khẩu đã được thiết lập lại thành công (Sandbox).',
    };
  }
}
