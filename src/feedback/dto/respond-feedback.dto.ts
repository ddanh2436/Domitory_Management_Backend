import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RespondFeedbackDto {
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập nội dung phản hồi' })
  @MaxLength(1000, { message: 'Nội dung phản hồi tối đa 1000 ký tự' })
  response!: string;

  @IsIn(['RESOLVED', 'CLOSED'], { message: 'Trạng thái phải là RESOLVED hoặc CLOSED' })
  status!: 'RESOLVED' | 'CLOSED';
}
