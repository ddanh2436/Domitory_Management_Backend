import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken, getConnectionToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { Booking } from './schemas/booking.schema';
import { Room } from '../rooms/schemas/room.schema';
import { User } from '../users/schemas/user.schema';
import { ContractsService } from '../contracts/contracts.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('BookingsService', () => {
  let service: BookingsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getModelToken(Booking.name), useValue: {} },
        { provide: getModelToken(Room.name), useValue: {} },
        { provide: getModelToken(User.name), useValue: {} },
        { provide: getConnectionToken(), useValue: { startSession: jest.fn() } },
        { provide: ContractsService, useValue: { createContractFromBooking: jest.fn() } },
        { provide: NotificationsService, useValue: { createAndSend: jest.fn() } },
      ],
    }).compile();

    service = module.get<BookingsService>(BookingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('từ chối bookingId sai định dạng khi duyệt đơn', async () => {
    await expect(service.approveBooking('sai-dinh-dang')).rejects.toThrow(BadRequestException);
  });
});
