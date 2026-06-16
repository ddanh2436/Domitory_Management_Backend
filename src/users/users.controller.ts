import { Controller, Get, Patch, Body, Request, UseGuards, Param, Delete } from '@nestjs/common';
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

  @Patch(':id')
  @Roles('ADMIN') 
  updateUserByAdmin(@Param('id') id: string, @Body() updateData: any) {
    // Tái sử dụng hàm updateProfile (hoặc hàm update tương ứng trong service của bạn)
    return this.usersService.updateProfile(id, updateData);
  }
  // Thêm chức năng Xóa sinh viên cho Admin
  @Delete(':id')
  @Roles('ADMIN')
  deleteUser(@Param('id') id: string) {
    return this.usersService.deleteUser(id);
  }
}
