# Frontend ↔ Backend Integration Map

Every screen in the SPA, the permission keys that gate it, and the exact API calls
it makes. All paths are relative to `VITE_API_BASE_URL` (`/api/v1` by default).

Permission keys are **the backend's own strings** (`apps/rbac/constants.py`); the
frontend never invents one. A screen is reachable only when the user's
`effective-permissions` response contains at least one listed key (or the user is
a superuser, which the backend reports as `superuser: true`).

Legend: **R** read, **W** write. "Scope" notes mean the backend filters rows by
the caller's grants — the client does not filter for security.

---

## 1. Cross-cutting

| Concern | Endpoint(s) | Notes |
| --- | --- | --- |
| Sign in | `POST /auth/login/` | Body `{ email, password }`; the `email` field accepts a username too. Returns `{ access, refresh, user }`. |
| Refresh | `POST /auth/refresh/` | Body `{ refresh }`; called by the Axios interceptor once per expiry. |
| Sign out | `POST /auth/logout/` | Body `{ refresh }`; tokens are cleared locally even if this fails. |
| Current user | `GET /auth/me/` | Cached to `localStorage` for instant shell render, refreshed on boot. `employees.view_profile`. |
| Effective access | `GET /rbac/users/{id}/effective-permissions/` | `users.view_effective_permissions`; drives every guard, nav item and conditional button. |
| Media | `GET /orders/{id}/original-image/`, `GET /orders/{id}/generated-image/` | `orders.view_media`. Binary, permission-checked; fetched as blobs and rendered via object URLs. Never public URLs. |

Error contract: DRF validation errors arrive as `{ field: [messages] }`,
business-rule failures as `{ detail: string | { field: message } }`, and
`403 {"detail": "..."}` for authorisation failures. All are normalised in
`src/lib/api/errors.ts` and rendered inline (field errors) or as an alert.

---

## 2. Authentication & account screens

| Route | Screen | Permissions | Endpoints |
| --- | --- | --- | --- |
| `/login` | Sign in | public | `POST /auth/login/` |
| `/forgot-password` | Request reset link | public | `POST /auth/password/forgot/` |
| `/reset-password?token=` | Set new password | public | `POST /auth/password/reset/` |
| `/accept-invitation?token=` | Activate invited account | public | `POST /invitations/accept/` |
| `/verify-email?token=` | Verify email | public | `POST /auth/email/verify/`; resend via `POST /auth/email/resend-verification/` |
| `/profile` | Own profile | `employees.view_profile` | `GET /auth/me/`, `PATCH /auth/me/` (`employees.edit_profile`), `GET /rbac/users/{id}/effective-permissions/` to show the user their own access |
| `/change-password` | Change password | authenticated | `POST /auth/change-password/` (`current_password`, `new_password`) |

Verified accounts with `requires_email_verification` are refused at login with the
backend's message; the SPA surfaces the resend action from the verify screen.

---

## 3. Orders

| Route | Screen | Permissions | Endpoints |
| --- | --- | --- | --- |
| `/orders` | Order list | `orders.view_order` | `R GET /orders/` — `page`, `page_size`, `search`, `ordering`, `overall_status`, `cutting_status`, `operator_status` |
| `/orders/new` | Create order | `orders.create_order` | `W POST /orders/` (multipart: `order_number`, `original_image`, `cutting_man`, `operator`); `R GET /employees/` for the two assignee pickers |
| `/orders/:id` | Order details | `orders.view_order` | `R GET /orders/{id}/`; `W PATCH /orders/{id}/` (`orders.edit_order`, metadata and/or replacement image); `R GET /orders/{id}/original-image/`, `/generated-image/` (`orders.view_media`) |
| … Assignments tab | Assignment history | `orders.view_assignments` | `GET /orders/{id}/assignments/` (paginated); `W PATCH /orders/{id}/assign/` (`orders.assign_order`) via the assign dialog |
| … Status history tab | Status history | `production.view_status_history` | `GET /orders/{id}/history/` (paginated) |
| … Notes tab | Notes | `orders.view_notes` | `GET /orders/{id}/notes/` (paginated), `POST /orders/{id}/notes/` (`orders.create_note`) |
| … Status card | Department status | `production.update_status` | `PATCH /orders/{id}/status/` with `{ status, department?, note? }` |

Status rules the UI respects rather than re-implements:

* Department statuses are only `PENDING` / `COMPLETED`; `IN_PROGRESS` exists only
  as the derived `overall_status` (verified: the API rejects `IN_PROGRESS` as a
  department status).
* Administrators (`production.update_status` at `ALL` scope) must choose a
  department; the client always sends it for admins and never for employees.
* Assignee employees see only the departments they currently hold, and the
  client only offers those.
* Reassignment preserves status and completion credit; the UI states this where
  the action is offered.
* A status equal to the current one is an accepted no-op, so the UI disables
  submitting an unchanged value.

The assignee pickers use `GET /employees/?page_size=200&ordering=employee_code`
and filter client-side to `is_active` + the required legacy role
(`CUTTING_MAN` / `OPERATOR`) because the employees endpoint has no role filter —
see `docs/KNOWN_LIMITATIONS.md`.

---

## 4. Production — "My work"

| Route | Screen | Permissions | Endpoints |
| --- | --- | --- | --- |
| `/production` | Assigned work queue | `production.update_status` | `GET /orders/?page_size=100&ordering=-updated_at`, then the same status endpoint as above |

There is no "orders assigned to me" collection endpoint. The page fetches the
permission-scoped order list (the backend already hides orders outside the
caller's scope), selects rows where the user currently holds Cutting or Operator,
and lets the employee update their own department's status. Completion-credit
reporting is done by the backend, not the client.

---

## 5. Employees

| Route | Screen | Permissions | Endpoints |
| --- | --- | --- | --- |
| `/employees` | Employee list | `employees.view_employee` | `GET /employees/` — `page`, `page_size`, `search`, `ordering` (`employee_code`, `full_name`, `date_joined`) |
| `/employees/new` | Create employee | `employees.create_employee` | `POST /employees/` (`username`, `password`, `full_name`, `employee_code`, `role`, `email?`, `is_active?`) |
| `/employees/:id` | Employee details | `employees.view_employee` | `GET /employees/{id}/`; `PATCH /employees/{id}/` (`employees.edit_employee`); `POST /employees/{id}/deactivate/` and `/reactivate/` (`employees.deactivate_employee`) |

Deactivation returns `{ detail, ... }` and the UI shows the backend's message,
because deactivating an employee also affects their assignments. The client never
deletes employees — the backend exposes no delete.

---

## 6. Targets

| Route | Screen | Permissions | Endpoints |
| --- | --- | --- | --- |
| `/targets` | Target list | `targets.view_targets` | `GET /targets/` — `page`, `page_size`, `ordering`, `employee`, `department`, `period_type` |
| `/targets/:id` | Target details + progress | `targets.view_targets` | `GET /targets/{id}/` (includes `achieved_count`); `PATCH /targets/{id}/` (`targets.manage_targets`) |
| … Create / edit dialog | Target form | `targets.manage_targets` | `POST /targets/`, `PATCH /targets/{id}/` (`employee`, `department`, `period_type`, `start_date`, `end_date`, `target_count`) |

Backend rules surfaced in the form, not re-implemented: role/department must match
the employee, date range must be valid, periods may not overlap, and once a target
has earned completion credits its employee/department/period/dates become
immutable (`target_count` stays editable). There is no DELETE endpoint for targets.

---

## 7. Dashboard & reports

| Route | Screen | Permissions | Endpoints |
| --- | --- | --- | --- |
| `/` (index) | Dashboard | `reports.view_reports` | `GET /reports/dashboard/` |
| `/reports` | Reports (3 tabs) | `reports.view_reports` | `GET /reports/production/`, `GET /reports/employees/?limit=&offset=`, `GET /reports/targets/?limit=&offset=` |

Report collections are plain arrays (no pagination envelope); the client windows
them with `limit`/`offset`. The backend clamps `limit` to `1..500`
(default `100`), which the UI's page-size choices respect.

Dashboard sections: KPI cards (total orders, completed today, active production
staff, completion rate, targets configured, completion credits), orders by status,
employees by department, employees by role, and recent orders. Each section has an
empty state driven by the actual (possibly sparse) response.

---

## 8. RBAC administration

| Route | Screen | Permissions | Endpoints |
| --- | --- | --- | --- |
| `/admin/roles` | Roles list | `roles.view_roles` | `GET /rbac/roles/` — `page`, `page_size`, `search`, `ordering`, `is_active`, `is_system` |
| `/admin/roles/new` | Create role | `roles.manage_roles` | `POST /rbac/roles/` |
| `/admin/roles/:id` | Role details, permission editor, change history | `roles.view_roles` (+ `roles.manage_roles` to edit, `permissions.view_change_history` for history) | `GET/PATCH/DELETE /rbac/roles/{id}/`; `DEL` = `DELETE`; `POST /rbac/roles/{id}/activate|deactivate/`; `GET/PUT /rbac/roles/{id}/permissions/`; `GET /rbac/roles/{id}/history/`; `GET /rbac/permissions/?page_size=200` for the catalogue |
| `/admin/permissions` | Permission catalogue | `permissions.view_permissions` | `GET /rbac/permissions/`; `POST /rbac/permissions/`, `PATCH /rbac/permissions/{id}/`, `/activate/`, `/deactivate/` behind `permissions.manage_permissions` |
| `/admin/departments` | Departments list | `departments.view_departments` | `GET /rbac/departments/` — `page`, `page_size`, `search`, `ordering`, `is_active`, `is_production` |
| `/admin/departments/:id` | Department details + memberships | `departments.view_departments` (+ `departments.manage_members` to mutate) | `GET/PATCH /rbac/departments/{id}/`; `GET /rbac/departments/{id}/members/` (plain array); `POST /rbac/departments/{id}/members/`, `DELETE …/members/{membershipId}/`, `POST …/members/{membershipId}/primary/` |
| `/admin/users/:id/access` | User access (roles, restrictions, superuser, effective access) | any of `users.manage_users`, `scopes.manage_user_restrictions` | `GET/POST /rbac/users/{id}/roles/`, `DELETE /rbac/users/{id}/roles/{assignmentId}/`; `GET/PUT/DELETE /rbac/users/{id}/scope-restrictions/` (DELETE body `{ permission }`); `POST /rbac/users/{id}/superuser/` (`system.manage_superusers`); `GET /rbac/users/{id}/effective-permissions/` |

The permission editor `PUT`s the **complete** grant list for the role
(`{ permissions: [{ permission, scope, options }] }`), matching the backend's
replace-all contract. Roles with `is_system: true` are shown read-only for name
and code; their grants remain editable when the user can manage roles. Scopes are
the backend's `ALL`, `DEPARTMENT`, `OWN` (and the options the API documents), not
a frontend enum.

---

## 9. Invitations

| Route | Screen | Permissions | Endpoints |
| --- | --- | --- | --- |
| `/admin/invitations` | Invitations | `invitations.view_invitation` | `GET /invitations/` — `page`, `page_size`, `status`, `email`; `POST /invitations/` (`invitations.create_invitation`); `GET /invitations/{id}/` |
| … row actions | Resend / cancel | `invitations.resend_invitation` / `invitations.cancel_invitation` | `POST /invitations/{id}/resend/`, `POST /invitations/{id}/cancel/` |
| … settings dialog | Invitation expiry | `invitations.manage_settings` | `GET/PATCH /invitations/settings/` (`invitation_expiry_hours`) |

The settings endpoint exposes only `invitation_expiry_hours` and
`max_invitation_expiry_hours`; the dialog validates against the server-provided
maximum instead of hardcoding a limit.

---

## 10. Audit log

| Route | Screen | Permissions | Endpoints |
| --- | --- | --- | --- |
| `/admin/audit` | Audit log | `audit_logs.view_logs` | `GET /audit-logs/` — `page`, `page_size`, `ordering`, `action`, `target_type`, `actor`, `search`; detail dialog uses `GET /audit-logs/{id}/` |

Logs are append-only on the backend; the UI offers no mutation.

---

## 11. System settings

| Route | Screen | Permissions | Endpoints |
| --- | --- | --- | --- |
| `/system/settings` | System settings | `system.manage_settings` | `GET/PATCH /system/settings/` (`invitation_expiry_hours`, `require_email_verification`) |
| `/system/email` | Email configuration | `system.manage_email_config` | `GET/PATCH /system/email/`; `POST /system/email/test/` with optional `{ email }` |

Password fields are write-only on the backend and are never echoed back; the form
shows "configured / not configured" instead of a fake value, and never logs or
persists the secret client-side.

---

## 12. Route tree and guards

```
/                         RequireAuth + AppShell
  index                   IndexRoute → first permitted of reports / orders / production / targets
  orders, orders/new, orders/:id
  production
  employees, employees/new, employees/:id
  targets, targets/:id
  reports
  profile, change-password
  admin/roles, admin/roles/new, admin/roles/:id
  admin/permissions
  admin/departments, admin/departments/:id
  admin/users/:id/access
  admin/invitations
  admin/audit
  system/settings, system/email
  *                       NotFound
```

Public routes sit outside the shell: `/login`, `/forgot-password`,
`/reset-password`, `/accept-invitation`, `/verify-email`.

Each guarded route wraps its lazy page in `RequirePermission`, which renders a
"permission denied" state (with the backend's own enforcement still in place)
instead of mounting a page whose queries would 403. Anonymous visits to a guarded
route are redirected to `/login` with the attempted path preserved and restored
after sign-in.
