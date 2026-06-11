import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

 async findProfile(userId: string) {
    const user = await this.userModel.findById(userId)
      .select('-passwordHash')
      .populate('room', 'name building floor capacity price'); 
      
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    return user;
  }

  async findAllStudents() {
    return this.userModel.find({ role: 'STUDENT' }).select('-passwordHash').sort({ createdAt: -1 });
  }
}