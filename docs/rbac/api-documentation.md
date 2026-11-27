# POMS API — Authentication, RBAC & Administration

**Base URL:** `/api/v1`
**Schema:** `/api/schema/` (OpenAPI 3) · `/api/v1/../api/docs/` (Swagger UI) · `/api/redoc/`
**Generated schema status:** 61 paths, **0 errors / 0 warnings** (`manage.py spectacular`).

All endpoints require `Authorization: Bearer <access>` unless marked **public**.
Errors use one envelope:

```json
{
  "detail": "Human readable message",
  "errors": { "field": ["message"] }
}
```

| Status | Meaning |
|---|---|
| 400 | Validation / business-rule failure |
| 401 | Missing, invalid, expired token, or inactive/unverified account |
| 403 | Authenticated but the required permission is absent |
| 404 | Object does not exist **or is outside your data scope** (never leaks existence) |
| 409 | Administrative safeguard refused the change (self-lockout, last superuser, role in use) |
| 429 | Login / password-reset rate limit exceeded |

---

## 1. Authorization model in one paragraph

A request is authorized by a **permission** (`module.action`) and a **data scope**. Permissions are
never granted to users directly: they come from **roles**, a user may hold **many**, and the
effective set is the **union** across active roles. A per-user restriction may only **narrow** that
set. Permission changes are read from the database on every request, so they take effect
immediately — no token re-issue is needed and **no authorization claims are carried in the JWT**.

`is_superuser` is a separate system plane: it bypasses business permissions and is required for the
`system.*` capabilities, which can never be assigned to a business role.

---

## 2. Authentication

| Method | Path | Auth | Permission |
|---|---|---|---|
| POST | `/auth/login/` | public | — |
| POST | `/auth/refresh/` | public | — |
| POST | `/auth/logout/` | bearer | authenticated + active |
| GET | `/auth/me/` | bearer | `employees.view_profile` |
| PATCH | `/auth/me/` | bearer | `employees.edit_profile` |
| POST | `/auth/change-password/` | bearer | authenticated |
| POST | `/auth/password/forgot/` | public | — |
| POST | `/auth/password/reset/` | public | — |
| POST | `/auth/email/verify/` | public | — |
| POST | `/auth/email/resend-verification/` | bearer | authenticated |
| POST | `/invitations/accept/` | public | — |

### 2.1 Login (email or username)

```http
POST /api/v1/auth/login/
Content-Type: application/json

{ "email": "jane.doe@example.com", "password": "…" }
```

`username` may be sent instead of `email` for legacy clients. Responses:

```json
{
  "refresh": "…",
  "access": "…",
  "user": {
    "id": "…", "username": "jane", "full_name": "Jane Doe",
    "employee_code": "OPR-001", "role": "OPERATOR", "role_display": "Operator",
    "roles": ["OPERATOR"], "email": "jane.doe@example.com",
    "email_verified_at": "2026-11-28T10:00:00Z", "is_active": true,
    "date_joined": "2026-11-20T09:00:00Z"
  }
}
```

Notes:

* Every credential failure returns the **same** `401 {"detail": "Invalid credentials."}` — unknown
  account, wrong password, inactive account and unverified email are indistinguishable.
* After **5** failed attempts for the same identifier/IP in 15 minutes the endpoint returns `429`.
* The access token contains only standard claims (`user_id`, `exp`, `iat`, `jti`, `token_type`).
  **Do not** build client-side authorization on token contents; use `/auth/me/` and
  `/rbac/users/{id}/effective-permissions/`.

### 2.2 Refresh & logout

`POST /auth/refresh/` with `{"refresh": "…"}` returns a new pair (rotation + blacklist enabled).
`POST /auth/logout/` with `{"refresh": "…"}` blacklists it (`204`).

### 2.3 Change password

```http
POST /api/v1/auth/change-password/
{ "current_password": "…", "new_password": "…" }
```

All configured Django validators run. `400` if the current password is wrong or the new one is weak
or identical. Audited as `auth.password_changed`.

### 2.4 Forgot / reset password

`POST /auth/password/forgot/` `{"email": "…"}` → **always `204`**, whether or not the account exists
(no enumeration). If it exists, a single-use, 1-hour token is emailed.

`POST /auth/password/reset/` `{"token": "…", "new_password": "…"}` → `200`. The token is consumed on
success; reuse returns `400`. All outstanding refresh tokens for the account are blacklisted.
Audited as `auth.password_reset`.

### 2.5 Email verification

Accounts created **through the API with an email** are flagged `requires_email_verification` and
cannot log in until verified (`401`, same generic message).

1. The account receives a verification link (3-day, single-use token).
2. `POST /auth/email/verify/` `{"token": "…"}` → `200`.
3. `POST /auth/email/resend-verification/` re-issues (invalidates the previous token).

---

## 3. Invitations

| Method | Path | Permission |
|---|---|---|
| GET | `/invitations/` | `invitations.view_invitation` |
| POST | `/invitations/` | `invitations.create_invitation` |
| POST | `/invitations/{id}/resend/` | `invitations.resend_invitation` |
| POST | `/invitations/{id}/cancel/` | `invitations.cancel_invitation` |
| GET | `/invitations/settings/` | `invitations.manage_settings` |
| PATCH | `/invitations/settings/` | `invitations.manage_settings` |
| POST | `/invitations/accept/` | public |

`GET/PATCH /invitations/settings/` reads or changes the invitation lifetime
(`invitation_expiry_hours`, 1–168). It is a **business** setting, so an Admin holding
`invitations.manage_settings` may change it; the security policy flag
(`require_email_verification`) remains superuser-only under `/system/settings/`.

### 3.1 Create

```http
POST /api/v1/invitations/
{
  "email": "new.hire@example.com",
  "full_name": "New Hire",
  "employee_code": "OPR-120",
  "roles": ["<role-uuid>"]
}
```

→ `201` with the invitation (status `PENDING`, `expires_at`). **No token is ever returned by the
API** — it exists only in the email body. Only its SHA-256 hash is stored.

Lifetime comes from `SystemSetting.invitation_expiry_hours` (default 72 h, hard maximum 168 h) and
is **snapshotted** at creation: changing the setting never alters an existing invitation.

### 3.2 Accept

```http
POST /api/v1/invitations/accept/
{ "token": "…", "password": "…" }
```

Creates (or activates) the account, validates the password with all Django validators, assigns the
invitation's roles, marks the email verified and the invitation `ACCEPTED`. Codes: `201` success,
`400` unknown/used/cancelled/expired token or weak password.

`resend` rotates the token (the old one becomes invalid) and increments `send_count`.
`cancel` moves the invitation to `CANCELLED`; it can no longer be accepted.

---

## 4. Roles

| Method | Path | Permission |
|---|---|---|
| GET | `/rbac/roles/` | `roles.view_roles` |
| POST | `/rbac/roles/` | `roles.manage_roles` |
| GET | `/rbac/roles/{id}/` | `roles.view_roles` |
| PATCH | `/rbac/roles/{id}/` | `roles.manage_roles` |
| DELETE | `/rbac/roles/{id}/` | `roles.manage_roles` |
| POST | `/rbac/roles/{id}/activate/` | `roles.manage_roles` |
| POST | `/rbac/roles/{id}/deactivate/` | `roles.manage_roles` |
| GET | `/rbac/roles/{id}/permissions/` | `roles.view_roles` |
| PUT | `/rbac/roles/{id}/permissions/` | `roles.manage_roles` |
| GET | `/rbac/roles/{id}/history/` | `permissions.view_change_history` |

Create:

```json
{ "code": "QC", "name": "Quality Controller", "description": "Inspection team" }
```

Replace a role's permission set (full replacement, atomic, audited):

```http
PUT /api/v1/rbac/roles/{id}/permissions/
{
  "permissions": [
    { "permission": "orders.view_order", "scope": "DEPARTMENT" },
    { "permission": "orders.edit_order", "scope": "ASSIGNED",
      "options": { "assignment_types": ["CUTTING"] } }
  ]
}
```

Rules enforced: unknown or inactive permission → `400`; scope not in the permission's
`supported_scopes` → `400`; `system.*` permission → `400`; replacing the actor's own management
permission with something that removes it → `409`.

`code` is stable for system roles; `DELETE` is refused for system roles (`400`) and for roles that
still have live assignments (`409`). Deactivating a role immediately removes its contribution from
every holder.

---

## 5. Permissions

| Method | Path | Permission |
|---|---|---|
| GET | `/rbac/permissions/` | `permissions.view_permissions` |
| POST | `/rbac/permissions/` | `permissions.manage_permissions` |
| GET | `/rbac/permissions/{id}/` | `permissions.view_permissions` |
| PATCH | `/rbac/permissions/{id}/` | `permissions.manage_permissions` |
| DELETE | `/rbac/permissions/{id}/` | `permissions.manage_permissions` |
| POST | `/rbac/permissions/{id}/activate/` | `permissions.manage_permissions` |
| POST | `/rbac/permissions/{id}/deactivate/` | `permissions.manage_permissions` |
| GET | `/rbac/permissions/{id}/history/` | `permissions.view_change_history` |

`key` is immutable and must be `module.action`. A custom key is **metadata only**: it grants nothing
until backend code checks it, so creating keys cannot bypass enforcement. `system.*` keys cannot be
created, and seeded system permissions cannot be deleted (deactivate instead).

---

## 6. User roles, scopes and account state

| Method | Path | Permission |
|---|---|---|
| GET | `/rbac/users/{id}/roles/` | `users.manage_users` |
| POST | `/rbac/users/{id}/roles/` | `users.manage_users` |
| DELETE | `/rbac/users/{id}/roles/{assignment_id}/` | `users.manage_users` |
| GET | `/rbac/users/{id}/effective-permissions/` | `users.view_effective_permissions` (own or `ALL`) |
| GET | `/rbac/users/{id}/scope-restrictions/` | `scopes.manage_user_restrictions` |
| PUT | `/rbac/users/{id}/scope-restrictions/` | `scopes.manage_user_restrictions` |
| DELETE | `/rbac/users/{id}/scope-restrictions/` | `scopes.manage_user_restrictions` |
| POST | `/rbac/users/{id}/superuser/` | `system.manage_superusers` (superuser only) |

Assign a role:

```http
POST /api/v1/rbac/users/{id}/roles/
{ "role": "<role-uuid>" }
```

Revoking a role keeps the row with `revoked_at` set (history preserved).

Inspect effective access:

```json
{
  "user": "…",
  "is_superuser": false,
  "permissions": {
    "orders.view_order": [{ "scope": "ASSIGNED", "options": {"assignment_types": ["CUTTING"]} }],
    "production.update_status": [{ "scope": "ASSIGNED", "options": {"assignment_types": ["CUTTING"]} }]
  },
  "restrictions": {}
}
```

Restrict (can only narrow):

```http
PUT /api/v1/rbac/users/{id}/scope-restrictions/
{ "permission": "orders.view_order", "scope": "ASSIGNED" }
```

The restriction is appended as an additional SQL `AND`, so it can never widen access or grant a
permission the user's roles do not provide.

---

## 7. Scope vocabulary

| Scope | Meaning per module |
|---|---|
| `ALL` | every row |
| `ASSIGNED` | orders where the user is the **current** cutting-man/operator (`options.assignment_types` restricts to one department) |
| `CREATED_BY_ME` | rows whose `created_by` is the user |
| `DEPARTMENT` | rows related to any department the user currently belongs to (primary or additional) |
| `OWN_PROFILE` | the user's own record |

A scope that is not supported for a permission is rejected at write time and, if it somehow exists,
evaluates to **no rows** (fail closed — never `ALL`).

---

## 8. Departments

| Method | Path | Permission |
|---|---|---|
| GET/POST | `/rbac/departments/` | `departments.view_departments` / `departments.manage_departments` |
| GET/PATCH/DELETE | `/rbac/departments/{id}/` | same |
| GET | `/rbac/departments/{id}/members/` | `departments.view_departments` |
| POST | `/rbac/departments/{id}/members/` | `departments.manage_members` |
| DELETE | `/rbac/departments/{id}/members/{membership_id}/` | `departments.manage_members` |
| POST | `/rbac/departments/{id}/members/{membership_id}/primary/` | `departments.manage_members` |

```json
POST /api/v1/rbac/departments/{id}/members/
{ "user": "<uuid>", "is_primary": true }
```

A user has at most one live primary department and any number of additional departments.
Memberships are ended (`ended_at`), never deleted, and take effect immediately for `DEPARTMENT`
scope. Deleting a department with live members is refused (`409`).

---

## 9. Employees (account management)

| Method | Path | Permission |
|---|---|---|
| GET | `/employees/` | `employees.view_employee` |
| POST | `/employees/` | `employees.create_employee` |
| GET | `/employees/{id}/` | `employees.view_employee` |
| PATCH | `/employees/{id}/` | `employees.edit_employee` |
| POST | `/employees/{id}/deactivate/` | `employees.deactivate_employee` |
| POST | `/employees/{id}/reactivate/` | `employees.deactivate_employee` |

`PUT`/`DELETE` are not routes (`405`). Accounts are never deleted.

Deactivation (transactional, audited, `409` on self-deactivation or last-superuser):

* sets `is_active = false` → all API calls with existing tokens fail `401` immediately;
* revokes every live role assignment (history retained);
* ends every live department membership;
* returns `active_orders` (count of non-completed orders still pointing at the user) and a `detail`
  prompting reassignment. Assignments are **not** silently rewritten.

Reactivation sets `is_active = true` and **does not restore roles** — an administrator must assign
them again.

`PATCH /employees/{id}/` cannot change `is_active`; that requires the guarded actions. Changing
`role` (the legacy field) requires `users.manage_users` and is refused (`400`) while the employee
holds active assignments in the department the new role would remove them from.

---

## 10. Orders, production, targets and reports

| Method | Path | Permission |
|---|---|---|
| GET | `/orders/`, `/orders/{id}/` | `orders.view_order` |
| POST | `/orders/` | `orders.create_order` |
| PATCH | `/orders/{id}/` | `orders.edit_order` |
| PATCH | `/orders/{id}/assign/` | `orders.assign_order` |
| GET | `/orders/{id}/assignments/` | `orders.view_assignments` |
| GET | `/orders/{id}/history/` | `production.view_status_history` |
| GET/POST | `/orders/{id}/notes/` | `orders.view_notes` / `orders.create_note` |
| GET | `/orders/{id}/original-image/`, `/generated-image/` | `orders.view_media` |
| PATCH | `/orders/{id}/status/` | `production.update_status` |
| GET | `/targets/`, `/targets/{id}/` | `targets.view_targets` |
| POST/PATCH | `/targets/` | `targets.manage_targets` |
| GET | `/reports/dashboard/`, `/employees/`, `/production/`, `/targets/` | `reports.view_reports` |

Order visibility is the `orders.view_order` scope; every sub-resource (history, notes, assignments,
images) resolves through the same scoped queryset, so an out-of-scope object returns **404**.
History and media have their **own** permissions — read access to an order does not automatically
grant historical access.

Status updates: a holder of `production.update_status` with `ALL` scope must specify `department`.
An employee acts only on a department where they are the **current** assignee (re-verified under a
`SELECT … FOR UPDATE` row lock); `DEPARTMENT` scope additionally requires membership. The
`department` sent by an employee is ignored in favour of their assignment.

---

## 11. Audit log

| Method | Path | Permission |
|---|---|---|
| GET | `/audit-logs/` | `audit_logs.view_logs` |
| GET | `/audit-logs/{id}/` | `audit_logs.view_logs` |

Filters: `?action=role.created&target_type=rbac.role&actor=<uuid>&search=…&ordering=-created_at`.

Events capture actor (`actor` + `actor_label` snapshot), action, target, `before`, `after`,
`metadata` (method, path, IP), and a `request_id`. Passwords, tokens, refresh values and SMTP
credentials are **redacted before storage**. Rows are append-only at the model layer and are not
registered in Django Admin; there are no write routes.

Audited actions include: role/permission created, updated, activated, deactivated, deleted,
permission-set changes, user-role assignment/revocation, scope restriction changes, user
created/deactivated/reactivated, superuser changes, department and membership changes, invitation
create/resend/cancel/accept, password change/reset, email verification, and system settings/email
configuration changes.

---

## 12. System configuration (superuser only)

| Method | Path | Notes |
|---|---|---|
| GET/PATCH | `/system/email/` | transport settings; **never** returns the SMTP password; returns `has_password` |
| POST | `/system/email/test/` | `{"email": "…"}` sends a test message |
| GET/PATCH | `/system/settings/` | `invitation_expiry_hours` (1–168), `require_email_verification` |

Sending a `smtp_password` field returns `400`: the credential is read from the environment variable
named by `password_env_var` (default `EMAIL_HOST_PASSWORD`) and is **never** written to the database.

---

## 13. Typical administration workflows

**Create a custom role and grant scoped access**

1. `POST /rbac/roles/` → role id.
2. `PUT /rbac/roles/{id}/permissions/` with `orders.view_order` at `DEPARTMENT`.
3. `POST /rbac/users/{user}/roles/` `{"role": id}`.
4. Verify with `GET /rbac/users/{user}/effective-permissions/`.

**Onboard a new employee**

1. `POST /invitations/` with email, name, employee code and roles.
2. Employee opens the emailed link and calls `POST /invitations/accept/` with their own password.
3. Optionally `POST /rbac/departments/{id}/members/` to set their primary department.

**Offboard**

1. `POST /employees/{id}/deactivate/` — notes `active_orders`.
2. Reassign those orders (`PATCH /orders/{id}/assign/`).
3. Roles remain revoked; reactivation requires re-assignment.
