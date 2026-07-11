import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, ClientSession, Types } from 'mongoose';
import { Contract, ContractDocument } from './schemas/contract.schema';
import { Room, RoomDocument } from '../rooms/schemas/room.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    @InjectModel(Contract.name) private contractModel: Model<ContractDocument>,
    @InjectModel(Room.name) private roomModel: Model<RoomDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createContractFromBooking(
    booking: any,
    roomPrice: number,
    session?: ClientSession,
  ) {
    // Kết hợp mốc thời gian (base36) + số ngẫu nhiên để gần như không thể trùng,
    // đồng thời đã có unique index trên contractNumber làm hàng rào cuối cùng.
    const uniquePart = `${Date.now().toString(36).toUpperCase()}${Math.floor(1000 + Math.random() * 9000)}`;
    const contractNumber = `HD-${new Date().getFullYear()}-${uniquePart}`;
    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 5);

    const terms = `1. Bên A có trách nhiệm cung cấp phòng ở đúng tiêu chuẩn kỹ thuật.\n2. Bên B tuân thủ nghiêm chỉnh các quy định phòng dịch, an toàn phòng cháy chữa cháy và nội quy nội trú.\n3. Tiền phòng thanh toán theo chu kỳ hóa đơn hàng tháng.`;

    const newContract = new this.contractModel({
      booking: new Types.ObjectId(booking._id),
      user: new Types.ObjectId(booking.user),
      room: new Types.ObjectId(booking.room),
      contractNumber,
      startDate,
      endDate,
      rentalFee: roomPrice,
      terms,
    });

    return newContract.save({ session });
  }

  // Danh sách toàn bộ hợp đồng cho trang quản lý của Admin
  async findAllContracts() {
    return this.contractModel
      .find()
      .populate('user', 'fullName mssv email phone')
      .populate('room', 'name building floor price')
      .sort({ createdAt: -1 })
      .lean();
  }

  // ─── Cron 8h sáng hàng ngày: nhắc hợp đồng sắp hết hạn (còn ≤ 7 ngày) ──────
  // lastReminderAt chặn spam: mỗi hợp đồng chỉ được nhắc lại sau tối thiểu 3 ngày.
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async remindExpiringContracts(): Promise<void> {
    const now = new Date();
    const soon = new Date(now);
    soon.setDate(soon.getDate() + 7);
    const reminderCooldown = new Date(now);
    reminderCooldown.setDate(reminderCooldown.getDate() - 3);

    const expiring = await this.contractModel.find({
      status: 'ACTIVE',
      endDate: { $gt: now, $lte: soon },
      $or: [
        { lastReminderAt: { $exists: false } },
        { lastReminderAt: { $lt: reminderCooldown } },
      ],
    });

    for (const contract of expiring) {
      const daysLeft = Math.max(
        1,
        Math.ceil((contract.endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
      );

      try {
        await this.notificationsService.createAndSend({
          recipient: contract.user.toString(),
          title: 'Hợp đồng sắp hết hạn! ⏳',
          message: `Hợp đồng ${contract.contractNumber} của bạn sẽ hết hạn sau ${daysLeft} ngày (${contract.endDate.toLocaleDateString('vi-VN')}). Hãy gia hạn nếu muốn tiếp tục lưu trú.`,
          type: 'SYSTEM',
          link: '/student/contracts',
        });
        contract.lastReminderAt = now;
        await contract.save();
      } catch (err) {
        this.logger.error(
          `Không gửi được nhắc hết hạn hợp đồng ${contract.contractNumber}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    if (expiring.length > 0) {
      this.logger.log(`Đã nhắc ${expiring.length} hợp đồng sắp hết hạn.`);
    }
  }

  // 1. HÀM TÌM HỢP ĐỒNG GIỮ NGUYÊN BẢN CŨ CỦA BẠN (Không dùng .sort)
  async findMyContract(userId: string) {
    const contract = await this.contractModel
      .findOne({ user: new Types.ObjectId(userId) })
      .populate('user', 'fullName mssv email phone cccd')
      .populate('room', 'name building floor price');

    if (!contract) return null;
    return contract;
  }

  // 2. CHỈ THÊM 2 HÀM NÀY XUỐNG CUỐI
  // FR15: Logic gia hạn hợp đồng
  async extendContract(userId: string, months: number) {
    // Chặn số tháng không hợp lệ (âm, 0, không nguyên, quá lớn) làm hỏng endDate
    if (!Number.isInteger(months) || months < 1 || months > 12) {
      throw new BadRequestException(
        'Số tháng gia hạn phải là số nguyên từ 1 đến 12',
      );
    }

    const contract = await this.contractModel.findOne({
      user: new Types.ObjectId(userId),
      status: 'ACTIVE',
    });

    if (!contract) {
      throw new NotFoundException('Không tìm thấy hợp đồng đang hoạt động');
    }

    const newEndDate = new Date(contract.endDate);
    newEndDate.setMonth(newEndDate.getMonth() + months);

    contract.endDate = newEndDate;
    return contract.save();
  }

  // FR16: Logic thanh lý hợp đồng — kèm TRẢ PHÒNG (giảm sức chứa, gỡ user khỏi phòng)
  async terminateContract(userId: string) {
    const contract = await this.contractModel.findOne({
      user: new Types.ObjectId(userId),
      status: 'ACTIVE',
    });

    if (!contract) {
      throw new NotFoundException('Không tìm thấy hợp đồng đang hoạt động');
    }

    contract.status = 'TERMINATED';
    contract.endDate = new Date();
    await contract.save();

    // Trả lại 1 chỗ trống cho phòng (không cho tụt xuống dưới 0)
    const updatedRoom = await this.roomModel.findOneAndUpdate(
      { _id: contract.room, currentOccupancy: { $gt: 0 } },
      { $inc: { currentOccupancy: -1 } },
      { returnDocument: 'after' },
    );

    // Nếu phòng đang FULL mà giờ đã có chỗ thì mở lại thành AVAILABLE
    if (
      updatedRoom &&
      updatedRoom.status === 'FULL' &&
      updatedRoom.currentOccupancy < updatedRoom.capacity
    ) {
      updatedRoom.status = 'AVAILABLE';
      await updatedRoom.save();
    }

    // Gỡ sinh viên ra khỏi phòng để không còn hiện diện trong danh sách occupants
    await this.userModel.findByIdAndUpdate(userId, { $unset: { room: 1 } });

    return contract;
  }
}
