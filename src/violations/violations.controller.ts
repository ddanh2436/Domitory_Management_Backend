import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ViolationsService } from './violations.service';
import { CreateViolationDto } from './dto/create-violation.dto';
import { AppealViolationDto } from './dto/appeal-violation.dto';
import { ReviewAppealDto } from './dto/review-appeal.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('api/violations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ViolationsController {
  constructor(private readonly violationsService: ViolationsService) {}

  // Admin ghi nhận vi phạm cho sinh viên
  @Post()
  @Roles('ADMIN', 'DORMITORY_MANAGER')
  create(@Req() req: any, @Body() dto: CreateViolationDto) {
    return this.violationsService.createViolation(req.user.sub, dto);
  }

  // Sinh viên xem lịch sử vi phạm của mình
  @Get('me')
  @Roles('STUDENT')
  getMine(@Req() req: any) {
    return this.violationsService.getMyViolations(req.user.sub);
  }

  // Admin xem lịch sử vi phạm của một sinh viên cụ thể
  @Get('student/:id')
  @Roles('ADMIN', 'DORMITORY_MANAGER', 'FLOOR_MANAGER')
  getByStudent(@Param('id') id: string) {
    return this.violationsService.getViolationsByStudent(id);
  }

  // Ban quản lý xem tất cả vi phạm (có thể lọc theo trạng thái) — hàng đợi duyệt khiếu nại
  @Get()
  @Roles('ADMIN', 'DORMITORY_MANAGER')
  findAll(@Query('status') status?: string) {
    return this.violationsService.findAll(status);
  }

  // Sinh viên khiếu nại một vi phạm của mình
  @Post(':id/appeal')
  @Roles('STUDENT')
  appeal(
    @Param('id') id: string,
    @Body() dto: AppealViolationDto,
    @Req() req: any,
  ) {
    return this.violationsService.appealViolation(req.user.sub, id, dto.reason);
  }

  // Ban quản lý duyệt khiếu nại (chấp nhận => thu hồi + hoàn điểm, hoặc từ chối)
  @Patch(':id/review')
  @Roles('ADMIN', 'DORMITORY_MANAGER')
  review(
    @Param('id') id: string,
    @Body() dto: ReviewAppealDto,
    @Req() req: any,
  ) {
    return this.violationsService.reviewAppeal(
      req.user.sub,
      id,
      dto.decision,
      dto.reviewNote,
    );
  }

  // Ban quản lý thu hồi trực tiếp một vi phạm ghi nhầm
  @Delete(':id')
  @Roles('ADMIN', 'DORMITORY_MANAGER')
  revoke(@Param('id') id: string, @Req() req: any) {
    return this.violationsService.revokeViolation(req.user.sub, id);
  }
}
