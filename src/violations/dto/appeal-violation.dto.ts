import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Body cho POST /api/violations/:id/appeal
export class AppealViolationDto {
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập lý do khiếu nại' })
  @MaxLength(500, { message: 'Lý do khiếu nại tối đa 500 ký tự' })
  reason!: string;
}
