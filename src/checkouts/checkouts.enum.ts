export enum CheckoutStatus {
  PENDING = 'PENDING', // Sinh viên đã gửi yêu cầu, chờ quản lý xử lý
  COMPLETED = 'COMPLETED', // Đã kiểm tra tài sản, tính bồi thường và hoàn cọc xong
  REJECTED = 'REJECTED', // Quản lý từ chối yêu cầu
  CANCELLED = 'CANCELLED', // Sinh viên tự hủy khi còn chờ duyệt
}
