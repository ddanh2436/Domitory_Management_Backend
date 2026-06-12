import { Module } from '@nestjs/common'; // 👈 ĐÃ SỬA: Import chuẩn từ @nestjs/common
import { MongooseModule } from '@nestjs/mongoose';
import { ContractsService } from './contracts.service';
import { ContractsController } from './contracts.controller';
import { Contract, ContractSchema } from './schemas/contract.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Contract.name, schema: ContractSchema }])],
  controllers: [ContractsController],
  providers: [ContractsService],
  exports: [ContractsService], // Xuất ra để BookingsModule có thể gọi sang dùng chung
})
export class ContractsModule {}