export enum AbsenceType {
  TAM_TRU = 'TAM_TRU', // Đăng ký khách tạm trú qua đêm tại phòng
  TAM_VANG = 'TAM_VANG', // Sinh viên tạm vắng qua đêm (không ngủ tại KTX)
}

export enum AbsenceStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}
