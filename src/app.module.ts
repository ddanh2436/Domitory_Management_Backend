import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RoomsModule } from './rooms/rooms.module';
import { BookingsModule } from './bookings/bookings.module';
import { InvoicesModule } from './invoices/invoices.module';
import { ContractsModule } from './contracts/contracts.module'; // 👈 Import Module hợp đồng vào đây
import { MaintenanceModule } from './maintenance/maintenance.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ViolationsModule } from './violations/violations.module';
import { TransfersModule } from './transfers/transfers.module';
import { AbsencesModule } from './absences/absences.module';
import { CheckoutsModule } from './checkouts/checkouts.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { ChatbotModule } from './chatbot/chatbot.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    UsersModule,
    RoomsModule,
    BookingsModule,
    InvoicesModule,
    ContractsModule,
    MaintenanceModule,
    NotificationsModule,
    ViolationsModule,
    TransfersModule,
    AbsencesModule,
    CheckoutsModule,
    AssignmentsModule,
    AuditLogsModule,
    ChatbotModule,
  ],
})
export class AppModule {}
