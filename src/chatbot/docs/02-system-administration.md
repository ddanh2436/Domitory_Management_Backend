# Use-Case Specifications — Group 2: System Administration (FR04–FR08)

<!-- Performed by: <member>; Reviewed by: <member>; Edited by: <member> -->

> Diagram: see `use-case-model.md` §2. See `01-authentication-profile.md` for the shared screenshot note.

---

## UC-04 — Lock / Unlock / Delete User Account

**Actor(s):** System Admin, Dormitory Manager (lock/unlock only — see Special Requirements)

**Description:** A manager restricts, restores, or permanently removes a user account.

**Preconditions:**
- The actor is logged in with `ADMIN` or `DORMITORY_MANAGER` role (delete requires `ADMIN`).
- The target account exists.

**Basic Flow (Lock):**
1. Manager opens the account list (`/admin/permissions` or `/admin/students`).
2. Manager selects "Khóa tài khoản" on a target user and enters a reason.
3. Frontend calls `PATCH /api/users/:id/block` with `{ reason }`.
4. Backend rejects the call if `reason` is empty (`BadRequestException`).
5. Backend sets `accessStatus = LOCKED` and stores `blockReason`, then saves.
6. The account is now blocked; its next authenticated request will be rejected by `JwtAuthGuard`.

**Alternative Flows:**
- **AF1 — Unlock:** Manager selects "Mở khóa"; frontend calls `PATCH /api/users/:id/unblock`; backend resets `accessStatus = ACTIVE` and clears `blockReason`.
- **AF2 — Delete (Admin only):** Admin selects "Xóa tài khoản"; frontend calls `DELETE /api/users/:id`; backend permanently removes the `User` document. ⚠ **verify:** confirm whether deletion is blocked/cascaded when the user still has an active room/contract/booking, or whether it silently leaves orphaned references (`Room.occupants`, `Contract.user`, etc.).
- **AF3 — Missing block reason:** at step 4, the request is rejected with 400 and the manager must supply a reason before retrying.
- **AF4 — Actor tries to lock/delete their own account or another Admin:** ⚠ **TEAM DECISION NEEDED** — no guard currently prevents an Admin from locking/deleting themselves or another Admin. Decide whether this should be restricted.

**Postconditions:**
- Lock/Unlock: `accessStatus` updated; enforced starting from the account's next API call.
- Delete: the `User` document no longer exists.

**Special Requirements:**
- Only `ADMIN` may call `DELETE /:id` and the generic `PATCH /:id` (used to edit any user's core fields — see UC-10); `ADMIN` and `DORMITORY_MANAGER` may both block/unblock. `FLOOR_MANAGER` cannot perform any of these actions.
- Locking takes effect immediately on the next request because `JwtAuthGuard` re-reads `accessStatus` from the database rather than trusting the JWT payload.

---

## UC-05 — Manage Roles & Access Control

**Actor(s):** System Admin

**Description:** The admin views every account's role and access status, and can reassign a user to a different role among the five fixed roles.

**Preconditions:**
- The actor is `ADMIN`.

**Basic Flow:**
1. Admin opens `/admin/permissions`.
2. Frontend calls `GET /api/users/access-control`, listing every account with its current `role` and `accessStatus`.
3. Admin selects a user and changes their `role` (e.g., promotes a Student to `FLOOR_MANAGER`).
4. Frontend calls `PATCH /api/users/:id`.
5. Backend validates the new role against the `USER_ROLES` enum and saves.

**Alternative Flows:**
- **AF1 — Invalid role value:** the schema-level enum constraint rejects any value outside `USER_ROLES`; the update fails with a validation error.

**Postconditions:**
- `user.role` is updated; the user's next login (or next JWT refresh) reflects the new role-based menu/permissions.

**Special Requirements:**
- 🔶 **Partially implemented.** There is no dynamic `Role`/`Permission` collection — the five roles (`STUDENT`, `ADMIN`, `DORMITORY_MANAGER`, `FLOOR_MANAGER`, `MAINTENANCE_STAFF`) are hardcoded in `USER_ROLES`, and every endpoint's access is hardcoded via `@Roles(...)` decorators. **TEAM DECISION NEEDED:** is building true dynamic RBAC (custom roles + a permission matrix UI) required for this submission, or is documenting the current fixed-role model as the intended design acceptable? This determines whether FR05 should be built out further before grading.

---

## UC-06 — View System Audit Logs

**Actor(s):** System Admin

**Description:** The admin reviews a chronological record of every data-mutating action performed on the system: who did it, what it was, when, and the result.

**Preconditions:**
- The actor is `ADMIN`.
- At least one mutating request has occurred since the audit-log module was deployed (logs only exist going forward, not retroactively).

**Basic Flow:**
1. Admin opens `/admin/audit-logs`.
2. Frontend calls `GET /api/audit-logs?page=1&limit=25`.
3. Backend (global `AuditLogInterceptor`, populated on every `POST`/`PATCH`/`PUT`/`DELETE` request) returns a paginated, most-recent-first list joined with the acting user's name/email/role.
4. Admin reviews the table: timestamp, actor, action label (e.g., "Cập nhật — Trả phòng"), HTTP method, path, status code, IP address.
5. Admin navigates pages using "Trước"/"Sau".

**Alternative Flows:**
- **AF1 (extends, UC-06a) — Search / filter:** Admin types a keyword (matched against path, action, actor email, or role via a case-insensitive regex) or selects a method filter (`POST`/`PATCH`/`PUT`/`DELETE`); the frontend resends the request with `search`/`method` query params and resets to page 1.
- **AF2 — No results match the filter:** the table shows an empty state ("Không có bản ghi nào khớp bộ lọc").
- **AF3 — Underlying request failed (e.g., 400/404/500):** the log entry is still recorded, with the actual error status code, because logging happens in both the success and error paths of the interceptor.

**Postconditions:**
- None — this is a read-only use case; log entries are immutable from the UI.

**Special Requirements:**
- Log entries auto-expire after 180 days via a MongoDB TTL index.
- Request bodies are **never** stored, to avoid leaking passwords or personal data in the log.
- Logging is fire-and-forget: a failure to write a log entry is caught and reported to the server console but never affects the API response the end user receives.

---

## UC-07 — View Admin Dashboard

**Actor(s):** System Admin, Dormitory Manager

**Description:** The manager sees an at-a-glance overview of dormitory operations: occupancy, pending requests across every module, and a revenue chart.

**Preconditions:**
- The actor is logged in with a management role.

**Basic Flow:**
1. Manager logs in and lands on `/admin`.
2. Frontend issues parallel requests: student count, pending bookings/transfers/checkouts/absences/maintenance counts, and `GET /api/invoices/stats/revenue`.
3. Dashboard renders summary tiles and a Recharts revenue-by-month chart.
4. The same pending counts also populate sidebar badges across the admin area.

**Alternative Flows:**
- **AF1 — No data yet (new deployment):** tiles show zero and the chart renders an empty state.
- **AF2 — One of the parallel requests fails:** ⚠ **verify:** confirm the dashboard degrades gracefully (renders the tiles it does have data for) rather than failing the whole page, since each request is awaited independently on the frontend.

**Postconditions:** None — read-only.

**Special Requirements:**
- `stats/revenue` is restricted to `ADMIN` only (not `DORMITORY_MANAGER`); confirm this is intentional since the rest of the dashboard is open to both roles.

---

## UC-08 — Back Up & Restore Data *(planned — not yet implemented)*

**Actor(s):** System Admin

**Description *(proposed design)*:** The admin triggers a manual backup of the database and can restore a previous backup in case of data loss or corruption.

**Preconditions:**
- The actor is `ADMIN`.
- Sufficient storage is available for the backup archive.

**Basic Flow *(proposed)*:**
1. Admin opens a (currently unbuilt) "System" settings page and clicks "Sao lưu ngay".
2. System exports all collections to a timestamped archive (e.g., JSON export per collection, or a `mongodump` archive) and stores it.
3. System confirms completion and adds the archive to a backup history list.
4. To restore, Admin selects a backup from history and confirms via a destructive-action dialog.
5. System restores all collections from the selected backup, overwriting current data.

**Alternative Flows:**
- **AF1 — Backup fails (disk/storage error):** the system reports the failure and does not leave a partial/corrupt archive in the history list.
- **AF2 — Restore selected on a corrupted or incompatible archive:** the system rejects the restore and leaves current data untouched.
- **AF3 — Restore confirmation cancelled:** no changes are made.

**Postconditions:**
- Basic flow: a new backup archive exists.
- Restore flow: the database reflects the state at the chosen backup's timestamp.

**Special Requirements:**
- Restore is a destructive, hard-to-reverse operation and must require explicit, unambiguous confirmation (e.g., typing the archive name) and `ADMIN`-only access.
- **TEAM DECISION NEEDED (this entire use case is unimplemented):**
  1. Backup mechanism — wrap the `mongodump`/`mongorestore` CLI tools vs. a custom per-collection JSON export/import.
  2. Storage location — local disk, or an external object store (S3/Cloudinary/Google Drive)?
  3. Priority — is FR08 required before this PA3 submission, or is documenting the design (this spec) sufficient, with implementation deferred to a future sprint?
