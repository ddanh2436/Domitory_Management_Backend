import { Controller, Get, Post, Request, UseGuards, Body } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('api/contracts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContractsController {
  constructor(private contractsService: ContractsService) {}

  @Get('my-contract')
  async getMyContract(@Request() req: any) {
    return this.contractsService.findMyContract(req.user.sub);
  }

  // Danh sách toàn bộ hợp đồng cho trang quản lý
  @Get()
  @Roles('ADMIN', 'DORMITORY_MANAGER', 'FLOOR_MANAGER')
  async getAllContracts() {
    return this.contractsService.findAllContracts();
  }

  // FR15: Gia hạn hợp đồng
  @Post('extend')
  async extendContract(@Request() req: any, @Body('months') months: number) {
    // Mặc định gia hạn 6 tháng nếu không truyền số tháng
    return this.contractsService.extendContract(req.user.sub, months || 6);
  }

  // FR16: Thanh lý hợp đồng
  @Post('terminate')
  async terminateContract(@Request() req: any) {
    return this.contractsService.terminateContract(req.user.sub);
  }
}