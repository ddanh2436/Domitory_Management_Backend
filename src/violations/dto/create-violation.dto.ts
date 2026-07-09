import {
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateViolationDto {
  @IsMongoId({ message: 'studentId không đúng định dạng' })
  studentId!: string;

  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập lý do vi phạm' })
  @MaxLength(300, { message: 'Lý do vi phạm tối đa 300 ký tự' })
  reason!: string;

  @IsInt({ message: 'Số điểm trừ phải là số nguyên' })
  @Min(1, { message: 'Số điểm trừ tối thiểu là 1' })
  @Max(100, { message: 'Số điểm trừ tối đa là 100' })
  points!: number;
}
