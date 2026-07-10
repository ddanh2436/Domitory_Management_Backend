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
import { AbsencesService } from './absences.service';
import type { CreateAbsenceDto } from './absences.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('api/absences')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AbsencesController {
  constructor(private readonly absencesService: AbsencesService) {}

  @Post()
  @Roles('STUDENT')
  createAbsence(@Req() req: any, @Body() dto: CreateAbsenceDto) {
    const userId = req.user.sub;
    return this.absencesService.createAbsence(userId, dto);
  }

  @Get('me')
  @Roles('STUDENT')
  getMyAbsences(@Req() req: any) {
    const userId = req.user.sub;
    return this.absencesService.getMyAbsences(userId);
  }

  @Patch(':id/cancel')
  @Roles('STUDENT')
  cancelAbsence(@Req() req: any, @Param('id') absenceId: string) {
    const userId = req.user.sub;
    return this.absencesService.cancelAbsence(userId, absenceId);
  }

  @Get()
  @Roles('ADMIN', 'DORMITORY_MANAGER', 'FLOOR_MANAGER')
  getAllAbsences() {
    return this.absencesService.getAllAbsences();
  }

  @Patch(':id/approve')
  @Roles('ADMIN', 'DORMITORY_MANAGER', 'FLOOR_MANAGER')
  approveAbsence(@Param('id') absenceId: string) {
    return this.absencesService.approveAbsence(absenceId);
  }

  @Patch(':id/reject')
  @Roles('ADMIN', 'DORMITORY_MANAGER', 'FLOOR_MANAGER')
  rejectAbsence(@Param('id') absenceId: string) {
    return this.absencesService.rejectAbsence(absenceId);
  }
}
