import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { RespondFeedbackDto } from './dto/respond-feedback.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('api/feedback')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  // Sinh viên gửi góp ý/khiếu nại mới
  @Post()
  @Roles('STUDENT')
  create(@Req() req: any, @Body() dto: CreateFeedbackDto) {
    return this.feedbackService.create(req.user.sub, dto);
  }

  // Sinh viên xem lịch sử góp ý/khiếu nại của chính mình
  @Get('me')
  @Roles('STUDENT')
  getMine(@Req() req: any) {
    return this.feedbackService.findMine(req.user.sub);
  }

  // Ban quản lý xem toàn bộ, lọc theo loại/trạng thái
  @Get()
  @Roles('ADMIN', 'DORMITORY_MANAGER')
  findAll(@Query('type') type?: string, @Query('status') status?: string) {
    return this.feedbackService.findAll(type, status);
  }

  // Ban quản lý phản hồi và khép lại một mục đang chờ xử lý
  @Patch(':id/respond')
  @Roles('ADMIN', 'DORMITORY_MANAGER')
  respond(@Param('id') id: string, @Body() dto: RespondFeedbackDto, @Req() req: any) {
    return this.feedbackService.respond(req.user.sub, id, dto);
  }
}
