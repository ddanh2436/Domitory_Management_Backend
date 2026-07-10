import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('api/transfers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Post()
  @Roles('STUDENT')
  createTransfer(
    @Req() req: any,
    @Body('toRoomId') toRoomId: string,
    @Body('reason') reason: string,
  ) {
    const userId = req.user.sub;
    return this.transfersService.createTransfer(userId, toRoomId, reason);
  }

  @Get('me')
  @Roles('STUDENT')
  getMyTransfers(@Req() req: any) {
    const userId = req.user.sub;
    return this.transfersService.getMyTransfers(userId);
  }

  @Patch(':id/cancel')
  @Roles('STUDENT')
  cancelTransfer(@Req() req: any, @Param('id') transferId: string) {
    const userId = req.user.sub;
    return this.transfersService.cancelTransfer(userId, transferId);
  }

  @Get()
  @Roles('ADMIN', 'DORMITORY_MANAGER', 'FLOOR_MANAGER')
  getAllTransfers() {
    return this.transfersService.getAllTransfers();
  }

  @Patch(':id/approve')
  @Roles('ADMIN', 'DORMITORY_MANAGER', 'FLOOR_MANAGER')
  approveTransfer(@Param('id') transferId: string) {
    return this.transfersService.approveTransfer(transferId);
  }

  @Patch(':id/reject')
  @Roles('ADMIN', 'DORMITORY_MANAGER', 'FLOOR_MANAGER')
  rejectTransfer(@Param('id') transferId: string) {
    return this.transfersService.rejectTransfer(transferId);
  }
}
