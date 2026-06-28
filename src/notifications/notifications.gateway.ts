import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

interface NotificationJwtPayload {
  sub?: string;
}

@WebSocketGateway({ cors: { origin: '*' } })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private activeUsers = new Map<string, string>();

  constructor(private readonly jwtService: JwtService) {}

  private getRoomName(userId: string) {
    return `user_${userId}`;
  }

  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token;

    if (typeof token !== 'string' || token.trim() === '') {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<NotificationJwtPayload>(token);
      const userId = payload.sub?.toString();

      if (!userId) {
        client.disconnect(true);
        return;
      }

      client.data.userId = userId;
      this.activeUsers.set(userId, client.id);
      await client.join(this.getRoomName(userId));
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = typeof client.data.userId === 'string' ? client.data.userId : undefined;

    if (userId && this.activeUsers.get(userId) === client.id) {
      this.activeUsers.delete(userId);
    }
  }

  sendToUser(userId: string, notification: any) {
    this.server.to(this.getRoomName(userId)).emit('newNotification', notification);
  }

  sendToAll(notification: any) {
    this.server.emit('newNotification', notification);
  }
}
