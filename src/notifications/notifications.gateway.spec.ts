import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Socket } from 'socket.io';
import { NotificationsGateway } from './notifications.gateway';

type MockSocket = {
  id: string;
  handshake: {
    auth?: {
      token?: string;
    };
    query?: {
      userId?: string;
    };
  };
  data: Record<string, unknown>;
  join: jest.Mock<Promise<void>, [string]>;
  disconnect: jest.Mock<void, [boolean?]>;
};

describe('NotificationsGateway', () => {
  let gateway: NotificationsGateway;
  let jwtService: { verifyAsync: jest.Mock };

  const createSocket = (token?: string, queryUserId?: string): MockSocket => ({
    id: 'socket-1',
    handshake: {
      auth: token ? { token } : {},
      query: queryUserId ? { userId: queryUserId } : {},
    },
    data: {},
    join: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
  });

  beforeEach(async () => {
    jwtService = {
      verifyAsync: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsGateway,
        {
          provide: JwtService,
          useValue: jwtService,
        },
      ],
    }).compile();

    gateway = module.get<NotificationsGateway>(NotificationsGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  it('verifies the JWT and joins the verified user room', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'admin-id' });
    const client = createSocket('valid-token', 'spoofed-admin-id');

    await gateway.handleConnection(client as unknown as Socket);

    expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-token');
    expect(client.join).toHaveBeenCalledWith('user_admin-id');
    expect(client.data.userId).toBe('admin-id');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects the socket when no token is provided', async () => {
    const client = createSocket();

    await gateway.handleConnection(client as unknown as Socket);

    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('disconnects the socket when token verification fails', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid token'));
    const client = createSocket('invalid-token');

    await gateway.handleConnection(client as unknown as Socket);

    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('emits notifications to the verified user room', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    gateway.server = { to } as unknown as NotificationsGateway['server'];

    gateway.sendToUser('user-123', { title: 'test' });

    expect(to).toHaveBeenCalledWith('user_user-123');
    expect(emit).toHaveBeenCalledWith('newNotification', { title: 'test' });
  });
});
