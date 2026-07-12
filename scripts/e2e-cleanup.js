// Dá»n sáº¡ch dá»¯ liá»‡u E2E: má»i báº£n ghi gáº¯n vá»›i tÃ i khoáº£n e2e.* vÃ  phÃ²ng tÃ²a E2E
const BACKEND = require("path").resolve(__dirname, "..");
require(`${BACKEND}/node_modules/dotenv`).config({ path: `${BACKEND}/.env` });
const mongoose = require(`${BACKEND}/node_modules/mongoose`);

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const users = await db.collection("users").find({ email: /^e2e\./ }).toArray();
  const userIds = users.map((u) => u._id);
  const rooms = await db.collection("rooms").find({ building: "E2E" }).toArray();
  const roomIds = rooms.map((r) => r._id);

  const out = {};
  out.notifications = (await db.collection("notifications").deleteMany({
    $or: [{ recipient: { $in: userIds } }, { message: /E2E/ }],
  })).deletedCount;
  out.maintenance = (await db.collection("maintenances").deleteMany({ user: { $in: userIds } })).deletedCount;
  out.transfers = (await db.collection("transfers").deleteMany({ user: { $in: userIds } })).deletedCount;
  out.absences = (await db.collection("absences").deleteMany({ user: { $in: userIds } })).deletedCount;
  out.invoices = (await db.collection("invoices").deleteMany({ room: { $in: roomIds } })).deletedCount;
  out.contracts = (await db.collection("contracts").deleteMany({ user: { $in: userIds } })).deletedCount;
  out.bookings = (await db.collection("bookings").deleteMany({ user: { $in: userIds } })).deletedCount;
  out.rooms = (await db.collection("rooms").deleteMany({ building: "E2E" })).deletedCount;
  out.users = (await db.collection("users").deleteMany({ email: /^e2e\./ })).deletedCount;

  console.log("CLEANUP_OK:", JSON.stringify(out));
  await mongoose.disconnect();
}

main().catch((e) => { console.error("CLEANUP_FAIL:", e.message); process.exit(1); });

