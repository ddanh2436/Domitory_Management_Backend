import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { Maintenance } from './schemas/maintenance.schema';
import { User } from '../users/schemas/user.schema';
import { NotificationsService } from '../notifications/notifications.service';

describe('MaintenanceService', () => {
  let service: MaintenanceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaintenanceService,
        { provide: getModelToken(Maintenance.name), useValue: {} },
        { provide: getModelToken(User.name), useValue: {} },
        { provide: NotificationsService, useValue: { createAndSend: jest.fn() } },
        // Không cấu hình Cloudinary trong test — service tự chuyển sang chế độ không upload
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
      ],
    }).compile();

    service = module.get<MaintenanceService>(MaintenanceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('từ chối requestId sai định dạng khi cập nhật trạng thái', async () => {
    await expect(service.updateStatus('sai-dinh-dang', 'RESOLVED')).rejects.toThrow(
      BadRequestException,
    );
  });
});
