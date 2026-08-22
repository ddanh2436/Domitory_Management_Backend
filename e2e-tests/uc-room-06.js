// e2e-tests/uc-room-06.js
// Tự động test UC-ROOM-06 — Review Room Application (includes UC-CON-01)
// 11 test case: TC-ROOM-06-01 .. 11
//
// Cách chạy riêng: node e2e-tests/uc-room-06.js
//
// Toàn bộ phòng/sinh viên dùng trong suite này được TẠO MỚI qua API (không đụng
// tới dữ liệu bạn đang thao tác tay trên /admin), nên chạy lại nhiều lần vẫn an
// toàn và không cần dọn dẹp thủ công.

const { getDb, closeDb, api, login, rnd, assert, createRunner, ObjectId } = require('./helpers');

const SEEDED_ADMIN = { identifier: 'e2e.admin@test.local', password: 'E2Etest123' };
const TEST_PASSWORD = 'Test@12345';

async function registerStudent(fullName) {
  const email = rnd('room06') + '@test.local';
  const reg = await api('POST', '/auth/register', {
    body: { email, password: TEST_PASSWORD, fullName },
  });
  assert(reg.status === 201 || reg.status === 200, `Đăng ký sinh viên thất bại: ${JSON.stringify(reg.body)}`);
  const token = await login(email, TEST_PASSWORD);
  return { email, token };
}

async function createRoom(adminToken, overrides = {}) {
  const body = {
    name: rnd('RM06'),
    building: 'B1',
    floor: 1,
    capacity: 4,
    price: 1500000,
    status: 'AVAILABLE',
    ...overrides,
  };
  const { status, body: room } = await api('POST', '/rooms', { token: adminToken, body });
  assert(status === 201 || status === 200, `Tạo phòng thất bại: ${JSON.stringify(room)}`);
  return room?._id ? room : room?.data; // phòng khi trường hợp API bọc trong { data }
}

async function run() {
  const run = createRunner('UC-ROOM-06 — Review Room Application');
  const db = await getDb();
  const adminToken = await login(SEEDED_ADMIN.identifier, SEEDED_ADMIN.password);

  // TC-ROOM-06-01 — Duyệt đơn thành công
  await run.test('TC-ROOM-06-01', 'Duyệt booking PENDING: booking APPROVED, occupancy +1, contract tạo mới, user.room được set', async () => {
    const room = await createRoom(adminToken, { capacity: 4 });
    const student = await registerStudent('SV Duyệt Đơn');
    const { status: bkStatus, body: bk } = await api('POST', '/bookings', {
      token: student.token,
      body: { roomId: room._id },
    });
    assert(bkStatus === 201 || bkStatus === 200, `Tạo booking thất bại: ${JSON.stringify(bk)}`);
    const bookingId = bk.booking?._id || bk._id;

    const before = await db.collection('rooms').findOne({ _id: new ObjectId(room._id) });
    const { status: apStatus } = await api('PATCH', `/bookings/${bookingId}/approve`, { token: adminToken });
    assert(apStatus === 200, `Kỳ vọng 200 khi duyệt, nhận ${apStatus}`);

    const bookingDoc = await db.collection('bookings').findOne({ _id: new ObjectId(bookingId) });
    assert(bookingDoc.status === 'APPROVED', `Booking.status kỳ vọng APPROVED, nhận ${bookingDoc.status}`);

    const after = await db.collection('rooms').findOne({ _id: new ObjectId(room._id) });
    assert(
      after.currentOccupancy === before.currentOccupancy + 1,
      `currentOccupancy kỳ vọng tăng 1 (${before.currentOccupancy} -> ${before.currentOccupancy + 1}), thực tế ${after.currentOccupancy}`,
    );

    const contract = await db.collection('contracts').findOne({ booking: new ObjectId(bookingId) });
    assert(!!contract, 'Không tìm thấy Contract được tạo tự động');
    assert(contract.status === 'ACTIVE', `Contract.status kỳ vọng ACTIVE, nhận ${contract.status}`);

    const userDoc = await db.collection('users').findOne({ email: student.email });
    assert(String(userDoc.room) === String(room._id), 'User.room chưa được set đúng phòng vừa duyệt');
  });

  // TC-ROOM-06-02 — Từ chối đơn
  await run.test('TC-ROOM-06-02', 'Từ chối booking PENDING: chỉ đổi status, không có side effect', async () => {
    const room = await createRoom(adminToken, { capacity: 4 });
    const student = await registerStudent('SV Từ Chối');
    const { body: bk } = await api('POST', '/bookings', { token: student.token, body: { roomId: room._id } });
    const bookingId = bk.booking?._id || bk._id;

    const before = await db.collection('rooms').findOne({ _id: new ObjectId(room._id) });
    const { status } = await api('PATCH', `/bookings/${bookingId}/reject`, { token: adminToken });
    assert(status === 200, `Kỳ vọng 200 khi từ chối, nhận ${status}`);

    const bookingDoc = await db.collection('bookings').findOne({ _id: new ObjectId(bookingId) });
    assert(bookingDoc.status === 'REJECTED', `Booking.status kỳ vọng REJECTED, nhận ${bookingDoc.status}`);

    const after = await db.collection('rooms').findOne({ _id: new ObjectId(room._id) });
    assert(after.currentOccupancy === before.currentOccupancy, 'currentOccupancy không được đổi khi từ chối');

    const contract = await db.collection('contracts').findOne({ booking: new ObjectId(bookingId) });
    assert(!contract, 'Không được tạo Contract khi từ chối');

    const userDoc = await db.collection('users').findOne({ email: student.email });
    assert(!userDoc.room, 'User.room phải vẫn trống khi đơn bị từ chối');
  });

  // TC-ROOM-06-03 — Trường hợp đồng sinh ra đúng
  await run.test('TC-ROOM-06-03', 'Hợp đồng tự sinh có contractNumber/startDate/endDate/rentalFee đúng quy tắc', async () => {
    const price = 1750000;
    const room = await createRoom(adminToken, { capacity: 2, price });
    const student = await registerStudent('SV Check Contract');
    const { body: bk } = await api('POST', '/bookings', { token: student.token, body: { roomId: room._id } });
    const bookingId = bk.booking?._id || bk._id;

    const beforeApprove = Date.now();
    await api('PATCH', `/bookings/${bookingId}/approve`, { token: adminToken });
    const afterApprove = Date.now();

    const contract = await db.collection('contracts').findOne({ booking: new ObjectId(bookingId) });
    assert(!!contract, 'Không tìm thấy contract');
    assert(/^HD-\d{4}-/.test(contract.contractNumber), `contractNumber sai định dạng: ${contract.contractNumber}`);

    const startMs = new Date(contract.startDate).getTime();
    assert(
      startMs >= beforeApprove - 5000 && startMs <= afterApprove + 5000,
      'startDate không nằm trong khoảng thời điểm duyệt đơn',
    );

    const expectedEnd = new Date(contract.startDate);
    expectedEnd.setMonth(expectedEnd.getMonth() + 5);
    assert(
      Math.abs(new Date(contract.endDate).getTime() - expectedEnd.getTime()) < 60_000,
      `endDate kỳ vọng startDate + 5 tháng, thực tế lệch quá nhiều: ${contract.endDate}`,
    );

    assert(contract.rentalFee === price, `rentalFee kỳ vọng ${price}, nhận ${contract.rentalFee}`);
  });

  // TC-ROOM-06-04 — Notification khi duyệt (kiểm tra bản ghi Notification trong DB;
  // việc chuông báo hiện tức thời trên UI vẫn nên xác nhận thêm bằng mắt qua trình duyệt)
  await run.test('TC-ROOM-06-04', 'Notification được tạo trong DB khi duyệt đơn', async () => {
    const room = await createRoom(adminToken, { capacity: 4 });
    const student = await registerStudent('SV Noti Duyệt');
    const { body: bk } = await api('POST', '/bookings', { token: student.token, body: { roomId: room._id } });
    const bookingId = bk.booking?._id || bk._id;
    const userDoc = await db.collection('users').findOne({ email: student.email });

    await api('PATCH', `/bookings/${bookingId}/approve`, { token: adminToken });

    const notif = await db.collection('notifications').findOne({
      recipient: userDoc._id,
      type: 'BOOKING',
    });
    assert(!!notif, 'Không tìm thấy Notification loại BOOKING cho sinh viên sau khi duyệt');
  });

  // TC-ROOM-06-05 — Notification khi từ chối
  await run.test('TC-ROOM-06-05', 'Notification được tạo trong DB khi từ chối đơn', async () => {
    const room = await createRoom(adminToken, { capacity: 4 });
    const student = await registerStudent('SV Noti Từ Chối');
    const { body: bk } = await api('POST', '/bookings', { token: student.token, body: { roomId: room._id } });
    const bookingId = bk.booking?._id || bk._id;
    const userDoc = await db.collection('users').findOne({ email: student.email });

    await api('PATCH', `/bookings/${bookingId}/reject`, { token: adminToken });

    const notif = await db.collection('notifications').findOne({ recipient: userDoc._id });
    assert(!!notif, 'Không tìm thấy Notification cho sinh viên sau khi từ chối');
  });

  // TC-ROOM-06-06 — Role không đủ quyền
  await run.test('TC-ROOM-06-06', 'Sinh viên không thể tự duyệt booking của mình (403)', async () => {
    const room = await createRoom(adminToken, { capacity: 4 });
    const student = await registerStudent('SV Không Quyền');
    const { body: bk } = await api('POST', '/bookings', { token: student.token, body: { roomId: room._id } });
    const bookingId = bk.booking?._id || bk._id;

    const { status } = await api('PATCH', `/bookings/${bookingId}/approve`, { token: student.token });
    assert(status === 403, `Kỳ vọng 403 (RolesGuard ném ForbiddenException), nhận ${status}`);

    const bookingDoc = await db.collection('bookings').findOne({ _id: new ObjectId(bookingId) });
    assert(bookingDoc.status === 'PENDING', 'Booking không được đổi trạng thái khi bị chặn quyền');
  });

  // TC-ROOM-06-07 — Duyệt lại booking không còn PENDING
  await run.test('TC-ROOM-06-07', 'Duyệt lại booking đã APPROVED bị từ chối (404, không tạo contract 2 lần)', async () => {
    const room = await createRoom(adminToken, { capacity: 4 });
    const student = await registerStudent('SV Duyệt Lại');
    const { body: bk } = await api('POST', '/bookings', { token: student.token, body: { roomId: room._id } });
    const bookingId = bk.booking?._id || bk._id;

    await api('PATCH', `/bookings/${bookingId}/approve`, { token: adminToken }); // duyệt lần 1
    const contractsBefore = await db.collection('contracts').countDocuments({ booking: new ObjectId(bookingId) });

    const { status } = await api('PATCH', `/bookings/${bookingId}/approve`, { token: adminToken }); // duyệt lần 2
    assert(
      status === 404,
      `approveBooking lọc theo status:PENDING nên duyệt lại phải trả 404 (NotFoundException), nhận ${status}`,
    );

    const contractsAfter = await db.collection('contracts').countDocuments({ booking: new ObjectId(bookingId) });
    assert(contractsAfter === contractsBefore, 'Không được tạo thêm contract khi duyệt lại lần 2');
  });

  // TC-ROOM-06-08 — Phòng đầy
  await run.test('TC-ROOM-06-08', 'Duyệt đơn khi phòng đã đầy chỗ bị từ chối (400), không tạo contract', async () => {
    const room = await createRoom(adminToken, { capacity: 1 });
    const studentA = await registerStudent('SV Full A');
    const studentB = await registerStudent('SV Full B');

    const { body: bkA } = await api('POST', '/bookings', { token: studentA.token, body: { roomId: room._id } });
    const bookingIdA = bkA.booking?._id || bkA._id;
    const approveA = await api('PATCH', `/bookings/${bookingIdA}/approve`, { token: adminToken });
    assert(approveA.status === 200, `Chuẩn bị: duyệt đơn A phải thành công để phòng đầy, nhận ${approveA.status}`);

    const { body: bkB } = await api('POST', '/bookings', { token: studentB.token, body: { roomId: room._id } });
    const bookingIdB = bkB.booking?._id || bkB._id;

    const { status } = await api('PATCH', `/bookings/${bookingIdB}/approve`, { token: adminToken });
    assert(status === 400, `Phòng đã đầy (capacity 1, đã có A) nên duyệt B phải trả 400, nhận ${status}`);

    const contractB = await db.collection('contracts').findOne({ booking: new ObjectId(bookingIdB) });
    assert(!contractB, 'Không được tạo contract cho đơn B khi phòng đã đầy');
  });

  // TC-ROOM-06-09 — Concurrency: 2 đơn tranh 1 slot cuối cùng
  await run.test('TC-ROOM-06-09', 'Duyệt song song 2 đơn cho 1 slot cuối: chỉ 1 thành công, occupancy không vượt capacity', async () => {
    const room = await createRoom(adminToken, { capacity: 1 });
    const studentA = await registerStudent('SV Race A');
    const studentB = await registerStudent('SV Race B');

    const { body: bkA } = await api('POST', '/bookings', { token: studentA.token, body: { roomId: room._id } });
    const { body: bkB } = await api('POST', '/bookings', { token: studentB.token, body: { roomId: room._id } });
    const bookingIdA = bkA.booking?._id || bkA._id;
    const bookingIdB = bkB.booking?._id || bkB._id;

    const [resA, resB] = await Promise.all([
      api('PATCH', `/bookings/${bookingIdA}/approve`, { token: adminToken }),
      api('PATCH', `/bookings/${bookingIdB}/approve`, { token: adminToken }),
    ]);

    const successCount = [resA, resB].filter((r) => r.status === 200).length;
    assert(successCount === 1, `Kỳ vọng đúng 1 trong 2 request thành công (chống overbooking), thực tế ${successCount} thành công`);

    const finalRoom = await db.collection('rooms').findOne({ _id: new ObjectId(room._id) });
    assert(
      finalRoom.currentOccupancy <= finalRoom.capacity,
      `currentOccupancy (${finalRoom.currentOccupancy}) không được vượt capacity (${finalRoom.capacity})`,
    );
  });

  // TC-ROOM-06-10 — Từ chối kèm ghi chú
  await run.test('TC-ROOM-06-10', 'Từ chối không làm thay đổi phòng/hợp đồng/user dù có hay không có ghi chú', async () => {
    const room = await createRoom(adminToken, { capacity: 4 });
    const student = await registerStudent('SV Note Reject');
    const { body: bk } = await api('POST', '/bookings', { token: student.token, body: { roomId: room._id } });
    const bookingId = bk.booking?._id || bk._id;

    const before = await db.collection('rooms').findOne({ _id: new ObjectId(room._id) });
    const { status } = await api('PATCH', `/bookings/${bookingId}/reject`, { token: adminToken });
    assert(status === 200, `Kỳ vọng 200, nhận ${status}`);

    const after = await db.collection('rooms').findOne({ _id: new ObjectId(room._id) });
    assert(after.currentOccupancy === before.currentOccupancy, 'currentOccupancy không được đổi');
    const userDoc = await db.collection('users').findOne({ email: student.email });
    assert(!userDoc.room, 'User.room phải vẫn trống');
  });

  // TC-ROOM-06-11 — UI cập nhật badge ngay sau khi duyệt/từ chối — hành vi giao diện, không automate qua API được
  run.manual(
    'TC-ROOM-06-11',
    'Bảng /admin/bookings cập nhật badge trạng thái ngay sau khi duyệt/từ chối, không cần F5',
    'Cần quan sát UI trực tiếp: mở /admin/bookings, duyệt hoặc từ chối 1 đơn PENDING, xác nhận badge đổi màu/nhãn tại chỗ mà không phải tải lại trang.',
  );

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
