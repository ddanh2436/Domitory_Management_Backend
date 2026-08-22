// e2e-tests/helpers.js
// Thư viện dùng chung cho toàn bộ script test tự động (không cần cài thêm package
// nào — dùng đúng `mongodb` driver đã có sẵn trong node_modules của backend, và
// `fetch` built-in của Node >= 18).
//
// Chạy MỌI script trong thư mục này từ bên trong Domitory_Management_Backend, ví dụ:
//   node e2e-tests/run-all.js
// vì `require('mongodb')` phân giải theo node_modules của thư mục hiện tại.

const { MongoClient, ObjectId } = require('mongodb');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001/api';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dormify';

let client;
async function getDb() {
  if (!client) {
    client = new MongoClient(MONGO_URI);
    await client.connect();
  }
  return client.db();
}

async function closeDb() {
  if (client) {
    await client.close();
    client = undefined;
  }
}

// Gọi API backend, tự thêm Authorization nếu có token, tự parse JSON nếu có.
async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch (_) {
    // Một số response không có body (ví dụ lỗi mạng) — bỏ qua, giữ json = null.
  }
  return { status: res.status, body: json };
}

async function login(identifier, password) {
  const { status, body } = await api('POST', '/auth/login', {
    body: { identifier, password },
  });
  if (status !== 200 || !body?.access_token) {
    throw new Error(
      `Login thất bại cho "${identifier}": HTTP ${status} — ${JSON.stringify(body)}`,
    );
  }
  return body.access_token;
}

// Sinh chuỗi ngẫu nhiên để tạo dữ liệu test không đụng nhau giữa các lần chạy.
function rnd(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

// Test runner rất tối giản: mỗi use case tự tạo 1 runner riêng (không dùng chung
// biến toàn cục), gọi run.test(...) cho case tự động hoá được, run.manual(...)
// cho case bắt buộc kiểm tra thủ công qua UI (ví dụ: nút bị disable, thông báo
// realtime, luồng OAuth). Cuối file gọi run.summary() để in tổng kết.
function createRunner(ucLabel) {
  const results = [];

  async function test(id, name, fn) {
    try {
      await fn();
      results.push({ id, name, status: 'PASS' });
      console.log(`  PASS  ${id} — ${name}`);
    } catch (e) {
      results.push({ id, name, status: 'FAIL', error: e.message });
      console.log(`  FAIL  ${id} — ${name}`);
      console.log(`        -> ${e.message}`);
    }
  }

  function manual(id, name, note) {
    results.push({ id, name, status: 'MANUAL', error: note });
    console.log(`  MANUAL ${id} — ${name}`);
    console.log(`        -> ${note}`);
  }

  function summary() {
    const pass = results.filter((r) => r.status === 'PASS').length;
    const fail = results.filter((r) => r.status === 'FAIL').length;
    const manualCount = results.filter((r) => r.status === 'MANUAL').length;
    console.log(
      `\n${ucLabel}: ${pass} PASS / ${fail} FAIL / ${manualCount} MANUAL (tổng ${results.length} test case)\n`,
    );
    return results;
  }

  return { test, manual, summary, results };
}

module.exports = {
  getDb,
  closeDb,
  api,
  login,
  rnd,
  assert,
  createRunner,
  ObjectId,
  BASE_URL,
  MONGO_URI,
};
