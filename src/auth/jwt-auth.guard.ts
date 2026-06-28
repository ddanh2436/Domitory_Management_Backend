import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Request } from 'express';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);
    
    if (!token) {
      throw new UnauthorizedException('Không tìm thấy token xác thực');
    }
    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: 'DORMITORY_SECRET_KEY_2026', 
      });

      const user = await this.userModel.findById(payload.sub).select('role accessStatus');
      if (!user) {
        throw new UnauthorizedException('Tài khoản không tồn tại');
      }
      if (user.accessStatus === 'LOCKED') {
        throw new UnauthorizedException('Tài khoản đã bị khóa');
      }

      request['user'] = {
        ...payload,
        role: user.role,
        accessStatus: user.accessStatus ?? 'ACTIVE',
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
    }
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
