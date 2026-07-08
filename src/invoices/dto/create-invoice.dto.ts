import {
  IsInt,
  IsMongoId,
  IsNumber,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateInvoiceDto {
  @IsMongoId({ message: 'roomId không đúng định dạng' })
  roomId!: string;

  @IsInt({ message: 'Tháng phải là số nguyên' })
  @Min(1, { message: 'Tháng phải từ 1 đến 12' })
  @Max(12, { message: 'Tháng phải từ 1 đến 12' })
  month!: number;

  @IsInt({ message: 'Năm phải là số nguyên' })
  @Min(2000, { message: 'Năm không hợp lệ' })
  @Max(2100, { message: 'Năm không hợp lệ' })
  year!: number;

  @IsNumber({}, { message: 'Tiền điện phải là số' })
  @Min(0, { message: 'Tiền điện không được âm' })
  electricityFee!: number;

  @IsNumber({}, { message: 'Tiền nước phải là số' })
  @Min(0, { message: 'Tiền nước không được âm' })
  waterFee!: number;

  @IsString()
  dueDate!: string;
}
