// ─── checkouts.service.ts ────────────────────────────────────────────────────
// Nghiệp vụ trả phòng (FR18-FR21): sinh viên gửi yêu cầu, quản lý kiểm tra
// tài sản, tính bồi thường trừ vào tiền cọc, hoàn số còn lại và thanh lý
// hợp đồng + trả chỗ trống cho phòng trong cùng một transaction.

import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection, ClientSession } from 'mongoose';

import { Checkout, CheckoutDocument } from './schemas/checkout.schema';
import { CheckoutStatus } from './checkouts.enum';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { CompleteCheckoutDto } from './dto/complete-checkout.dto';
import { Room, RoomDocument } from '../rooms/schemas/room.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  Contract,
  ContractDocument,
} from '../contracts/schemas/contract.schema';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class CheckoutsService {
  private readonly logger = new Logger(CheckoutsService.name);

  constructor(
    @InjectModel(Checkout.name) private checkoutModel: Model<CheckoutDocument>,
    @InjectModel(Room.name) private roomModel: Model<RoomDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Contract.name) private contractModel: Model<ContractDocument>,
    @InjectConnection() private connection: Connection,
    private notificationsService: NotificationsService,
  ) {}

  private assertValidObjectId(id: string, fieldName: string): void {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`${fieldName} không hợp lệ.`);
    }
  }

  // ── FR18: Sinh viên gửi yêu cầu trả phòng ─────────────────────────────────
  async createCheckout(userId: string, dto: CreateCheckoutDto) {
    this.assertValidObjectId(userId, 'userId');

    const expectedDate = new Date(dto.expectedDate);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    if (expectedDate < startOfToday) {
      throw new BadRequestException(
        'Ngày dự kiến trả phòng không được ở trong quá khứ.',
      );
    }

    const user = await this.userModel.findById(userId);
    if (!user || !user.room) {
      throw new BadRequestException(
        'Bạn chưa được xếp phòng nên không thể yêu cầu trả phòng.',
      );
    }

    const contract = await this.contractModel.findOne({
      user: new Types.ObjectId(userId),
      status: 'ACTIVE',
    });
    if (!contract) {
      throw new BadRequestException(
        'Không tìm thấy hợp đồng đang hoạt động của bạn. Liên hệ Ban quản lý để được hỗ trợ.',
      );
    }

    const existingPending = await this.checkoutModel.findOne({
      user: new Types.ObjectId(userId),
      status: CheckoutStatus.PENDING,
    });
    if (existingPending) {
      throw new BadRequestException(
        'Bạn đã có một yêu cầu trả phòng đang chờ xử lý. Vui lòng hủy yêu cầu cũ trước khi tạo mới.',
      );
    }

    // Hệ thống chưa quản lý tiền cọc riêng — quy ước cọc = 1 tháng tiền phòng,
    // quản lý được điều chỉnh lại con số thực tế khi hoàn tất.
    const checkout = await this.checkoutModel.create({
      user: new Types.ObjectId(userId),
      room: user.room,
      contract: contract._id,
      reason: dto.reason.trim(),
      expectedDate,
      depositAmount: contract.rentalFee,
      status: CheckoutStatus.PENDING,
    });

    this.logger.log(
      `Checkout requested — user: ${userId}, room: ${user.room.toString()}`,
    );

    // Báo cho quản lý — lỗi gửi thông báo không được làm hỏng việc tạo yêu cầu
    try {
      const room = await this.roomModel
        .findById(user.room)
        .select('name')
        .lean();
      const managers = await this.userModel
        .find({
          role: { $in: ['ADMIN', 'DORMITORY_MANAGER', 'FLOOR_MANAGER'] },
        })
        .select('_id')
        .lean();
      for (const manager of managers) {
        await this.notificationsService.createAndSend({
          recipient: manager._id.toString(),
          title: 'Yêu cầu trả phòng mới! 📦',
          message: `Sinh viên ${user.fullName} xin trả phòng ${room?.name ?? '—'}, dự kiến rời ngày ${expectedDate.toLocaleDateString('vi-VN')}.`,
          type: 'BOOKING',
          link: '/admin/checkouts',
        });
      }
    } catch (notifyErr) {
      this.logger.error(
        `Không gửi được thông báo yêu cầu trả phòng cho quản lý — user: ${userId}`,
        notifyErr instanceof Error ? notifyErr.stack : String(notifyErr),
      );
    }

    return {
      message:
        'Đã gửi yêu cầu trả phòng! Ban quản lý sẽ hẹn lịch kiểm tra tài sản và phản hồi qua thông báo.',
      checkout,
    };
  }

  async getMyCheckouts(userId: string): Promise<CheckoutDocument[]> {
    this.assertValidObjectId(userId, 'userId');

    return this.checkoutModel
      .find({ user: new Types.ObjectId(userId) })
      .populate('room', 'name building floor price')
      .populate('contract', 'contractNumber rentalFee')
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async getAllCheckouts(): Promise<CheckoutDocument[]> {
    return this.checkoutModel
      .find()
      .populate('user', 'fullName mssv email phone')
      .populate('room', 'name building floor price')
      .populate('contract', 'contractNumber rentalFee startDate endDate')
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async cancelCheckout(
    userId: string,
    checkoutId: string,
  ): Promise<{ message: string }> {
    this.assertValidObjectId(userId, 'userId');
    this.assertValidObjectId(checkoutId, 'checkoutId');

    const checkout = await this.checkoutModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(checkoutId),
        user: new Types.ObjectId(userId),
        status: CheckoutStatus.PENDING,
      },
      { status: CheckoutStatus.CANCELLED },
      { returnDocument: 'after' },
    );

    if (!checkout) {
      throw new NotFoundException(
        'Không tìm thấy yêu cầu trả phòng này, hoặc yêu cầu không thể hủy (chỉ hủy được yêu cầu đang chờ xử lý).',
      );
    }

    this.logger.log(
      `Checkout cancelled — userId: ${userId}, checkoutId: ${checkoutId}`,
    );
    return { message: 'Đã hủy yêu cầu trả phòng.' };
  }

  async rejectCheckout(
    checkoutId: string,
    adminNote?: string,
  ): Promise<{ message: string }> {
    this.assertValidObjectId(checkoutId, 'checkoutId');

    const checkout = await this.checkoutModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(checkoutId),
        status: CheckoutStatus.PENDING,
      },
      {
        status: CheckoutStatus.REJECTED,
        processedAt: new Date(),
        ...(adminNote?.trim() ? { adminNote: adminNote.trim() } : {}),
      },
      { returnDocument: 'after' },
    );

    if (!checkout) {
      throw new NotFoundException(
        'Không tìm thấy yêu cầu trả phòng này, hoặc yêu cầu không còn ở trạng thái chờ xử lý.',
      );
    }

    this.logger.log(`Checkout rejected — checkoutId: ${checkoutId}`);

    try {
      await this.notificationsService.createAndSend({
        recipient: checkout.user.toString(),
        title: 'Yêu cầu trả phòng bị từ chối',
        message: adminNote?.trim()
          ? `Yêu cầu trả phòng của bạn không được chấp thuận. Lý do: ${adminNote.trim()}`
          : 'Rất tiếc, yêu cầu trả phòng của bạn không được chấp thuận. Liên hệ Ban quản lý để biết thêm chi tiết.',
        type: 'BOOKING',
        link: '/student/checkout',
      });
    } catch (notifyErr) {
      this.logger.error(
        `Không gửi được thông báo từ chối trả phòng — checkoutId: ${checkoutId}`,
        notifyErr instanceof Error ? notifyErr.stack : String(notifyErr),
      );
    }

    return { message: 'Đã từ chối yêu cầu trả phòng.' };
  }

  // ── FR19 + FR20 + FR21: Kiểm tra tài sản, tính bồi thường, hoàn cọc ───────
  // Hoàn tất trả phòng trong 1 transaction: lưu danh mục hư hỏng, tính tiền,
  // thanh lý hợp đồng, trả chỗ trống cho phòng và gỡ sinh viên khỏi phòng.
  async completeCheckout(
    checkoutId: string,
    dto: CompleteCheckoutDto,
  ): Promise<{
    message: string;
    compensationAmount: number;
    refundAmount: number;
  }> {
    this.assertValidObjectId(checkoutId, 'checkoutId');

    const session: ClientSession = await this.connection.startSession();
    session.startTransaction();

    try {
      const pending = await this.checkoutModel
        .findOne({
          _id: new Types.ObjectId(checkoutId),
          status: CheckoutStatus.PENDING,
        })
        .session(session);

      if (!pending) {
        throw new NotFoundException(
          'Không tìm thấy yêu cầu trả phòng này, hoặc yêu cầu không còn ở trạng thái chờ xử lý.',
        );
      }

      const damages = (dto.damages ?? []).map((d) => ({
        itemName: d.itemName.trim(),
        fee: d.fee,
        note: d.note?.trim(),
      }));
      const depositAmount = dto.depositAmount ?? pending.depositAmount;
      const compensationAmount = damages.reduce((sum, d) => sum + d.fee, 0);
      const refundAmount = Math.max(0, depositAmount - compensationAmount);

      pending.status = CheckoutStatus.COMPLETED;
      pending.damages = damages;
      pending.depositAmount = depositAmount;
      pending.compensationAmount = compensationAmount;
      pending.refundAmount = refundAmount;
      pending.processedAt = new Date();
      if (dto.adminNote?.trim()) pending.adminNote = dto.adminNote.trim();
      await pending.save({ session });

      // Thanh lý hợp đồng gắn với yêu cầu (nếu vẫn còn ACTIVE)
      await this.contractModel.findOneAndUpdate(
        { _id: pending.contract, status: 'ACTIVE' },
        { status: 'TERMINATED', endDate: new Date() },
        { session },
      );

      // Trả lại 1 chỗ trống cho phòng (không cho tụt dưới 0)
      const room = await this.roomModel.findOneAndUpdate(
        { _id: pending.room, currentOccupancy: { $gt: 0 } },
        { $inc: { currentOccupancy: -1 } },
        { session, returnDocument: 'after' },
      );
      if (
        room &&
        room.status === 'FULL' &&
        room.currentOccupancy < room.capacity
      ) {
        await this.roomModel.findByIdAndUpdate(
          pending.room,
          { status: 'AVAILABLE' },
          { session },
        );
      }

      // Gỡ sinh viên khỏi phòng
      await this.userModel.findByIdAndUpdate(
        pending.user,
        { $unset: { room: 1 } },
        { session },
      );

      await session.commitTransaction();
      this.logger.log(
        `Checkout completed — checkoutId: ${checkoutId}, compensation: ${compensationAmount}, refund: ${refundAmount}`,
      );

      // Gửi thông báo SAU khi commit — lỗi thông báo không làm rollback dữ liệu
      try {
        const detail =
          damages.length > 0
            ? `Phí bồi thường hư hỏng: ${compensationAmount.toLocaleString('vi-VN')}đ (${damages.length} hạng mục). `
            : 'Không ghi nhận hư hỏng tài sản. ';
        await this.notificationsService.createAndSend({
          recipient: pending.user.toString(),
          title: 'Trả phòng hoàn tất! ✅',
          message: `${detail}Tiền cọc hoàn lại: ${refundAmount.toLocaleString('vi-VN')}đ. Hợp đồng của bạn đã được thanh lý.`,
          type: 'BOOKING',
          link: '/student/checkout',
        });
      } catch (notifyErr) {
        this.logger.error(
          `Không gửi được thông báo hoàn tất trả phòng — checkoutId: ${checkoutId}`,
          notifyErr instanceof Error ? notifyErr.stack : String(notifyErr),
        );
      }

      return {
        message: 'Đã hoàn tất trả phòng và thanh lý hợp đồng.',
        compensationAmount,
        refundAmount,
      };
    } catch (err) {
      await session.abortTransaction();

      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException
      ) {
        throw err;
      }

      this.logger.error(
        `completeCheckout failed — checkoutId: ${checkoutId}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw new InternalServerErrorException(
        'Có lỗi xảy ra khi hoàn tất trả phòng. Vui lòng thử lại sau.',
      );
    } finally {
      session.endSession();
    }
  }
}
