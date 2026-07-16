import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';

@Injectable()
export class AuditLogsService {
  constructor(
    @InjectModel(AuditLog.name)
    private auditLogModel: Model<AuditLogDocument>,
  ) {}

  // Danh sách nhật ký có phân trang + lọc theo method / từ khóa (path, email, hành động)
  async findAll(options: {
    page?: number;
    limit?: number;
    method?: string;
    search?: string;
  }) {
    const page = Math.max(1, Math.floor(options.page ?? 1));
    const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 25)));

    const filter: any = {};
    if (options.method) {
      filter.method = options.method.toUpperCase();
    }
    if (options.search?.trim()) {
      // Escape ký tự regex đặc biệt để từ khóa luôn được hiểu là chuỗi thường
      const escaped = options.search
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { path: regex },
        { action: regex },
        { userEmail: regex },
        { userRole: regex },
      ];
    }

    const [data, total] = await Promise.all([
      this.auditLogModel
        .find(filter)
        .populate('user', 'fullName email role')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.auditLogModel.countDocuments(filter),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
