// ─── transfers.service.ts ────────────────────────────────────────────────────
// Nghiệp vụ đổi phòng: sinh viên gửi yêu cầu, admin duyệt thì chuyển thật sự.

import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection, ClientSession } from 'mongoose';

import { Transfer, TransferDocument } from './schemas/transfer.schema';
import { TransferStatus } from './transfers.enum';
import { Room, RoomDocument } from '../rooms/schemas/room.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  Contract,
  ContractDocument,
} from '../contracts/schemas/contract.schema';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name);

  constructor(
    @InjectModel(Transfer.name) private transferModel: Model<TransferDocument>,
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

  async createTransfer(userId: string, toRoomId: string, reason: string) {
    this.assertValidObjectId(userId, 'userId');
    this.assertValidObjectId(toRoomId, 'toRoomId');

    if (!reason || !reason.trim()) {
      throw new BadRequestException('Vui lòng nhập lý do muốn đổi phòng.');
    }

    const user = await this.userModel.findById(userId);
    if (!user || !user.room) {
      throw new BadRequestException(
        'Bạn chưa được xếp phòng nên không thể yêu cầu đổi phòng.',
      );
    }

    if (user.room.toString() === toRoomId) {
      throw new BadRequestException(
        'Phòng muốn chuyển đến trùng với phòng bạn đang ở.',
      );
    }

    const existingPending = await this.transferModel.findOne({
      user: new Types.ObjectId(userId),
      status: TransferStatus.PENDING,
    });
    if (existingPending) {
      throw new BadRequestException(
        'Bạn đã có một yêu cầu đổi phòng đang chờ duyệt. Vui lòng hủy yêu cầu cũ trước khi tạo mới.',
      );
    }

    const toRoom = await this.roomModel.findOne({
      _id: new Types.ObjectId(toRoomId),
      status: 'AVAILABLE',
      $expr: { $lt: ['$currentOccupancy', '$capacity'] },
    });
    if (!toRoom) {
      const exists = await this.roomModel.exists({
        _id: new Types.ObjectId(toRoomId),
      });
      if (!exists) {
        throw new NotFoundException('Không tìm thấy phòng muốn chuyển đến.');
      }
      throw new BadRequestException(
        'Phòng muốn chuyển đến hiện không còn chỗ trống hoặc đang bảo trì.',
      );
    }

    const transfer = await this.transferModel.create({
      user: new Types.ObjectId(userId),
      fromRoom: user.room,
      toRoom: toRoom._id,
      reason: reason.trim(),
      status: TransferStatus.PENDING,
    });

    this.logger.log(
      `Transfer requested — user: ${userId}, from: ${user.room.toString()}, to: ${toRoomId}`,
    );

    // Báo cho các tài khoản quản lý có quyền duyệt đổi phòng —
    // lỗi gửi thông báo không được làm hỏng việc tạo yêu cầu.
    try {
      const fromRoom = await this.roomModel
        .findById(user.room)
        .select('name')
        .lean();
      const managers = await this.userModel
        .find({ role: { $in: ['ADMIN', 'DORMITORY_MANAGER', 'FLOOR_MANAGER'] } })
        .select('_id')
        .lean();
      for (const manager of managers) {
        await this.notificationsService.createAndSend({
          recipient: manager._id.toString(),
          title: 'Yêu cầu đổi phòng mới! 🔄',
          message: `Sinh viên ${user.fullName} xin chuyển từ phòng ${fromRoom?.name ?? '—'} sang phòng ${toRoom.name}.`,
          type: 'BOOKING',
          link: '/admin/transfers',
        });
      }
    } catch (notifyErr) {
      this.logger.error(
        `Không gửi được thông báo yêu cầu đổi phòng cho quản lý — user: ${userId}`,
        notifyErr instanceof Error ? notifyErr.stack : String(notifyErr),
      );
    }

    return {
      message:
        'Đã gửi yêu cầu đổi phòng! Vui lòng chờ Ban quản lý phê duyệt.',
      transfer,
    };
  }

  async getMyTransfers(userId: string): Promise<TransferDocument[]> {
    this.assertValidObjectId(userId, 'userId');

    return this.transferModel
      .find({ user: new Types.ObjectId(userId) })
      .populate('fromRoom', 'name building floor price')
      .populate('toRoom', 'name building floor price')
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async getAllTransfers(): Promise<TransferDocument[]> {
    return this.transferModel
      .find()
      .populate('user', 'fullName mssv email')
      .populate('fromRoom', 'name building floor price')
      .populate('toRoom', 'name building floor price')
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async approveTransfer(transferId: string): Promise<{ message: string }> {
    this.assertValidObjectId(transferId, 'transferId');

    const session: ClientSession = await this.connection.startSession();
    session.startTransaction();

    try {
      const transfer = await this.transferModel.findOneAndUpdate(
        {
          _id: new Types.ObjectId(transferId),
          status: TransferStatus.PENDING,
        },
        { status: TransferStatus.APPROVED, processedAt: new Date() },
        { session, returnDocument: 'after' },
      );

      if (!transfer) {
        throw new NotFoundException(
          'Không tìm thấy yêu cầu đổi phòng này, hoặc yêu cầu không còn ở trạng thái chờ duyệt.',
        );
      }

      // Nhận thêm người vào phòng mới — điều kiện $expr chặn vượt sức chứa
      // kể cả khi 2 yêu cầu cùng được duyệt song song.
      const toRoom = await this.roomModel.findOneAndUpdate(
        {
          _id: transfer.toRoom,
          $expr: { $lt: ['$currentOccupancy', '$capacity'] },
        },
        { $inc: { currentOccupancy: 1 } },
        { session, returnDocument: 'after' },
      );
      if (!toRoom) {
        throw new BadRequestException(
          'Phòng muốn chuyển đến đã hết chỗ trống, không thể duyệt yêu cầu này.',
        );
      }
      if (toRoom.currentOccupancy >= toRoom.capacity) {
        await this.roomModel.findByIdAndUpdate(
          transfer.toRoom,
          { status: 'FULL' },
          { session },
        );
      }

      // Trả chỗ ở phòng cũ (không cho tụt dưới 0)
      const fromRoom = await this.roomModel.findOneAndUpdate(
        { _id: transfer.fromRoom, currentOccupancy: { $gt: 0 } },
        { $inc: { currentOccupancy: -1 } },
        { session, returnDocument: 'after' },
      );
      if (
        fromRoom &&
        fromRoom.status === 'FULL' &&
        fromRoom.currentOccupancy < fromRoom.capacity
      ) {
        await this.roomModel.findByIdAndUpdate(
          transfer.fromRoom,
          { status: 'AVAILABLE' },
          { session },
        );
      }

      // Chuyển sinh viên sang phòng mới
      await this.userModel.findByIdAndUpdate(
        transfer.user,
        { room: transfer.toRoom },
        { session },
      );

      // Hợp đồng đang hoạt động đi theo phòng mới (kèm giá thuê mới)
      await this.contractModel.findOneAndUpdate(
        { user: transfer.user, status: 'ACTIVE' },
        { room: transfer.toRoom, rentalFee: toRoom.price },
        { session },
      );

      await session.commitTransaction();
      this.logger.log(`Transfer approved — transferId: ${transferId}`);

      // Gửi thông báo SAU khi commit — lỗi thông báo không làm rollback dữ liệu
      try {
        await this.notificationsService.createAndSend({
          recipient: transfer.user.toString(),
          title: 'Yêu cầu đổi phòng đã được duyệt! 🎉',
          message: `Bạn đã được chuyển sang phòng ${toRoom.name} (Tòa ${toRoom.building}, tầng ${toRoom.floor}). Hãy kiểm tra thông tin phòng mới của mình.`,
          type: 'BOOKING',
          link: '/student',
        });
      } catch (notifyErr) {
        this.logger.error(
          `Không gửi được thông báo duyệt đổi phòng — transferId: ${transferId}`,
          notifyErr instanceof Error ? notifyErr.stack : String(notifyErr),
        );
      }

      return { message: 'Đã duyệt yêu cầu đổi phòng thành công.' };
    } catch (err) {
      await session.abortTransaction();

      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException
      ) {
        throw err;
      }

      this.logger.error(
        `approveTransfer failed — transferId: ${transferId}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw new InternalServerErrorException(
        'Có lỗi xảy ra khi duyệt yêu cầu. Vui lòng thử lại sau.',
      );
    } finally {
      session.endSession();
    }
  }

  async rejectTransfer(transferId: string): Promise<{ message: string }> {
    this.assertValidObjectId(transferId, 'transferId');

    const transfer = await this.transferModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(transferId),
        status: TransferStatus.PENDING,
      },
      { status: TransferStatus.REJECTED, processedAt: new Date() },
      { returnDocument: 'after' },
    );

    if (!transfer) {
      throw new NotFoundException(
        'Không tìm thấy yêu cầu đổi phòng này, hoặc yêu cầu không còn ở trạng thái chờ duyệt.',
      );
    }

    this.logger.log(`Transfer rejected — transferId: ${transferId}`);

    try {
      await this.notificationsService.createAndSend({
        recipient: transfer.user.toString(),
        title: 'Yêu cầu đổi phòng bị từ chối',
        message:
          'Rất tiếc, yêu cầu đổi phòng của bạn không được chấp thuận. Liên hệ Ban quản lý để biết thêm chi tiết.',
        type: 'BOOKING',
        link: '/student/transfers',
      });
    } catch (notifyErr) {
      this.logger.error(
        `Không gửi được thông báo từ chối đổi phòng — transferId: ${transferId}`,
        notifyErr instanceof Error ? notifyErr.stack : String(notifyErr),
      );
    }

    return { message: 'Đã từ chối yêu cầu đổi phòng.' };
  }

  async cancelTransfer(
    userId: string,
    transferId: string,
  ): Promise<{ message: string }> {
    this.assertValidObjectId(userId, 'userId');
    this.assertValidObjectId(transferId, 'transferId');

    const transfer = await this.transferModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(transferId),
        user: new Types.ObjectId(userId),
        status: TransferStatus.PENDING,
      },
      { status: TransferStatus.CANCELLED },
      { returnDocument: 'after' },
    );

    if (!transfer) {
      throw new NotFoundException(
        'Không tìm thấy yêu cầu đổi phòng này, hoặc yêu cầu không thể hủy (chỉ hủy được yêu cầu đang chờ duyệt).',
      );
    }

    this.logger.log(
      `Transfer cancelled — userId: ${userId}, transferId: ${transferId}`,
    );
    return { message: 'Đã hủy yêu cầu đổi phòng.' };
  }
}
