// ─── assignments.service.ts ──────────────────────────────────────────────────
// FR12 — Phân phòng tự động: xếp hàng loạt sinh viên chưa có phòng vào các
// phòng còn chỗ trống, ưu tiên khớp giới tính (phòng MIXED nhận mọi sinh viên,
// phòng MALE/FEMALE chỉ nhận sinh viên có giới tính tương ứng).
// Mỗi sinh viên xếp thành công sẽ được tạo booking (APPROVED) + hợp đồng.

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Room, RoomDocument } from '../rooms/schemas/room.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Booking, BookingDocument } from '../bookings/schemas/booking.schema';
import { BookingStatus } from '../bookings/bookings.enum';
import { ContractsService } from '../contracts/contracts.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface AssignmentResult {
  studentId: string;
  studentName: string;
  mssv?: string;
  roomName?: string;
  status: 'ASSIGNED' | 'SKIPPED';
  reason?: string;
}

@Injectable()
export class AssignmentsService {
  private readonly logger = new Logger(AssignmentsService.name);

  constructor(
    @InjectModel(Room.name) private roomModel: Model<RoomDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Booking.name) private bookingModel: Model<BookingDocument>,
    private contractsService: ContractsService,
    private notificationsService: NotificationsService,
  ) {}

  // Xem trước hiện trạng: bao nhiêu sinh viên chưa có phòng, bao nhiêu chỗ trống
  async getPreview() {
    const [students, rooms] = await Promise.all([
      this.userModel
        .find({
          role: 'STUDENT',
          accessStatus: 'ACTIVE',
          room: { $exists: false },
        })
        .select('fullName mssv gender email')
        .sort({ fullName: 1 })
        .lean(),
      this.roomModel
        .find({
          status: 'AVAILABLE',
          $expr: { $lt: ['$currentOccupancy', '$capacity'] },
        })
        .select(
          'name building floor capacity currentOccupancy genderType price',
        )
        .sort({ building: 1, floor: 1, name: 1 })
        .lean(),
    ]);

    const freeSlots = rooms.reduce(
      (sum, r) => sum + (r.capacity - r.currentOccupancy),
      0,
    );

    return {
      unassignedStudents: students,
      availableRooms: rooms,
      freeSlots,
    };
  }

  // Chạy phân phòng tự động cho toàn bộ sinh viên chưa có phòng
  async runAutoAssignment(): Promise<{
    message: string;
    assignedCount: number;
    skippedCount: number;
    results: AssignmentResult[];
  }> {
    const { unassignedStudents, availableRooms } = await this.getPreview();
    const results: AssignmentResult[] = [];

    // Bản sao occupancy trong bộ nhớ để lần lượt "rót" sinh viên vào từng phòng
    const roomStates = availableRooms.map((r) => ({
      _id: r._id,
      name: r.name,
      building: r.building,
      floor: r.floor,
      price: r.price,
      genderType: r.genderType ?? 'MIXED',
      remaining: r.capacity - r.currentOccupancy,
    }));

    const pickRoom = (gender?: string) =>
      roomStates.find(
        (r) =>
          r.remaining > 0 &&
          (r.genderType === 'MIXED' || (gender && r.genderType === gender)),
      );

    let assignedCount = 0;

    for (const student of unassignedStudents) {
      const room = pickRoom(student.gender);
      if (!room) {
        results.push({
          studentId: student._id.toString(),
          studentName: student.fullName,
          mssv: student.mssv,
          status: 'SKIPPED',
          reason: student.gender
            ? 'Hết phòng trống phù hợp giới tính.'
            : 'Hết phòng trống (sinh viên chưa khai giới tính chỉ xếp được vào phòng MIXED).',
        });
        continue;
      }

      try {
        // Điều kiện $expr chặn vượt sức chứa kể cả khi có booking khác
        // được duyệt song song ngoài quy trình này.
        const updatedRoom = await this.roomModel.findOneAndUpdate(
          {
            _id: room._id,
            status: 'AVAILABLE',
            $expr: { $lt: ['$currentOccupancy', '$capacity'] },
          },
          { $inc: { currentOccupancy: 1 } },
          { returnDocument: 'after' },
        );
        if (!updatedRoom) {
          room.remaining = 0; // phòng đã bị lấp đầy bởi tiến trình khác
          results.push({
            studentId: student._id.toString(),
            studentName: student.fullName,
            mssv: student.mssv,
            status: 'SKIPPED',
            reason: `Phòng ${room.name} vừa hết chỗ, sinh viên bị bỏ qua trong lượt này.`,
          });
          continue;
        }
        if (updatedRoom.currentOccupancy >= updatedRoom.capacity) {
          await this.roomModel.findByIdAndUpdate(room._id, { status: 'FULL' });
        }

        const booking = await this.bookingModel.create({
          user: student._id,
          room: room._id,
          status: BookingStatus.APPROVED,
        });

        await this.contractsService.createContractFromBooking(
          booking,
          room.price,
        );

        await this.userModel.findByIdAndUpdate(student._id, {
          room: room._id,
        });

        room.remaining -= 1;
        assignedCount += 1;
        results.push({
          studentId: student._id.toString(),
          studentName: student.fullName,
          mssv: student.mssv,
          roomName: room.name,
          status: 'ASSIGNED',
        });

        // Thông báo cho sinh viên — lỗi gửi không làm hỏng kết quả xếp phòng
        try {
          await this.notificationsService.createAndSend({
            recipient: student._id.toString(),
            title: 'Bạn đã được xếp phòng! 🏠',
            message: `Hệ thống đã xếp bạn vào phòng ${room.name} (Tòa ${room.building}, tầng ${room.floor}). Hợp đồng lưu trú đã được tạo tự động.`,
            type: 'BOOKING',
            link: '/student',
          });
        } catch (notifyErr) {
          this.logger.error(
            `Không gửi được thông báo xếp phòng — student: ${student._id.toString()}`,
            notifyErr instanceof Error ? notifyErr.stack : String(notifyErr),
          );
        }
      } catch (err) {
        this.logger.error(
          `Xếp phòng thất bại — student: ${student._id.toString()}`,
          err instanceof Error ? err.stack : String(err),
        );
        results.push({
          studentId: student._id.toString(),
          studentName: student.fullName,
          mssv: student.mssv,
          status: 'SKIPPED',
          reason: 'Lỗi hệ thống khi xếp phòng cho sinh viên này.',
        });
      }
    }

    const skippedCount = results.length - assignedCount;
    this.logger.log(
      `Auto-assignment finished — assigned: ${assignedCount}, skipped: ${skippedCount}`,
    );

    return {
      message: `Đã xếp phòng cho ${assignedCount} sinh viên${skippedCount > 0 ? `, ${skippedCount} sinh viên chưa xếp được` : ''}.`,
      assignedCount,
      skippedCount,
      results,
    };
  }
}
