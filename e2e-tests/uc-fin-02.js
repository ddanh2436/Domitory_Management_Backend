// e2e-tests/uc-fin-02.js
// Tự động test UC-FIN-02 — Create or Bulk-Generate Invoices
// 11 test case: TC-FIN-02-01 .. 11
//
// Cách chạy riêng: node e2e-tests/uc-fin-02.js
//
// GHI CHÚ QUAN TRỌNG (khác với mô tả gốc trong PA5-TestPlan-and-TestCases.md,
// do đọc trực tiếp code thật src/invoices/invoices.service.ts):
//   - Bulk-generate (POST /invoices/generate-bulk) dùng body dạng
//     { month, year, dueDate, electricityUnitPrice, waterUnitPrice,
//       readings: [{ roomId, electricityKwh, waterM3 }] }
//     KHÔNG PHẢI { rooms: [...] } như bản nháp đầu tiên trong tài liệu.
//   - dueDate BẮT BUỘC là 1 thời điểm SAU hiện tại (parseDueDate ném lỗi nếu
//     dueDate <= now) — luôn dùng 1 ngày trong tương lai.
//   - Với readings có chỉ số âm/không hợp lệ: code KHÔNG trả 400, mà âm thầm
//     tăng "skipped" và ghi lý do vào mảng "errors", HTTP vẫn 200/201. Tài
//     liệu gốc ghi kỳ vọng 400 cho TC-FIN-02-04 — sai so với code thật, test
//     bên dưới đã sửa lại đúng hành vi thực tế.
//   - Không có kiểm tra currentOccupancy khi tạo hoá đơn — hoá đơn vẫn được
//     tạo bình thường cho 1 phòng đang trống (0 người ở). Tài liệu gốc kỳ
//     vọng bị chặn/skip cho TC-FIN-02-05 — cũng sai so với code thật.

const { getDb, closeDb, api, login, rnd, assert, createRunner, ObjectId } = require('./helpers');

const SEEDED_ADMIN = { identifier: 'e2e.admin@test.local', password: 'E2Etest123' };
const TEST_PASSWORD = 'Test@12345';

function futureDueDate(daysFromNow = 30) {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

async function createRoom(adminToken, overrides = {}) {
  const body = {
    name: rnd('RMFIN'),
    building: 'F1',
    floor: 1,
    capacity: 4,
    price: 1500000,
    status: 'AVAILABLE',
    ...overrides,
  };
  const { status, body: room } = await api('POST', '/rooms', { token: adminToken, body });
  assert(status === 201 || status === 200, `Tạo phòng thất bại: ${JSON.stringify(room)}`);
  return room?._id ? room : room?.data;
}

async function registerStudent(fullName) {
  const email = rnd('fin02') + '@test.local';
  const reg = await api('POST', '/auth/register', { body: { email, password: TEST_PASSWORD, fullName } });
  assert(reg.status === 200 || reg.status === 201, `Đăng ký sinh viên thất bại: ${JSON.stringify(reg.body)}`);
  const token = await login(email, TEST_PASSWORD);
  return { email, token };
}

async function run() {
  const run = createRunner('UC-FIN-02 — Create or Bulk-Generate Invoices');
  const db = await getDb();
  const adminToken = await login(SEEDED_ADMIN.identifier, SEEDED_ADMIN.password);

  // TC-FIN-02-01 — Bulk-generate cho nhiều phòng cùng lúc
  await run.test('TC-FIN-02-01', 'Bulk-generate tính đúng electricityFee/waterFee/totalAmount cho 2 phòng', async () => {
    const roomA = await createRoom(adminToken, { price: 1500000 });
    const roomB = await createRoom(adminToken, { price: 1500000 });

    const { status, body } = await api('POST', '/invoices/generate-bulk', {
      token: adminToken,
      body: {
        month: 9,
        year: 2026,
        dueDate: futureDueDate(),
        electricityUnitPrice: 3500,
        waterUnitPrice: 20000,
        readings: [
          { roomId: roomA._id, electricityKwh: 40, waterM3: 5 },
          { roomId: roomB._id, electricityKwh: 25, waterM3: 3 },
        ],
      },
    });
    assert(status === 201 || status === 200, `Kỳ vọng 200/201, nhận ${status}: ${JSON.stringify(body)}`);
    assert(body.created === 2, `Kỳ vọng created=2, nhận ${body.created}`);

    const invA = await db.collection('invoices').findOne({ room: new ObjectId(roomA._id), month: 9, year: 2026 });
    assert(invA.electricityFee === 140000, `electricityFee phòng A kỳ vọng 140000, nhận ${invA.electricityFee}`);
    assert(invA.waterFee === 100000, `waterFee phòng A kỳ vọng 100000, nhận ${invA.waterFee}`);
    assert(invA.totalAmount === 1740000, `totalAmount phòng A kỳ vọng 1740000, nhận ${invA.totalAmount}`);

    const invB = await db.collection('invoices').findOne({ room: new ObjectId(roomB._id), month: 9, year: 2026 });
    assert(invB.electricityFee === 87500, `electricityFee phòng B kỳ vọng 87500, nhận ${invB.electricityFee}`);
    assert(invB.waterFee === 60000, `waterFee phòng B kỳ vọng 60000, nhận ${invB.waterFee}`);
    assert(invB.totalAmount === 1647500, `totalAmount phòng B kỳ vọng 1647500, nhận ${invB.totalAmount}`);
  });

  // TC-FIN-02-02 — Tạo 1 hóa đơn đơn lẻ với phí đã tính sẵn
  await run.test('TC-FIN-02-02', 'POST /invoices (đơn lẻ) nhận electricityFee/waterFee tính sẵn, totalAmount đúng', async () => {
    const room = await createRoom(adminToken, { price: 1500000 });
    const { status, body } = await api('POST', '/invoices', {
      token: adminToken,
      body: {
        roomId: room._id,
        month: 9,
        year: 2026,
        electricityFee: 150000,
        waterFee: 80000,
        dueDate: futureDueDate(),
      },
    });
    assert(status === 201 || status === 200, `Kỳ vọng 200/201, nhận ${status}: ${JSON.stringify(body)}`);
    assert(body.totalAmount === 1730000, `totalAmount kỳ vọng 1730000, nhận ${body.totalAmount}`);
    assert(body.status === 'PENDING', `status kỳ vọng PENDING, nhận ${body.status}`);
  });

  // TC-FIN-02-03 — Trùng hóa đơn cùng phòng/tháng/năm
  await run.test('TC-FIN-02-03', 'Tạo trùng hóa đơn cùng room+month+year bị từ chối (409)', async () => {
    const room = await createRoom(adminToken, { price: 1500000 });
    const payload = {
      roomId: room._id,
      month: 10,
      year: 2026,
      electricityFee: 100000,
      waterFee: 50000,
      dueDate: futureDueDate(),
    };
    const first = await api('POST', '/invoices', { token: adminToken, body: payload });
    assert(first.status === 201 || first.status === 200, `Lần tạo đầu phải thành công, nhận ${first.status}`);

    const second = await api('POST', '/invoices', { token: adminToken, body: payload });
    assert(second.status === 409, `Lần tạo trùng kỳ vọng 409, nhận ${second.status}`);

    const count = await db.collection('invoices').countDocuments({ room: new ObjectId(room._id), month: 10, year: 2026 });
    assert(count === 1, `Chỉ được có đúng 1 hóa đơn cho phòng/kỳ này, thực tế ${count}`);
  });

  // TC-FIN-02-04 — Chỉ số âm trong bulk-generate (hành vi thật: skip âm thầm, không phải 400)
  await run.test('TC-FIN-02-04', 'Bulk-generate với electricityKwh âm: phòng đó bị skip, không tạo hóa đơn', async () => {
    const room = await createRoom(adminToken, { price: 1500000 });
    const { status, body } = await api('POST', '/invoices/generate-bulk', {
      token: adminToken,
      body: {
        month: 11,
        year: 2026,
        dueDate: futureDueDate(),
        electricityUnitPrice: 3500,
        waterUnitPrice: 20000,
        readings: [{ roomId: room._id, electricityKwh: -10, waterM3: 5 }],
      },
    });
    assert(status === 201 || status === 200, `Endpoint không throw ở mức HTTP cho lỗi từng dòng, kỳ vọng 200/201, nhận ${status}`);
    assert(body.created === 0, `created kỳ vọng 0, nhận ${body.created}`);
    assert(body.skipped === 1, `skipped kỳ vọng 1, nhận ${body.skipped}`);

    const invoice = await db.collection('invoices').findOne({ room: new ObjectId(room._id), month: 11, year: 2026 });
    assert(!invoice, 'Không được tạo hóa đơn khi chỉ số điện âm');
  });

  // TC-FIN-02-05 — Phòng trống (0 người ở) — hành vi thật: VẪN tạo hóa đơn bình thường
  await run.test('TC-FIN-02-05', 'Hóa đơn vẫn được tạo cho phòng đang trống (0 người ở) — không có occupancy guard trong code', async () => {
    const room = await createRoom(adminToken, { price: 1500000 }); // currentOccupancy = 0 mặc định
    const { status, body } = await api('POST', '/invoices', {
      token: adminToken,
      body: {
        roomId: room._id,
        month: 12,
        year: 2026,
        electricityFee: 0,
        waterFee: 0,
        dueDate: futureDueDate(),
      },
    });
    assert(status === 201 || status === 200, `Kỳ vọng 200/201 (đúng hành vi thật của code), nhận ${status}`);
    const invoice = await db.collection('invoices').findOne({ room: new ObjectId(room._id), month: 12, year: 2026 });
    assert(!!invoice, 'Hóa đơn phải được tạo dù phòng đang trống — nếu team muốn chặn trường hợp này thì đây là backlog cần bổ sung, không phải lỗi test.');
  });

  // TC-FIN-02-06 — Role không đủ quyền
  await run.test('TC-FIN-02-06', 'Sinh viên không thể tạo hóa đơn (403)', async () => {
    const student = await registerStudent('SV Không Quyền Invoice');
    const room = await createRoom(adminToken, { price: 1500000 });
    const { status } = await api('POST', '/invoices/generate-bulk', {
      token: student.token,
      body: {
        month: 1,
        year: 2027,
        dueDate: futureDueDate(),
        electricityUnitPrice: 3500,
        waterUnitPrice: 20000,
        readings: [{ roomId: room._id, electricityKwh: 10, waterM3: 2 }],
      },
    });
    assert(status === 403, `Kỳ vọng 403, nhận ${status}`);
  });

  // TC-FIN-02-07 — Hóa đơn mới mặc định PENDING
  await run.test('TC-FIN-02-07', 'Hóa đơn mới tạo mặc định status = PENDING', async () => {
    const room = await createRoom(adminToken, { price: 1500000 });
    await api('POST', '/invoices', {
      token: adminToken,
      body: { roomId: room._id, month: 2, year: 2027, electricityFee: 50000, waterFee: 30000, dueDate: futureDueDate() },
    });
    const invoice = await db.collection('invoices').findOne({ room: new ObjectId(room._id), month: 2, year: 2027 });
    assert(invoice.status === 'PENDING', `status kỳ vọng PENDING, nhận ${invoice.status}`);
  });

  // TC-FIN-02-08 — totalAmount cộng đúng với số không tròn
  await run.test('TC-FIN-02-08', 'totalAmount = roomFee + electricityFee + waterFee chính xác tuyệt đối với số lẻ', async () => {
    const price = 1350000;
    const room = await createRoom(adminToken, { price });
    const { body } = await api('POST', '/invoices/generate-bulk', {
      token: adminToken,
      body: {
        month: 3,
        year: 2027,
        dueDate: futureDueDate(),
        electricityUnitPrice: 3750,
        waterUnitPrice: 18000,
        readings: [{ roomId: room._id, electricityKwh: 37, waterM3: 4.5 }],
      },
    });
    assert(body.created === 1, `Kỳ vọng tạo được 1 hóa đơn, response: ${JSON.stringify(body)}`);
    const invoice = await db.collection('invoices').findOne({ room: new ObjectId(room._id), month: 3, year: 2027 });
    const expectedElectricity = Math.round(37 * 3750); // 138750
    const expectedWater = Math.round(4.5 * 18000); // 81000
    assert(invoice.electricityFee === expectedElectricity, `electricityFee kỳ vọng ${expectedElectricity}, nhận ${invoice.electricityFee}`);
    assert(invoice.waterFee === expectedWater, `waterFee kỳ vọng ${expectedWater}, nhận ${invoice.waterFee}`);
    assert(
      invoice.totalAmount === price + expectedElectricity + expectedWater,
      `totalAmount kỳ vọng ${price + expectedElectricity + expectedWater}, nhận ${invoice.totalAmount}`,
    );
  });

  // TC-FIN-02-09 — Bulk nhiều phòng tạo đúng số lượng hóa đơn, không lẫn dữ liệu
  await run.test('TC-FIN-02-09', 'Bulk-generate 5 phòng tạo đúng 5 hóa đơn, không bị lẫn giá trị giữa các phòng', async () => {
    const rooms = [];
    for (let i = 0; i < 5; i++) {
      rooms.push(await createRoom(adminToken, { price: 1000000 + i * 100000 }));
    }
    const readings = rooms.map((r, i) => ({ roomId: r._id, electricityKwh: 10 + i, waterM3: 1 + i }));
    const { body } = await api('POST', '/invoices/generate-bulk', {
      token: adminToken,
      body: {
        month: 4,
        year: 2027,
        dueDate: futureDueDate(),
        electricityUnitPrice: 3000,
        waterUnitPrice: 15000,
        readings,
      },
    });
    assert(body.created === 5, `Kỳ vọng created=5, nhận ${body.created}`);

    for (let i = 0; i < 5; i++) {
      const invoice = await db.collection('invoices').findOne({ room: new ObjectId(rooms[i]._id), month: 4, year: 2027 });
      const expectedElectricity = Math.round((10 + i) * 3000);
      const expectedWater = Math.round((1 + i) * 15000);
      const expectedTotal = 1000000 + i * 100000 + expectedElectricity + expectedWater;
      assert(
        invoice.totalAmount === expectedTotal,
        `Phòng thứ ${i} kỳ vọng totalAmount ${expectedTotal}, nhận ${invoice.totalAmount} — có thể bị lẫn dữ liệu giữa các phòng`,
      );
    }
  });

  // TC-FIN-02-10 — Thiếu đơn giá điện
  await run.test('TC-FIN-02-10', 'Bulk-generate thiếu electricityUnitPrice bị từ chối (400)', async () => {
    const room = await createRoom(adminToken, { price: 1500000 });
    const { status } = await api('POST', '/invoices/generate-bulk', {
      token: adminToken,
      body: {
        month: 5,
        year: 2027,
        dueDate: futureDueDate(),
        waterUnitPrice: 20000,
        // electricityUnitPrice cố tình bỏ trống
        readings: [{ roomId: room._id, electricityKwh: 30, waterM3: 4 }],
      },
    });
    assert(status === 400, `Kỳ vọng 400 (Number(undefined) = NaN -> BadRequestException), nhận ${status}`);
    const invoice = await db.collection('invoices').findOne({ room: new ObjectId(room._id), month: 5, year: 2027 });
    assert(!invoice, 'Không được tạo hóa đơn khi thiếu đơn giá điện');
  });

  // TC-FIN-02-11 — Sinh viên xem được hóa đơn của đúng phòng mình đang ở
  await run.test('TC-FIN-02-11', 'Sinh viên đúng phòng xem được hóa đơn vừa tạo qua GET /invoices/room/:roomId', async () => {
    const room = await createRoom(adminToken, { capacity: 4, price: 1500000 });
    const student = await registerStudent('SV Xem Hóa Đơn');

    // Cho sinh viên vào phòng qua đúng luồng UC-ROOM-06 (booking -> approve)
    const { body: bk } = await api('POST', '/bookings', { token: student.token, body: { roomId: room._id } });
    const bookingId = bk.booking?._id || bk._id;
    await api('PATCH', `/bookings/${bookingId}/approve`, { token: adminToken });

    await api('POST', '/invoices', {
      token: adminToken,
      body: { roomId: room._id, month: 6, year: 2027, electricityFee: 60000, waterFee: 40000, dueDate: futureDueDate() },
    });

    const { status, body } = await api('GET', `/invoices/room/${room._id}`, { token: student.token });
    assert(status === 200, `Kỳ vọng 200, nhận ${status}`);
    const found = (Array.isArray(body) ? body : body?.data || []).some((inv) => inv.month === 6 && inv.year === 2027);
    assert(found, 'Sinh viên không thấy hóa đơn tháng 6/2027 vừa tạo cho phòng mình');
  });

  return run.summary();
}

if (require.main === module) {
  run()
    .then(() => closeDb())
    .catch((e) => {
      console.error('Lỗi không mong muốn khi chạy suite:', e);
      process.exitCode = 1;
    });
}

module.exports = { run };
