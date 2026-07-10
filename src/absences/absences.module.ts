import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AbsencesController } from './absences.controller';
import { AbsencesService } from './absences.service';
import { Absence, AbsenceSchema } from './schemas/absence.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Absence.name, schema: AbsenceSchema },
      { name: User.name, schema: UserSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [AbsencesController],
  providers: [AbsencesService],
})
export class AbsencesModule {}
