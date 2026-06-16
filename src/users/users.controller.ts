import { Controller, Get, Patch, Body, Param, Request, UseGuards } from '@nestjs/common'; // Thêm Patch và Body
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('api/users')
@UseGuards(JwtAuthGuard, RolesGuard) 
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('profile')
  getProfile(@Request() req: any) {
    const userId = req.user.sub; 
    return this.usersService.findProfile(userId);
  }

  // Thêm endpoint để Admin (và cả Student) có thể tự cập nhật thông tin
  @Patch('profile')
  updateProfile(@Request() req: any, @Body() updateData: any) {
    const userId = req.user.sub;
    return this.usersService.updateProfile(userId, updateData);
  }

  @Get('students')
  @Roles('ADMIN', 'DORMITORY_MANAGER', 'FLOOR_MANAGER') 
  getAllStudents() {
    return this.usersService.findAllStudents();
  }

  @Get('access-control')
  @Roles('ADMIN')
  getAccessControlAccounts() {
    return this.usersService.findAccessControlAccounts();
  }

  @Patch(':id/access-control')
  @Roles('ADMIN')
  updateAccessControl(@Param('id') userId: string, @Body() updateData: any) {
    return this.usersService.updateAccessControl(userId, updateData);
  }
}
