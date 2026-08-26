import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ViolationsService } from './violations.service';
import { Violation } from './schemas/violation.schema';
import { User } from '../users/schemas/user.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { ViolationStatus } from './violations.enum';

// ObjectId hợp lệ (24 hex) để qua isValidObjectId
const VIOLATION_ID = '507f1f77bcf86cd799439011';
const STUDENT_ID = '507f1f77bcf86cd799439012';
const REVIEWER_ID = '507f191e810c19729de860ea';

describe('ViolationsService', () => {
  let service: ViolationsService;
  let violationModel: any;
  let userModel: any;

  // Doc vi phạm giả lập, có save() để kiểm tra thay đổi trạng thái
  // Các field ban quản lý ghi thêm trong lúc khiếu nại/duyệt là optional,
  // khai báo tường minh để test đọc được v.appealReason / v.reviewNote
  type MockViolation = {
    _id: string;
    student: string;
    reason: string;
    points: number;
    status: ViolationStatus;
    appealReason?: string;
    appealedAt?: Date;
    reviewNote?: string;
    reviewedBy?: unknown;
    reviewedAt?: Date;
    save: jest.Mock;
  };

  const makeViolation = (over: Record<string, any> = {}): MockViolation => ({
    _id: VIOLATION_ID,
    student: STUDENT_ID, // .toString() trả về chính chuỗi này
    reason: 'Về ký túc xá quá giờ',
    points: 10,
    status: ViolationStatus.ACTIVE,
    save: jest.fn().mockResolvedValue(true),
    ...over,
  });

  const makeStudent = (score: number) => ({
    _id: STUDENT_ID,
    behaviorScore: score,
    save: jest.fn().mockResolvedValue(true),
  });

  beforeEach(async () => {
    violationModel = { findById: jest.fn() };
    userModel = {
      findById: jest.fn(),
      // dùng trong appeal để tìm admin gửi thông báo
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ViolationsService,
        { provide: getModelToken(Violation.name), useValue: violationModel },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: NotificationsService, useValue: { createAndSend: jest.fn() } },
      ],
    }).compile();

    service = module.get<ViolationsService>(ViolationsService);
  });

  it('service được khởi tạo', () => {
    expect(service).toBeDefined();
  });

  // ── APPEAL ──────────────────────────────────────────────
  describe('appealViolation', () => {
    it('chặn khi thiếu lý do', async () => {
      await expect(
        service.appealViolation(STUDENT_ID, VIOLATION_ID, '   '),
      ).rejects.toThrow(BadRequestException);
    });

    it('chặn khi không phải chủ vi phạm', async () => {
      violationModel.findById.mockResolvedValue(makeViolation({ student: 'nguoi-khac' }));
      await expect(
        service.appealViolation(STUDENT_ID, VIOLATION_ID, 'Em bị oan'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('chặn khi vi phạm không ở trạng thái ACTIVE', async () => {
      violationModel.findById.mockResolvedValue(
        makeViolation({ status: ViolationStatus.REVOKED }),
      );
      await expect(
        service.appealViolation(STUDENT_ID, VIOLATION_ID, 'Em bị oan'),
      ).rejects.toThrow(BadRequestException);
    });

    it('khiếu nại hợp lệ -> chuyển APPEAL_PENDING và lưu lý do', async () => {
      const v = makeViolation();
      violationModel.findById.mockResolvedValue(v);
      const res = await service.appealViolation(STUDENT_ID, VIOLATION_ID, 'Em có minh chứng');
      expect(v.status).toBe(ViolationStatus.APPEAL_PENDING);
      expect(v.appealReason).toBe('Em có minh chứng');
      expect(v.save).toHaveBeenCalled();
      expect(res.violation).toBe(v);
    });
  });

  // ── REVIEW ──────────────────────────────────────────────
  describe('reviewAppeal', () => {
    it('chỉ duyệt được khiếu nại đang chờ', async () => {
      violationModel.findById.mockResolvedValue(
        makeViolation({ status: ViolationStatus.ACTIVE }),
      );
      await expect(
        service.reviewAppeal(REVIEWER_ID, VIOLATION_ID, 'ACCEPT'),
      ).rejects.toThrow(BadRequestException);
    });

    it('ACCEPT -> REVOKED và hoàn đúng số điểm', async () => {
      const v = makeViolation({ status: ViolationStatus.APPEAL_PENDING, points: 10 });
      violationModel.findById.mockResolvedValue(v);
      const student = makeStudent(80);
      userModel.findById.mockResolvedValue(student);

      const res = await service.reviewAppeal(REVIEWER_ID, VIOLATION_ID, 'ACCEPT');
      expect(v.status).toBe(ViolationStatus.REVOKED);
      expect(student.behaviorScore).toBe(90); // 80 + 10
      expect(res.behaviorScore).toBe(90);
    });

    it('ACCEPT -> hoàn điểm bị chặn ở trần 100', async () => {
      const v = makeViolation({ status: ViolationStatus.APPEAL_PENDING, points: 10 });
      violationModel.findById.mockResolvedValue(v);
      const student = makeStudent(95);
      userModel.findById.mockResolvedValue(student);

      await service.reviewAppeal(REVIEWER_ID, VIOLATION_ID, 'ACCEPT');
      expect(student.behaviorScore).toBe(100); // min(100, 95 + 10)
    });

    it('REJECT -> APPEAL_REJECTED và KHÔNG đổi điểm', async () => {
      const v = makeViolation({ status: ViolationStatus.APPEAL_PENDING, points: 10 });
      violationModel.findById.mockResolvedValue(v);
      // restoreScore không được gọi -> nếu gọi sẽ trả undefined, ta kiểm behaviorScore
      const res = await service.reviewAppeal(REVIEWER_ID, VIOLATION_ID, 'REJECT', 'Bằng chứng chưa đủ');
      expect(v.status).toBe(ViolationStatus.APPEAL_REJECTED);
      expect(v.reviewNote).toBe('Bằng chứng chưa đủ');
      expect(userModel.findById).not.toHaveBeenCalled(); // không hoàn điểm
      expect(res.behaviorScore).toBeUndefined();
    });
  });

  // ── REVOKE (thu hồi trực tiếp) ──────────────────────────
  describe('revokeViolation', () => {
    it('chặn khi vi phạm đã REVOKED (idempotent)', async () => {
      violationModel.findById.mockResolvedValue(
        makeViolation({ status: ViolationStatus.REVOKED }),
      );
      await expect(
        service.revokeViolation(REVIEWER_ID, VIOLATION_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('thu hồi hợp lệ -> REVOKED và hoàn điểm', async () => {
      const v = makeViolation({ status: ViolationStatus.ACTIVE, points: 15 });
      violationModel.findById.mockResolvedValue(v);
      const student = makeStudent(70);
      userModel.findById.mockResolvedValue(student);

      const res = await service.revokeViolation(REVIEWER_ID, VIOLATION_ID);
      expect(v.status).toBe(ViolationStatus.REVOKED);
      expect(student.behaviorScore).toBe(85); // 70 + 15
      expect(res.behaviorScore).toBe(85);
    });
  });
});
