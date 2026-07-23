# Use-Case Specifications — Group 1: Authentication & Profile (FR01–FR03)

<!-- Performed by: <member>; Reviewed by: <member>; Edited by: <member> -->

> Diagram: see `use-case-model.md` §1. Screenshots for each use case must be inserted by the team — see the note at the end of this file (`⚠ TEAM ACTION`).

---

## UC-01 — Register Account

**Actor(s):** Guest (future Student)

**Description:** A guest creates a new account with basic personal information so they can log in and use the self-service portal.

**Preconditions:**
- The guest is not currently logged in.
- The guest has a valid, not-yet-registered email address.

**Basic Flow:**
1. Guest opens the login page and selects "Register".
2. Guest enters full name, email, and password.
3. System validates the input format (email pattern, password length).
4. System checks that the email is not already registered.
5. System hashes the password and creates a new `User` document with `role = STUDENT`, `accessStatus = ACTIVE`, `behaviorScore = 100`.
6. System returns a success response.
7. Guest is redirected to the login page to sign in with the new account.

**Alternative Flows:**
- **AF1 — Email already registered:** At step 4, the system finds an existing account with the same email and returns an error ("Email đã được sử dụng"); registration is aborted and the form is not cleared.
- **AF2 — Invalid input format:** At step 3, validation fails (e.g., malformed email, password too short); the system returns field-level error messages and the guest corrects the form.

**Postconditions:**
- A new `User` document exists with no `room` assigned yet.

**Special Requirements:**
- Passwords are stored as a bcrypt hash in `passwordHash`, a field marked `select: false` so it is never returned by any query by default.

---

## UC-02 — Log In

**Actor(s):** Guest → any registered role (Student, System Admin, Dormitory Manager, Floor Manager, Maintenance Staff)

**Description:** A registered user authenticates with email and password and is routed to the area matching their role.

**Preconditions:**
- The user has an existing account.
- The account's `accessStatus` is `ACTIVE`.

**Basic Flow:**
1. User opens `/login` and submits email + password.
2. Frontend calls `POST /api/auth/login`.
3. Backend finds the user by email and compares the password against `passwordHash`.
4. Backend checks that `accessStatus !== 'LOCKED'`.
5. Backend issues a JWT containing `sub`, `email`, `role`, `accessStatus`.
6. Frontend calls `persistToken()`, storing the token in `localStorage` (for `apiClient`/sockets) and in the `token` cookie (for `proxy.ts`).
7. The user is redirected to `/admin`, `/student`, or `/staff` based on `role`.

**Alternative Flows:**
- **AF1 — Wrong password:** At step 3, the password does not match; the system returns 401 "Sai mật khẩu".
- **AF2 — Account not found:** At step 3, no user with that email exists; the system returns 401 "Tài khoản không tồn tại".
- **AF3 — Account locked:** At step 4, `accessStatus === 'LOCKED'`; login is rejected with an error referencing the lock.
- **AF4 (extends UC-02a) — Sign in with Google:** the user chooses the Google button instead of the email/password form.
- **AF5 (extends UC-02b) — Forgot password:** the user clicks "Quên mật khẩu" instead of submitting credentials.

**Postconditions:**
- A valid JWT is held by the client; the session remains active until the token expires or the user logs out.

**Special Requirements:**
- `JwtAuthGuard` re-reads `accessStatus` from the database on **every** subsequent authenticated request (not only at login time), so an account locked mid-session is rejected on its very next API call even though the previously issued token has not technically expired.

---

## UC-02a — Log In with Google *(extends UC-02)*

**Actor(s):** Guest

**Description:** Alternative authentication path using a Google-issued ID token; an account is created automatically on first login.

**Preconditions:**
- The guest has a Google account.

**Basic Flow:**
1. User clicks "Đăng nhập với Google" and completes the Google OAuth consent screen.
2. Frontend sends the Google ID token to `POST /api/auth/google`.
3. Backend verifies the token with Google's OAuth2 client and extracts email and name.
4. If no `User` exists with that email, the backend creates one (`role = STUDENT`, `accessStatus = ACTIVE`, a random unusable password hash).
5. Backend issues a JWT as in UC-02 step 5 onward.

**Alternative Flows:**
- **AF1 — Invalid/expired Google token:** the backend rejects with 401.
- **AF2 — Matching email is locked:** an account already exists with that email and `accessStatus = LOCKED`; login is rejected as in UC-02/AF3.

**Postconditions:** Same as UC-02.

**Special Requirements:** None beyond UC-02.

---

## UC-02b — Reset Forgotten Password *(extends UC-02)*

**Actor(s):** Guest

**Description:** A user who forgot their password requests a reset link by email and sets a new password.

**Preconditions:**
- An account exists with the given email (see AF1 for the case where it does not).

**Basic Flow:**
1. User clicks "Quên mật khẩu" on the login page and enters their email.
2. Frontend calls `POST /api/auth/forgot-password`.
3. Backend generates `resetPasswordToken` + `resetPasswordExpires`, saves them on the user document, and sends an email containing the reset link via `MailService`.
4. User opens the link and enters a new password on the reset-password page.
5. Frontend calls `POST /api/auth/reset-password` with the token and new password.
6. Backend validates the token has not expired, hashes the new password, and clears the reset fields.
7. User is redirected to `/login` with a success message.

**Alternative Flows:**
- **AF1 — Email not registered:** ⚠ **needs verification** — confirm whether step 2 always returns a generic success message regardless of whether the email exists (to avoid leaking which emails are registered), or whether it returns a distinct error. Check `auth.service.ts` and align the message accordingly.
- **AF2 — Token invalid or expired:** at step 6, validation fails; the system returns "Token không hợp lệ hoặc đã hết hạn" and the user must request a new link.

**Postconditions:**
- The account's password is updated; the reset token is cleared and cannot be reused.

**Special Requirements:**
- A `POST /api/auth/sandbox-reset-password` endpoint exists in the backend that bypasses the email step (used for testing). ⚠ **TEAM DECISION NEEDED:** confirm whether this endpoint should be disabled/removed before grading, or documented as a QA-only tool, since exposing a password-reset bypass in a graded submission may raise a security-review flag.

---

## UC-03 — View & Update Personal Profile

**Actor(s):** Student (also used by every role to manage their own profile page)

**Description:** A student views their personal information and residency/contract summary, and edits the subset of fields the system allows them to self-manage.

**Preconditions:**
- The user is logged in.

**Basic Flow:**
1. Student opens `/student/profile`.
2. Frontend calls `GET /api/users/profile`, which returns the user document (minus `passwordHash`) populated with room info.
3. Student edits an allowed field (full name, phone, CCCD, or avatar) and submits.
4. Frontend calls `PATCH /api/users/profile`.
5. Backend whitelists only `fullName`, `phone`, `cccd`, `avatar` from the request body (`PROFILE_UPDATABLE_FIELDS`), ignoring any other field, and updates the document.
6. Updated profile is returned and reflected in the UI.

**Alternative Flows:**
- **AF1 — Validation error:** the submitted value fails format validation (e.g., malformed phone number); the system returns an inline error and the field is not saved.
- **AF2 — Attempt to edit a non-whitelisted field (e.g., `room`, `email`, `role`):** the backend silently drops the field; only whitelisted fields are persisted.

**Postconditions:**
- The updated fields are persisted on the `User` document.

**Special Requirements:**
- ⚠ **DISCREPANCY TO RESOLVE WITH THE TEAM:** `spec.md` (FR03) states *"Chỉ Admin mới có quyền chỉnh sửa dữ liệu gốc"* (only Admin may edit core identity data). In the current implementation, `fullName` and `cccd` **are** in the student self-service whitelist (`users.service.ts → PROFILE_UPDATABLE_FIELDS`), meaning a student can change their own legal name and ID number via `PATCH /api/users/profile`, even though the current UI may not expose input fields for them. **Decision needed:** (a) keep self-service editing of these fields and update the spec wording, or (b) remove `fullName`/`cccd` from the whitelist so only `PATCH /users/:id` (Admin-only, see UC-10) can change them.

---

## ⚠ TEAM ACTION — Prototype Screenshots (applies to every use case in this document set)

Per the PA3 prototype requirement, each use case must be accompanied by screenshots of the screens involved in its basic flow and alternative flows. Since Dormify's UI is already fully implemented and running (not a mockup), the team has two options:

1. **(Recommended)** Run the app locally (`npm run dev` in both `src/backend` and `src/frontend`) and capture real screenshots of each screen referenced below, saving them under `docs/analysis-and-design/use-case-specs/screenshots/UC-XX/` and embedding them under each use case with `![...](screenshots/UC-XX/step-N.png)`.
2. Build a separate prototype in Figma/v0/Bolt/etc. as the assignment describes, if the TA specifically requires a design-tool artifact distinct from the working app.

**Decision needed from the team:** confirm with the TA whether real application screenshots satisfy the "UI prototype" requirement, or whether a separate prototyping-tool artifact is mandatory. This affects every use-case file in this folder.
