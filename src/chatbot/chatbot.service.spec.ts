import { ChatbotService } from './chatbot.service';

// Các hàm được kiểm ở đây đều thuần (không chạm Mongo/Ollama) nên dựng service
// với model rỗng là đủ — mục tiêu là chốt hành vi của phần suy luận, không phải I/O.
const service = new ChatbotService(
  null as never,
  null as never,
  null as never,
  null as never,
);

const extractSources = (contents: string[]): string[] =>
  (service as unknown as { extractSources(c: string[]): string[] }).extractSources(contents);

const isInvoiceQuery = (message: string): boolean =>
  (service as unknown as { isInvoiceQuery(m: string): boolean }).isInvoiceQuery(message);

const getSuggestions = (message: string): string[] =>
  (service as unknown as { getSuggestions(m: string): string[] }).getSuggestions(message);

describe('ChatbotService — chip nguồn', () => {
  it('gom các mục cùng một tài liệu thành một chip duy nhất', () => {
    const sources = extractSources([
      '[NỘI QUY KÝ TÚC XÁ DORMIFY — 1. Quy định về Giờ giấc sinh hoạt]\nCửa chính đóng 23:00.',
      '[NỘI QUY KÝ TÚC XÁ DORMIFY — 3. Quy định về Vệ sinh & Môi trường]\nĐổ rác đúng nơi.',
    ]);

    expect(sources).toEqual(['NỘI QUY KÝ TÚC XÁ DORMIFY · §1, 3']);
  });

  it('giữ tên mục khi mục không đánh số', () => {
    expect(extractSources(['[QUY ĐỊNH GỬI XE — Đăng ký vé xe]\nMang thẻ SV.'])).toEqual([
      'QUY ĐỊNH GỬI XE · Đăng ký vé xe',
    ]);
  });

  it('bỏ qua đoạn không có nhãn và không trả về quá 3 chip', () => {
    const sources = extractSources([
      'Đoạn không có nhãn',
      '[Tài liệu A — 1. Mục]\nnội dung',
      '[Tài liệu B — 1. Mục]\nnội dung',
      '[Tài liệu C — 1. Mục]\nnội dung',
      '[Tài liệu D — 1. Mục]\nnội dung',
    ]);

    expect(sources).toHaveLength(3);
    expect(sources).not.toContain('Tài liệu D · §1');
  });
});

describe('ChatbotService — nhận diện câu hỏi hoá đơn cá nhân', () => {
  it.each([
    'Hoá đơn tháng 7 của tôi bao nhiêu?',
    'Hoá đơn tháng này của tôi?',
    'Tiền điện tháng 6 phòng mình hết bao nhiêu?',
  ])('đính kèm bảng hoá đơn cho: %s', (message) => {
    expect(isInvoiceQuery(message)).toBe(true);
  });

  it.each([
    'Quy trình thanh toán hoá đơn thế nào?', // hỏi thủ tục chung, không phải hoá đơn của mình
    'Giờ đóng cửa KTX là mấy giờ?', // không dính hoá đơn
  ])('KHÔNG đính kèm bảng hoá đơn cho: %s', (message) => {
    expect(isInvoiceQuery(message)).toBe(false);
  });
});

describe('ChatbotService — câu hỏi gợi ý khi bí', () => {
  it('gợi ý đúng chủ đề trả phòng khi hỏi về tiền cọc', () => {
    expect(getSuggestions('Tiền cọc trả phòng tính thế nào?')).toContain(
      'Thủ tục trả phòng gồm những gì?',
    );
  });

  it('rơi về gợi ý chung khi câu hỏi không thuộc chủ đề nào', () => {
    expect(getSuggestions('Wifi KTX mật khẩu gì?')).toContain('Nội quy KTX gồm những mục nào?');
  });
});
