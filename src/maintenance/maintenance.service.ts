import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { v2 as cloudinary } from 'cloudinary';
import { Model, Types, isValidObjectId } from 'mongoose';
import { Maintenance, MaintenanceDocument } from './schemas/maintenance.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { MaintenanceStatus } from './maintenance.enum';
import { NotificationsService } from '../notifications/notifications.service';

export interface MaintenanceImageFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

@Injectable()
export class MaintenanceService {
  private readonly isCloudinaryConfigured: boolean;
  private readonly cloudinaryFolder: string;

  constructor(
    @InjectModel(Maintenance.name)
    private maintenanceModel: Model<MaintenanceDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private notificationsService: NotificationsService,
    private configService: ConfigService,
  ) {
    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');

    this.isCloudinaryConfigured = Boolean(cloudName && apiKey && apiSecret);
    this.cloudinaryFolder =
      this.configService.get<string>('CLOUDINARY_MAINTENANCE_FOLDER') ||
      'dormitory/maintenance';

    if (this.isCloudinaryConfigured) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
      });
    }
  }

  // Trọng số sắp xếp trạng thái (Nhỏ xếp trước)
  private readonly statusWeight: Record<string, number> = {
    [MaintenanceStatus.PENDING]: 1,
    [MaintenanceStatus.IN_PROGRESS]: 2,
    [MaintenanceStatus.RESOLVED]: 3,
    [MaintenanceStatus.REJECTED]: 4,
  };

  private async uploadImage(file?: MaintenanceImageFile) {
    if (!file) return undefined;

    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Chi duoc dinh kem file anh');
    }

    if (!this.isCloudinaryConfigured) {
      throw new InternalServerErrorException(
        'Chua cau hinh Cloudinary tren server',
      );
    }

    const dataUri = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: this.cloudinaryFolder,
      resource_type: 'image',
    });

    return result.secure_url;
  }

  async createRequest(
    userId: string,
    createDto: any,
    image?: MaintenanceImageFile,
  ) {
    const { title, description, priority, imageUrl } = createDto;

    const user = await this.userModel.findById(userId).lean();
    if (!user || !user.room) {
      throw new BadRequestException(
        'Bạn chưa được xếp phòng, không thể gửi yêu cầu sửa chữa.',
      );
    }

    const uploadedImageUrl = await this.uploadImage(image);

    const newRequest = await this.maintenanceModel.create({
      user: new Types.ObjectId(userId),
      room: user.room,
      title,
      description,
      priority,
      imageUrl: uploadedImageUrl || imageUrl,
      status: MaintenanceStatus.PENDING,
    });

    try {
      const admins = await this.userModel
        .find({ role: 'ADMIN' })
        .select('_id')
        .lean();
      for (const admin of admins) {
        await this.notificationsService.createAndSend({
          recipient: admin._id.toString(),
          title: 'Yêu cầu bảo trì mới! 🛠️',
          message: `Sinh viên ${user.fullName} vừa báo sự cố: "${title}"`,
          type: 'MAINTENANCE',
          link: '/admin/maintenance',
        });
      }
    } catch (err) {
      console.error('Lỗi bắn socket thông báo cho Admin:', err);
    }

    return { message: 'Gửi yêu cầu thành công', request: newRequest };
  }

  async getMyRequests(userId: string) {
    const requests = await this.maintenanceModel
      .find({ user: new Types.ObjectId(userId) })
      .populate('room', 'name building')
      .lean();

    return requests.sort((a: any, b: any) => {
      const weightA = this.statusWeight[a.status] || 5;
      const weightB = this.statusWeight[b.status] || 5;
      if (weightA !== weightB) return weightA - weightB;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  async getAllRequests() {
    const requests = await this.maintenanceModel
      .find()
      .populate('user', 'fullName mssv phone')
      .populate('room', 'name building')
      .lean();

    return requests.sort((a: any, b: any) => {
      const weightA = this.statusWeight[a.status] || 5;
      const weightB = this.statusWeight[b.status] || 5;
      if (weightA !== weightB) return weightA - weightB;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  async updateStatus(requestId: string, status: string) {
    if (!isValidObjectId(requestId))
      throw new BadRequestException('ID không hợp lệ');

    // Chỉ chấp nhận đúng các trạng thái hợp lệ, tránh lưu chuỗi tự do làm hỏng sort/thống kê
    const validStatuses = Object.values(MaintenanceStatus) as string[];
    if (!validStatuses.includes(status)) {
      throw new BadRequestException('Trạng thái yêu cầu bảo trì không hợp lệ');
    }

    const request = await this.maintenanceModel.findById(requestId);
    if (!request) throw new NotFoundException('Không tìm thấy yêu cầu này');

    // Ghi nhận việc CHUYỂN sang RESOLVED (chỉ khi trước đó chưa RESOLVED)
    // để không gửi trùng thông báo mỗi lần bấm cập nhật lại.
    const justResolved =
      status === MaintenanceStatus.RESOLVED &&
      request.status !== MaintenanceStatus.RESOLVED;

    const updateData: any = { status };
    if (justResolved) {
      updateData.resolvedAt = new Date();
    }

    const updatedRequest = await this.maintenanceModel.findByIdAndUpdate(
      requestId,
      updateData,
      { returnDocument: 'after' },
    );

    // Gửi thông báo SAU KHI đã cập nhật thành công
    if (justResolved) {
      try {
        await this.notificationsService.createAndSend({
          recipient: request.user.toString(),
          title: 'Sửa chữa hoàn tất! ⭐',
          message: `Sự cố "${request.title}" của phòng bạn đã được khắc phục xong. Hãy đánh giá chất lượng sửa chữa (1-5 sao) nhé!`,
          type: 'MAINTENANCE',
          link: '/student/maintenance',
        });
      } catch (err) {
        console.error('Lỗi gửi thông báo hoàn tất bảo trì:', err);
      }
    }

    return { message: 'Cập nhật tiến độ thành công', request: updatedRequest };
  }

  // Sinh viên chấm điểm chất lượng sửa chữa (1-5 sao) sau khi yêu cầu đã RESOLVED
  async rateRequest(requestId: string, userId: string, rating: number) {
    if (!isValidObjectId(requestId))
      throw new BadRequestException('ID không hợp lệ');

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException('Điểm đánh giá phải là số nguyên từ 1 đến 5 sao');
    }

    const request = await this.maintenanceModel.findById(requestId);
    if (!request) throw new NotFoundException('Không tìm thấy yêu cầu này');

    // Chỉ chủ đơn mới được đánh giá
    if (request.user.toString() !== userId) {
      throw new ForbiddenException('Bạn chỉ có thể đánh giá yêu cầu của chính mình');
    }

    if (request.status !== MaintenanceStatus.RESOLVED) {
      throw new BadRequestException('Chỉ đánh giá được yêu cầu đã hoàn thành sửa chữa');
    }

    // Mỗi yêu cầu chỉ đánh giá 1 lần
    if (request.rating) {
      throw new BadRequestException('Yêu cầu này đã được đánh giá trước đó');
    }

    request.rating = rating;
    request.ratedAt = new Date();
    await request.save();

    // Báo cho Admin biết chất lượng dịch vụ vừa được chấm điểm
    try {
      const admins = await this.userModel
        .find({ role: 'ADMIN' })
        .select('_id')
        .lean();
      const stars = '⭐'.repeat(rating);
      for (const admin of admins) {
        await this.notificationsService.createAndSend({
          recipient: admin._id.toString(),
          title: `Đánh giá sửa chữa mới: ${stars}`,
          message: `Sinh viên vừa chấm ${rating}/5 sao cho yêu cầu "${request.title}".`,
          type: 'MAINTENANCE',
          link: '/admin/maintenance',
        });
      }
    } catch (err) {
      console.error('Lỗi gửi thông báo đánh giá cho Admin:', err);
    }

    return { message: 'Cảm ơn bạn đã đánh giá!', request };
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
      REJECTED: 'Từ chối',
    };

    return stats.map((s) => ({
      name: statusMap[s._id] || s._id,
      value: s.value,
    }));
  }
}
