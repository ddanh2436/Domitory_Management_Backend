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

  async updateProfile(userId: string, updateData: Partial<User>) {
    // Ngăn chặn update các field nhạy cảm
    delete updateData.passwordHash;
    delete updateData.role;
    
    const updatedUser = await this.userModel.findByIdAndUpdate(userId, updateData, { returnDocument: 'after' }).select('-passwordHash');
    if (!updatedUser) throw new NotFoundException('Không tìm thấy người dùng');
    return updatedUser;
  }

  async findAllStudents() {
    return this.userModel.find({ role: 'STUDENT' })
      .select('-passwordHash')
      .populate('room', 'name building') 
      .sort({ createdAt: -1 });
  }

  // --------------------------------------------------------
  // HÀM XÓA SINH VIÊN (BẠN ĐANG THIẾU CÁI NÀY NÈ)
  // --------------------------------------------------------
  async deleteUser(userId: string) {
    const deletedUser = await this.userModel.findByIdAndDelete(userId);
    if (!deletedUser) throw new NotFoundException('Không tìm thấy người dùng để xóa');
    return deletedUser;
  }
}