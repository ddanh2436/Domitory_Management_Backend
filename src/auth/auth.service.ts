import { Injectable, UnauthorizedException, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class AuthService {
  // THAY MÃ CLIENT ID CỦA BẠN VÀO ĐÂY
  private googleClient = new OAuth2Client('554498848939-6lfe3dqvl8ca1uaudvk9hqs0rm5irt26.apps.googleusercontent.com');

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
  ) {}

  // 1. Hàm Đăng ký thủ công
  async register(registerDto: any) {
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
        throw new ConflictException('MSSV này đã được đăng ký cho một tài khoản khác');
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
  async login(loginDto: any) {
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

    const user = await this.userModel.findOne({ $or: searchCondition });
    
    if (!user) {
      throw new UnauthorizedException('Sai thông tin đăng nhập (Email/MSSV không tồn tại)');
    }

    if (user.accessStatus === 'LOCKED') {
      const reason = user.blockReason || 'Vi phạm nội quy hoặc chưa thanh toán phí';
      throw new UnauthorizedException(`Tài khoản đã bị khóa. Lý do: ${reason}`);
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Sai mật khẩu');
    }

    const payload = { sub: user._id, email: user.email, role: user.role, accessStatus: user.accessStatus ?? 'ACTIVE' };
    return {
      access_token: await this.jwtService.signAsync(payload),
      user: {
        id: user._id,
        mssv: user.mssv,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        accessStatus: user.accessStatus ?? 'ACTIVE',
      }
    };
  }

  // 3. Hàm Đăng nhập bằng Google
  async googleLogin(googleToken: string) {
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: googleToken,
        // THAY MÃ CLIENT ID CỦA BẠN VÀO ĐÂY NỮA NHÉ
        audience: '554498848939-6lfe3dqvl8ca1uaudvk9hqs0rm5irt26.apps.googleusercontent.com', 
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
        const reason = user.blockReason || 'Vi phạm nội quy hoặc chưa thanh toán phí';
        throw new UnauthorizedException(`Tài khoản đã bị khóa. Lý do: ${reason}`);
      }

      const jwtPayload = { sub: user._id, email: user.email, role: user.role, accessStatus: user.accessStatus ?? 'ACTIVE' };
      return {
        access_token: await this.jwtService.signAsync(jwtPayload),
        user: {
          id: user._id,
          mssv: user.mssv,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          accessStatus: user.accessStatus ?? 'ACTIVE',
        }
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Xác thực Google thất bại');
    }
  }

  // 4. Hàm đặt lại mật khẩu trực tiếp cho Sandbox
  async resetPasswordSandbox(email: string, newPassword: string) {
    if (!email || !newPassword) {
      throw new BadRequestException('Vui lòng cung cấp đầy đủ email và mật khẩu mới');
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
      message: 'Mật khẩu đã được thiết lập lại thành công (Sandbox).' 
    };
  }
}