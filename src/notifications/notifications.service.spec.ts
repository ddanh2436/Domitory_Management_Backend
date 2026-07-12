import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { Notification } from './schemas/notification.schema';
import { Announcement } from './schemas/announcement.schema';
import { User } from '../users/schemas/user.schema';

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getModelToken(Notification.name), useValue: {} },
        { provide: getModelToken(Announcement.name), useValue: {} },
        { provide: getModelToken(User.name), useValue: {} },
        { provide: NotificationsGateway, useValue: { sendToUser: jest.fn(), sendToAll: jest.fn() } },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('từ chối broadcast khi thiếu tiêu đề hoặc nội dung', async () => {
    await expect(
      service.broadcastToStudents({ title: '  ', message: '' }),
    ).rejects.toThrow(BadRequestException);
  });
});
