import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// Body cho PATCH /api/violations/:id/review
export class ReviewAppealDto {
  @IsIn(['ACCEPT', 'REJECT'], {
    message: 'Quyết định duyệt phải là ACCEPT hoặc REJECT',
  })
  decision!: 'ACCEPT' | 'REJECT';

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Ghi chú duyệt tối đa 500 ký tự' })
  reviewNote?: string;
}
