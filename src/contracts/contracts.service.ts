import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ClientSession, Types } from 'mongoose'; 
import { Contract, ContractDocument } from './schemas/contract.schema';

@Injectable()
export class ContractsService {
  constructor(@InjectModel(Contract.name) private contractModel: Model<ContractDocument>) {}

  async createContractFromBooking(booking: any, roomPrice: number, session?: ClientSession) {
    // ... (Giữ nguyên logic của bạn ở đây)
    const contractNumber = `HD-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
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

  // 1. HÀM TÌM HỢP ĐỒNG GIỮ NGUYÊN BẢN CŨ CỦA BẠN (Không dùng .sort)
  async findMyContract(userId: string) {
    const contract = await this.contractModel.findOne({ user: new Types.ObjectId(userId) })
      .populate('user', 'fullName mssv email phone cccd')
      .populate('room', 'name building floor price');
      
    if (!contract) return null; 
    return contract;
  }

  // 2. CHỈ THÊM 2 HÀM NÀY XUỐNG CUỐI
  // FR15: Logic gia hạn hợp đồng
  async extendContract(userId: string, months: number) {
    const contract = await this.contractModel.findOne({ 
      user: new Types.ObjectId(userId), 
      status: 'ACTIVE' 
    });
    
    if (!contract) {
      throw new NotFoundException('Không tìm thấy hợp đồng đang hoạt động');
    }
    
    const newEndDate = new Date(contract.endDate);
    newEndDate.setMonth(newEndDate.getMonth() + months);
    
    contract.endDate = newEndDate;
    return contract.save();
  }

  // FR16: Logic thanh lý hợp đồng
  async terminateContract(userId: string) {
    const contract = await this.contractModel.findOne({ 
      user: new Types.ObjectId(userId), 
      status: 'ACTIVE' 
    });
    
    if (!contract) {
      throw new NotFoundException('Không tìm thấy hợp đồng đang hoạt động');
    }
    
    contract.status = 'TERMINATED';
    contract.endDate = new Date();
    return contract.save();
  }
}