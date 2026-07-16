import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  controllers: [AuditLogsController],
  providers: [
    AuditLogsService,
    // Interceptor toàn cục: mọi request thay đổi dữ liệu đều được ghi nhật ký
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
})
export class AuditLogsModule {}
