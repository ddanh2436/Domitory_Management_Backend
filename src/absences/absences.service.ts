// ─── absences.service.ts ─────────────────────────────────────────────────────
// Nghiệp vụ đăng ký tạm trú (khách qua đêm) / tạm vắng (sinh viên vắng qua đêm).

import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Absence, AbsenceDocument } from './schemas/absence.schema';
import { AbsenceStatus, AbsenceType } from './absences.enum';
import { User, UserDocument } from '../users/schemas/user.schema';
import { NotificationsService } from '../notifications/notifications.service';

export interface CreateAbsenceDto {
  type: string;
  startDate: string;
  endDate: string;
  reason: string;
  guestName?: string;
  guestIdNumber?: string;
}

@Injectable()
export class AbsencesService {
  private readonly logger = new Logger(AbsencesService.name);

  constructor(
    @InjectModel(Absence.name) private absenceModel: Model<AbsenceDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private notificationsService: NotificationsService,
  ) {}

  private assertValidObjectId(id: string, fieldName: string): void {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`${fieldName} không hợp lệ.`);
    }
  }

  async createAbsence(userId: string, dto: CreateAbsenceDto) {
    this.assertValidObjectId(userId, 'userId');

    if (!Object.values(AbsenceType).includes(dto.type as AbsenceType)) {
      throw new BadRequestException('Loại đăng ký không hợp lệ.');
    }
    if (!dto.reason || !dto.reason.trim()) {
      throw new BadRequestException('Vui lòng nhập lý do đăng ký.');
    }

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new BadRequestException('Ngày bắt đầu/kết thúc không hợp lệ.');
    }
    if (endDate < startDate) {
      throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu.');
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (startDate < today) {
      throw new BadRequestException('Ngày bắt đầu không được ở trong quá khứ.');
    }

    if (dto.type === AbsenceType.TAM_TRU) {
      if (!dto.guestName || !dto.guestName.trim()) {
        throw new BadRequestException('Vui lòng nhập họ tên khách tạm trú.');
      }
      if (!dto.guestIdNumber || !dto.guestIdNumber.trim()) {
        throw new BadRequestException('Vui lòng nhập số CCCD của khách tạm trú.');
      }
    }

    const user = await this.userModel.findById(userId);
    if (!user || !user.room) {
      throw new BadRequestException(
        'Bạn chưa được xếp phòng nên không thể đăng ký tạm trú/tạm vắng.',
      );
    }

    const existingPending = await this.absenceModel.findOne({
      user: new Types.ObjectId(userId),
      status: AbsenceStatus.PENDING,
    });
    if (existingPending) {
      throw new BadRequestException(
        'Bạn đã có một đơn đang chờ duyệt. Vui lòng hủy đơn cũ trước khi tạo đơn mới.',
      );
    }

    const absence = await this.absenceModel.create({
      user: new Types.ObjectId(userId),
      room: user.room,
      type: dto.type,
      startDate,
      endDate,
      reason: dto.reason.trim(),
      guestName: dto.type === AbsenceType.TAM_TRU ? dto.guestName?.trim() : undefined,
      guestIdNumber: dto.type === AbsenceType.TAM_TRU ? dto.guestIdNumber?.trim() : undefined,
      status: AbsenceStatus.PENDING,
    });

    this.logger.log(
      `Absence requested — user: ${userId}, type: ${dto.type}, ${dto.startDate} → ${dto.endDate}`,
    );

    // Báo cho các tài khoản quản lý — lỗi thông báo không làm hỏng việc tạo đơn
    try {
      const typeLabel =
        dto.type === AbsenceType.TAM_TRU ? 'tạm trú qua đêm' : 'tạm vắng qua đêm';
      const managers = await this.userModel
        .find({ role: { $in: ['ADMIN', 'DORMITORY_MANAGER', 'FLOOR_MANAGER'] } })
        .select('_id')
        .lean();
      for (const manager of managers) {
        await this.notificationsService.createAndSend({
          recipient: manager._id.toString(),
          title: 'Đơn tạm trú/tạm vắng mới! 🌙',
          message: `Sinh viên ${user.fullName} vừa đăng ký ${typeLabel} (${startDate.toLocaleDateString('vi-VN')} - ${endDate.toLocaleDateString('vi-VN')}).`,
          type: 'SYSTEM',
          link: '/admin/absences',
        });
      }
    } catch (notifyErr) {
      this.logger.error(
        `Không gửi được thông báo đơn tạm trú/tạm vắng cho quản lý — user: ${userId}`,
        notifyErr instanceof Error ? notifyErr.stack : String(notifyErr),
      );
    }

    return {
      message: 'Đã gửi đơn đăng ký! Vui lòng chờ Ban quản lý phê duyệt.',
      absence,
    };
  }

  async getMyAbsences(userId: string): Promise<AbsenceDocument[]> {
    this.assertValidObjectId(userId, 'userId');

    return this.absenceModel
      .find({ user: new Types.ObjectId(userId) })
      .populate('room', 'name building floor')
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async getAllAbsences(): Promise<AbsenceDocument[]> {
    return this.absenceModel
      .find()
      .populate('user', 'fullName mssv email phone')
      .populate('room', 'name building floor')
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  private async processAbsence(
    absenceId: string,
    nextStatus: AbsenceStatus.APPROVED | AbsenceStatus.REJECTED,
  ) {
    this.assertValidObjectId(absenceId, 'absenceId');

    const absence = await this.absenceModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(absenceId),
        status: AbsenceStatus.PENDING,
      },
      { status: nextStatus, processedAt: new Date() },
      { returnDocument: 'after' },
    );

    if (!absence) {
      throw new NotFoundException(
        'Không tìm thấy đơn này, hoặc đơn không còn ở trạng thái chờ duyệt.',
      );
    }

    const approved = nextStatus === AbsenceStatus.APPROVED;
    const typeLabel =
      absence.type === AbsenceType.TAM_TRU ? 'tạm trú qua đêm' : 'tạm vắng qua đêm';

    this.logger.log(
      `Absence ${approved ? 'approved' : 'rejected'} — absenceId: ${absenceId}`,
    );

    try {
      await this.notificationsService.createAndSend({
        recipient: absence.user.toString(),
        title: approved
          ? 'Đơn tạm trú/tạm vắng đã được duyệt! ✅'
          : 'Đơn tạm trú/tạm vắng bị từ chối',
        message: approved
          ? `Đơn đăng ký ${typeLabel} của bạn đã được chấp thuận. Nhớ tuân thủ nội quy KTX nhé.`
          : `Rất tiếc, đơn đăng ký ${typeLabel} của bạn không được chấp thuận. Liên hệ Ban quản lý để biết thêm chi tiết.`,
        type: 'SYSTEM',
        link: '/student/absences',
      });
    } catch (notifyErr) {
      this.logger.error(
        `Không gửi được thông báo kết quả đơn — absenceId: ${absenceId}`,
        notifyErr instanceof Error ? notifyErr.stack : String(notifyErr),
      );
    }

    return {
      message: approved ? 'Đã duyệt đơn đăng ký.' : 'Đã từ chối đơn đăng ký.',
    };
  }

  approveAbsence(absenceId: string) {
    return this.processAbsence(absenceId, AbsenceStatus.APPROVED);
  }

  rejectAbsence(absenceId: string) {
    return this.processAbsence(absenceId, AbsenceStatus.REJECTED);
  }

  async cancelAbsence(userId: string, absenceId: string) {
    this.assertValidObjectId(userId, 'userId');
    this.assertValidObjectId(absenceId, 'absenceId');

    const absence = await this.absenceModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(absenceId),
        user: new Types.ObjectId(userId),
        status: AbsenceStatus.PENDING,
      },
      { status: AbsenceStatus.CANCELLED },
      { returnDocument: 'after' },
    );

    if (!absence) {
      throw new NotFoundException(
        'Không tìm thấy đơn này, hoặc đơn không thể hủy (chỉ hủy được đơn đang chờ duyệt).',
      );
    }

    this.logger.log(
      `Absence cancelled — userId: ${userId}, absenceId: ${absenceId}`,
    );
    return { message: 'Đã hủy đơn đăng ký.' };
  }
}
