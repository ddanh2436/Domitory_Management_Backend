import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ClientSession, Types } from 'mongoose'; // 👈 Thêm Types vào đây
import { Contract, ContractDocument } from './schemas/contract.schema';

@Injectable()
export class ContractsService {
  constructor(@InjectModel(Contract.name) private contractModel: Model<ContractDocument>) {}

  async createContractFromBooking(booking: any, roomPrice: number, session?: ClientSession) {
    const contractNumber = `HD-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 5); 

    const terms = `1. Bên A có trách nhiệm cung cấp phòng ở đúng tiêu chuẩn kỹ thuật.\n2. Bên B tuân thủ nghiêm chỉnh các quy định phòng dịch, an toàn phòng cháy chữa cháy và nội quy nội trú.\n3. Tiền phòng thanh toán theo chu kỳ hóa đơn hàng tháng.`;

    // 🛠️ FIX TẠI ĐÂY: Ép kiểu toàn bộ ID thô về Types.ObjectId chuẩn của Mongoose
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

  async findMyContract(userId: string) {
    // Tìm hợp đồng của cơ sở dữ liệu dựa trên ID của user
    const contract = await this.contractModel.findOne({ user: new Types.ObjectId(userId) })
      .populate('user', 'fullName mssv email phone cccd')
      .populate('room', 'name building floor price');
      
    if (!contract) return null; // Trả về null nếu thực sự chưa có bản ghi
    return contract;
  }
}