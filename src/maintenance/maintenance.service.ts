import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { Maintenance, MaintenanceDocument } from './schemas/maintenance.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { MaintenanceStatus } from './maintenance.enum';

@Injectable()
export class MaintenanceService {
  constructor(
    @InjectModel(Maintenance.name) private maintenanceModel: Model<MaintenanceDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  // 1. Sinh viên tạo yêu cầu mới
  async createRequest(userId: string, createDto: any) {
    const { title, description, priority, imageUrl } = createDto;

    const user = await this.userModel.findById(userId).lean();
    if (!user || !user.room) {
      throw new BadRequestException('Bạn chưa được xếp phòng, không thể gửi yêu cầu sửa chữa.');
    }

    const newRequest = await this.maintenanceModel.create({
      user: new Types.ObjectId(userId),
      room: user.room,
      title,
      description,
      priority,
      imageUrl,
      status: MaintenanceStatus.PENDING,
    });

    return { message: 'Gửi yêu cầu thành công', request: newRequest };
  }

  async getMyRequests(userId: string) {
    return this.maintenanceModel
      .find({ user: new Types.ObjectId(userId) })
      .populate('room', 'name building')
      .sort({ createdAt: -1 })
      .lean();
  }

  async getAllRequests() {
    return this.maintenanceModel
      .find()
      .populate('user', 'fullName mssv phone')
      .populate('room', 'name building')
      .sort({ status: -1, createdAt: -1 }) // Ưu tiên xếp theo trạng thái PENDING lên đầu
      .lean();
  }

  async updateStatus(requestId: string, status: string) {
    if (!isValidObjectId(requestId)) throw new BadRequestException('ID không hợp lệ');

    const updateData: any = { status };
    if (status === MaintenanceStatus.RESOLVED) {
      updateData.resolvedAt = new Date();
    }

    const request = await this.maintenanceModel.findByIdAndUpdate(
      requestId,
      updateData,
      { returnDocument: 'after' }
    );

    if (!request) throw new NotFoundException('Không tìm thấy yêu cầu này');
    return { message: 'Cập nhật tiến độ thành công', request };
  }
}