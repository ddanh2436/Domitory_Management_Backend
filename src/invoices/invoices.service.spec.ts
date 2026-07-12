import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { Invoice } from './schemas/invoice.schema';
import { Room } from '../rooms/schemas/room.schema';
import { User } from '../users/schemas/user.schema';
import { NotificationsService } from '../notifications/notifications.service';

describe('InvoicesService', () => {
  let service: InvoicesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: getModelToken(Invoice.name), useValue: {} },
        { provide: getModelToken(Room.name), useValue: {} },
        { provide: getModelToken(User.name), useValue: {} },
        { provide: NotificationsService, useValue: { createAndSend: jest.fn() } },
      ],
    }).compile();

    service = module.get<InvoicesService>(InvoicesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('từ chối sinh hóa đơn hàng loạt với tháng không hợp lệ', async () => {
    await expect(
      service.generateBulkInvoices({
        month: 13,
        year: 2026,
        dueDate: new Date(Date.now() + 86400000).toISOString(),
        electricityUnitPrice: 3500,
        waterUnitPrice: 15000,
        readings: [{ roomId: 'x', electricityKwh: 1, waterM3: 1 }],
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
