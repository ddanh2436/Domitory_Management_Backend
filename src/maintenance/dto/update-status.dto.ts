import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { MaintenanceStatus } from '../maintenance.enum';

// Body cho PATCH /api/maintenance/:id/status
// Validate cơ bản ở đây; ràng buộc "REJECTED bắt buộc có lý do" xử lý ở service
// (nguồn sự thật, tránh phụ thuộc hoàn toàn vào client).
export class UpdateStatusDto {
  @IsEnum(MaintenanceStatus, {
    message: 'Trạng thái yêu cầu bảo trì không hợp lệ',
  })
  status!: MaintenanceStatus;

  // Lý do từ chối (khi status = REJECTED)
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Lý do từ chối tối đa 500 ký tự' })
  rejectionReason?: string;

  // Nội dung đã xử lý (khi status = RESOLVED)
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Nội dung xử lý tối đa 500 ký tự' })
  note?: string;
}
