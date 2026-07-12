// E2E test toÃ n bá»™ flow nghiá»‡p vá»¥ qua API tháº­t (backend localhost:3001)
const API = "http://localhost:3001/api";
const PASSWORD = "E2Etest123";

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "âœ… PASS" : "âŒ FAIL"} â€” ${name}${detail ? ` (${detail})` : ""}`);
}

async function api(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, data };
}

async function login(email) {
  const r = await api("POST", "/auth/login", null, { identifier: email, password: PASSWORD });
  return r.data?.access_token;
}

async function main() {
  // â”€â”€ 1. ÄÄƒng nháº­p 3 vai trÃ² â”€â”€
  const admin = await login("e2e.admin@test.local");
  const staff = await login("e2e.staff@test.local");
  const student = await login("e2e.student@test.local");
  record("ÄÄƒng nháº­p 3 vai trÃ² (admin/staff/student)", !!(admin && staff && student));
  if (!admin || !staff || !student) throw new Error("KhÃ´ng Ä‘Äƒng nháº­p Ä‘Æ°á»£c, dá»«ng E2E");

  // Láº¥y id 2 phÃ²ng test
  const roomsRes = await api("GET", "/rooms?limit=100", admin);
  const allRooms = roomsRes.data?.data || roomsRes.data || [];
  const room101 = allRooms.find((r) => r.name === "E2E-101");
  const room102 = allRooms.find((r) => r.name === "E2E-102");
  record("Danh sÃ¡ch phÃ²ng chá»©a 2 phÃ²ng E2E", !!(room101 && room102));

  // â”€â”€ 2. Äáº·t phÃ²ng â†’ duyá»‡t â†’ há»£p Ä‘á»“ng â”€â”€
  const bookRes = await api("POST", "/bookings", student, { roomId: room101._id });
  record("Sinh viÃªn Ä‘áº·t phÃ²ng E2E-101", bookRes.ok, bookRes.data?.message);

  const bookingsRes = await api("GET", "/bookings", admin);
  const myBooking = (bookingsRes.data || []).find(
    (b) => b.status === "PENDING" && b.user?.email === "e2e.student@test.local",
  );
  record("Admin tháº¥y Ä‘Æ¡n PENDING cá»§a sinh viÃªn E2E", !!myBooking);

  const approveRes = await api("PATCH", `/bookings/${myBooking._id}/approve`, admin);
  record("Admin duyá»‡t Ä‘Æ¡n Ä‘áº·t phÃ²ng", approveRes.ok, approveRes.data?.message);

  const contractRes = await api("GET", "/contracts/my-contract", student);
  const contract = contractRes.data;
  record("Há»£p Ä‘á»“ng tá»± sinh sau khi duyá»‡t, Ä‘Ãºng phÃ²ng E2E-101", contract?.room?.name === "E2E-101", contract?.contractNumber);

  const profileRes = await api("GET", "/users/profile", student);
  record("Profile sinh viÃªn Ä‘Ã£ gáº¯n phÃ²ng E2E-101", profileRes.data?.room?.name === "E2E-101");

  // â”€â”€ 3. Sinh hÃ³a Ä‘Æ¡n hÃ ng loáº¡t theo chá»‰ sá»‘ Ä‘iá»‡n nÆ°á»›c â”€â”€
  const due = new Date(Date.now() + 7 * 86400000).toISOString();
  const bulkRes = await api("POST", "/invoices/generate-bulk", admin, {
    month: 1, year: 2099, dueDate: due,
    electricityUnitPrice: 3500, waterUnitPrice: 15000,
    readings: [{ roomId: room101._id, electricityKwh: 100, waterM3: 10 }],
  });
  record("Sinh hÃ³a Ä‘Æ¡n hÃ ng loáº¡t (100 kWh + 10 mÂ³)", bulkRes.ok && bulkRes.data?.created === 1, bulkRes.data?.message);

  const bulkDupRes = await api("POST", "/invoices/generate-bulk", admin, {
    month: 1, year: 2099, dueDate: due,
    electricityUnitPrice: 3500, waterUnitPrice: 15000,
    readings: [{ roomId: room101._id, electricityKwh: 100, waterM3: 10 }],
  });
  record("Cháº¡y láº¡i cÃ¹ng ká»³ â†’ tá»± bá» qua phÃ²ng Ä‘Ã£ cÃ³ hÃ³a Ä‘Æ¡n", bulkDupRes.data?.created === 0 && bulkDupRes.data?.skipped === 1);

  const invListRes = await api("GET", `/invoices/room/${room101._id}`, student);
  const invoice = (invListRes.data || []).find((i) => i.year === 2099);
  const expectedTotal = 500000 + 100 * 3500 + 10 * 15000;
  record("Tá»•ng hÃ³a Ä‘Æ¡n tÃ­nh Ä‘Ãºng (phÃ²ng + Ä‘iá»‡n + nÆ°á»›c)", invoice?.totalAmount === expectedTotal, `${invoice?.totalAmount} = ${expectedTotal}`);

  const payRes = await api("PATCH", `/invoices/${invoice._id}/pay-mock`, student);
  record("Sinh viÃªn thanh toÃ¡n hÃ³a Ä‘Æ¡n (mock)", payRes.ok);

  // â”€â”€ 4. Äá»•i phÃ²ng â”€â”€
  const transferRes = await api("POST", "/transfers", student, { toRoomId: room102._id, reason: "E2E: kiá»ƒm thá»­ Ä‘á»•i phÃ²ng" });
  record("Sinh viÃªn gá»­i yÃªu cáº§u Ä‘á»•i phÃ²ng sang E2E-102", transferRes.ok, transferRes.data?.message);

  const transferDup = await api("POST", "/transfers", student, { toRoomId: room102._id, reason: "E2E trÃ¹ng" });
  record("Cháº·n táº¡o yÃªu cáº§u Ä‘á»•i phÃ²ng thá»© 2 khi Ä‘ang chá» duyá»‡t", transferDup.status === 400);

  const transfersRes = await api("GET", "/transfers", admin);
  const myTransfer = (transfersRes.data || []).find((t) => t.status === "PENDING" && t.user?.email === "e2e.student@test.local");
  const approveTransfer = await api("PATCH", `/transfers/${myTransfer._id}/approve`, admin);
  record("Admin duyá»‡t Ä‘á»•i phÃ²ng", approveTransfer.ok, approveTransfer.data?.message);

  const profileAfter = await api("GET", "/users/profile", student);
  record("Sinh viÃªn Ä‘Ã£ chuyá»ƒn sang phÃ²ng E2E-102", profileAfter.data?.room?.name === "E2E-102");

  const contractAfter = await api("GET", "/contracts/my-contract", student);
  record("Há»£p Ä‘á»“ng Ä‘i theo phÃ²ng má»›i + giÃ¡ má»›i (800k)", contractAfter.data?.room?.name === "E2E-102" && contractAfter.data?.rentalFee === 800000);

  // â”€â”€ 5. Táº¡m trÃº / táº¡m váº¯ng â”€â”€
  const t0 = new Date(); const t1 = new Date(Date.now() + 2 * 86400000);
  const absRes = await api("POST", "/absences", student, {
    type: "TAM_TRU", startDate: t0.toISOString(), endDate: t1.toISOString(),
    reason: "E2E: kiá»ƒm thá»­ táº¡m trÃº", guestName: "E2E KhÃ¡ch", guestIdNumber: "099999999999",
  });
  record("Sinh viÃªn gá»­i Ä‘Æ¡n táº¡m trÃº kÃ¨m thÃ´ng tin khÃ¡ch", absRes.ok, absRes.data?.message);

  const absBad = await api("POST", "/absences", student, {
    type: "TAM_VANG", startDate: "2020-01-01", endDate: "2020-01-02", reason: "E2E quÃ¡ khá»©",
  });
  record("Cháº·n Ä‘Æ¡n cÃ³ ngÃ y báº¯t Ä‘áº§u trong quÃ¡ khá»©", absBad.status === 400);

  const absList = await api("GET", "/absences", admin);
  const myAbs = (absList.data || []).find((a) => a.status === "PENDING" && a.user?.email === "e2e.student@test.local");
  const approveAbs = await api("PATCH", `/absences/${myAbs._id}/approve`, admin);
  record("Admin duyá»‡t Ä‘Æ¡n táº¡m trÃº", approveAbs.ok);

  // â”€â”€ 6. Báº£o trÃ¬: táº¡o â†’ phÃ¢n cÃ´ng â†’ nhÃ¢n viÃªn xá»­ lÃ½ â†’ Ä‘Ã¡nh giÃ¡ â”€â”€
  const mtRes = await api("POST", "/maintenance", student, {
    title: "E2E: bÃ³ng Ä‘Ã¨n há»ng", description: "E2E kiá»ƒm thá»­ flow báº£o trÃ¬", priority: "HIGH",
  });
  record("Sinh viÃªn táº¡o yÃªu cáº§u báº£o trÃ¬", mtRes.ok, mtRes.data?.message);
  const requestId = mtRes.data?.request?._id;

  const staffEarly = await api("PATCH", `/maintenance/${requestId}/status`, staff, { status: "IN_PROGRESS" });
  record("NhÃ¢n viÃªn KHÃ”NG Ä‘Æ°á»£c cáº­p nháº­t viá»‡c chÆ°a phÃ¢n cÃ´ng (403)", staffEarly.status === 403);

  const staffProfile = await api("GET", "/users/profile", staff);
  const assignRes = await api("PATCH", `/maintenance/${requestId}/assign`, admin, { staffId: staffProfile.data?._id });
  record("Admin phÃ¢n cÃ´ng cho nhÃ¢n viÃªn báº£o trÃ¬", assignRes.ok, assignRes.data?.message);

  const assignedList = await api("GET", "/maintenance/assigned/me", staff);
  record("NhÃ¢n viÃªn tháº¥y viá»‡c trong danh sÃ¡ch Ä‘Æ°á»£c giao", (assignedList.data || []).some((r) => r._id === requestId));

  const s1 = await api("PATCH", `/maintenance/${requestId}/status`, staff, { status: "IN_PROGRESS" });
  const s2 = await api("PATCH", `/maintenance/${requestId}/status`, staff, { status: "RESOLVED" });
  record("NhÃ¢n viÃªn tiáº¿p nháº­n â†’ hoÃ n thÃ nh viá»‡c Ä‘Æ°á»£c giao", s1.ok && s2.ok);

  const rateRes = await api("PATCH", `/maintenance/${requestId}/rate`, student, { rating: 5 });
  record("Sinh viÃªn Ä‘Ã¡nh giÃ¡ 5 sao sau khi hoÃ n thÃ nh", rateRes.ok);

  // â”€â”€ 7. ThÃ´ng bÃ¡o: phÃ¢n trang + Ä‘Ã¡nh dáº¥u Ä‘Ã£ Ä‘á»c â”€â”€
  const notifRes = await api("GET", "/notifications/me?page=1&limit=5", student);
  const notifData = notifRes.data;
  record("API thÃ´ng bÃ¡o tráº£ vá» dáº¡ng phÃ¢n trang + unreadCount", Array.isArray(notifData?.data) && typeof notifData?.unreadCount === "number", `unread=${notifData?.unreadCount}, total=${notifData?.total}`);
  record("Sinh viÃªn cÃ³ nháº­n Ä‘Æ°á»£c thÃ´ng bÃ¡o tá»« cÃ¡c flow trÃªn", (notifData?.total ?? 0) > 0);

  const readAll = await api("PATCH", "/notifications/read-all", student);
  const notifAfter = await api("GET", "/notifications/me?page=1&limit=1", student);
  record("ÄÃ¡nh dáº¥u táº¥t cáº£ Ä‘Ã£ Ä‘á»c â†’ unreadCount vá» 0", readAll.ok && notifAfter.data?.unreadCount === 0);

  const historyRes = await api("GET", "/notifications/broadcast/history", admin);
  record("Admin xem Ä‘Æ°á»£c lá»‹ch sá»­ thÃ´ng bÃ¡o chung", historyRes.ok && Array.isArray(historyRes.data));

  // â”€â”€ 8. Báº£o máº­t: phÃ¢n quyá»n + reset password â”€â”€
  const studentSeesAll = await api("GET", "/bookings", student);
  record("Sinh viÃªn bá»‹ cháº·n xem danh sÃ¡ch Ä‘Æ¡n cá»§a admin (403)", studentSeesAll.status === 403);

  const staffSeesInvoices = await api("GET", "/invoices?limit=5", staff);
  record("NhÃ¢n viÃªn báº£o trÃ¬ bá»‹ cháº·n xem hÃ³a Ä‘Æ¡n (403)", staffSeesInvoices.status === 403);

  const badToken = await api("POST", "/auth/reset-password", null, { token: "deadbeef".repeat(8), newPassword: "hack1234" });
  record("Token Ä‘áº·t láº¡i máº­t kháº©u giáº£ bá»‹ tá»« chá»‘i (400)", badToken.status === 400);

  const noAuth = await fetch(`${API}/users/profile`);
  record("Gá»i API khÃ´ng cÃ³ token bá»‹ cháº·n (401)", noAuth.status === 401);

  // â”€â”€ Tá»•ng káº¿t â”€â”€
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n===== Káº¾T QUáº¢: ${passed}/${results.length} PASS =====`);
  if (passed < results.length) {
    console.log("CÃ¡c bÆ°á»›c FAIL:");
    results.filter((r) => !r.ok).forEach((r) => console.log(` - ${r.name} ${r.detail}`));
    process.exit(1);
  }
}

main().catch((e) => { console.error("E2E_ABORT:", e.message); process.exit(1); });

