import { Controller, Get, Post, Body, Patch, Param, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('api/maintenance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Post()
  @Roles('STUDENT')
  create(@Req() req: any, @Body() createDto: any) {
    // Trích xuất an toàn, lấy được ID dù JWT payload lưu dưới bất kỳ tên nào
    const userId = req.user?.sub || req.user?.userId || req.user?._id || req.user?.id;
    if (!userId) throw new BadRequestException('Không tìm thấy thông tin xác thực');
    return this.maintenanceService.createRequest(userId, createDto);
  }

  @Get('me')
  @Roles('STUDENT')
  getMyRequests(@Req() req: any) {
    const userId = req.user?.sub || req.user?.userId || req.user?._id || req.user?.id;
    return this.maintenanceService.getMyRequests(userId);
  }

  // --- API DÀNH CHO ADMIN ---
  @Get()
  @Roles('ADMIN', 'DORMITORY_MANAGER')
  findAll() {
    return this.maintenanceService.getAllRequests();
  }

  @Get('stats/status')
  @Roles('ADMIN', 'DORMITORY_MANAGER')
  getStatusStats() {
    return this.maintenanceService.getStatusStats();
  }

  @Patch(':id/status')
  @Roles('ADMIN', 'DORMITORY_MANAGER')
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.maintenanceService.updateStatus(id, status);
  }
}