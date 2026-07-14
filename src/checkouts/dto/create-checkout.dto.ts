import { IsDateString, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateCheckoutDto {
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập lý do trả phòng' })
  @MaxLength(300, { message: 'Lý do trả phòng tối đa 300 ký tự' })
  reason!: string;

  @IsDateString({}, { message: 'Ngày dự kiến trả phòng không đúng định dạng' })
  expectedDate!: string;
}
