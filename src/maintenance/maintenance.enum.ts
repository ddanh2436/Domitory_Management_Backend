export enum MaintenanceStatus {
  PENDING = 'PENDING',       // Mới gửi, chờ tiếp nhận
  IN_PROGRESS = 'IN_PROGRESS', // Đang sửa chữa
  RESOLVED = 'RESOLVED',     // Đã sửa xong
  REJECTED = 'REJECTED',     // Từ chối (báo cáo sai)
}

export enum MaintenancePriority {
  LOW = 'LOW',       // Hỏng hóc nhẹ, không gấp
  MEDIUM = 'MEDIUM', // Bình thường
  HIGH = 'HIGH',     // Ảnh hưởng sinh hoạt (VD: hỏng quạt mùa hè)
  URGENT = 'URGENT', // Khẩn cấp (VD: vỡ ống nước, chập điện)
}