import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { Room, RoomDocument } from './schemas/room.schema';
import { SearchRoomDto } from './dto/search-room.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class RoomsService {
  constructor(@InjectModel(Room.name) private roomModel: Model<RoomDocument>) {}

  // --- Helper: Validate ObjectId ---
  private validateObjectId(id: string, context = 'phòng'): void {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`ID "${id}" không đúng định dạng ObjectId`);
    }
  }

  // --- Helper: Xử lý lỗi duplicate key ---
  private handleDuplicateKeyError(error: any): never {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      throw new BadRequestException(
        `Giá trị "${field}" này đã tồn tại trong cơ sở dữ liệu`,
      );
    }
    throw error;
  }

  // 1. LƯU (Create): Thêm phòng mới vào MongoDB
  async create(createRoomDto: CreateRoomDto): Promise<Room> {
    try {
      const newRoom = new this.roomModel(createRoomDto);
      return await newRoom.save();
    } catch (error: any) {
      this.handleDuplicateKeyError(error);
    }
  }

  // 2. LẤY TẤT CẢ (Read All)
  async findAll(query: SearchRoomDto): Promise<PaginatedResult<Room>> {
    const {
      page = 1,
      limit = 20,
      name,
      building,
      status,
      minPrice,
      maxPrice,
    } = query;

    const filter: any = {};

    if (name) {
      filter.name = { $regex: name, $options: 'i' };
    }
    if (building) {
      filter.building = building;
    }
    if (status) {
      filter.status = status;
    }
    if (minPrice !== undefined || maxPrice !== undefined) {
      filter.price = {};
      if (minPrice !== undefined) filter.price.$gte = minPrice;
      if (maxPrice !== undefined) filter.price.$lte = maxPrice;
    }

    const skip = (page - 1) * limit;

    // Chạy song song 2 query để tối ưu performance
    const [data, total] = await Promise.all([
      this.roomModel
        .find(filter)
        // Chỉ lấy các trường công khai của occupants — tuyệt đối không trả passwordHash/cccd/phone
        .populate('occupants', 'fullName mssv avatar')
        .sort({ building: 1, name: 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.roomModel.countDocuments(filter).exec(),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // 3. LẤY CHI TIẾT (Read One): Tìm 1 phòng theo ID
  async findOne(id: string): Promise<Room> {
    this.validateObjectId(id);

    // Thêm .populate('occupants') để admin có thể xem được người dùng trong 1 phòng cụ thể
    // (chỉ các trường công khai — endpoint này không yêu cầu đăng nhập)
    const room = await this.roomModel
      .findById(id)
      .populate('occupants', 'fullName mssv avatar')
      .exec();
    if (!room) {
      throw new NotFoundException(`Không tìm thấy phòng có ID "${id}"`);
    }
    return room;
  }

  // THÊM MỚI: Dành cho API Get /me của Student (Đã sửa lỗi query ảo)
  async findRoomByUserId(userId: string): Promise<Room> {
    // 1. Tìm thông tin User để lấy ID phòng.
    // Dùng this.roomModel.db.model('User') để truy vấn trực tiếp bảng User mà không cần import model gây vòng lặp.
    const user = await this.roomModel.db.model('User').findById(userId).exec();

    if (!user || !user.room) {
      throw new NotFoundException('Bạn chưa được phân vào phòng nào.');
    }

    // 2. Dùng ID phòng của user để lấy dữ liệu phòng (gọi lại hàm findOne để nó tự động populate occupants)
    return this.findOne(user.room.toString());
  }

  // 4. CẬP NHẬT (Update): Thay đổi thông tin phòng
  async update(id: string, updateRoomDto: UpdateRoomDto): Promise<Room> {
    this.validateObjectId(id);

    try {
      const updatedRoom = await this.roomModel
        .findByIdAndUpdate(id, updateRoomDto, {
          returnDocument: 'after',
          runValidators: true,
        })
        .populate('occupants', 'fullName mssv avatar') // Trả về occupants (chỉ trường công khai) sau khi update
        .exec();

      if (!updatedRoom) {
        throw new NotFoundException(
          `Không tìm thấy phòng có ID "${id}" để cập nhật`,
        );
      }
      return updatedRoom;
    } catch (error: any) {
      // Ném lại NotFoundException nếu đã được throw ở trên
      if (error instanceof NotFoundException) throw error;
      this.handleDuplicateKeyError(error);
    }
  }

  // 5. XÓA (Delete): Gỡ bỏ phòng khỏi MongoDB
  async remove(id: string): Promise<{ message: string }> {
    this.validateObjectId(id);

    const result = await this.roomModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`Không tìm thấy phòng có ID "${id}" để xóa`);
    }

    // Đảm bảo không bị lỗi nếu schema dùng 'roomNumber' thay vì 'name'
    const roomIdentifier =
      (result as any).name || (result as any).roomNumber || id;
    return { message: `Đã xóa phòng "${roomIdentifier}" thành công` };
  }
}
