import { Controller, Get, Patch, Body, Request, UseGuards, Param, Delete, BadRequestException } from '@nestjs/common';
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

  // ĐƯA LÊN TRÊN: Các endpoint cụ thể (block, unblock) phải đứng trước endpoint chứa tham số động (:id)
  @Patch(':id/block')
  @Roles('ADMIN', 'DORMITORY_MANAGER') 
  async blockUser(@Param('id') id: string, @Body('reason') reason: string) {
    if (!reason) {
      throw new BadRequestException('Vui lòng cung cấp lý do khóa tài khoản');
    }
    return this.usersService.blockUser(id, reason);
  }

  @Patch(':id/unblock')
  @Roles('ADMIN', 'DORMITORY_MANAGER')
  async unblockUser(@Param('id') id: string) {
    return this.usersService.unblockUser(id);
  }

  // ĐƯA XUỐNG DƯỚI: Endpoint chứa tham số động chung (:id)
  @Patch(':id')
  @Roles('ADMIN') 
  updateUserByAdmin(@Param('id') id: string, @Body() updateData: any) {
    return this.usersService.updateProfile(id, updateData);
  }

  @Delete(':id')
  @Roles('ADMIN')
  deleteUser(@Param('id') id: string) {
    return this.usersService.deleteUser(id);
  }
}