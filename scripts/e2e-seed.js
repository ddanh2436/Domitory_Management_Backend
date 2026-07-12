// Seed dá»¯ liá»‡u E2E: 3 tÃ i khoáº£n test + 2 phÃ²ng test (Ä‘Ã¡nh dáº¥u báº±ng tiá»n tá»‘ E2E)
const BACKEND = require("path").resolve(__dirname, "..");
require(`${BACKEND}/node_modules/dotenv`).config({ path: `${BACKEND}/.env` });
const mongoose = require(`${BACKEND}/node_modules/mongoose`);
const bcrypt = require(`${BACKEND}/node_modules/bcrypt`);

const PASSWORD = "E2Etest123";

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const hash = await bcrypt.hash(PASSWORD, 10);

  const users = [
    { email: "e2e.admin@test.local", fullName: "E2E Quáº£n Trá»‹", role: "ADMIN" },
    { email: "e2e.staff@test.local", fullName: "E2E NhÃ¢n ViÃªn Báº£o TrÃ¬", role: "MAINTENANCE_STAFF" },
    { email: "e2e.student@test.local", fullName: "E2E Sinh ViÃªn", role: "STUDENT", mssv: "E2E0001" },
  ];
  for (const u of users) {
    await db.collection("users").updateOne(
      { email: u.email },
      {
        $set: { ...u, passwordHash: hash, accessStatus: "ACTIVE", behaviorScore: 100, isTempResident: false },
        $unset: { room: 1 },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
  }

  const rooms = [
    { name: "E2E-101", building: "E2E", floor: 1, capacity: 2, price: 500000 },
    { name: "E2E-102", building: "E2E", floor: 2, capacity: 2, price: 800000 },
  ];
  for (const r of rooms) {
    await db.collection("rooms").updateOne(
      { name: r.name },
      { $set: { ...r, currentOccupancy: 0, status: "AVAILABLE", facilities: ["E2E Test"] } },
      { upsert: true },
    );
  }

  console.log("SEED_OK");
  await mongoose.disconnect();
}

main().catch((e) => { console.error("SEED_FAIL:", e.message); process.exit(1); });

