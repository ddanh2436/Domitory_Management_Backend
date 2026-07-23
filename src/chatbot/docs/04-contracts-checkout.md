# Use-Case Specifications — Group 4: Contracts & Checkout (FR14–FR21)

<!-- Performed by: <member>; Reviewed by: <member>; Edited by: <member> -->

> Diagram: see `use-case-model.md` §4. See `01-authentication-profile.md` for the shared screenshot note.

---

## UC-16 — View Contract

**Actor(s):** Student

**Description:** A student views their active rental contract, including its terms, dates, and rent.

**Preconditions:**
- The student is logged in.

**Basic Flow:**
1. Student opens `/student/contracts`.
2. Frontend calls `GET /api/contracts/my-contract`.
3. Backend finds the student's contract (any status) and returns it populated with user and room details.
4. Frontend displays contract number, dates, rent, status, and terms.

**Alternative Flows:**
- **AF1 — No contract exists yet:** the endpoint returns `null`/empty; the page shows an empty state ("Bạn chưa có hợp đồng nào").

**Postconditions:** None — read-only.

**Special Requirements:**
- The endpoint returns the most recently matched contract regardless of status (not filtered to `ACTIVE`) — ⚠ **verify:** confirm this is intentional (e.g., so a student can still see a just-terminated contract right after checkout) rather than an oversight.

---

## UC-17 — Extend Contract

**Actor(s):** Student

**Description:** A student extends the end date of their active contract by a chosen number of months.

**Preconditions:**
- The student has a `Contract(ACTIVE)`.

**Basic Flow:**
1. Student opens `/student/contracts` and clicks "Gia hạn".
2. Student chooses a number of months (1–12).
3. Frontend calls `POST /api/contracts/extend` with `{ months }`.
4. Backend validates `months` is an integer in `[1, 12]`.
5. Backend finds the student's `Contract(ACTIVE)` and adds `months` to `endDate`.
6. Updated contract is returned and shown.

**Alternative Flows:**
- **AF1 — Invalid months value (non-integer, < 1, > 12):** rejected with a validation error.
- **AF2 — No active contract found:** 404 error ("Không tìm thấy hợp đồng đang hoạt động").
- **AF3 — `months` omitted:** the controller defaults to 6 months rather than rejecting the request. ⚠ **verify with the team** whether a silent default of 6 is the intended UX, since the frontend form is expected to always send an explicit value.

**Postconditions:**
- `Contract.endDate` is extended by the requested number of months.

**Special Requirements:**
- `POST /api/contracts/extend` has **no `@Roles` restriction** in the controller — it relies entirely on `req.user.sub` to locate "my" active contract, so technically any authenticated role could call it, though only a Student would realistically hold a contract. ⚠ **TEAM DECISION:** add `@Roles('STUDENT')` explicitly for defense-in-depth, or leave as-is since the query is self-scoped?

---

## UC-18 — Terminate Contract

**Actor(s):** Student (self-service)

**Description:** A student ends their contract early outside the formal checkout process (e.g., administrative termination), releasing their room.

**Preconditions:**
- The student has a `Contract(ACTIVE)`.

**Basic Flow:**
1. Student opens `/student/contracts` and clicks "Thanh lý hợp đồng".
2. Frontend calls `POST /api/contracts/terminate`.
3. Backend finds the student's `Contract(ACTIVE)`, sets `status = TERMINATED` and `endDate = now`.
4. Backend decrements the room's `currentOccupancy` (floored at 0) and flips `status` back to `AVAILABLE` if it had been `FULL`.
5. Backend removes the `room` reference from the student's `User` document.

**Alternative Flows:**
- **AF1 — No active contract found:** 404 error.

**Postconditions:**
- Contract is `TERMINATED`; the room regains one free slot; the student no longer has a `room`.

**Special Requirements:**
- Same role-guard note as UC-17: the endpoint has no explicit `@Roles` restriction; access control relies on the query being scoped to `req.user.sub`.
- ⚠ **Overlaps with UC-22 (checkout completion):** both this use case and the checkout-completion flow terminate a contract and release a room slot, but they are implemented as **two separate code paths** (`ContractsService.terminateContract()` vs. inline logic inside `CheckoutsService.completeCheckout()`), not a shared function. **TEAM DECISION NEEDED:** decide whether direct self-service termination (this UC) should remain available once the formal checkout workflow (UC-20–UC-22) exists, since it lets a student skip the asset-inspection/deposit-refund process entirely — or whether it should be restricted/removed in favor of always going through checkout.

---

## UC-19 — Export Contract to PDF

**Actor(s):** Student

**Description:** A student downloads their contract as a PDF file for printing or record-keeping.

**Preconditions:**
- The student has a contract to export.

**Basic Flow:**
1. Student opens `/student/contracts` and clicks "Xuất PDF".
2. Frontend (`app/utils/exportPdf.ts`) renders the contract data into a PDF client-side and triggers a file download.

**Alternative Flows:**
- **AF1 — Export fails (e.g., browser blocks download):** an error toast is shown; the student can retry.

**Postconditions:** None — no server-side state changes; a file is saved to the student's device.

**Special Requirements:**
- Generation happens entirely client-side from data already fetched in UC-16; no dedicated backend PDF endpoint exists.

---

## UC-20 — Request Room Checkout

**Actor(s):** Student

**Description:** A student who wants to move out submits a checkout request with a reason and expected departure date.

**Preconditions:**
- The student currently occupies a room and has a `Contract(ACTIVE)`.
- The student has no other `Checkout(PENDING)` request.

**Basic Flow:**
1. Student opens `/student/checkout` and clicks "Yêu cầu trả phòng".
2. Student enters the expected departure date and a reason, then submits.
3. Frontend calls `POST /api/checkouts`.
4. Backend validates the date is not in the past, confirms the student has a room and an active contract, and confirms no other pending checkout exists.
5. Backend creates a `Checkout(PENDING)` with `depositAmount` defaulted to one month's rent (`Contract.rentalFee`).
6. Managers receive a realtime notification.

**Alternative Flows:**
- **AF1 — Expected date in the past:** rejected with a validation error.
- **AF2 — Student has no room / no active contract:** rejected.
- **AF3 — A pending checkout already exists:** rejected; must be cancelled first (AF4).
- **AF4 — Cancel a pending checkout:** `PATCH /api/checkouts/:id/cancel`.

**Postconditions:**
- A `Checkout(PENDING)` exists, awaiting manager processing (UC-21/UC-22).

**Special Requirements:**
- The deposit amount is a **convention**, not a real collected deposit (the system does not currently collect deposits at contract signing) — the manager can adjust it during inspection (see UC-22).

---

## UC-21 — Inspect Assets & Record Damages

**Actor(s):** System Admin, Dormitory Manager, Floor Manager

**Description:** As part of completing a checkout, the manager records any damaged items found in the room and their compensation fee.

**Preconditions:**
- A `Checkout(PENDING)` exists.

**Basic Flow:**
1. Manager opens `/admin/checkouts` and clicks "Kiểm tra & hoàn tất" on a pending request.
2. For each damaged item found, manager adds a row: item name, fee (VND), optional note.
3. Manager may adjust the deposit amount if it differs from the one-month-rent default.
4. The modal live-computes: total compensation (sum of item fees) and the resulting refund (`max(0, deposit − compensation)`).
5. Manager proceeds to UC-22 to confirm and submit.

**Alternative Flows:**
- **AF1 — No damage found:** manager adds zero items; compensation is 0 and the full deposit is refunded.
- **AF2 — Manager removes a previously added row:** the row is discarded before submission; no server call has happened yet at this stage.

**Postconditions:** None yet — this step is purely client-side preparation; the checkout is not saved until UC-22's confirmation.

**Special Requirements:**
- Item name and fee are required per row; fee must be a non-negative integer (VND, no decimals).

---

## UC-22 — Complete Checkout & Refund Deposit

**Actor(s):** System Admin, Dormitory Manager, Floor Manager

**Description:** The manager finalizes a checkout: damages and deposit adjustments from UC-21 are persisted, the compensation and refund are computed, the contract is terminated, and the room slot is released — all atomically.

**Preconditions:**
- A `Checkout(PENDING)` exists with the damage list prepared (UC-21).

**Basic Flow:**
1. Manager reviews the computed refund amount in the confirmation dialog and confirms.
2. Frontend calls `PATCH /api/checkouts/:id/complete` with the damage list, (optionally adjusted) deposit amount, and an optional admin note.
3. Backend, inside a MongoDB transaction:
   a. Sets `Checkout.status = COMPLETED`, stores `damages[]`, `depositAmount`, `compensationAmount` (sum of fees), `refundAmount` (`max(0, deposit − compensation)`), and `processedAt`.
   b. Sets the linked `Contract.status = TERMINATED` and `endDate = now`.
   c. Decrements the room's `currentOccupancy` (floored at 0) and flips `status` back to `AVAILABLE` if it had been `FULL`.
   d. Removes the `room` reference from the student's `User` document.
4. After the transaction commits, the student receives a realtime notification stating the compensation charged and the amount refunded.

**Alternative Flows:**
- **AF1 — Any step in the transaction fails:** the entire transaction aborts; `Checkout` remains `PENDING` and no partial state (contract, room, user) is changed.
- **AF2 — Manager rejects the checkout instead** *(alternative entry point, not a continuation of UC-21)*: see UC-23 below is unrelated; rejection is `PATCH /api/checkouts/:id/reject`, optionally with an `adminNote`; `Checkout.status = REJECTED`; the student is notified; no contract/room changes occur.

**Postconditions:**
- `Checkout(COMPLETED)` with full financial breakdown recorded; `Contract(TERMINATED)`; room has one more free slot; student no longer occupies the room.

**Special Requirements:**
- Notifications are sent **after** the transaction commits, so a notification failure never rolls back the already-committed business changes.
- ⚠ **Maintainability note (see UC-18):** this use case duplicates contract-termination and room-release logic independently from `ContractsService.terminateContract()` rather than calling it. If the termination business rule changes in the future, both code paths must be updated together.

---

## UC-23 — Remind Expiring Contracts *(system-triggered)*

**Actor(s):** System (scheduler)

**Description:** A daily cron job proactively reminds students whose contract is about to expire, so they can extend it (UC-17) before it lapses.

**Preconditions:**
- At least one `Contract(ACTIVE)` has an `endDate` within the next 7 days.

**Basic Flow:**
1. Every day at 8:00 AM, the scheduler runs `ContractsService.remindExpiringContracts()`.
2. System finds all `Contract(ACTIVE)` with `endDate` between now and 7 days from now, where `lastReminderAt` is unset or older than 3 days.
3. For each matching contract, the system sends a realtime notification to the student stating how many days remain, and sets `lastReminderAt = now`.

**Alternative Flows:**
- **AF1 — Notification send fails for one contract:** the failure is logged; the job continues processing the remaining contracts rather than aborting the whole batch.
- **AF2 — No contracts are currently expiring:** the job completes with zero reminders sent and no log entry.

**Postconditions:**
- Affected contracts have an updated `lastReminderAt`; students have received a notification.

**Special Requirements:**
- The 3-day cooldown per contract prevents sending the same reminder every single day during the 7-day window.
