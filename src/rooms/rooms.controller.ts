import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { SearchRoomDto } from './dto/search-room.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('api/rooms')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  // Quyền ADMIN: Tạo phòng mới
  @Post()
  @Roles('ADMIN')
  create(@Body() createRoomDto: any) {
    return this.roomsService.create(createRoomDto);
  }

  // Quyền CHUNG (Admin & Student): Lấy danh sách hoặc tìm kiếm lọc phòng
  @Get()
  findAll(@Query() query: SearchRoomDto) {
    return this.roomsService.findAll(query);
  }

  // Quyền CHUNG: Xem chi tiết một phòng cụ thể
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.roomsService.findOne(id);
  }

  // Quyền ADMIN: Chỉnh sửa thông tin phòng
  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() updateRoomDto: any) {
    return this.roomsService.update(id, updateRoomDto);
  }

  // Quyền ADMIN: Xóa phòng khỏi hệ thống
  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.roomsService.remove(id);
  }
}