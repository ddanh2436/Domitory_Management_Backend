import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

 async findProfile(userId: string) {
    const user = await this.userModel.findById(userId)
      .select('-passwordHash')
      .populate('room', 'name building floor capacity price'); 
      
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    return user;
  }

  // 1. Thêm hàm updateProfile
  async updateProfile(userId: string, updateData: Partial<User>) {
    // Ngăn chặn update các field nhạy cảm như passwordHash hay role từ request
    delete updateData.passwordHash;
    delete updateData.role;
    
    const updatedUser = await this.userModel.findByIdAndUpdate(userId, updateData, { new: true }).select('-passwordHash');
    if (!updatedUser) throw new NotFoundException('Không tìm thấy người dùng');
    return updatedUser;
  }

  // 2. Chỉnh sửa findAllStudents để populate thêm dữ liệu phòng
  async findAllStudents() {
    return this.userModel.find({ role: 'STUDENT' })
      .select('-passwordHash')
      .populate('room', 'name building') // Lấy thêm tên phòng và toà nhà
      .sort({ createdAt: -1 });
  }
}

