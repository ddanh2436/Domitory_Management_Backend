import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// Một hạng mục hư hỏng do quản lý ghi nhận khi kiểm tra tài sản (FR19)
export class DamageItemDto {
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập tên tài sản hư hỏng' })
  @MaxLength(100, { message: 'Tên tài sản tối đa 100 ký tự' })
  itemName!: string;

  @IsInt({ message: 'Phí bồi thường phải là số nguyên (VNĐ)' })
  @Min(0, { message: 'Phí bồi thường không được âm' })
  fee!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'Ghi chú tối đa 200 ký tự' })
  note?: string;
}

export class CompleteCheckoutDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DamageItemDto)
  damages!: DamageItemDto[];

  // Cho phép quản lý sửa lại mức cọc thực tế nếu khác snapshot ban đầu
  @IsOptional()
  @IsInt({ message: 'Tiền cọc phải là số nguyên (VNĐ)' })
  @Min(0, { message: 'Tiền cọc không được âm' })
  depositAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300, { message: 'Ghi chú tối đa 300 ký tự' })
  adminNote?: string;
}
