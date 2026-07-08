import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateRoomDto {
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập tên phòng' })
  name!: string;

  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập tòa nhà' })
  building!: string;

  @IsInt({ message: 'Tầng phải là số nguyên' })
  @Min(1, { message: 'Tầng phải lớn hơn hoặc bằng 1' })
  floor!: number;

  @IsInt({ message: 'Sức chứa phải là số nguyên' })
  @Min(1, { message: 'Sức chứa phải lớn hơn hoặc bằng 1' })
  capacity!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  currentOccupancy?: number;

  @IsNumber({}, { message: 'Giá phòng phải là số' })
  @Min(0, { message: 'Giá phòng không được âm' })
  price!: number;

  @IsOptional()
  @IsIn(['AVAILABLE', 'FULL', 'MAINTENANCE'], {
    message: 'Trạng thái phòng không hợp lệ',
  })
  status?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  facilities?: string[];
}
