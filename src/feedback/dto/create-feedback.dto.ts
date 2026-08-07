import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { FeedbackCategory, FeedbackType } from '../feedback.enum';

export class CreateFeedbackDto {
  @IsIn(Object.values(FeedbackType), { message: 'Loại góp ý/khiếu nại không hợp lệ' })
  type!: FeedbackType;

  @IsOptional()
  @IsEnum(FeedbackCategory, { message: 'Danh mục không hợp lệ' })
  category?: FeedbackCategory;

  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập nội dung' })
  @MaxLength(1000, { message: 'Nội dung tối đa 1000 ký tự' })
  message!: string;
}
