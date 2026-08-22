// e2e-tests/uc-auth-02.js
// Tự động test UC-AUTH-02 — Log In (11 test case: TC-AUTH-02-01 .. 11)
//
// Cách chạy riêng file này: node e2e-tests/uc-auth-02.js
// (hoặc chạy chung qua node e2e-tests/run-all.js)
//
// LƯU Ý VỀ 3 TÀI KHOẢN SEED CÓ SẴN: script này giả định e2e-seed.js đã tạo:
//   e2e.admin@test.local  / E2Etest123  (role ADMIN)
//   e2e.staff@test.local  / E2Etest123  (role MAINTENANCE_STAFF)
// Nếu email/mật khẩu thật trong máy bạn khác, sửa 2 hằng số SEEDED_ADMIN /
// SEEDED_STAFF bên dưới cho khớp. Các case còn lại tự đăng ký tài khoản mới,
// không phụ thuộc dữ liệu seed nên chạy lại nhiều lần vẫn an toàn.

const { getDb, closeDb, api, login, rnd, assert, createRunner } = require('./helpers');

const SEEDED_ADMIN = { identifier: 'e2e.admin@test.local', password: 'E2Etest123' };
const SEEDED_STAFF = { identifier: 'e2e.staff@test.local', password: 'E2Etest123' };
const TEST_PASSWORD = 'Test@12345';

async function run() {
  const run = createRunner('UC-AUTH-02 — Log In');
  const db = await getDb();

  // ─── Chuẩn bị: đăng ký 1 sinh viên test riêng cho suite này ───────────────
  const email = rnd('auth02') + '@test.local';
  const mssv = rnd('MSSV');
  const fullName = 'Auth Test Student';
  const reg = await api('POST', '/auth/register', {
    body: { email, password: TEST_PASSWORD, fullName, mssv },
  });
  assert(reg.status === 201 || reg.status === 200, `Đăng ký thất bại: ${JSON.stringify(reg.body)}`);

  // TC-AUTH-02-01 — Login thành công bằng email
  await run.test('TC-AUTH-02-01', 'Login thành công bằng email hợp lệ', async () => {
    const { status, body } = await api('POST', '/auth/login', {
      body: { identifier: email, password: TEST_PASSWORD },
    });
    assert(status === 200, `Kỳ vọng 200, nhận ${status}`);
    assert(!!body?.access_token, 'Thiếu access_token trong response');
    assert(body?.user?.role === 'STUDENT', `Kỳ vọng role STUDENT, nhận ${body?.user?.role}`);
  });

  // TC-AUTH-02-02 — Login thành công bằng MSSV
  await run.test('TC-AUTH-02-02', 'Login thành công bằng MSSV thay vì email', async () => {
    const { status, body } = await api('POST', '/auth/login', {
      body: { identifier: mssv, password: TEST_PASSWORD },
    });
    assert(status === 200, `Kỳ vọng 200, nhận ${status}`);
    assert(!!body?.access_token, 'Thiếu access_token trong response');
  });

  // TC-AUTH-02-03 — Sai mật khẩu
  await run.test('TC-AUTH-02-03', 'Login thất bại khi sai mật khẩu', async () => {
    const { status, body } = await api('POST', '/auth/login', {
      body: { identifier: email, password: 'SaiMatKhau123' },
    });
    assert(status === 401, `Kỳ vọng 401, nhận ${status}`);
    assert(
      (body?.message || '').includes('Sai mật khẩu'),
      `Message không đúng: ${JSON.stringify(body)}`,
    );
  });

  // TC-AUTH-02-04 — Identifier không tồn tại
  await run.test('TC-AUTH-02-04', 'Login thất bại khi identifier không tồn tại', async () => {
    const { status, body } = await api('POST', '/auth/login', {
      body: { identifier: 'khong-ton-tai-' + rnd('x') + '@test.local', password: TEST_PASSWORD },
    });
    assert(status === 401, `Kỳ vọng 401, nhận ${status}`);
    assert(
      (body?.message || '').includes('Sai thông tin đăng nhập'),
      `Message không đúng: ${JSON.stringify(body)}`,
    );
  });

  // TC-AUTH-02-05 — Tài khoản bị khóa
  await run.test('TC-AUTH-02-05', 'Login thất bại khi tài khoản bị khóa', async () => {
    await db.collection('users').updateOne(
      { email },
      { $set: { accessStatus: 'LOCKED', blockReason: 'Vi phạm nội quy' } },
    );
    try {
      const { status, body } = await api('POST', '/auth/login', {
        body: { identifier: email, password: TEST_PASSWORD },
      });
      assert(status === 401, `Kỳ vọng 401, nhận ${status}`);
      assert(
        (body?.message || '').includes('Vi phạm nội quy'),
        `Message không chứa lý do khóa: ${JSON.stringify(body)}`,
      );
    } finally {
      // Mở khóa lại ngay để không ảnh hưởng các test case sau
      await db.collection('users').updateOne(
        { email },
        { $set: { accessStatus: 'ACTIVE' }, $unset: { blockReason: '' } },
      );
    }
  });

  // TC-AUTH-02-06 — Login Admin (phần redirect /admin phải xác nhận thêm bằng UI)
  await run.test('TC-AUTH-02-06', 'Login Admin trả về đúng role ADMIN (redirect UI xác nhận thủ công)', async () => {
    const { status, body } = await api('POST', '/auth/login', { body: SEEDED_ADMIN });
    assert(status === 200, `Kỳ vọng 200, nhận ${status}. Kiểm tra lại SEEDED_ADMIN có đúng tài khoản seed thật không.`);
    assert(body?.user?.role === 'ADMIN', `Kỳ vọng role ADMIN, nhận ${body?.user?.role}`);
  });

  // TC-AUTH-02-07 — Login Staff (MAINTENANCE_STAFF -> /staff theo code frontend thật)
  await run.test('TC-AUTH-02-07', 'Login Maintenance Staff trả về đúng role (redirect /staff xác nhận thủ công)', async () => {
    const { status, body } = await api('POST', '/auth/login', { body: SEEDED_STAFF });
    assert(status === 200, `Kỳ vọng 200, nhận ${status}. Kiểm tra lại SEEDED_STAFF có đúng tài khoản seed thật không.`);
    assert(
      body?.user?.role === 'MAINTENANCE_STAFF',
      `Kỳ vọng role MAINTENANCE_STAFF, nhận ${body?.user?.role}`,
    );
  });

  // TC-AUTH-02-08 — Password rỗng
  await run.test('TC-AUTH-02-08', 'Login thất bại khi password rỗng (validation)', async () => {
    const { status } = await api('POST', '/auth/login', {
      body: { identifier: email, password: '' },
    });
    assert(status === 400, `Kỳ vọng 400, nhận ${status}`);
  });

  // TC-AUTH-02-09 — Identifier dị dạng, không được crash 500
  await run.test('TC-AUTH-02-09', 'Login với identifier dị dạng không gây lỗi 500', async () => {
    const { status } = await api('POST', '/auth/login', {
      body: { identifier: 'abc@@@invalid', password: TEST_PASSWORD },
    });
    assert(status !== 500, `Không được trả 500, thực tế nhận ${status}`);
    assert(status === 401, `Kỳ vọng 401 (not found), nhận ${status}`);
  });

  // TC-AUTH-02-10 — Khóa tài khoản giữa phiên phải chặn ngay request tiếp theo
  await run.test('TC-AUTH-02-10', 'Khóa tài khoản giữa phiên chặn request kế tiếp dù JWT còn hạn', async () => {
    const token = await login(email, TEST_PASSWORD);
    const before = await api('GET', '/bookings/me', { token });
    assert(before.status === 200, `Trước khi khóa phải gọi API được (200), nhận ${before.status}`);

    await db.collection('users').updateOne({ email }, { $set: { accessStatus: 'LOCKED' } });
    try {
      const after = await api('GET', '/bookings/me', { token });
      assert(
        after.status === 401,
        `Sau khi khóa phải bị chặn (401) dù JWT cũ còn hạn, thực tế nhận ${after.status}`,
      );
    } finally {
      await db.collection('users').updateOne({ email }, { $set: { accessStatus: 'ACTIVE' } });
    }
  });

  // TC-AUTH-02-11 — Google OAuth: không automate được (cần token Google thật)
  run.manual(
    'TC-AUTH-02-11',
    'Login lần đầu bằng Google tự tạo tài khoản mới',
    'Cần 1 ID token Google thật để gọi POST /auth/google — không thể giả lập bằng script. Test thủ công qua UI: /login > "Đăng nhập với Google" > dùng email Google chưa từng đăng ký > xác nhận redirect /student và có User mới trong DB.',
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
