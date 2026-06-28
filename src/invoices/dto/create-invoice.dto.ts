export class CreateInvoiceDto {
  roomId!: string;
  month!: number;
  year!: number;
  electricityFee!: number;
  waterFee!: number;
  dueDate!: string;
}
