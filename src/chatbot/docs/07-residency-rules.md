# Use-Case Specifications — Group 7: Residency Rules & Conduct (FR25, FR29–FR30)

<!-- Performed by: <member>; Reviewed by: <member>; Edited by: <member> -->

> Diagram: see `use-case-model.md` §7. See `01-authentication-profile.md` for the shared screenshot note.

---

## UC-36 — Declare Overnight Absence

**Actor(s):** Student

**Description:** A student declares either their own overnight absence from the dormitory (`TAM_VANG`) or an overnight guest staying with them (`TAM_TRU`), so Floor/Dormitory Managers can track temporary residence/absence for security and legal compliance.

**Preconditions:**
- The student is logged in and has a room assigned.
- The student has no other declaration currently `PENDING`.

**Basic Flow:**
1. Student opens `/student/absences` and selects a declaration type: "Tạm vắng" (I will be away overnight) or "Tạm trú" (a guest will stay overnight).
2. Student enters a start date, end date, and reason; for "Tạm trú", also the guest's full name and ID number.
3. Frontend calls `POST /api/absences`.
4. Backend validates the type, reason, and date range (end ≥ start, start not in the past); for `TAM_TRU`, it also requires `guestName` and `guestIdNumber`.
5. Backend creates an `Absence(PENDING)` and notifies all managers in realtime.

**Alternative Flows:**
- **AF1 — Missing guest details on a `TAM_TRU` declaration:** rejected ("Vui lòng nhập họ tên/CCCD của khách tạm trú").
- **AF2 — End date before start date, or start date in the past:** rejected.
- **AF3 — Student has no room:** rejected.
- **AF4 — A pending declaration already exists:** rejected; must cancel it first (AF5).
- **AF5 — Cancel a pending declaration:** `PATCH /api/absences/:id/cancel`.

**Postconditions:**
- An `Absence(PENDING)` exists, awaiting manager review (UC-37).

**Special Requirements:**
- Only one declaration type is submitted per request — a student cannot combine a "tạm vắng" and a "tạm trú" into a single submission; each is a separate declaration.

---

## UC-37 — Approve / Reject Absence Declaration

**Actor(s):** System Admin, Dormitory Manager, Floor Manager

**Description:** A manager reviews pending temporary-residence/absence declarations and approves or rejects them.

**Preconditions:**
- An `Absence(PENDING)` exists.

**Basic Flow:**
1. Manager opens `/admin/absences` and reviews the pending list, populated with the requesting student's name/MSSV and room.
2. Manager clicks "Duyệt".
3. Backend sets `status = APPROVED`, `processedAt = now`, and notifies the student.

**Alternative Flows:**
- **AF1 — Reject:** Manager clicks "Từ chối"; `status = REJECTED`; the student is notified that the declaration was not approved.
- **AF2 — Declaration no longer pending** (e.g., the student cancelled it moments earlier): the approve/reject call returns 404.

**Postconditions:**
- `Absence.status` becomes `APPROVED` or `REJECTED`; `processedAt` is set.

**Special Requirements:**
- Approval/rejection does not currently generate any downstream record (e.g., there is no separate "occupancy log" beyond the `Absence` document itself) — the approved/rejected declaration list **is** the tracking record referenced by FR25.

---

## UC-38 — Record Rule Violation

**Actor(s):** System Admin, Dormitory Manager

**Description:** A manager records that a student violated a dormitory rule and specifies how many conduct points to deduct.

**Preconditions:**
- The actor holds `ADMIN` or `DORMITORY_MANAGER` (`FLOOR_MANAGER` may only view violations — see UC-40's actor note).
- The target account exists and has `role = STUDENT`.

**Basic Flow:**
1. Manager opens a student's profile or the violations screen and clicks "Ghi nhận vi phạm".
2. Manager enters the reason (max 300 characters) and the number of points to deduct (integer, 1–100).
3. Frontend calls `POST /api/violations` with `{ studentId, reason, points }`.
4. Backend verifies the target is a `STUDENT`, then (UC-39, always performed as part of this flow) deducts the points from the student's `behaviorScore`, floored at 0, and records the violation with a snapshot of the resulting score (`scoreAfter`).
5. The student is notified of the point deduction and their new score.

**Alternative Flows:**
- **AF1 — Target student not found:** 404 error.
- **AF2 — Target account is not a Student** (e.g., trying to record a violation against a staff account): rejected.
- **AF3 — Points value out of range (< 1 or > 100) or non-integer:** rejected by DTO validation.
- **AF4 — Reason empty or exceeds 300 characters:** rejected by DTO validation.

**Postconditions:**
- A new `Violation` record exists, linked to the student and the manager who recorded it (`markedBy`); the student's `behaviorScore` is reduced (never below 0).

**Special Requirements:**
- `FLOOR_MANAGER` can view violation history (`GET /violations/student/:id`) but **cannot** create a violation — only `ADMIN`/`DORMITORY_MANAGER` may call `POST /violations`.

---

## UC-39 — Deduct Conduct Points *(included by UC-38)*

**Actor(s):** System (invoked as part of UC-38; not independently triggerable)

**Description:** Whenever a violation is recorded, the student's conduct score is automatically recalculated and floored at zero.

**Preconditions:** A violation is being recorded (UC-38 in progress).

**Basic Flow:**
1. System reads the student's current `behaviorScore` (defaulting to 100 if somehow unset).
2. System computes `scoreAfter = max(0, currentScore − points)`.
3. System persists the new `behaviorScore` on the `User` document and stores `scoreAfter` on the `Violation` record as a historical snapshot.

**Alternative Flows:**
- **AF1 — Deduction would take the score below 0:** the score is floored at 0 rather than going negative.

**Postconditions:**
- `User.behaviorScore` reflects the cumulative effect of all violations to date (floored at 0); each `Violation` retains the score *at the time it was recorded*, so history is never rewritten by later violations.

**Special Requirements:**
- There is currently no mechanism to **restore** points (e.g., for good behavior over time) — `behaviorScore` only ever decreases. ⚠ **TEAM DECISION:** is a point-recovery mechanic (as hinted by spec.md FR30 "hệ thống điểm rèn luyện") in scope for a future iteration?

---

## UC-40 — View Own Violations & Conduct Score

**Actor(s):** Student

**Description:** A student reviews their own violation history and current conduct score.

**Preconditions:**
- The student is logged in.

**Basic Flow:**
1. Student opens `/student/profile` (or a dedicated violations view).
2. Frontend calls `GET /api/violations/me`.
3. System returns every violation recorded against the student, newest first, each with its reason, points deducted, and the resulting score at that time.
4. The student's current `behaviorScore` (visible on their profile, from `GET /users/profile`) reflects the latest cumulative deduction.

**Alternative Flows:**
- **AF1 — No violations on record:** the list is empty and the score remains at the default 100 (or whatever baseline was set).

**Postconditions:** None — read-only.

**Special Requirements:**
- The `markedBy` manager's identity is **not** exposed to the student in `getMyViolations` (no `.populate('markedBy', ...)` in that query path, unlike the manager-facing `getViolationsByStudent`) — ⚠ **verify this is an intentional privacy choice** rather than an oversight.
