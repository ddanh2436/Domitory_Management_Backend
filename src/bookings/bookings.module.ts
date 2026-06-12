import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { Booking, BookingSchema } from './schemas/booking.schema';
import { Room, RoomSchema } from '../rooms/schemas/room.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ContractsModule } from '../contracts/contracts.module'; // 👈 Import module hợp đồng

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      { name: Room.name, schema: RoomSchema },
      { name: User.name, schema: UserSchema },
    ]),
    ContractsModule, // 👈 BẮT BUỘC: Thêm dòng này để BookingsService sử dụng được ContractsService
  ],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}