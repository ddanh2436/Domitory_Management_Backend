import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  User,
  UserAccessStatus,
  UserDocument,
  UserRole,
  USER_ACCESS_STATUSES,
  USER_ROLES,
} from './schemas/user.schema';

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
    delete updateData.accessStatus;
    
    const updatedUser = await this.userModel.findByIdAndUpdate(userId, updateData, { returnDocument: 'after' }).select('-passwordHash');
    if (!updatedUser) throw new NotFoundException('Không tìm thấy người dùng');
    return updatedUser;
  }

  // Chỉnh sửa findAllStudents để populate thêm dữ liệu phòng
  async findAllStudents() {
    return this.userModel.find({ role: 'STUDENT' })
      .select('-passwordHash')
      .populate('room', 'name building') // Lấy thêm tên phòng và toà nhà
      .sort({ createdAt: -1 });
  }

  async findAccessControlAccounts() {
    return this.userModel.find()
      .select('fullName email mssv cccd role accessStatus createdAt')
      .sort({ createdAt: -1 });
  }

  async updateAccessControl(
    userId: string,
    updateData: { role?: UserRole; accessStatus?: UserAccessStatus },
  ) {
    const updatePayload: Partial<Pick<User, 'role' | 'accessStatus'>> = {};

    if (updateData.role) {
      if (!USER_ROLES.includes(updateData.role)) {
        throw new BadRequestException('Vai trò tài khoản không hợp lệ');
      }
      updatePayload.role = updateData.role;
    }

    if (updateData.accessStatus) {
      if (!USER_ACCESS_STATUSES.includes(updateData.accessStatus)) {
        throw new BadRequestException('Trạng thái truy cập không hợp lệ');
      }
      updatePayload.accessStatus = updateData.accessStatus;
    }

    const updatedUser = await this.userModel
      .findByIdAndUpdate(userId, updatePayload, {returnDocument: 'after'})
      .select('fullName email mssv cccd role accessStatus createdAt');

    if (!updatedUser) throw new NotFoundException('Không tìm thấy người dùng');
    return updatedUser;
  }

  // HÀM XÓA SINH VIÊN 
  async deleteUser(userId: string) {
    const deletedUser = await this.userModel.findByIdAndDelete(userId);
    if (!deletedUser) throw new NotFoundException('Không tìm thấy người dùng để xóa');
    return deletedUser;
  }

  // --------------------------------------------------------
  // TÍNH NĂNG MỚI: HÀM KHÓA TÀI KHOẢN XUỐNG DATABASE
  // --------------------------------------------------------
  async blockUser(id: string, reason: string) {
    const updatedUser = await this.userModel.findByIdAndUpdate(
      id,
      { accessStatus: 'LOCKED', blockReason: reason },
      { returnDocument: 'after' } // Đảm bảo trả về dữ liệu mới nhất
    );
    if (!updatedUser) throw new NotFoundException('Không tìm thấy người dùng');
    return updatedUser;
  }

  // --------------------------------------------------------
  // TÍNH NĂNG MỚI: HÀM MỞ KHÓA TÀI KHOẢN
  // --------------------------------------------------------
  async unblockUser(id: string) {
    const updatedUser = await this.userModel.findByIdAndUpdate(
      id,
      { accessStatus: 'ACTIVE', $unset: { blockReason: 1 } }, // Trả về ACTIVE và xóa bỏ lý do
      { returnDocument: 'after' }
    );
    if (!updatedUser) throw new NotFoundException('Không tìm thấy người dùng');
    return updatedUser;
  }
}