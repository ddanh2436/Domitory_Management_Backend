import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Room, RoomDocument } from './schemas/room.schema';
import { SearchRoomDto } from './dto/search-room.dto';

@Injectable()
export class RoomsService {
  constructor(@InjectModel(Room.name) private roomModel: Model<RoomDocument>) {}

  // 1. LƯU (Create): Thêm phòng mới hoàn toàn vào MongoDB
  async create(createRoomDto: any): Promise<Room> {
    try {
      const newRoom = new this.roomModel(createRoomDto);
      return await newRoom.save();
    } catch (error: any) {
      if (error.code === 11000) {
        throw new BadRequestException('Tên phòng này đã tồn tại trong cơ sở dữ liệu MongoDB');
      }
      throw error;
    }
  }

  // 2. LẤY VÀ TÌM KIẾM (Read All + Lọc): Truy vấn dữ liệu từ MongoDB theo điều kiện
  async findAll(query: SearchRoomDto): Promise<Room[]> {
    const filter: any = {};

    if (query.name) {
      filter.name = { $regex: query.name, $options: 'i' }; // Tìm kiếm gần đúng
    }
    if (query.building) {
      filter.building = query.building;
    }
    if (query.status) {
      filter.status = query.status;
    }
    if (query.minPrice || query.maxPrice) {
      filter.price = {};
      if (query.minPrice) filter.price.$gte = Number(query.minPrice);
      if (query.maxPrice) filter.price.$lte = Number(query.maxPrice);
    }

    return this.roomModel.find(filter).sort({ building: 1, name: 1 }).exec();
  }

  // 3. LẤY CHI TIẾT (Read One): Tìm 1 phòng dựa trên ID
  async findOne(id: string): Promise<Room> {
    const room = await this.roomModel.findById(id).exec();
    if (!room) {
      throw new NotFoundException(`Không tìm thấy phòng có mã ID ${id} trong hệ thống`);
    }
    return room;
  }

  // 4. CẬP NHẬT (Update): Thay đổi thông tin hoặc số lượng người đang ở
  async update(id: string, updateRoomDto: any): Promise<Room> {
    const updatedRoom = await this.roomModel
      .findByIdAndUpdate(id, updateRoomDto, { new: true, runValidators: true })
      .exec();
    
    if (!updatedRoom) {
      throw new NotFoundException(`Không tìm thấy phòng có ID ${id} để thực hiện cập nhật`);
    }
    return updatedRoom;
  }

  // 5. XÓA (Delete): Gỡ bỏ hoàn toàn phòng khỏi MongoDB
  async remove(id: string): Promise<{ message: string }> {
    const result = await this.roomModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`Không tìm thấy phòng có ID ${id} để thực hiện thao tác xóa`);
    }
    return { message: 'Xóa thông tin phòng khỏi cơ sở dữ liệu thành công' };
  }
}