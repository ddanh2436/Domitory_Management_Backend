# Use-Case Specifications — Group 3: Room Booking & Allocation (FR09–FR13)

<!-- Performed by: <member>; Reviewed by: <member>; Edited by: <member> -->

> Diagram: see `use-case-model.md` §3. See `01-authentication-profile.md` for the shared screenshot note.

---

## UC-09 — Manage Room Catalog (CRUD)

**Actor(s):** System Admin, Dormitory Manager

**Description:** A manager maintains the list of dormitory rooms: creating, editing, deleting, and marking rooms under maintenance.

**Preconditions:**
- The actor holds `ADMIN` or `DORMITORY_MANAGER`.

**Basic Flow:**
1. Manager opens `/admin/rooms`.
2. Manager clicks "Thêm phòng" and fills in name, building, floor, capacity, price, facilities, and gender type.
3. Frontend calls `POST /api/rooms`.
4. Backend validates the DTO and creates the `Room` document (`status = AVAILABLE` by default).
5. Manager edits an existing room (e.g., changes price or facilities) via `PATCH /api/rooms/:id`.
6. Manager marks a room under maintenance by setting `status = MAINTENANCE`.

**Alternative Flows:**
- **AF1 — Duplicate room name:** the unique index on `Room.name` rejects the creation/update with a conflict error.
- **AF2 — Delete a room:** Manager calls `DELETE /api/rooms/:id`. ⚠ **verify:** confirm whether deleting a room with `currentOccupancy > 0` or active contracts is blocked, since no explicit guard was found in the read portion of `rooms.service.ts` — this could silently orphan `User.room` / `Contract.room` references.
- **AF3 — Room capacity reduced below current occupancy:** ⚠ **verify:** confirm `update` rejects a `capacity` value lower than the room's current `currentOccupancy`.

**Postconditions:**
- The `rooms` collection reflects the change; `RoomSchema`'s `pre('save')` hook keeps `status` (`AVAILABLE`/`FULL`) consistent with `currentOccupancy` vs. `capacity`.

**Special Requirements:**
- `genderType` (`MALE`/`FEMALE`/`MIXED`) exists on the schema and is used by UC-13 (auto-assignment), but the create/edit room form does not yet expose an input for it — all rooms default to `MIXED` until the UI is extended. ⚠ **documented gap, see spec.md backlog.**

---

## UC-10 — Manage Student Records

**Actor(s):** System Admin, Dormitory Manager, Floor Manager

**Description:** A manager views the full student roster and edits a student's core identity data.

**Preconditions:**
- The actor holds a management role (`ADMIN`, `DORMITORY_MANAGER`, or `FLOOR_MANAGER` for viewing; only `ADMIN` may edit via `PATCH /users/:id`).

**Basic Flow:**
1. Manager opens `/admin/students`.
2. Frontend calls `GET /api/users/students`, listing every student with room/contract summary.
3. Manager opens a specific student's detail to review booking/transfer/absence/violation history.
4. Admin edits core fields (full name, phone, CCCD, avatar) via `PATCH /api/users/:id`.

**Alternative Flows:**
- **AF1 — Non-Admin manager attempts to edit:** `PATCH /api/users/:id` is `ADMIN`-only; a `DORMITORY_MANAGER`/`FLOOR_MANAGER` request is rejected by `RolesGuard` (403).
- **AF2 — Editing a student who has a pending self-service request** (e.g., a pending transfer or checkout): no special restriction exists; the edit proceeds independently of pending requests.

**Postconditions:**
- The targeted `User` document's fields are updated.

**Special Requirements:**
- Same underlying service method (`updateProfile`) is shared with the student's own self-service profile edit (UC-03) but reached through a different, `ADMIN`-only route (`PATCH /users/:id` vs. `PATCH /users/profile`) — both apply the same field whitelist (`fullName`, `phone`, `cccd`, `avatar`).

---

## UC-11 — Search & Book a Room

**Actor(s):** Student

**Description:** A student without a room searches available rooms by filters and submits a booking request.

**Preconditions:**
- The student is logged in and does not currently occupy a room.

**Basic Flow:**
1. Student opens `/student/rooms` and applies filters (building, floor, price range).
2. Frontend calls `GET /api/rooms` with the filter query, returning `AVAILABLE` rooms with remaining capacity.
3. Student opens a room's detail page (`/student/rooms/[id]`).
4. Student submits a booking request from `/student/book-room`.
5. Frontend calls `POST /api/bookings` with the chosen `roomId`.
6. Backend creates a `Booking` document with `status = PENDING`.

**Alternative Flows:**
- **AF1 — Student already has a room:** the booking request is rejected — a student with an assigned room cannot create a new booking.
- **AF2 — Room fills up between viewing and submitting:** the guarded creation logic detects the race and rejects the booking with an error asking the student to pick another room.
- **AF3 — Student cancels their own pending booking:** `PATCH /api/bookings/:id/cancel`.

**Postconditions:**
- A `Booking(PENDING)` exists, awaiting a manager's decision (UC-12).

**Special Requirements:** None beyond the guards above.

---

## UC-12 — Approve / Reject Booking

**Actor(s):** System Admin, Dormitory Manager, Floor Manager

**Description:** A manager reviews pending booking requests and approves or rejects them, with approval creating the student's first contract.

**Preconditions:**
- At least one `Booking(PENDING)` exists.

**Basic Flow:**
1. Manager opens `/admin/bookings` and reviews the pending list.
2. Manager clicks "Duyệt" (Approve).
3. Backend, in a transaction, increments `Room.currentOccupancy`, sets `Booking.status = APPROVED`, calls `ContractsService.createContractFromBooking()` to generate a numbered contract, and sets `User.room`.
4. Student receives a realtime notification.

**Alternative Flows:**
- **AF1 — Reject:** Manager clicks "Từ chối"; `Booking.status = REJECTED`; the student is notified; no room/contract changes occur.
- **AF2 — Room fills concurrently:** a second approval racing against this one fails the guarded occupancy update; the transaction aborts, the manager sees an error, and must pick a different room/booking.

**Postconditions:**
- Approved: `Booking(APPROVED)`, `Room.currentOccupancy` incremented, a new `Contract(ACTIVE)`, `User.room` set.
- Rejected: `Booking(REJECTED)`, no other state changes.

**Special Requirements:**
- The approval path runs inside a MongoDB transaction so the booking status, room occupancy, and contract creation either all succeed or all roll back together.

---

## UC-13 — Run Automatic Room Assignment

**Actor(s):** System Admin, Dormitory Manager

**Description:** A manager bulk-assigns every student who has no room yet into available rooms, matching gender where the room type requires it — typically used at the start of a semester.

**Preconditions:**
- The actor holds `ADMIN` or `DORMITORY_MANAGER`.
- At least one student has no `room` assigned.

**Basic Flow:**
1. Manager opens `/admin/auto-assign`.
2. Frontend calls `GET /api/assignments/preview`, showing the count of unassigned students, available rooms, and total free slots.
3. Manager clicks "Chạy phân phòng tự động" and confirms in the dialog.
4. Frontend calls `POST /api/assignments/auto`.
5. Backend iterates unassigned students in name order; for each, it finds the first room whose `genderType` is `MIXED` or matches the student's `gender`, with remaining capacity.
6. For each match: backend increments the room's occupancy (guarded), creates a `Booking(APPROVED)`, calls `createContractFromBooking()`, sets `User.room`, and sends a realtime notification.
7. Backend returns a per-student results table (assigned room, or skipped with a reason) plus summary counts.

**Alternative Flows:**
- **AF1 — No compatible room for a student:** gender mismatch or no remaining capacity anywhere suitable → the student is listed as `SKIPPED` with a human-readable reason.
- **AF2 — A room fills mid-run due to a concurrent process:** the guarded update fails for that specific assignment; the student is marked `SKIPPED` and the run continues with the next student rather than aborting.
- **AF3 — Confirmation dialog cancelled:** no request is sent; no state changes.
- **AF4 — Zero unassigned students or zero free slots:** the "Run" button is disabled and an informational note explains why.

**Postconditions:**
- Zero or more students are newly assigned rooms with bookings and contracts; unmatched students remain unassigned for a future run.

**Special Requirements:**
- Requires `User.gender` and `Room.genderType`; the UI to input a student's/room's gender does not yet exist (see spec.md backlog) — until it does, every room defaults to `MIXED` and effectively accepts any student.
- Guarded occupancy updates (`$expr: currentOccupancy < capacity`) make the operation safe even if run concurrently with manual booking approvals or transfers.

---

## UC-14 — Request Room Transfer

**Actor(s):** Student

**Description:** A student who already has a room requests to move to a different one.

**Preconditions:**
- The student currently occupies a room.
- The student has no other `Transfer(PENDING)` request.

**Basic Flow:**
1. Student opens `/student/transfers` and sees their current room.
2. Student selects a target room (must have remaining capacity and not be under maintenance) and enters a reason.
3. Frontend calls `POST /api/transfers`.
4. Backend validates the target differs from the current room, the target has capacity, and no pending transfer already exists, then creates a `Transfer(PENDING)`.
5. Managers receive a realtime notification.

**Alternative Flows:**
- **AF1 — Student has no room:** the request is rejected ("Bạn chưa được xếp phòng...").
- **AF2 — Target room equals current room:** rejected.
- **AF3 — A pending transfer already exists:** rejected; the student must cancel it first (AF4).
- **AF4 — Cancel a pending transfer:** `PATCH /api/transfers/:id/cancel`.

**Postconditions:**
- A `Transfer(PENDING)` exists, awaiting a manager decision (UC-15), or is set to `CANCELLED`.

**Special Requirements:** None beyond the guards above.

---

## UC-15 — Approve / Reject Transfer

**Actor(s):** System Admin, Dormitory Manager, Floor Manager

**Description:** A manager reviews a pending transfer request and, if approved, moves the student and updates their contract to the new room's price.

**Preconditions:**
- A `Transfer(PENDING)` exists.

**Basic Flow:**
1. Manager opens `/admin/transfers`.
2. Manager clicks "Duyệt".
3. Backend, in a transaction: increments the target room's occupancy (guarded), decrements the source room's occupancy (floored at 0), sets `User.room` to the target, and updates the student's active `Contract.room` + `Contract.rentalFee` to the target room's price.
4. Student receives a realtime notification with the new room's details.

**Alternative Flows:**
- **AF1 — Reject:** `Transfer.status = REJECTED`; the student is notified; no data changes.
- **AF2 — Target room fills concurrently:** the guarded update fails; the whole transaction aborts with an error and the manager must retry against a different room.

**Postconditions:**
- Approved: both rooms' occupancy updated, `User.room` changed, active contract's room/price updated.
- Rejected: transfer closed, no other changes.

**Special Requirements:**
- Wrapped in a MongoDB transaction across two room documents, the user document, and the contract document for atomicity.
