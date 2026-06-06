import { Controller, Get, Request, UseGuards } from '@nestjs/common';
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


  @Get('students')
  @Roles('ADMIN') 
  getAllStudents() {
    return this.usersService.findAllStudents();
  }
}