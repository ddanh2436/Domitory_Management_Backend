import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Patch, 
  Param, 
  Delete, 
  Query, 
  UseGuards, 
  Request, 
  BadRequestException 
} from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { SearchRoomDto } from './dto/search-room.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('api/rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'DORMITORY_MANAGER')
  create(@Body() createRoomDto: CreateRoomDto) {
    return this.roomsService.create(createRoomDto);
  }

  @Get()
  findAll(@Query() query: SearchRoomDto) {
    const formattedQuery = {
      ...query,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
      minPrice: query.minPrice ? Number(query.minPrice) : undefined,
      maxPrice: query.maxPrice ? Number(query.maxPrice) : undefined,
    };
    return this.roomsService.findAll(formattedQuery);
  }

  // ĐÃ CẬP NHẬT: Xử lý tìm phòng cá nhân của Student
  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('STUDENT', 'ADMIN', 'DORMITORY_MANAGER')
  async findMyRoom(@Request() req: any) {
    // Ưu tiên lấy từ req.user.sub (chuẩn JWT payload của bạn), sau đó fallback sang các biến khác
    const userId = req.user?.sub || req.user?.userId || req.user?._id || req.user?.id;
    
    // Validate tránh lỗi truyền undefined xuống Service
    if (!userId) {
      throw new BadRequestException('Không thể đọc được thông tin ID người dùng từ Token.');
    }

    const room = await this.roomsService.findRoomByUserId(userId);
    
    // Bọc vào object có key 'data' để tương thích 100% với Frontend (payload.data)
    return { data: room };
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.roomsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'DORMITORY_MANAGER')
  update(@Param('id') id: string, @Body() updateRoomDto: UpdateRoomDto) {
    return this.roomsService.update(id, updateRoomDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'DORMITORY_MANAGER')
  remove(@Param('id') id: string) {
    return this.roomsService.remove(id);
  }
}