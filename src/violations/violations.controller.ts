import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ViolationsService } from './violations.service';
import { CreateViolationDto } from './dto/create-violation.dto';
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
}
