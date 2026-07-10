import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import { Room, RoomDocument } from '../rooms/schemas/room.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Room.name) private roomModel: Model<RoomDocument>,
  ) {}

  async findProfile(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .select('-passwordHash')
      .populate('room', 'name building floor capacity price');

    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    return user;
  }

  // Danh sách trường người dùng ĐƯỢC PHÉP tự cập nhật (whitelist).
  // Tuyệt đối không dùng blacklist: kẻ xấu có thể gửi thêm field lạ (room, mssv, email...)
  private static readonly PROFILE_UPDATABLE_FIELDS = [
    'fullName',
    'phone',
    'cccd',
    'avatar',
  ] as const;

  async updateProfile(userId: string, updateData: Partial<User>) {
    // Chỉ nhặt đúng các trường trong whitelist, bỏ qua mọi trường khác
    const safeData: Partial<User> = {};
    for (const field of UsersService.PROFILE_UPDATABLE_FIELDS) {
      if (updateData[field] !== undefined) {
        safeData[field] = updateData[field];
      }
    }

    const updatedUser = await this.userModel
      .findByIdAndUpdate(userId, safeData, { returnDocument: 'after' })
      .select('-passwordHash');
    if (!updatedUser) throw new NotFoundException('Không tìm thấy người dùng');
    return updatedUser;
  }

  // Chỉnh sửa findAllStudents để populate thêm dữ liệu phòng
  async findAllStudents() {
    return this.userModel
      .find({ role: 'STUDENT' })
      .select('-passwordHash')
      .populate('room', 'name building floor') // Lấy thêm tên phòng, toà nhà và tầng
      .sort({ createdAt: -1 });
  }

  async findAccessControlAccounts() {
    return this.userModel
      .find()
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
      .findByIdAndUpdate(userId, updatePayload, { returnDocument: 'after' })
      .select('fullName email mssv cccd role accessStatus createdAt');

    if (!updatedUser) throw new NotFoundException('Không tìm thấy người dùng');
    return updatedUser;
  }

  // HÀM XÓA SINH VIÊN — kèm TRẢ PHÒNG nếu người dùng đang ở
  async deleteUser(userId: string) {
    const deletedUser = await this.userModel.findByIdAndDelete(userId);
    if (!deletedUser)
      throw new NotFoundException('Không tìm thấy người dùng để xóa');

    // Nếu user đang chiếm 1 chỗ trong phòng thì giải phóng lại chỗ đó,
    // tránh để phòng bị "kẹt" full trong khi người ở đã bị xóa.
    if (deletedUser.room) {
      const updatedRoom = await this.roomModel.findOneAndUpdate(
        { _id: deletedUser.room, currentOccupancy: { $gt: 0 } },
        { $inc: { currentOccupancy: -1 } },
        { returnDocument: 'after' },
      );

      if (
        updatedRoom &&
        updatedRoom.status === 'FULL' &&
        updatedRoom.currentOccupancy < updatedRoom.capacity
      ) {
        updatedRoom.status = 'AVAILABLE';
        await updatedRoom.save();
      }
    }

    return deletedUser;
  }

  // --------------------------------------------------------
  // TÍNH NĂNG MỚI: HÀM KHÓA TÀI KHOẢN XUỐNG DATABASE
  // --------------------------------------------------------
  async blockUser(id: string, reason: string) {
    const updatedUser = await this.userModel.findByIdAndUpdate(
      id,
      { accessStatus: 'LOCKED', blockReason: reason },
      { returnDocument: 'after' }, // Đảm bảo trả về dữ liệu mới nhất
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
      { returnDocument: 'after' },
    );
    if (!updatedUser) throw new NotFoundException('Không tìm thấy người dùng');
    return updatedUser;
  }
}
