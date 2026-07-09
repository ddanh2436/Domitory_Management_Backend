import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ViolationsController } from './violations.controller';
import { ViolationsService } from './violations.service';
import { Violation, ViolationSchema } from './schemas/violation.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Violation.name, schema: ViolationSchema },
      { name: User.name, schema: UserSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [ViolationsController],
  providers: [ViolationsService],
})
export class ViolationsModule {}
