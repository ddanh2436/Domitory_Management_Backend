// e2e-tests/uc-chk-04.js
// Tự động test UC-CHK-04 — Refund Deposit and Complete Checkout (includes UC-CON-03)
// 11 test case: TC-CHK-04-01 .. 11
//
// Cách chạy riêng: node e2e-tests/uc-chk-04.js
//
// GHI CHÚ (khác với bản nháp gốc, đọc trực tiếp code checkouts.service.ts):
//   - CompleteCheckoutDto dùng field "damages" (không phải "damageItems"), mỗi
//     phần tử có "itemName" + "fee" (không phải "name"/"fee").
//   - Response của complete = { message, compensationAmount, refundAmount }
//     (không có field "refund"/"compensation" trần).
//   - Sinh viên PHẢI có 1 Contract đang ACTIVE mới tạo được checkout — luồng
//     chuẩn bị dùng lại đúng UC-ROOM-06 (booking -> approve) trước khi tạo
//     checkout, đảm bảo tự nhất quán với hệ thống thật thay vì insert thẳng
//     Contract giả vào DB.

const { getDb, closeDb, api, login, rnd, assert, createRunner, ObjectId } = require('./helpers');

const SEEDED_ADMIN = { identifier: 'e2e.admin@test.local', password: 'E2Etest123' };
const TEST_PASSWORD = 'Test@12345';

async function createRoom(adminToken, overrides = {}) {
  const body = {
    name: rnd('RMCHK'),
    building: 'C1',
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

// Chuẩn bị 1 sinh viên đã có phòng + hợp đồng ACTIVE, đúng theo luồng thật
// UC-ROOM-06 (đăng ký -> đặt phòng -> quản lý duyệt), rồi tạo sẵn 1 checkout
// PENDING cho sinh viên đó.
async function setupStudentWithPendingCheckout(db, adminToken, roomOverrides = {}) {
  const room = await createRoom(adminToken, { capacity: 4, price: 1500000, ...roomOverrides });
  const email = rnd('chk04') + '@test.local';
  const reg = await api('POST', '/auth/register', { body: { email, password: TEST_PASSWORD, fullName: 'SV Checkout Test' } });
  assert(reg.status === 200 || reg.status === 201, `Đăng ký sinh viên thất bại: ${JSON.stringify(reg.body)}`);
  const token = await login(email, TEST_PASSWORD);

  const { body: bk } = await api('POST', '/bookings', { token, body: { roomId: room._id } });
  const bookingId = bk.booking?._id || bk._id;
  const approve = await api('PATCH', `/bookings/${bookingId}/approve`, { token: adminToken });
  assert(approve.status === 200, `Chuẩn bị: duyệt booking phải thành công, nhận ${approve.status}`);

  const contract = await db.collection('contracts').findOne({ booking: new ObjectId(bookingId) });
  assert(!!contract, 'Chuẩn bị: không tìm thấy contract vừa tạo qua UC-ROOM-06');

  const expectedDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { status: coStatus, body: co } = await api('POST', '/checkouts', {
    token,
    body: { reason: 'Kết thúc năm học', expectedDate },
  });
  assert(coStatus === 200 || coStatus === 201, `Chuẩn bị: tạo checkout thất bại: ${JSON.stringify(co)}`);
  const checkoutId = co.checkout?._id || co._id;

  return { email, token, room, contract, checkoutId };
}

async function run() {
  const run = createRunner('UC-CHK-04 — Refund Deposit and Complete Checkout');
  const db = await getDb();
  const adminToken = await login(SEEDED_ADMIN.identifier, SEEDED_ADMIN.password);

  // TC-CHK-04-01 — Hoàn cọc toàn bộ khi không có hư hỏng
  await run.test('TC-CHK-04-01', 'Complete checkout không hư hỏng: hoàn 100% cọc, contract TERMINATED, occupancy -1', async () => {
    const ctx = await setupStudentWithPendingCheckout(db, adminToken);
    const before = await db.collection('rooms').findOne({ _id: new ObjectId(ctx.room._id) });

    const { status, body } = await api('PATCH', `/checkouts/${ctx.checkoutId}/complete`, {
      token: adminToken,
      body: { damages: [] },
    });
    assert(status === 200, `Kỳ vọng 200, nhận ${status}: ${JSON.stringify(body)}`);
    assert(body.compensationAmount === 0, `compensationAmount kỳ vọng 0, nhận ${body.compensationAmount}`);
    assert(body.refundAmount === ctx.contract.rentalFee, `refundAmount kỳ vọng ${ctx.contract.rentalFee}, nhận ${body.refundAmount}`);

    const contract = await db.collection('contracts').findOne({ _id: ctx.contract._id });
    assert(contract.status === 'TERMINATED', `Contract.status kỳ vọng TERMINATED, nhận ${contract.status}`);

    const after = await db.collection('rooms').findOne({ _id: new ObjectId(ctx.room._id) });
    assert(
      after.currentOccupancy === before.currentOccupancy - 1,
      `currentOccupancy kỳ vọng giảm 1 (${before.currentOccupancy} -> ${before.currentOccupancy - 1}), thực tế ${after.currentOccupancy}`,
    );
  });

  // TC-CHK-04-02 — Có hư hỏng: trừ đúng vào cọc
  await run.test('TC-CHK-04-02', 'Complete checkout có hư hỏng: compensation/refund tính đúng', async () => {
    const ctx = await setupStudentWithPendingCheckout(db, adminToken);
    const { status, body } = await api('PATCH', `/checkouts/${ctx.checkoutId}/complete`, {
      token: adminToken,
      body: {
        damages: [
          { itemName: 'Vỡ cửa kính', fee: 300000 },
          { itemName: 'Mất chìa khóa', fee: 100000 },
        ],
      },
    });
    assert(status === 200, `Kỳ vọng 200, nhận ${status}`);
    assert(body.compensationAmount === 400000, `compensationAmount kỳ vọng 400000, nhận ${body.compensationAmount}`);
    assert(
      body.refundAmount === ctx.contract.rentalFee - 400000,
      `refundAmount kỳ vọng ${ctx.contract.rentalFee - 400000}, nhận ${body.refundAmount}`,
    );
  });

  // TC-CHK-04-03 — Bồi thường vượt tiền cọc: refund = 0, không âm
  await run.test('TC-CHK-04-03', 'Compensation vượt deposit: refund bị chặn ở 0, không ra số âm', async () => {
    const ctx = await setupStudentWithPendingCheckout(db, adminToken, { price: 1000000 });
    const { status, body } = await api('PATCH', `/checkouts/${ctx.checkoutId}/complete`, {
      token: adminToken,
      body: { damages: [{ itemName: 'Hỏng toàn bộ nội thất', fee: 1400000 }] },
    });
    assert(status === 200, `Kỳ vọng 200, nhận ${status}`);
    assert(body.compensationAmount === 1400000, `compensationAmount kỳ vọng 1400000, nhận ${body.compensationAmount}`);
    assert(body.refundAmount === 0, `refundAmount kỳ vọng 0 (không âm), nhận ${body.refundAmount}`);
  });

  // TC-CHK-04-04 — Chỉ terminate đúng 1 contract liên quan, không ảnh hưởng contract khác
  await run.test('TC-CHK-04-04', 'Complete checkout chỉ terminate đúng contract liên quan, contract khác không đổi', async () => {
    const ctx = await setupStudentWithPendingCheckout(db, adminToken);
    const other = await setupStudentWithPendingCheckout(db, adminToken); // tạo 1 sinh viên/contract độc lập khác, KHÔNG complete checkout của họ

    await api('PATCH', `/checkouts/${ctx.checkoutId}/complete`, { token: adminToken, body: { damages: [] } });

    const contract = await db.collection('contracts').findOne({ _id: ctx.contract._id });
    assert(contract.status === 'TERMINATED', 'Contract của sinh viên vừa checkout phải TERMINATED');

    const otherContract = await db.collection('contracts').findOne({ _id: other.contract._id });
    assert(otherContract.status === 'ACTIVE', `Contract của sinh viên khác không được đổi, thực tế ${otherContract.status}`);
  });

  // TC-CHK-04-05 — Room occupancy giảm và User.room bị gỡ
  await run.test('TC-CHK-04-05', 'Room occupancy giảm đúng 1 và User.room bị gỡ hoàn toàn sau khi complete', async () => {
    const ctx = await setupStudentWithPendingCheckout(db, adminToken);
    const before = await db.collection('rooms').findOne({ _id: new ObjectId(ctx.room._id) });

    await api('PATCH', `/checkouts/${ctx.checkoutId}/complete`, { token: adminToken, body: { damages: [] } });

    const after = await db.collection('rooms').findOne({ _id: new ObjectId(ctx.room._id) });
    assert(after.currentOccupancy === before.currentOccupancy - 1, 'currentOccupancy phải giảm đúng 1');

    const userDoc = await db.collection('users').findOne({ email: ctx.email });
    assert(!userDoc.room, 'User.room phải bị gỡ (unset) sau khi checkout hoàn tất');
  });

  // TC-CHK-04-06 — Notification kèm số tiền hoàn cọc (kiểm tra bản ghi trong DB)
  await run.test('TC-CHK-04-06', 'Notification chứa đúng số tiền hoàn cọc sau khi complete', async () => {
    const ctx = await setupStudentWithPendingCheckout(db, adminToken);
    const userDoc = await db.collection('users').findOne({ email: ctx.email });

    const { body } = await api('PATCH', `/checkouts/${ctx.checkoutId}/complete`, { token: adminToken, body: { damages: [] } });

    const notif = await db.collection('notifications').findOne({
      recipient: userDoc._id,
      title: { $regex: 'Trả phòng hoàn tất' },
    });
    assert(!!notif, 'Không tìm thấy Notification "Trả phòng hoàn tất"');
    assert(
      notif.message.includes(body.refundAmount.toLocaleString('vi-VN')),
      `Nội dung thông báo không chứa đúng số tiền hoàn cọc (${body.refundAmount})`,
    );
  });

  // TC-CHK-04-07 — Complete lần 2 trên checkout đã COMPLETED
  await run.test('TC-CHK-04-07', 'Complete lại checkout đã COMPLETED bị từ chối (404), không tăng thêm lần refund', async () => {
    const ctx = await setupStudentWithPendingCheckout(db, adminToken);
    const first = await api('PATCH', `/checkouts/${ctx.checkoutId}/complete`, { token: adminToken, body: { damages: [] } });
    assert(first.status === 200, `Lần 1 phải thành công, nhận ${first.status}`);

    const roomAfterFirst = await db.collection('rooms').findOne({ _id: new ObjectId(ctx.room._id) });

    const second = await api('PATCH', `/checkouts/${ctx.checkoutId}/complete`, { token: adminToken, body: { damages: [] } });
    assert(second.status === 404, `Lần 2 kỳ vọng 404 (lọc theo status:PENDING), nhận ${second.status}`);

    const roomAfterSecond = await db.collection('rooms').findOne({ _id: new ObjectId(ctx.room._id) });
    assert(
      roomAfterSecond.currentOccupancy === roomAfterFirst.currentOccupancy,
      'currentOccupancy không được giảm thêm lần nữa ở lần complete thứ 2',
    );
  });

  // TC-CHK-04-08 — Role không đủ quyền
  await run.test('TC-CHK-04-08', 'Sinh viên không thể tự complete checkout của chính mình (403)', async () => {
    const ctx = await setupStudentWithPendingCheckout(db, adminToken);
    const { status } = await api('PATCH', `/checkouts/${ctx.checkoutId}/complete`, {
      token: ctx.token,
      body: { damages: [] },
    });
    assert(status === 403, `Kỳ vọng 403, nhận ${status}`);
  });

  // TC-CHK-04-09 — Điều chỉnh deposit khác mặc định
  await run.test('TC-CHK-04-09', 'depositAmount điều chỉnh tay được dùng để tính refund, không dùng giá trị mặc định', async () => {
    const ctx = await setupStudentWithPendingCheckout(db, adminToken, { price: 1200000 });
    const adjustedDeposit = 1000000;
    const { status, body } = await api('PATCH', `/checkouts/${ctx.checkoutId}/complete`, {
      token: adminToken,
      body: { damages: [], depositAmount: adjustedDeposit },
    });
    assert(status === 200, `Kỳ vọng 200, nhận ${status}`);
    assert(body.refundAmount === adjustedDeposit, `refundAmount kỳ vọng dùng deposit điều chỉnh ${adjustedDeposit}, nhận ${body.refundAmount}`);

    const checkoutDoc = await db.collection('checkouts').findOne({ _id: new ObjectId(ctx.checkoutId) });
    assert(checkoutDoc.depositAmount === adjustedDeposit, `depositAmount lưu trong DB kỳ vọng ${adjustedDeposit}, nhận ${checkoutDoc.depositAmount}`);
  });

  // TC-CHK-04-10 — Từ chối thay vì hoàn tất: không có side effect
  await run.test('TC-CHK-04-10', 'Reject checkout: không đổi contract/room/user, chỉ đổi status checkout', async () => {
    const ctx = await setupStudentWithPendingCheckout(db, adminToken);
    const beforeRoom = await db.collection('rooms').findOne({ _id: new ObjectId(ctx.room._id) });

    const { status } = await api('PATCH', `/checkouts/${ctx.checkoutId}/reject`, {
      token: adminToken,
      body: { adminNote: 'Không đủ điều kiện trả phòng' },
    });
    assert(status === 200, `Kỳ vọng 200, nhận ${status}`);

    const checkoutDoc = await db.collection('checkouts').findOne({ _id: new ObjectId(ctx.checkoutId) });
    assert(checkoutDoc.status === 'REJECTED', `Checkout.status kỳ vọng REJECTED, nhận ${checkoutDoc.status}`);

    const contract = await db.collection('contracts').findOne({ _id: ctx.contract._id });
    assert(contract.status === 'ACTIVE', `Contract phải vẫn ACTIVE sau khi reject, nhận ${contract.status}`);

    const afterRoom = await db.collection('rooms').findOne({ _id: new ObjectId(ctx.room._id) });
    assert(afterRoom.currentOccupancy === beforeRoom.currentOccupancy, 'currentOccupancy không được đổi khi reject');

    const userDoc = await db.collection('users').findOne({ email: ctx.email });
    assert(String(userDoc.room) === String(ctx.room._id), 'User.room không được gỡ khi reject');
  });

  // TC-CHK-04-11 — Atomicity khi transaction fail giữa chừng: không thể fault-inject an toàn bằng
  // script chạy từ ngoài (cần sửa code / dùng mongo fail point chuyên biệt) — để MANUAL.
  run.manual(
    'TC-CHK-04-11',
    'Transaction rollback hoàn toàn nếu lỗi giữa chừng (không có state nửa vời)',
    'Không thể an toàn mô phỏng lỗi giữa transaction từ 1 script HTTP/DB client bên ngoài mà không sửa tạm code hoặc dùng MongoDB fail point chuyên dụng (db.adminCommand({configureFailPoint...})) — rủi ro làm hỏng dữ liệu khác đang chạy song song. Khuyến nghị: xác nhận bằng code review đoạn session.startTransaction()/commitTransaction()/abortTransaction() trong completeCheckout (đã bọc toàn bộ update Checkout+Contract+Room+User trong 1 session), và ghi chú rõ trong Test Execution là "xác nhận qua code review" thay vì chạy thử nghiệm thực tế.',
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
