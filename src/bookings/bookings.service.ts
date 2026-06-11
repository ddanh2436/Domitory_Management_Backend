// ─── bookings.service.ts ─────────────────────────────────────────────────────

import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection, ClientSession } from 'mongoose';

import { Booking, BookingDocument } from './schemas/booking.schema';
import { Room, RoomDocument } from '../rooms/schemas/room.schema';
import { BookingStatus, RoomStatus } from './bookings.enum';
import { User, UserDocument } from '../users/schemas/user.schema';
// ─── Response shapes ─────────────────────────────────────────────────────────

export interface CreateBookingResponse {
  message: string;
  booking: {
    _id: Types.ObjectId;
    status: BookingStatus;
    createdAt: Date;
    room: {
      _id: Types.ObjectId;
      name: string;
      building: string;
      floor: number;
      price: number;
    };
  };
}

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @InjectModel(Booking.name) private bookingModel: Model<BookingDocument>,
    @InjectModel(Room.name) private roomModel: Model<RoomDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectConnection() private connection: Connection,
  ) {}

  private assertValidObjectId(id: string, fieldName: string): void {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`${fieldName} không hợp lệ.`);
    }
  }

  async createBooking(
    userId: string,
    roomId: string,
  ): Promise<CreateBookingResponse> {
    this.assertValidObjectId(userId, 'userId');
    this.assertValidObjectId(roomId, 'roomId');

    const session: ClientSession = await this.connection.startSession();
    session.startTransaction();

    try {
      const existingBooking = await this.bookingModel.findOne(
        {
          user: new Types.ObjectId(userId),
          status: { $in: [BookingStatus.PENDING, BookingStatus.APPROVED] },
        },
        null,
        { session },
      );

      if (existingBooking) {
        throw new BadRequestException(
          'Bạn đã có đơn đăng ký đang chờ duyệt hoặc đang lưu trú. ' +
            'Vui lòng hủy đơn cũ trước khi đăng ký phòng mới.',
        );
      }

      const room = await this.roomModel.findOneAndUpdate(
        {
          _id: new Types.ObjectId(roomId),
          status: RoomStatus.AVAILABLE,
          $expr: { $lt: ['$currentOccupancy', '$capacity'] }, // safety net
        },
        {},
        { session, returnDocument: 'after' },
      );

      if (!room) {
        const exists = await this.roomModel.exists({
          _id: new Types.ObjectId(roomId),
        });

        if (!exists) {
          throw new NotFoundException(
            'Không tìm thấy phòng này trong hệ thống.',
          );
        }
        throw new BadRequestException(
          'Phòng này hiện không còn chỗ trống hoặc đang trong thời gian bảo trì.',
        );
      }

      const [newBooking] = await this.bookingModel.create(
        [
          {
            user: new Types.ObjectId(userId),
            room: new Types.ObjectId(roomId),
            status: BookingStatus.PENDING,
          },
        ],
        { session },
      );

      // ── 5. Commit ───────────────────────────────────────────────────────
      await session.commitTransaction();

      this.logger.log(
        `Booking created — user: ${userId}, room: ${roomId}, bookingId: ${newBooking._id}`,
      );

      const populated = await newBooking.populate<{
        room: Pick<Room, 'name' | 'building' | 'floor' | 'price'> & {
          _id: Types.ObjectId;
        };
      }>('room', 'name building floor price');

      return {
        message:
          'Đăng ký phòng thành công! Vui lòng chờ Ban quản lý phê duyệt.',
        booking: {
          _id: newBooking._id as Types.ObjectId,
          status: newBooking.status as BookingStatus,
          createdAt: newBooking.get('createdAt') as Date,
          room: populated.room,
        },
      };
    } catch (err) {
      await session.abortTransaction();

      if (
        err instanceof BadRequestException ||
        err instanceof NotFoundException
      ) {
        throw err;
      }

      this.logger.error(
        `createBooking failed — user: ${userId}, room: ${roomId}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw new InternalServerErrorException(
        'Có lỗi xảy ra khi xử lý yêu cầu. Vui lòng thử lại sau.',
      );
    } finally {
      session.endSession();
    }
  }

  async getBookingsByUser(userId: string): Promise<BookingDocument[]> {
    this.assertValidObjectId(userId, 'userId');

    return this.bookingModel
      .find({ user: new Types.ObjectId(userId) })
      .populate('room', 'name building floor price status')
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async getAllBookings(): Promise<BookingDocument[]> {
    return this.bookingModel
      .find()
      .populate('user', 'fullName mssv email')
      .populate('room', 'name building floor price status')
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async approveBooking(bookingId: string): Promise<{ message: string }> {
    this.assertValidObjectId(bookingId, 'bookingId');

    const session: ClientSession = await this.connection.startSession();
    session.startTransaction();

    try {
      const booking = await this.bookingModel.findOneAndUpdate(
        {
          _id: new Types.ObjectId(bookingId),
          status: BookingStatus.PENDING,
        },
        { status: BookingStatus.APPROVED },
        { session, returnDocument: 'after' },
      );

      if (!booking) {
        throw new NotFoundException(
          'Không tìm thấy đơn đăng ký này, hoặc đơn không còn ở trạng thái chờ duyệt.',
        );
      }

      const updatedRoom = await this.roomModel.findByIdAndUpdate(
        booking.room,
        { $inc: { currentOccupancy: 1 } },
        { session, returnDocument: 'after' },
      );

     if (updatedRoom && updatedRoom.currentOccupancy >= updatedRoom.capacity) {
        await this.roomModel.findByIdAndUpdate(
          booking.room,
          { status: RoomStatus.FULL },
          { session, returnDocument: 'after' },
        );
      }

      await this.userModel.findByIdAndUpdate(
        booking.user,
        { room: booking.room },
        { session, returnDocument: 'after' }
      );

      await session.commitTransaction();
      this.logger.log(`Booking approved — bookingId: ${bookingId}`);

      return { message: 'Phê duyệt đơn đăng ký thành công.' };
    } catch (err) {
      await session.abortTransaction();

      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException
      ) {
        throw err;
      }

      this.logger.error(`approveBooking failed — bookingId: ${bookingId}`, err);
      throw new InternalServerErrorException(
        'Có lỗi xảy ra. Vui lòng thử lại sau.',
      );
    } finally {
      session.endSession();
    }
  }

  async rejectBooking(bookingId: string): Promise<{ message: string }> {
    this.assertValidObjectId(bookingId, 'bookingId');

    const booking = await this.bookingModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(bookingId),
        status: BookingStatus.PENDING,
      },
      { status: BookingStatus.REJECTED },
      { returnDocument: 'after' },
    );

    if (!booking) {
      throw new NotFoundException(
        'Không tìm thấy đơn đăng ký này, hoặc đơn không còn ở trạng thái chờ duyệt.',
      );
    }

    this.logger.log(`Booking rejected — bookingId: ${bookingId}`);
    return { message: 'Đã từ chối đơn đăng ký.' };
  }

  async cancelBooking(
    userId: string,
    bookingId: string,
  ): Promise<{ message: string }> {
    this.assertValidObjectId(userId, 'userId');
    this.assertValidObjectId(bookingId, 'bookingId');

    const booking = await this.bookingModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(bookingId),
        user: new Types.ObjectId(userId),
        status: BookingStatus.PENDING,
      },
      { status: BookingStatus.CANCELLED },
      { returnDocument: 'after' },
    );

    if (!booking) {
      throw new NotFoundException(
        'Không tìm thấy đơn đăng ký này, hoặc đơn không thể hủy (chỉ hủy được đơn đang chờ duyệt).',
      );
    }

    this.logger.log(
      `Booking cancelled — userId: ${userId}, bookingId: ${bookingId}`,
    );
    return { message: 'Đã hủy đơn đăng ký thành công.' };
  }
}
