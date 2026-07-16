import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AssignmentsService } from './assignments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('api/assignments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AssignmentsController {
  constructor(private readonly assignmentsService: AssignmentsService) {}

  // Xem trước: sinh viên chưa có phòng + phòng còn trống
  @Get('preview')
  @Roles('ADMIN', 'DORMITORY_MANAGER')
  getPreview() {
    return this.assignmentsService.getPreview();
  }

  // Chạy phân phòng tự động hàng loạt
  @Post('auto')
  @Roles('ADMIN', 'DORMITORY_MANAGER')
  runAutoAssignment() {
    return this.assignmentsService.runAutoAssignment();
  }
}
