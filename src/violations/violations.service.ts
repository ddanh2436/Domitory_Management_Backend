import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Violation, ViolationDocument } from './schemas/violation.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateViolationDto } from './dto/create-violation.dto';
import { ViolationStatus } from './violations.enum';

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

  // Ban quản lý xem tất cả vi phạm (kèm bộ lọc trạng thái) để duyệt khiếu nại / theo dõi
  async findAll(status?: string) {
    const filter: Record<string, unknown> = {};
    if (status) {
      if (!Object.values(ViolationStatus).includes(status as ViolationStatus)) {
        throw new BadRequestException('Trạng thái vi phạm không hợp lệ');
      }
      filter.status = status;
    }
    return this.violationModel
      .find(filter)
      .populate('student', 'fullName mssv behaviorScore')
      .populate('markedBy', 'fullName')
      .populate('reviewedBy', 'fullName')
      .sort({ createdAt: -1 })
      .lean();
  }

  // Hoàn lại điểm hành vi đã trừ cho sinh viên (chặn trần 100).
  // Chỉ gọi đúng MỘT lần khi vi phạm chuyển sang REVOKED để bảo đảm idempotent.
  private async restoreScore(studentId: Types.ObjectId, points: number) {
    const student = await this.userModel.findById(studentId);
    if (!student) return;
    const current = student.behaviorScore ?? 100;
    student.behaviorScore = Math.min(100, current + points);
    await student.save();
    return student.behaviorScore;
  }

  // Sinh viên khiếu nại một vi phạm của chính mình (chỉ khi đang ACTIVE)
  async appealViolation(studentId: string, violationId: string, reason: string) {
    if (!isValidObjectId(violationId)) {
      throw new BadRequestException('ID vi phạm không hợp lệ');
    }
    const trimmed = (reason ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('Vui lòng nhập lý do khiếu nại');
    }

    const violation = await this.violationModel.findById(violationId);
    if (!violation) throw new NotFoundException('Không tìm thấy vi phạm');

    if (violation.student.toString() !== studentId) {
      throw new ForbiddenException('Bạn chỉ có thể khiếu nại vi phạm của chính mình');
    }
    if (violation.status !== ViolationStatus.ACTIVE) {
      throw new BadRequestException('Chỉ khiếu nại được vi phạm đang hiệu lực');
    }

    violation.status = ViolationStatus.APPEAL_PENDING;
    violation.appealReason = trimmed;
    violation.appealedAt = new Date();
    await violation.save();

    // Thông báo cho ban quản lý biết có khiếu nại mới cần duyệt
    try {
      const admins = await this.userModel
        .find({ role: { $in: ['ADMIN', 'DORMITORY_MANAGER'] } })
        .select('_id')
        .lean();
      for (const admin of admins) {
        await this.notificationsService.createAndSend({
          recipient: admin._id.toString(),
          title: 'Có khiếu nại vi phạm mới 📝',
          message: `Một sinh viên vừa khiếu nại vi phạm "${violation.reason}".`,
          type: 'SYSTEM',
          link: '/admin/violations',
        });
      }
    } catch (err) {
      console.error('Lỗi gửi thông báo khiếu nại:', err);
    }

    return { message: 'Đã gửi khiếu nại, vui lòng chờ ban quản lý duyệt', violation };
  }

  // Ban quản lý duyệt một khiếu nại đang chờ: ACCEPT (thu hồi + hoàn điểm) hoặc REJECT
  async reviewAppeal(
    reviewerId: string,
    violationId: string,
    decision: 'ACCEPT' | 'REJECT',
    reviewNote?: string,
  ) {
    if (!isValidObjectId(violationId)) {
      throw new BadRequestException('ID vi phạm không hợp lệ');
    }
    const violation = await this.violationModel.findById(violationId);
    if (!violation) throw new NotFoundException('Không tìm thấy vi phạm');

    if (violation.status !== ViolationStatus.APPEAL_PENDING) {
      throw new BadRequestException('Chỉ duyệt được khiếu nại đang chờ');
    }

    const note = reviewNote?.trim();
    violation.reviewNote = note;
    violation.reviewedBy = new Types.ObjectId(reviewerId);
    violation.reviewedAt = new Date();

    let behaviorScore: number | undefined;
    if (decision === 'ACCEPT') {
      violation.status = ViolationStatus.REVOKED;
      behaviorScore = await this.restoreScore(violation.student, violation.points);
    } else {
      violation.status = ViolationStatus.APPEAL_REJECTED;
    }
    await violation.save();

    // Thông báo kết quả cho sinh viên
    try {
      const accepted = decision === 'ACCEPT';
      await this.notificationsService.createAndSend({
        recipient: violation.student.toString(),
        title: accepted ? 'Khiếu nại được chấp nhận ✅' : 'Khiếu nại bị từ chối',
        message: accepted
          ? `Vi phạm "${violation.reason}" đã được thu hồi và hoàn lại ${violation.points} điểm hành vi.`
          : `Khiếu nại vi phạm "${violation.reason}" đã bị từ chối.${note ? ` Lý do: ${note}` : ''}`,
        type: 'SYSTEM',
        link: '/student/profile',
      });
    } catch (err) {
      console.error('Lỗi gửi thông báo kết quả khiếu nại:', err);
    }

    return {
      message: decision === 'ACCEPT' ? 'Đã chấp nhận khiếu nại và hoàn điểm' : 'Đã từ chối khiếu nại',
      violation,
      behaviorScore,
    };
  }

  // Ban quản lý thu hồi trực tiếp một vi phạm ghi nhầm (không cần khiếu nại)
  async revokeViolation(reviewerId: string, violationId: string) {
    if (!isValidObjectId(violationId)) {
      throw new BadRequestException('ID vi phạm không hợp lệ');
    }
    const violation = await this.violationModel.findById(violationId);
    if (!violation) throw new NotFoundException('Không tìm thấy vi phạm');

    if (violation.status === ViolationStatus.REVOKED) {
      throw new BadRequestException('Vi phạm đã được thu hồi trước đó');
    }

    violation.status = ViolationStatus.REVOKED;
    violation.reviewedBy = new Types.ObjectId(reviewerId);
    violation.reviewedAt = new Date();
    await violation.save();

    const behaviorScore = await this.restoreScore(
      violation.student,
      violation.points,
    );

    try {
      await this.notificationsService.createAndSend({
        recipient: violation.student.toString(),
        title: 'Vi phạm đã được thu hồi ✅',
        message: `Vi phạm "${violation.reason}" đã được thu hồi và hoàn lại ${violation.points} điểm hành vi.`,
        type: 'SYSTEM',
        link: '/student/profile',
      });
    } catch (err) {
      console.error('Lỗi gửi thông báo thu hồi vi phạm:', err);
    }

    return { message: 'Đã thu hồi vi phạm và hoàn điểm', violation, behaviorScore };
  }
}
