import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

// Gửi email qua SMTP (Gmail app password hoặc bất kỳ SMTP nào).
// Cấu hình trong .env: SMTP_USER + SMTP_PASS (bắt buộc), SMTP_HOST/SMTP_PORT (tùy chọn, mặc định Gmail).
// Nếu CHƯA cấu hình SMTP: không gửi mail thật, chỉ log đường link ra console để dev test được flow.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (user && pass) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT) || 465,
        secure: (Number(process.env.SMTP_PORT) || 465) === 465,
        auth: { user, pass },
      });
      this.logger.log(`MailService sẵn sàng gửi qua ${process.env.SMTP_HOST || 'smtp.gmail.com'} (${user})`);
    } else {
      this.logger.warn(
        'SMTP_USER/SMTP_PASS chưa được cấu hình trong .env — email sẽ chỉ được log ra console (chế độ dev).',
      );
    }
  }

  get isConfigured(): boolean {
    return this.transporter !== null;
  }

  async sendPasswordResetEmail(to: string, fullName: string, resetLink: string): Promise<void> {
    const subject = 'Dormify — Đặt lại mật khẩu của bạn';
    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 520px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: #0D1B2A; padding: 22px 28px;">
          <span style="color: #ffffff; font-size: 20px; font-weight: bold;">Dorm<span style="color: #C9A84C;">ify</span></span>
        </div>
        <div style="padding: 28px;">
          <h2 style="color: #0D1B2A; font-size: 18px; margin: 0 0 12px;">Xin chào ${fullName},</h2>
          <p style="color: #475569; font-size: 14px; line-height: 1.7; margin: 0 0 20px;">
            Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.
            Bấm nút bên dưới để tạo mật khẩu mới. Liên kết có hiệu lực trong <b>15 phút</b>.
          </p>
          <a href="${resetLink}"
             style="display: inline-block; background: #0D1B2A; color: #C9A84C; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: bold;">
            Đặt lại mật khẩu
          </a>
          <p style="color: #94a3b8; font-size: 12.5px; line-height: 1.7; margin: 22px 0 0;">
            Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này — tài khoản của bạn vẫn an toàn.<br/>
            Nếu nút không hoạt động, sao chép liên kết sau vào trình duyệt:<br/>
            <a href="${resetLink}" style="color: #2563eb; word-break: break-all;">${resetLink}</a>
          </p>
        </div>
      </div>
    `;

    if (!this.transporter) {
      // Chế độ dev: không có SMTP thì in link ra console để test flow
      this.logger.warn(`[DEV] Link đặt lại mật khẩu cho ${to}: ${resetLink}`);
      return;
    }

    await this.transporter.sendMail({
      from: `"Dormify KTX" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
    this.logger.log(`Đã gửi email đặt lại mật khẩu đến ${to}`);
  }
}
