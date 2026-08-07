// Vòng đời trạng thái của một vi phạm nề nếp.
export enum ViolationStatus {
  ACTIVE = 'ACTIVE', // Đang hiệu lực, đã trừ điểm (mặc định)
  APPEAL_PENDING = 'APPEAL_PENDING', // Sinh viên đã khiếu nại, chờ duyệt
  REVOKED = 'REVOKED', // Đã thu hồi (duyệt chấp nhận hoặc admin thu hồi trực tiếp) → đã hoàn điểm
  APPEAL_REJECTED = 'APPEAL_REJECTED', // Khiếu nại bị từ chối, vi phạm vẫn hiệu lực
}
