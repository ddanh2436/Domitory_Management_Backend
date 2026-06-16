import { Controller, Get, Post, Body, Patch, Param, Req, UseGuards } from '@nestjs/common';
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
    const userId = req.user.sub;
    return this.maintenanceService.createRequest(userId, createDto);
  }

  @Get('me')
  @Roles('STUDENT')
  getMyRequests(@Req() req: any) {
    const userId = req.user.sub;
    return this.maintenanceService.getMyRequests(userId);
  }

  // --- API DÀNH CHO ADMIN ---
  @Get()
  @Roles('ADMIN')
  findAll() {
    return this.maintenanceService.getAllRequests();
  }

  @Patch(':id/status')
  @Roles('ADMIN')
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.maintenanceService.updateStatus(id, status);
  }
}