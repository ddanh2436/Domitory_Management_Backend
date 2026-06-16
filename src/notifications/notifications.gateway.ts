import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' } }) // Cho phép Frontend kết nối
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  // Lưu trữ danh sách các user đang online (userId -> socketId)
  private activeUsers = new Map<string, string>();

  handleConnection(client: Socket) {
    // Khi frontend gọi socket.connect(), nó có thể truyền userId lên
    const userId = client.handshake.query.userId as string;
    if (userId) {
      this.activeUsers.set(userId, client.id);
      client.join(userId); // Cho user vào một "phòng" riêng mang tên ID của họ
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.handshake.query.userId as string;
    if (userId) {
      this.activeUsers.delete(userId);
    }
  }

  // Hàm bắn thông báo đến một user cụ thể
  sendToUser(userId: string, notification: any) {
    this.server.to(userId).emit('newNotification', notification);
  }

  // Hàm bắn thông báo cho toàn bộ hệ thống (dành cho Admin gửi Broadcast)
  sendToAll(notification: any) {
    this.server.emit('newNotification', notification);
  }
}