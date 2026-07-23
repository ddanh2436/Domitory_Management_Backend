# Use-Case Specifications — Group 5: Finance (FR22–FR24)

<!-- Performed by: <member>; Reviewed by: <member>; Edited by: <member> -->

> Diagram: see `use-case-model.md` §5. See `01-authentication-profile.md` for the shared screenshot note.

---

## UC-24 — Create Invoice / Bulk-Generate by Meter Readings

**Actor(s):** System Admin, Dormitory Manager

**Description:** A manager creates a monthly invoice for a room, either individually or in bulk for many rooms at once using electricity/water meter readings.

**Preconditions:**
- The actor holds `ADMIN` or `DORMITORY_MANAGER`.

**Basic Flow (single invoice):**
1. Manager opens `/admin/invoices` and creates a single invoice for a room, specifying month, year, room fee, electricity fee, water fee, and due date.
2. Frontend calls `POST /api/invoices`.
3. Backend computes `totalAmount` and creates the `Invoice(PENDING)`, guarded by the unique index on `(room, month, year)`.

**Alternative Flows:**
- **AF1 (extends) — Bulk generation:** Manager instead provides `month`, `year`, `dueDate`, `electricityUnitPrice`, `waterUnitPrice`, and a list of `{ roomId, electricityKwh, waterM3 }` readings; frontend calls `POST /api/invoices/generate-bulk`; the backend computes each room's electricity/water fee from the unit price × consumption and creates one invoice per room in the list.
- **AF2 — Duplicate invoice for the same room/month/year:** rejected by the unique index (`ConflictException`).
- **AF3 — Invalid numeric input (negative fee, non-numeric reading):** rejected by DTO validation.

**Postconditions:**
- One or more `Invoice(PENDING)` documents exist for the target room(s)/period.

**Special Requirements:**
- The unique index `(room, month, year)` is the authoritative guard against duplicate billing for the same period, even under concurrent bulk-generation calls.

---

## UC-25 — View & Pay Invoice (Mock Gateway)

**Actor(s):** Student

**Description:** A student views their room's invoices and pays one via the mock payment gateway.

**Preconditions:**
- The student is logged in and belongs to a room with at least one invoice.

**Basic Flow:**
1. Student opens `/student/invoices`.
2. Frontend calls `GET /api/invoices/room/:roomId` (allowed for the room's own students as well as managers).
3. Student selects a `PENDING` or `OVERDUE` invoice and proceeds to `/student/payment/[id]`.
4. Student confirms payment; frontend calls `PATCH /api/invoices/:id/pay-mock`.
5. Backend verifies the invoice belongs to the requesting student's room, sets `status = PAID`, `paidAt = now`, and sends payment-confirmation notifications.

**Alternative Flows:**
- **AF1 — Invoice already paid:** the pay action is unavailable/rejected; the UI only offers payment for `PENDING`/`OVERDUE` invoices.
- **AF2 — Student attempts to pay an invoice for a room they do not belong to:** rejected by the role/ownership check in `getInvoicesByRoom`/`mockPay`.

**Postconditions:**
- `Invoice.status = PAID`, `paidAt` set.

**Special Requirements:**
- This is a **mock** payment gateway — no real payment provider (VNPay/MoMo/ZaloPay) is integrated; see the Backlog in `spec.md`.

---

## UC-26 — Mark Invoice as Paid (Manual)

**Actor(s):** System Admin, Dormitory Manager

**Description:** A manager manually marks an invoice as paid, for cases where payment was collected outside the mock gateway (e.g., cash, bank transfer confirmed offline).

**Preconditions:**
- The invoice exists and is not already `PAID`.

**Basic Flow:**
1. Manager opens `/admin/invoices`, finds the target invoice.
2. Manager clicks "Đánh dấu đã thanh toán".
3. Frontend calls `PATCH /api/invoices/:id/pay`.
4. Backend sets `status = PAID`, `paidAt = now`, and sends the same payment notifications as UC-25.

**Alternative Flows:**
- **AF1 — Invoice not found:** 404 error.

**Postconditions:**
- `Invoice.status = PAID`.

**Special Requirements:** None beyond role restriction.

---

## UC-27 — View Debt Summary by Room

**Actor(s):** System Admin, Dormitory Manager

**Description:** A manager sees, at a glance, which rooms currently have unpaid invoices, how much is owed, and who lives there.

**Preconditions:**
- The actor holds `ADMIN` or `DORMITORY_MANAGER`.

**Basic Flow:**
1. Manager opens `/admin/debts`.
2. Frontend calls `GET /api/invoices/debts`.
3. Backend aggregates all `PENDING`/`OVERDUE` invoices grouped by room: total debt, count of unpaid invoices, count of overdue invoices, and the oldest due date; joins in the room's name/building/floor and the list of current student occupants.
4. Dashboard shows overview tiles (total debt, rooms in debt, unpaid/overdue invoice counts) plus a per-room table.

**Alternative Flows:**
- **AF1 — No rooms currently owe anything:** the table shows a positive empty state ("tài chính sạch sẽ").
- **AF2 — A debt room currently has no occupants** (e.g., student moved out without settling): the occupant column shows "Phòng trống — nợ tồn đọng" and the reminder action is disabled for that row (there is no one to notify).

**Postconditions:** None — read-only.

**Special Requirements:** None.

---

## UC-28 — Send Debt Reminders *(extends UC-27)*

**Actor(s):** System Admin, Dormitory Manager

**Description:** From the debt summary, a manager sends a reminder notification to the students of one indebted room, or to all indebted rooms at once.

**Preconditions:**
- At least one room appears in the debt summary (UC-27).

**Basic Flow (single room):**
1. Manager clicks "Nhắc nợ" on a room's row.
2. Frontend calls `POST /api/invoices/debts/:roomId/remind`.
3. Backend re-confirms the room still has unpaid invoices, computes the total owed, and sends a realtime notification to every student currently in that room.

**Alternative Flows:**
- **AF1 (extends) — Remind all:** Manager clicks "Nhắc nợ tất cả" and confirms; frontend calls `POST /api/invoices/debts/remind-all`; the backend repeats the single-room flow for every room in the current debt summary and reports how many rooms/students were notified.
- **AF2 — Room no longer has any unpaid invoices** (e.g., paid between page load and the reminder click): the reminder call returns a 404 ("Phòng này không còn hóa đơn nợ nào").
- **AF3 — Room has no occupants:** the remind button is disabled (see UC-27/AF2); calling it anyway would notify zero students.

**Postconditions:** None persisted — a notification is sent; no invoice/debt state changes.

**Special Requirements:**
- A reminder failure for one student (e.g., notification delivery error) does not stop reminders from being sent to the room's other occupants, nor does it stop "remind all" from proceeding to the next room.

---

## UC-29 — View Revenue Report

**Actor(s):** System Admin

**Description:** The admin views a chart of actual collected revenue (paid invoices only) broken down by room fee, electricity, and water, over the last several months.

**Preconditions:**
- The actor holds `ADMIN`.

**Basic Flow:**
1. Admin opens `/admin` (dashboard) or another page embedding the revenue chart.
2. Frontend calls `GET /api/invoices/stats/revenue`.
3. Backend aggregates `Invoice(PAID)` documents grouped by month/year, summing room/electricity/water fees, and returns the most recent 6 periods.
4. Dashboard renders a Recharts stacked/grouped chart.

**Alternative Flows:**
- **AF1 — Fewer than 6 months of paid invoices exist:** the chart simply shows however many periods are available.
- **AF2 — No paid invoices at all:** the chart renders empty.

**Postconditions:** None — read-only.

**Special Requirements:**
- This endpoint is restricted to `ADMIN` only (unlike most of the dashboard, which `DORMITORY_MANAGER` can also view) — ⚠ **verify this restriction is intentional.**
- Only `PAID` invoices count toward revenue; `PENDING`/`OVERDUE` invoices are excluded, so the chart reflects cash actually collected, not billed.

---

## UC-30 — Mark Overdue Invoices *(system-triggered, with manual override)*

**Actor(s):** System (scheduler); System Admin / Dormitory Manager (manual trigger)

**Description:** Invoices whose due date has passed without payment are automatically flagged as overdue and their room's students are notified; a manager can also trigger this check on demand instead of waiting for the daily job.

**Preconditions:**
- At least one `Invoice(PENDING)` has a `dueDate` in the past (or, if `dueDate` is unset, belongs to a prior month/year).

**Basic Flow (automatic):**
1. A daily cron job runs `markOverdueInvoices()`.
2. System finds every `Invoice(PENDING)` whose due date has passed (or, lacking a due date, whose billing period is before the current month/year).
3. For each match, the system sets `status = OVERDUE`, `overdueAt = now`.
4. System notifies every student in the invoice's room that their bill is overdue, stating the amount and original due date.

**Alternative Flows:**
- **AF1 (extends) — Manual trigger:** a manager clicks "Cập nhật quá hạn" on `/admin/invoices`; frontend calls `POST /api/invoices/trigger-overdue`, running the exact same logic on demand instead of waiting for the next scheduled run.
- **AF2 — Notification fails for one room's students:** the failure is logged and does not stop the remaining invoices in the batch from being processed.
- **AF3 — No invoices are currently past due:** the job/endpoint completes with `updated: 0, notified: 0`.

**Postconditions:**
- Matching invoices become `OVERDUE`; affected students are notified.

**Special Requirements:**
- Marking overdue also makes the invoice count toward the debt summary (UC-27)'s `overdueCount`.
