// e2e-tests/uc-room-07.js
// Tự động test UC-ROOM-07 — Run Automatic Room Allocation
// 11 test case: TC-ROOM-07-01 .. 11
//
// Cách chạy riêng: node e2e-tests/uc-room-07.js
//
// LƯU Ý QUAN TRỌNG VỀ MÔI TRƯỜNG: POST /api/assignments/auto xử lý TOÀN BỘ
// sinh viên chưa có phòng trong CẢ HỆ THỐNG (không giới hạn theo sinh viên
// script này vừa tạo). Vì vậy:
//   - Với các test case chỉ cần biết "sinh viên X của mình được ASSIGNED hay
//     SKIPPED", script lọc `results` theo đúng studentId của mình thay vì tin
//     vào assignedCount/skippedCount toàn cục (tránh nhiễu bởi dữ liệu thật/
//     dữ liệu bạn đang thao tác tay song song).
//   - TC-03 (skip do giới tính) và TC-06/09/11 (concurrency, thứ tự, đa giới
//     tính) giả định KHÔNG có phòng MIXED nào khác còn trống, phù hợp giới
//     tính, "cướp" mất sinh viên test trước khi tới lượt phòng mục tiêu. Trên
//     một CSDL dev đang có nhiều dữ liệu thật/thao tác tay song song, các case
//     này có thể không ổn định (flaky) — khuyên chạy trên CSDL test cô lập
//     nếu cần kết quả chắc chắn 100%.
//   - TC-04 và TC-05 (nút bị disable khi 0 sinh viên/0 chỗ trống) đánh giá
//     TRẠNG THÁI TOÀN CỤC của cả hệ thống và là hành vi UI thuần tuý (disabled
//     attribute của nút) — script không tự ý sửa dữ liệu thật của người khác
//     để ép trạng thái này, nên 2 case này để MANUAL kèm hướng dẫn kiểm tra.

const { getDb, closeDb, api, login, rnd, assert, createRunner, ObjectId } = require('./helpers');

const SEEDED_ADMIN = { identifier: 'e2e.admin@test.local', password: 'E2Etest123' };
const SEEDED_STAFF = { identifier: 'e2e.staff@test.local', password: 'E2Etest123' };
const TEST_PASSWORD = 'Test@12345';

async function registerStudent(db, fullName, gender) {
  const email = rnd('room07') + '@test.local';
  const reg = await api('POST', '/auth/register', {
    body: { email, password: TEST_PASSWORD, fullName },
  });
  assert(reg.status === 201 || reg.status === 200, `Đăng ký sinh viên thất bại: ${JSON.stringify(reg.body)}`);
  if (gender) {
    await db.collection('users').updateOne({ email }, { $set: { gender } });
  }
  const userDoc = await db.collection('users').findOne({ email });
  return { email, id: userDoc._id.toString() };
}

async function createRoom(adminToken, overrides = {}) {
  const body = {
    name: rnd('RM07'),
    building: 'B7',
    floor: 7,
    capacity: 4,
    price: 1500000,
    status: 'AVAILABLE',
    ...overrides,
  };
  const { status, body: room } = await api('POST', '/rooms', { token: adminToken, body });
  assert(status === 201 || status === 200, `Tạo phòng thất bại: ${JSON.stringify(room)}`);
  const created = room?._id ? room : room?.data;
  if (overrides.genderType) {
    // CreateRoomDto không có field genderType, set trực tiếp qua DB sau khi tạo.
    const db = await getDb();
    await db.collection('rooms').updateOne({ _id: new ObjectId(created._id) }, { $set: { genderType: overrides.genderType } });
  }
  return created;
}

function resultsFor(results, studentIds) {
  const idSet = new Set(studentIds);
  return results.filter((r) => idSet.has(r.studentId));
}

async function run() {
  const run = createRunner('UC-ROOM-07 — Run Automatic Room Allocation');
  const db = await getDb();
  const adminToken = await login(SEEDED_ADMIN.identifier, SEEDED_ADMIN.password);
  const staffToken = await login(SEEDED_STAFF.identifier, SEEDED_STAFF.password);

  // TC-ROOM-07-01 — Preview đúng số liệu
  await run.test('TC-ROOM-07-01', 'Preview trả đúng số sinh viên chưa có phòng và số chỗ trống', async () => {
    const dbCount = await db.collection('users').countDocuments({
      role: 'STUDENT',
      accessStatus: 'ACTIVE',
      room: { $exists: false },
    });
    const { status, body } = await api('GET', '/assignments/preview', { token: adminToken });
    assert(status === 200, `Kỳ vọng 200, nhận ${status}`);
    assert(
      body.unassignedStudents.length === dbCount,
      `Preview trả ${body.unassignedStudents.length} sinh viên, DB đếm trực tiếp ra ${dbCount}`,
    );
    const dbFreeSlots = await db
      .collection('rooms')
      .aggregate([
        { $match: { status: 'AVAILABLE', $expr: { $lt: ['$currentOccupancy', '$capacity'] } } },
        { $group: { _id: null, total: { $sum: { $subtract: ['$capacity', '$currentOccupancy'] } } } },
      ])
      .toArray();
    const expectedFreeSlots = dbFreeSlots[0]?.total || 0;
    assert(body.freeSlots === expectedFreeSlots, `freeSlots kỳ vọng ${expectedFreeSlots}, nhận ${body.freeSlots}`);
  });

  // TC-ROOM-07-02 — Xếp phòng thành công khi đủ chỗ
  await run.test('TC-ROOM-07-02', 'Chạy auto-assign xếp đúng các sinh viên test vào phòng MIXED đủ chỗ', async () => {
    const room = await createRoom(adminToken, { capacity: 5, genderType: 'MIXED' });
    const s1 = await registerStudent(db, 'AutoAssign Test One');
    const s2 = await registerStudent(db, 'AutoAssign Test Two');
    const s3 = await registerStudent(db, 'AutoAssign Test Three');

    const { status, body } = await api('POST', '/assignments/auto', { token: adminToken });
    assert(status === 201 || status === 200, `Kỳ vọng 200/201, nhận ${status}`);

    const mine = resultsFor(body.results, [s1.id, s2.id, s3.id]);
    assert(mine.length === 3, `Kỳ vọng thấy đủ 3 sinh viên test trong results, chỉ thấy ${mine.length}`);
    for (const r of mine) {
      assert(r.status === 'ASSIGNED', `Sinh viên ${r.studentName} kỳ vọng ASSIGNED, nhận ${r.status} (${r.reason || ''})`);
    }

    for (const s of [s1, s2, s3]) {
      const userDoc = await db.collection('users').findOne({ _id: new ObjectId(s.id) });
      assert(!!userDoc.room, `User ${s.email} chưa được set room sau khi assign`);
    }
  });

  // TC-ROOM-07-03 — Skip vì không có phòng hợp giới tính
  // Giả định môi trường không có phòng MIXED/FEMALE nào khác còn trống — xem ghi
  // chú đầu file. Nếu flaky trên DB đang có nhiều dữ liệu thật, chạy lại trên DB cô lập.
  await run.test('TC-ROOM-07-03', 'Sinh viên nữ bị SKIPPED khi chỉ còn phòng MALE trống', async () => {
    await createRoom(adminToken, { capacity: 2, genderType: 'MALE' });
    const s1 = await registerStudent(db, 'GenderSkip Test', 'FEMALE');

    const { body } = await api('POST', '/assignments/auto', { token: adminToken });
    const mine = resultsFor(body.results, [s1.id]);
    assert(mine.length === 1, 'Không thấy sinh viên test trong results — kiểm tra lại điều kiện $exists của room trước khi kết luận đây là lỗi thật.');
    assert(
      mine[0].status === 'SKIPPED',
      `Kỳ vọng SKIPPED (không có phòng MIXED/FEMALE nào trống trong hệ thống), nhận ${mine[0].status}. Nếu môi trường có sẵn phòng MIXED trống khác, đây là false-negative do dữ liệu môi trường, không phải bug.`,
    );
  });

  // TC-ROOM-07-04 — Không còn sinh viên chưa có phòng: đánh giá trạng thái nút UI toàn cục
  run.manual(
    'TC-ROOM-07-04',
    'Nút "Chạy phân phòng tự động" bị disable khi không còn sinh viên chưa có phòng',
    'Đây là trạng thái toàn cục của cả hệ thống — script không tự ý gán room cho toàn bộ sinh viên thật khác để ép điều kiện này (sẽ phá dữ liệu thật). Kiểm tra thủ công: khi GET /assignments/preview trả unassignedStudents rỗng, mở /admin/auto-assign và xác nhận nút bị mờ/disable.',
  );

  // TC-ROOM-07-05 — Không còn chỗ trống nào: tương tự, trạng thái toàn cục
  run.manual(
    'TC-ROOM-07-05',
    'Nút "Chạy phân phòng tự động" bị disable khi không còn chỗ trống nào',
    'Tương tự TC-04 — trạng thái toàn cục, không nên tự ý set toàn bộ phòng thật sang FULL/MAINTENANCE. Kiểm tra thủ công khi GET /assignments/preview trả freeSlots = 0.',
  );

  // TC-ROOM-07-06 — Guard chống overbooking khi chạy song song với duyệt tay (UC-ROOM-06)
  await run.test('TC-ROOM-07-06', 'Guard $expr chặn overbooking khi auto-assign và duyệt tay chạy song song trên cùng phòng', async () => {
    const room = await createRoom(adminToken, { capacity: 1, genderType: 'MALE' });
    const sAuto = await registerStudent(db, 'ZZRace AutoAssign', 'MALE');
    const sManualStudentEmail = rnd('room07manual') + '@test.local';
    const regManual = await api('POST', '/auth/register', {
      body: { email: sManualStudentEmail, password: TEST_PASSWORD, fullName: 'ZZRace Manual' },
    });
    assert(regManual.status === 200 || regManual.status === 201, 'Đăng ký sinh viên cho nhánh duyệt tay thất bại');
    const manualToken = await login(sManualStudentEmail, TEST_PASSWORD);
    const { body: bk } = await api('POST', '/bookings', { token: manualToken, body: { roomId: room._id } });
    const bookingId = bk.booking?._id || bk._id;

    const [autoRes, approveRes] = await Promise.all([
      api('POST', '/assignments/auto', { token: adminToken }),
      api('PATCH', `/bookings/${bookingId}/approve`, { token: adminToken }),
    ]);

    const finalRoom = await db.collection('rooms').findOne({ _id: new ObjectId(room._id) });
    assert(
      finalRoom.currentOccupancy <= finalRoom.capacity,
      `currentOccupancy (${finalRoom.currentOccupancy}) vượt quá capacity (${finalRoom.capacity}) — guard chống overbooking thất bại!`,
    );

    const mineAuto = resultsFor(autoRes.body?.results || [], [sAuto.id]);
    const bookingApproved = approveRes.status === 200;
    const autoAssigned = mineAuto[0]?.status === 'ASSIGNED';
    assert(
      !(bookingApproved && autoAssigned),
      'Cả 2 nhánh (duyệt tay và auto-assign) đều thành công cho cùng 1 slot cuối — đây chính là overbooking, occupancy sẽ vượt capacity.',
    );
  });

  // TC-ROOM-07-07 — Kết quả trả về đúng tên phòng cho từng sinh viên
  await run.test('TC-ROOM-07-07', 'results[].roomName khớp với room thực lưu trong Contract của đúng sinh viên', async () => {
    const room = await createRoom(adminToken, { capacity: 2, genderType: 'MIXED' });
    const s1 = await registerStudent(db, 'RoomNameCheck Test');

    const { body } = await api('POST', '/assignments/auto', { token: adminToken });
    const mine = resultsFor(body.results, [s1.id]);
    assert(mine.length === 1 && mine[0].status === 'ASSIGNED', 'Sinh viên test không được ASSIGNED — không thể kiểm tra roomName');
    assert(mine[0].roomName === room.name, `results.roomName kỳ vọng "${room.name}", nhận "${mine[0].roomName}"`);

    const contract = await db.collection('contracts').findOne({ user: new ObjectId(s1.id) });
    assert(String(contract.room) === String(room._id), 'Room trong Contract không khớp room trong response');
  });

  // TC-ROOM-07-08 — Role không đủ quyền
  await run.test('TC-ROOM-07-08', 'Student và Maintenance Staff đều bị chặn 403 khi gọi auto-assign', async () => {
    const student = await registerStudent(db, 'NoPermission Test');
    const studentEmail = student.email;
    const studentToken = await login(studentEmail, TEST_PASSWORD);

    const resStudent = await api('POST', '/assignments/auto', { token: studentToken });
    assert(resStudent.status === 403, `Student kỳ vọng 403, nhận ${resStudent.status}`);

    const resStaff = await api('POST', '/assignments/auto', { token: staffToken });
    assert(
      resStaff.status === 403,
      `MAINTENANCE_STAFF không nằm trong @Roles('ADMIN','DORMITORY_MANAGER') nên kỳ vọng 403, nhận ${resStaff.status}`,
    );
  });

  // TC-ROOM-07-09 — Thứ tự xử lý theo alphabet của fullName
  await run.test('TC-ROOM-07-09', 'Khi slot khan hiếm, sinh viên có fullName đứng trước alphabet được ưu tiên', async () => {
    const room = await createRoom(adminToken, { capacity: 2, genderType: 'FEMALE' });
    // Tiền tố ZZOrder để (gần như chắc chắn) đứng sau mọi dữ liệu thật khác khi sort theo fullName,
    // giữ đúng thứ tự tương đối A < B < C giữa 3 sinh viên test với nhau.
    const a = await registerStudent(db, 'ZZOrder A Test', 'FEMALE');
    const b = await registerStudent(db, 'ZZOrder B Test', 'FEMALE');
    const c = await registerStudent(db, 'ZZOrder C Test', 'FEMALE');

    const { body } = await api('POST', '/assignments/auto', { token: adminToken });
    const mine = resultsFor(body.results, [a.id, b.id, c.id]);
    assert(mine.length === 3, `Kỳ vọng thấy đủ 3 sinh viên, chỉ thấy ${mine.length}`);

    const byId = Object.fromEntries(mine.map((r) => [r.studentId, r.status]));
    assert(byId[a.id] === 'ASSIGNED', `"ZZOrder A Test" kỳ vọng ASSIGNED, nhận ${byId[a.id]}`);
    assert(byId[b.id] === 'ASSIGNED', `"ZZOrder B Test" kỳ vọng ASSIGNED, nhận ${byId[b.id]}`);
    assert(byId[c.id] === 'SKIPPED', `"ZZOrder C Test" kỳ vọng SKIPPED (hết 2 slot), nhận ${byId[c.id]}`);
  });

  // TC-ROOM-07-10 — Thông báo realtime khi được xếp phòng (kiểm tra bản ghi Notification trong DB)
  await run.test('TC-ROOM-07-10', 'Notification loại BOOKING được tạo trong DB cho sinh viên vừa được auto-assign', async () => {
    const room = await createRoom(adminToken, { capacity: 2, genderType: 'MIXED' });
    const s1 = await registerStudent(db, 'NotifCheck Test');

    const { body } = await api('POST', '/assignments/auto', { token: adminToken });
    const mine = resultsFor(body.results, [s1.id]);
    assert(mine[0]?.status === 'ASSIGNED', 'Sinh viên test không được ASSIGNED — không thể kiểm tra notification');

    const notif = await db.collection('notifications').findOne({ recipient: new ObjectId(s1.id), type: 'BOOKING' });
    assert(!!notif, 'Không tìm thấy Notification BOOKING cho sinh viên vừa được xếp phòng');
  });

  // TC-ROOM-07-11 — Phòng MIXED nhận cả nam lẫn nữ trong cùng 1 lượt chạy
  await run.test('TC-ROOM-07-11', 'Phòng MIXED xếp được cả sinh viên MALE và FEMALE trong cùng 1 lần chạy', async () => {
    const room = await createRoom(adminToken, { capacity: 2, genderType: 'MIXED' });
    const male = await registerStudent(db, 'ZZMixed Male Test', 'MALE');
    const female = await registerStudent(db, 'ZZMixed Female Test', 'FEMALE');

    const { body } = await api('POST', '/assignments/auto', { token: adminToken });
    const mine = resultsFor(body.results, [male.id, female.id]);
    assert(mine.length === 2, `Kỳ vọng thấy 2 sinh viên, chỉ thấy ${mine.length}`);
    for (const r of mine) {
      assert(r.status === 'ASSIGNED', `${r.studentName} kỳ vọng ASSIGNED, nhận ${r.status} (${r.reason || ''})`);
    }
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
