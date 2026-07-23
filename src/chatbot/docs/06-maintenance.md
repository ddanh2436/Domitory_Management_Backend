# Use-Case Specifications — Group 6: Maintenance (FR26–FR28)

<!-- Performed by: <member>; Reviewed by: <member>; Edited by: <member> -->

> Diagram: see `use-case-model.md` §6. See `01-authentication-profile.md` for the shared screenshot note.

---

## UC-31 — Report Incident (Photo + Priority)

**Actor(s):** Student

**Description:** A student reports a facility issue in their room, optionally attaching a photo and indicating its priority.

**Preconditions:**
- The student is logged in and has a room assigned.

**Basic Flow:**
1. Student opens `/student/maintenance` and clicks "Báo cáo sự cố".
2. Student enters a title, description, priority (`LOW`/`MEDIUM`/`HIGH`/`URGENT`), and optionally attaches a photo.
3. Frontend calls `POST /api/maintenance` (multipart, field `image`).
4. Backend validates the file is an image (≤ 5 MB) and, if Cloudinary is configured, uploads it and stores the returned URL.
5. Backend creates a `Maintenance(PENDING)` request tied to the student's room.
6. Every `ADMIN` account receives a realtime notification.

**Alternative Flows:**
- **AF1 — Student has no room:** rejected ("Bạn chưa được xếp phòng...").
- **AF2 — Non-image file attached:** rejected by the file filter (400) before upload is attempted.
- **AF3 — Cloudinary not configured on the server:** if a photo was provided, the upload step throws an `InternalServerErrorException`; ⚠ **verify:** confirm whether the report can still be submitted text-only when Cloudinary is unavailable, or whether the whole request fails.
- **AF4 — No photo attached:** the request proceeds normally with `imageUrl` left undefined.

**Postconditions:**
- A `Maintenance(PENDING)` request exists, visible to managers (UC-32) and to the student's own history.

**Special Requirements:**
- Notifications for new requests currently go to **`ADMIN` only**, not `DORMITORY_MANAGER`/`FLOOR_MANAGER` — ⚠ **verify this is intentional**, since the assignment step (UC-32) is available to both `ADMIN` and `DORMITORY_MANAGER`.

---

## UC-32 — Assign Request to Staff

**Actor(s):** System Admin, Dormitory Manager

**Description:** A manager reviews incoming maintenance requests and assigns one to a specific maintenance staff member.

**Preconditions:**
- A `Maintenance(PENDING)` request exists.
- At least one active `MAINTENANCE_STAFF` account exists.

**Basic Flow:**
1. Manager opens `/admin/maintenance` and reviews the request list (sorted by status, then newest first).
2. Manager selects a staff member from `GET /api/users/maintenance-staff` and clicks "Phân công".
3. Frontend calls `PATCH /api/maintenance/:id/assign` with `{ staffId }`.
4. Backend validates the target user has `role = MAINTENANCE_STAFF`, sets `Maintenance.assignedTo`, and notifies the staff member in realtime.

**Alternative Flows:**
- **AF1 — Target user is not a maintenance-staff account:** rejected with a validation error.
- **AF2 — Reassigning an already-assigned request to a different staff member:** ⚠ **verify:** confirm the current staff member is properly notified of the reassignment (or at least that the previous assignee's view updates) since `assignRequest` simply overwrites `assignedTo`.

**Postconditions:**
- `Maintenance.assignedTo` is set (or changed); the staff member sees it in "Công việc của tôi" (UC-33).

**Special Requirements:** None beyond role restriction.

---

## UC-33 — View Assigned Jobs

**Actor(s):** Maintenance Staff

**Description:** A staff member sees every maintenance request assigned to them, filterable by status and searchable by keyword, with realtime updates when new work arrives.

**Preconditions:**
- The staff member is logged in.

**Basic Flow:**
1. Staff opens `/staff` (their dashboard).
2. Frontend calls `GET /api/maintenance/assigned/me`.
3. Dashboard shows summary tiles (total assigned, pending, in progress, completed, average rating) and two sections: "Cần xử lý" (pending/in-progress) and "Đã xong" (resolved/rejected).
4. Staff narrows the list using the status filter tabs or the search box (matches title, description, or room name).
5. When a `MAINTENANCE`-type notification arrives via Socket.IO (e.g., a new assignment), the list refreshes automatically without a manual reload.

**Alternative Flows:**
- **AF1 — No jobs assigned yet:** an empty state explains that assigned work will appear once a manager assigns it.
- **AF2 — Filter/search yields no matches:** a distinct empty state is shown ("Không có công việc nào khớp bộ lọc").

**Postconditions:** None — read-only.

**Special Requirements:**
- The realtime refresh listens for `newNotification` events of `type = MAINTENANCE`; any other notification type is ignored for the purpose of auto-refresh.

---

## UC-34 — Update Repair Progress

**Actor(s):** Maintenance Staff (own assignments only); System Admin, Dormitory Manager (any request)

**Description:** The assigned staff member (or a manager) moves a request through its lifecycle: Pending → In Progress → Resolved (or Rejected).

**Preconditions:**
- The request is assigned to the acting staff member, or the actor is a manager.

**Basic Flow:**
1. Staff opens a card in "Cần xử lý" and clicks "Tiếp nhận sửa chữa" (Pending → In Progress) or "Hoàn thành" (In Progress → Resolved), confirming in a dialog.
2. Frontend calls `PATCH /api/maintenance/:id/status` with the new status.
3. Backend validates the status value against the allowed enum.
4. If the actor is `MAINTENANCE_STAFF`, backend verifies `Maintenance.assignedTo` matches the actor; otherwise rejects with 403.
5. Backend updates `status`; if transitioning to `RESOLVED` for the first time, it also records `resolvedAt` and notifies the student to rate the repair (UC-35).

**Alternative Flows:**
- **AF1 — Staff attempts to update a request assigned to someone else:** rejected (403 "Bạn chỉ có thể cập nhật yêu cầu được phân công cho mình").
- **AF2 — Invalid status value:** rejected by validation.
- **AF3 — Marking `RESOLVED` a request that is already `RESOLVED`:** the update still succeeds but `resolvedAt` is **not** overwritten and the "please rate" notification is **not** re-sent, preventing notification spam on repeated updates.
- **AF4 — Manager marks a request `REJECTED`** (e.g., duplicate/invalid report): allowed for `ADMIN`/`DORMITORY_MANAGER`/`MAINTENANCE_STAFF` alike; no rating notification is sent for this transition.

**Postconditions:**
- `Maintenance.status` updated; `resolvedAt` set on first resolution.

**Special Requirements:**
- Realtime status changes are what UC-33's auto-refresh (student side too, via the dashboard's activity feed) reacts to.

---

## UC-35 — Rate Completed Repair (1–5 Stars) *(extends UC-34)*

**Actor(s):** Student

**Description:** After a repair is marked resolved, the student who filed it rates the service quality.

**Preconditions:**
- The request belongs to the rating student.
- `Maintenance.status === RESOLVED`.
- The request has not been rated yet.

**Basic Flow:**
1. Student opens `/student/maintenance`, finds the resolved request, and selects a 1–5 star rating.
2. Frontend calls `PATCH /api/maintenance/:id/rate` with `{ rating }`.
3. Backend validates the rating is an integer 1–5, the request belongs to the student, is `RESOLVED`, and has not already been rated.
4. Backend stores `rating` and `ratedAt`, then notifies every `ADMIN` of the new rating.

**Alternative Flows:**
- **AF1 — Not the request's owner:** rejected (403).
- **AF2 — Request not yet resolved:** rejected ("Chỉ đánh giá được yêu cầu đã hoàn thành sửa chữa").
- **AF3 — Already rated:** rejected ("Yêu cầu này đã được đánh giá trước đó") — ratings cannot be changed once submitted.
- **AF4 — Invalid rating value (not 1–5, non-integer):** rejected by validation.

**Postconditions:**
- `Maintenance.rating` and `ratedAt` are set; the value feeds into the staff member's average-rating tile (UC-33).

**Special Requirements:**
- Ratings are immutable once set — there is currently no "edit my rating" flow.
