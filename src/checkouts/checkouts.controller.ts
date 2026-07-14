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
import { CheckoutsService } from './checkouts.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { CompleteCheckoutDto } from './dto/complete-checkout.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('api/checkouts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CheckoutsController {
  constructor(private readonly checkoutsService: CheckoutsService) {}

  @Post()
  @Roles('STUDENT')
  createCheckout(@Req() req: any, @Body() dto: CreateCheckoutDto) {
    const userId = req.user.sub;
    return this.checkoutsService.createCheckout(userId, dto);
  }

  @Get('me')
  @Roles('STUDENT')
  getMyCheckouts(@Req() req: any) {
    const userId = req.user.sub;
    return this.checkoutsService.getMyCheckouts(userId);
  }

  @Patch(':id/cancel')
  @Roles('STUDENT')
  cancelCheckout(@Req() req: any, @Param('id') checkoutId: string) {
    const userId = req.user.sub;
    return this.checkoutsService.cancelCheckout(userId, checkoutId);
  }

  @Get()
  @Roles('ADMIN', 'DORMITORY_MANAGER', 'FLOOR_MANAGER')
  getAllCheckouts() {
    return this.checkoutsService.getAllCheckouts();
  }

  // Kiểm tra tài sản + tính bồi thường + hoàn cọc + thanh lý hợp đồng
  @Patch(':id/complete')
  @Roles('ADMIN', 'DORMITORY_MANAGER', 'FLOOR_MANAGER')
  completeCheckout(
    @Param('id') checkoutId: string,
    @Body() dto: CompleteCheckoutDto,
  ) {
    return this.checkoutsService.completeCheckout(checkoutId, dto);
  }

  @Patch(':id/reject')
  @Roles('ADMIN', 'DORMITORY_MANAGER', 'FLOOR_MANAGER')
  rejectCheckout(
    @Param('id') checkoutId: string,
    @Body('adminNote') adminNote?: string,
  ) {
    return this.checkoutsService.rejectCheckout(checkoutId, adminNote);
  }
}
