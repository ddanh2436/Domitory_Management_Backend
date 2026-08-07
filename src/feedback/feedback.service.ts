import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Feedback, FeedbackDocument } from './schemas/feedback.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { RespondFeedbackDto } from './dto/respond-feedback.dto';
import { FeedbackCategory, FeedbackStatus, FeedbackType } from './feedback.enum';

const TYPE_LABEL: Record<string, string> = {
  [FeedbackType.COMPLAINT]: 'khiếu nại',
  [FeedbackType.SUGGESTION]: 'góp ý',
};

@Injectable()
export class FeedbackService {
  constructor(
    @InjectModel(Feedback.name) private feedbackModel: Model<FeedbackDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly notificationsService: NotificationsService,
  ) {}

  // Sinh viên gửi một góp ý/khiếu nại mới
  async create(studentId: string, dto: CreateFeedbackDto) {
    const message = dto.message.trim();
    if (!message) {
      throw new BadRequestException('Vui lòng nhập nội dung');
    }

    const [feedback] = await this.feedbackModel.create([
      {
        student: new Types.ObjectId(studentId),
        type: dto.type,
        category: dto.category ?? FeedbackCategory.OTHER,
        message,
        status: FeedbackStatus.PENDING,
      },
    ]);

    // Thông báo cho toàn bộ ban quản lý biết có mục mới cần xử lý
    try {
      const managers = await this.userModel
        .find({ role: { $in: ['ADMIN', 'DORMITORY_MANAGER'] } })
        .select('_id')
        .lean();
      for (const manager of managers) {
        await this.notificationsService.createAndSend({
          recipient: manager._id.toString(),
          title: `Có ${TYPE_LABEL[dto.type]} mới cần xử lý 📝`,
          message: message.length > 120 ? `${message.slice(0, 120)}...` : message,
          type: 'SYSTEM',
          link: '/admin/feedback',
        });
      }
    } catch (err) {
      console.error('Lỗi gửi thông báo góp ý/khiếu nại mới:', err);
    }

    return {
      message: 'Đã gửi góp ý/khiếu nại, ban quản lý sẽ phản hồi sớm nhất.',
      feedback,
    };
  }

  // Sinh viên xem danh sách góp ý/khiếu nại của chính mình
  async findMine(studentId: string) {
    return this.feedbackModel
      .find({ student: new Types.ObjectId(studentId) })
      .sort({ createdAt: -1 })
      .lean();
  }

  // Ban quản lý xem toàn bộ, có lọc theo loại/trạng thái
  async findAll(type?: string, status?: string) {
    const filter: Record<string, unknown> = {};
    if (type) {
      if (!Object.values(FeedbackType).includes(type as FeedbackType)) {
        throw new BadRequestException('Loại góp ý/khiếu nại không hợp lệ');
      }
      filter.type = type;
    }
    if (status) {
      if (!Object.values(FeedbackStatus).includes(status as FeedbackStatus)) {
        throw new BadRequestException('Trạng thái không hợp lệ');
      }
      filter.status = status;
    }
    return this.feedbackModel
      .find(filter)
      .populate('student', 'fullName mssv email')
      .populate('respondedBy', 'fullName')
      .sort({ createdAt: -1 })
      .lean();
  }

  // Ban quản lý phản hồi và khép lại một mục đang chờ xử lý
  async respond(reviewerId: string, feedbackId: string, dto: RespondFeedbackDto) {
    if (!isValidObjectId(feedbackId)) {
      throw new BadRequestException('ID góp ý/khiếu nại không hợp lệ');
    }
    const response = dto.response.trim();
    if (!response) {
      throw new BadRequestException('Vui lòng nhập nội dung phản hồi');
    }

    const feedback = await this.feedbackModel.findById(feedbackId);
    if (!feedback) {
      throw new NotFoundException('Không tìm thấy góp ý/khiếu nại');
    }
    if (feedback.status !== FeedbackStatus.PENDING) {
      throw new BadRequestException('Mục này đã được xử lý trước đó');
    }

    feedback.response = response;
    feedback.status = dto.status;
    feedback.respondedBy = new Types.ObjectId(reviewerId);
    feedback.respondedAt = new Date();
    await feedback.save();

    try {
      await this.notificationsService.createAndSend({
        recipient: feedback.student.toString(),
        title:
          dto.status === 'RESOLVED'
            ? 'Góp ý/khiếu nại của bạn đã được xử lý ✅'
            : 'Góp ý/khiếu nại của bạn đã được đóng',
        message: feedback.response,
        type: 'SYSTEM',
        link: '/student/feedback',
      });
    } catch (err) {
      console.error('Lỗi gửi thông báo phản hồi góp ý/khiếu nại:', err);
    }

    return { message: 'Đã phản hồi và cập nhật trạng thái', feedback };
  }
}
