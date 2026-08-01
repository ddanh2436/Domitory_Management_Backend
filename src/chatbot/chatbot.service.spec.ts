import { ChatbotService, type ChatTurn } from './chatbot.service';

// Các hàm được kiểm ở đây đều thuần (không chạm Mongo/Ollama) nên dựng service
// với model rỗng là đủ — mục tiêu là chốt hành vi của phần suy luận, không phải I/O.
const service = new ChatbotService(
  null as never,
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

const sanitizeHistory = (history: unknown): ChatTurn[] =>
  (service as unknown as { sanitizeHistory(h: unknown): ChatTurn[] }).sanitizeHistory(history);

const isSmallTalk = (message: string): boolean =>
  (service as unknown as { isSmallTalk(m: string): boolean }).isSmallTalk(message);

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

describe('ChatbotService — ngữ cảnh hội thoại', () => {
  const history: ChatTurn[] = [
    { role: 'user', content: 'Hoá đơn tháng 7 của tôi bao nhiêu?' },
    { role: 'assistant', content: 'Hoá đơn tháng 7 của phòng bạn là 646.800đ.' },
  ];

  it('ghép câu hỏi trước vào truy vấn khi câu hiện tại là câu nối tiếp', () => {
    expect(service.buildSearchQuery('Còn tháng 6 thì sao?', history)).toBe(
      'Hoá đơn tháng 7 của tôi bao nhiêu? Còn tháng 6 thì sao?',
    );
  });

  it.each([
    'Quy định gửi xe máy tại ký túc xá như thế nào?', // kết thúc bằng "thế nào" nhưng vẫn đủ nghĩa
    'Giờ đóng cửa KTX?', // ngắn nhưng đủ nghĩa
    'Thủ tục trả phòng gồm những gì?',
  ])('giữ nguyên câu hỏi đã đủ nghĩa: %s', (question) => {
    expect(service.buildSearchQuery(question, history)).toBe(question);
  });

  it('không ghép gì khi chưa có lượt nào trước đó', () => {
    expect(service.buildSearchQuery('Còn tháng 6 thì sao?', [])).toBe('Còn tháng 6 thì sao?');
  });

  it('nhận ra hoá đơn cá nhân qua ngữ cảnh của câu hỏi trước', () => {
    // Bản thân "Còn tháng 6 thì sao?" không có chữ "hoá đơn" nào
    expect(isInvoiceQuery('Còn tháng 6 thì sao?')).toBe(false);
    expect(isInvoiceQuery(service.buildSearchQuery('Còn tháng 6 thì sao?', history))).toBe(true);
  });

  it('cắt lịch sử về số lượt tối đa và loại lượt rỗng/sai định dạng', () => {
    const messy = [
      { role: 'user', content: 'câu 1' },
      { role: 'assistant', content: '   ' },
      { role: 'system', content: 'chèn bậy' },
      { role: 'user', content: 'câu 2' },
      { role: 'assistant', content: 'trả lời 2' },
      { role: 'user', content: 'câu 3' },
      { role: 'assistant', content: 'trả lời 3' },
    ];

    const cleaned = sanitizeHistory(messy);

    expect(cleaned).toHaveLength(4); // mặc định giữ 4 lượt gần nhất
    expect(cleaned.every((turn) => turn.role !== ('system' as never))).toBe(true);
    expect(cleaned[cleaned.length - 1]).toEqual({ role: 'assistant', content: 'trả lời 3' });
  });

  it('không vỡ khi lịch sử không phải mảng', () => {
    expect(sanitizeHistory(undefined)).toEqual([]);
    expect(sanitizeHistory('không phải mảng')).toEqual([]);
  });
});

describe('ChatbotService — câu xã giao bỏ qua khâu tra cứu', () => {
  it.each(['Chào bạn', 'hello', 'cảm ơn', 'ok'])('bỏ qua tra cứu cho: %s', (message) => {
    expect(isSmallTalk(message)).toBe(true);
  });

  it.each(['Chào bạn, cho tôi hỏi giờ đóng cửa KTX', 'Cảm ơn, thế còn tiền điện thì sao?'])(
    'VẪN tra cứu khi câu chào có kèm câu hỏi thật: %s',
    (message) => {
      expect(isSmallTalk(message)).toBe(false);
    },
  );
});

describe('ChatbotService — chuẩn hoá bỏ dấu tiếng Việt', () => {
  it('bỏ dấu thanh, dấu mũ và chữ đ', () => {
    expect(ChatbotService.normalizeVietnamese('Hoá đơn tháng 7 của tôi')).toBe(
      'hoa don thang 7 cua toi',
    );
    expect(ChatbotService.normalizeVietnamese('NỘI QUY KÝ TÚC XÁ')).toBe('noi quy ky tuc xa');
  });

  it('bỏ dấu câu để từ cuối câu hỏi vẫn khớp được', () => {
    expect(ChatbotService.normalizeVietnamese('Giờ đóng cửa là mấy giờ?')).toBe(
      'gio dong cua la may gio',
    );
    expect(ChatbotService.normalizeVietnamese('Phòng B4-207, tầng 2.')).toBe('phong b4 207 tang 2');
  });

  it('cho phép gõ không dấu khớp được với tài liệu có dấu', () => {
    expect(ChatbotService.normalizeVietnamese('hoa don thang 7')).toBe(
      ChatbotService.normalizeVietnamese('Hoá đơn tháng 7'),
    );
  });
});

describe('ChatbotService — truy vấn cho nhánh từ khoá', () => {
  it('loại hư từ để câu lạc đề không được cộng điểm oan', () => {
    // "thế nào" khớp khắp nơi trong kho tài liệu; giữ lại thì "nấu phở bò thế nào?"
    // vượt ngưỡng dù hoàn toàn lạc đề (đo được 1.02 → 0.51 sau khi loại).
    expect(ChatbotService.buildKeywordQuery('nấu phở bò thế nào?')).toBe('nau pho bo');
    expect(ChatbotService.buildKeywordQuery('Hoá đơn tháng 7 của tôi là bao nhiêu?')).toBe(
      'hoa don thang 7 cua',
    );
  });

  it('giữ "cua" vì bỏ dấu xong "cửa" và "của" trùng nhau', () => {
    // Nếu coi "cua" là hư từ thì "giờ đóng cửa" mất luôn từ khoá chính
    expect(ChatbotService.buildKeywordQuery('Giờ đóng cửa KTX là mấy giờ?')).toContain('cua');
  });

  it('giữ nguyên từ khoá chuyên ngành và số', () => {
    // "dùng" được giữ: nó là động từ có nghĩa, và bỏ dấu xong còn trùng với "đúng"
    expect(ChatbotService.buildKeywordQuery('thiết bị điện 1000W có được dùng không?')).toBe(
      'thiet bi dien 1000w dung',
    );
  });

  it('trả về chuỗi rỗng khi câu chỉ toàn hư từ', () => {
    expect(ChatbotService.buildKeywordQuery('thế nào rồi')).toBe('');
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
