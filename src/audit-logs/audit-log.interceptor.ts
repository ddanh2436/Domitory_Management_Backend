// ─── audit-log.interceptor.ts ────────────────────────────────────────────────
// Interceptor toàn cục (đăng ký qua APP_INTERCEPTOR trong AuditLogsModule):
// ghi nhật ký mọi request THAY ĐỔI dữ liệu, kể cả khi request thất bại.
// Việc ghi log là fire-and-forget — lỗi ghi log không được ảnh hưởng response.

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';

const MUTATING_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'];

// Map tiền tố path -> tên nghiệp vụ tiếng Việt cho cột "Hành động"
const MODULE_LABELS: [string, string][] = [
  ['/api/auth/login', 'Đăng nhập'],
  ['/api/auth/register', 'Đăng ký tài khoản'],
  ['/api/auth/forgot-password', 'Yêu cầu đặt lại mật khẩu'],
  ['/api/auth/reset-password', 'Đặt lại mật khẩu'],
  ['/api/auth/google', 'Đăng nhập Google'],
  ['/api/users', 'Tài khoản người dùng'],
  ['/api/rooms', 'Quản lý phòng'],
  ['/api/bookings', 'Đặt phòng'],
  ['/api/transfers', 'Đổi phòng'],
  ['/api/checkouts', 'Trả phòng'],
  ['/api/assignments', 'Phân phòng tự động'],
  ['/api/contracts', 'Hợp đồng'],
  ['/api/invoices', 'Hóa đơn'],
  ['/api/maintenance', 'Bảo trì'],
  ['/api/violations', 'Vi phạm nội quy'],
  ['/api/absences', 'Tạm trú / Tạm vắng'],
  ['/api/notifications', 'Thông báo'],
];

const METHOD_VERBS: Record<string, string> = {
  POST: 'Tạo mới',
  PATCH: 'Cập nhật',
  PUT: 'Cập nhật',
  DELETE: 'Xóa',
};

function describeAction(method: string, path: string): string {
  const match = MODULE_LABELS.find(([prefix]) => path.startsWith(prefix));
  if (!match) return `${METHOD_VERBS[method] ?? method} ${path}`;
  // Các path auth đã là mô tả hoàn chỉnh, không cần thêm động từ
  if (match[0].startsWith('/api/auth')) return match[1];
  return `${METHOD_VERBS[method] ?? method} — ${match[1]}`;
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(
    @InjectModel(AuditLog.name)
    private auditLogModel: Model<AuditLogDocument>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest();
    const method: string = request?.method ?? '';
    if (!MUTATING_METHODS.includes(method)) return next.handle();

    return next.handle().pipe(
      tap({
        next: () => {
          const statusCode: number =
            context.switchToHttp().getResponse()?.statusCode ?? 200;
          this.write(request, method, statusCode);
        },
        error: (err: unknown) => {
          const statusCode =
            typeof (err as { status?: unknown })?.status === 'number'
              ? (err as { status: number }).status
              : 500;
          this.write(request, method, statusCode);
        },
      }),
    );
  }

  private write(request: any, method: string, statusCode: number): void {
    try {
      const path: string = request?.originalUrl ?? request?.url ?? '';
      // Không ghi log cho chính API đọc nhật ký (tránh nhiễu nếu sau này có POST)
      if (path.startsWith('/api/audit-logs')) return;

      const user = request?.user as
        | { sub?: string; email?: string; role?: string }
        | undefined;

      const entry: Partial<AuditLog> = {
        method,
        path,
        action: describeAction(method, path.split('?')[0]),
        statusCode,
        ip:
          (request?.headers?.['x-forwarded-for'] as string | undefined)
            ?.split(',')[0]
            ?.trim() || request?.ip,
        userEmail: user?.email,
        userRole: user?.role,
      };
      if (user?.sub && Types.ObjectId.isValid(user.sub)) {
        entry.user = new Types.ObjectId(user.sub);
      }

      // Fire-and-forget: không await để không làm chậm response
      void this.auditLogModel.create(entry).catch((err: unknown) => {
        this.logger.error(
          `Không ghi được nhật ký hệ thống — ${method} ${path}`,
          err instanceof Error ? err.stack : String(err),
        );
      });
    } catch (err) {
      this.logger.error(
        'Lỗi không mong đợi khi ghi nhật ký hệ thống',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
