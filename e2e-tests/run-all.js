// e2e-tests/run-all.js
// Chạy toàn bộ 5 suite (55 test case) và in báo cáo tổng hợp cuối cùng, đúng
// định dạng để copy thẳng vào bảng "Test Execution" của
// PA5-TestPlan-and-TestCases.md.
//
// Cách chạy: node e2e-tests/run-all.js
// (bắt buộc đứng trong thư mục Domitory_Management_Backend, backend + MongoDB
// phải đang chạy sẵn ở localhost:3001 / MONGO_URI)

const { closeDb } = require('./helpers');

const suites = [
  { label: 'UC-AUTH-02', mod: require('./uc-auth-02') },
  { label: 'UC-ROOM-06', mod: require('./uc-room-06') },
  { label: 'UC-ROOM-07', mod: require('./uc-room-07') },
  { label: 'UC-FIN-02', mod: require('./uc-fin-02') },
  { label: 'UC-CHK-04', mod: require('./uc-chk-04') },
];

async function main() {
  const allResults = [];

  for (const suite of suites) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Chạy suite: ${suite.label}`);
    console.log('='.repeat(70));
    try {
      const results = await suite.mod.run();
      for (const r of results) allResults.push({ suite: suite.label, ...r });
    } catch (e) {
      console.error(`Suite ${suite.label} bị crash giữa chừng:`, e);
      allResults.push({ suite: suite.label, id: `${suite.label}-CRASH`, name: 'Suite crash', status: 'FAIL', error: e.message });
    }
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log('TỔNG KẾT — dán bảng dưới đây vào mục Test Execution của file .md');
  console.log('='.repeat(70));
  console.log('\n| Test case ID | Ngày chạy | Status | Actual result |');
  console.log('|---|---|---|---|');
  const today = new Date().toISOString().slice(0, 10);
  for (const r of allResults) {
    const status = r.status === 'PASS' ? 'Pass' : r.status === 'FAIL' ? 'Fail' : 'Manual';
    const actual = r.status === 'PASS' ? 'Đúng như kỳ vọng.' : (r.error || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    console.log(`| ${r.id} | ${today} | ${status} | ${actual} |`);
  }

  const pass = allResults.filter((r) => r.status === 'PASS').length;
  const fail = allResults.filter((r) => r.status === 'FAIL').length;
  const manual = allResults.filter((r) => r.status === 'MANUAL').length;
  console.log(
    `\nTổng: ${allResults.length} test case — ${pass} Pass / ${fail} Fail / ${manual} Manual (cần kiểm tra UI thủ công).\n`,
  );

  if (fail > 0) {
    console.log('Các test case FAIL (cần mở Bug Report tương ứng):');
    for (const r of allResults.filter((r) => r.status === 'FAIL')) {
      console.log(`  - ${r.id}: ${r.error}`);
    }
  }

  await closeDb();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error('Lỗi không mong muốn:', e);
  process.exitCode = 1;
});
