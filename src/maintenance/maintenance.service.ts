import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { Maintenance, MaintenanceDocument } from './schemas/maintenance.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { MaintenanceStatus } from './maintenance.enum';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class MaintenanceService {
  constructor(
    @InjectModel(Maintenance.name) private maintenanceModel: Model<MaintenanceDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private notificationsService: NotificationsService,
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
    
    try {
      const admins = await this.userModel.find({ role: 'ADMIN' }).select('_id').lean();
      for (const admin of admins) {
        await this.notificationsService.createAndSend({
          recipient: admin._id.toString(),
          title: 'Yêu cầu bảo trì mới! 🛠️',
          message: `Sinh viên ${user.fullName} vừa báo sự cố: "${title}"`,
          type: 'MAINTENANCE',
          link: '/admin/maintenance'
        });
      }
    } catch (err) {
      console.error("Lỗi bắn socket thông báo cho Admin:", err);
    }

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
    const request = await this.maintenanceModel.findById(requestId);

    if (!request) throw new NotFoundException('Không tìm thấy yêu cầu này');

    if (status === MaintenanceStatus.RESOLVED) {
      updateData.resolvedAt = new Date();

      // Bắn thông báo real-time
      await this.notificationsService.createAndSend({
        recipient: request.user.toString(),
        title: 'Sửa chữa hoàn tất!',
        message: `Sự cố "${request.title}" của phòng bạn đã được khắc phục xong.`,
        type: 'MAINTENANCE',
        link: '/student/maintenance',
      });
    }

    const updatedRequest = await this.maintenanceModel.findByIdAndUpdate(
      requestId,
      updateData,
      { returnDocument: 'after' }
    );

    return { message: 'Cập nhật tiến độ thành công', request: updatedRequest };
  }

  async getStatusStats() {
    const stats = await this.maintenanceModel.aggregate([
      {
        $group: {
          _id: '$status',
          value: { $sum: 1 },
        },
      },
    ]);

    const statusMap: Record<string, string> = {
      PENDING: 'Chưa xử lý',
      IN_PROGRESS: 'Đang sửa chữa',
      RESOLVED: 'Đã hoàn thành',
    };

    return stats.map(s => ({
      name: statusMap[s._id] || s._id,
      value: s.value,
    }));
  }
}