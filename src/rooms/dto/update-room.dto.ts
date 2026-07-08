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

// Bản PATCH: mọi trường đều tùy chọn, nhưng nếu gửi lên thì vẫn phải đúng định dạng
export class UpdateRoomDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Tên phòng không được để trống' })
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Tòa nhà không được để trống' })
  building?: string;

  @IsOptional()
  @IsInt({ message: 'Tầng phải là số nguyên' })
  @Min(1, { message: 'Tầng phải lớn hơn hoặc bằng 1' })
  floor?: number;

  @IsOptional()
  @IsInt({ message: 'Sức chứa phải là số nguyên' })
  @Min(1, { message: 'Sức chứa phải lớn hơn hoặc bằng 1' })
  capacity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  currentOccupancy?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Giá phòng phải là số' })
  @Min(0, { message: 'Giá phòng không được âm' })
  price?: number;

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
