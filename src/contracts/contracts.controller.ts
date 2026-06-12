import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/contracts')
@UseGuards(JwtAuthGuard)
export class ContractsController {
  constructor(private contractsService: ContractsService) {}

  @Get('my-contract')
  async getMyContract(@Request() req: any) {
    // Gọi chính xác hàm findMyContract đã viết bên ContractsService
    return this.contractsService.findMyContract(req.user.sub);
  }
}