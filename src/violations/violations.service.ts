import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Violation, ViolationDocument } from './schemas/violation.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateViolationDto } from './dto/create-violation.dto';

@Injectable()
export class ViolationsService {
  constructor(
    @InjectModel(Violation.name) private violationModel: Model<ViolationDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly notificationsService: NotificationsService,
  ) {}

  // Admin ghi nhận vi phạm cho sinh viên và trừ điểm hành vi tương ứng
  async createViolation(adminId: string, dto: CreateViolationDto) {
    const student = await this.userModel.findById(dto.studentId);
    if (!student) {
      throw new NotFoundException('Không tìm thấy sinh viên');
    }
    if (student.role !== 'STUDENT') {
      throw new BadRequestException(
        'Chỉ có thể ghi nhận vi phạm cho tài khoản sinh viên',
      );
    }

    const current = student.behaviorScore ?? 100;
    const scoreAfter = Math.max(0, current - dto.points); // không cho tụt dưới 0

    student.behaviorScore = scoreAfter;
    await student.save();

    const [violation] = await this.violationModel.create([
      {
        student: student._id,
        reason: dto.reason,
        points: dto.points,
        markedBy: new Types.ObjectId(adminId),
        scoreAfter,
      },
    ]);

    // Thông báo cho sinh viên biết mình vừa bị trừ điểm
    try {
      await this.notificationsService.createAndSend({
        recipient: student._id.toString(),
        title: `Bạn bị trừ ${dto.points} điểm hành vi ⚠️`,
        message: `Lý do: ${dto.reason}. Điểm hành vi hiện tại: ${scoreAfter}/100.`,
        type: 'SYSTEM',
        link: '/student/profile',
      });
    } catch (err) {
      console.error('Lỗi gửi thông báo vi phạm:', err);
    }

    return {
      message: 'Đã ghi nhận vi phạm và trừ điểm hành vi',
      behaviorScore: scoreAfter,
      violation,
    };
  }

  // Sinh viên xem lịch sử vi phạm của chính mình
  async getMyViolations(studentId: string) {
    return this.violationModel
      .find({ student: new Types.ObjectId(studentId) })
      .sort({ createdAt: -1 })
      .lean();
  }

  // Admin xem lịch sử vi phạm của một sinh viên
  async getViolationsByStudent(studentId: string) {
    if (!isValidObjectId(studentId)) {
      throw new BadRequestException('ID sinh viên không hợp lệ');
    }
    return this.violationModel
      .find({ student: new Types.ObjectId(studentId) })
      .populate('markedBy', 'fullName')
      .sort({ createdAt: -1 })
      .lean();
  }
}
