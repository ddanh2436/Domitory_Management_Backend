// Loại góp ý/khiếu nại — dùng chung một collection, phân biệt bằng type
export enum FeedbackType {
  COMPLAINT = 'COMPLAINT',
  SUGGESTION = 'SUGGESTION',
}

// Danh mục nội dung, chủ yếu áp dụng cho khiếu nại
export enum FeedbackCategory {
  FACILITY = 'FACILITY',
  STAFF_CONDUCT = 'STAFF_CONDUCT',
  BILLING = 'BILLING',
  OTHER = 'OTHER',
}

// Vòng đời trạng thái: PENDING -> RESOLVED | CLOSED (trạng thái cuối, không quay lại)
export enum FeedbackStatus {
  PENDING = 'PENDING',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}
