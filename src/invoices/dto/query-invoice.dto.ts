import { IsIn, IsInt, IsMongoId, IsOptional, Max, Min } from 'class-validator';
import { InvoiceStatus } from '../invoices.enum';

export class QueryInvoiceDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsMongoId({ message: 'roomId không đúng định dạng' })
  roomId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsIn(Object.values(InvoiceStatus), {
    message: 'Trạng thái hóa đơn không hợp lệ',
  })
  status?: string;
}
