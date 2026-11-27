# Phase 1 — Existing System Audit (POMS Backend)

**Date:** 2026-11-28
**Auditor role:** Senior Software Architect / Principal Django Engineer / Application Security Engineer
**Method:** Direct source inspection of the working tree at commit `f9c02ce` plus live runtime introspection and a full test run against the project's own PostgreSQL cluster.
**Scope:** Authentication, authorization, roles, permissions, data scoping, audit-related behaviour.

> This document describes **what exists today**. It contains no proposed design (see
> `phase-2-architecture.md`) and no migration steps (see `phase-3-migration-plan.md`).
> Every claim below was verified against the current code; anything that could not be
> verified is explicitly marked **NOT VERIFIED**.

---

## 1. Verification performed

| Check | Command / method | Result |
|---|---|---|
| Working tree state | `git status --porcelain` | 2 commits (`052e86d`, `f9c02ce`). Pre-existing uncommitted changes: `backend/config/api_urls.py` and ~1,276 tracked files under `backend/pgdata/`. No source file was modified for this audit. |
| Test baseline | `.venv/bin/python -m pytest -q` | **164 passed** in 7.01s |
| Migration state | `manage.py makemigrations --check --dry-run` | `No changes detected` |
| Runtime versions | interpreter introspection | Python 3.12.3, Django 5.2.19, DRF 3.16.1, SimpleJWT 5.5.1, psycopg 3.2.13, drf-spectacular 0.28.0, django-filter 25.2 |
| `cryptography` availability | import check | **Not installed** (constrains secret-at-rest options; see §11) |
| Database connectivity | `pg_ctl` + `pg_isready` on the project cluster (`backend/pgdata`, port 55432) | Server started, `accepting connections` |
| Existing user data | `SELECT role, count(*) … GROUP BY role` | 1 user total: `OPERATOR`, with a non-empty email |

Test count by file (161 test functions, 164 collected cases):

| File | Test functions |
|---|---|
| `apps/accounts/test_api.py` | 31 |
| `apps/accounts/tests.py` | 5 |
| `apps/orders/test_api.py` | 42 |
| `apps/orders/tests.py` | 7 |
| `apps/production/test_api.py` | 29 |
| `apps/production/tests.py` | 4 |
| `apps/targets/test_api.py` | 28 |
| `apps/targets/tests.py` | 6 |
| `apps/targets/test_services.py` | 7 |
| `apps/common/test_health.py` | 2 |

---

## 2. Current architecture

- **Pattern:** modular Django project, one Django app per business module, service-layer for
  multi-step writes, selector-layer for read queries.
- **API:** DRF, versioned under `/api/v1/`, exception envelope from
  `common/exceptions.py::poms_exception_handler`.
- **Auth:** JWT only (`rest_framework_simplejwt.authentication.JWTAuthentication`), configured in
  `backend/config/settings/base.py` (`REST_FRAMEWORK`, `SIMPLE_JWT`).
- **DB:** PostgreSQL; everything domain-facing uses UUID PKs via
  `common/models.py::TimeStampedUUIDModel`.
- **Docs:** drf-spectacular (`/api/schema/`, `/api/docs/`, `/api/redoc/`).

Apps and responsibilities:

| App | Responsibility |
|---|---|
| `apps.accounts` | `User` model, login/refresh/logout/me, employee CRUD, `IsAdmin`/`IsEmployee`/`IsActiveUser` |
| `apps.orders` | `Order`, `AssignmentHistory`, order CRUD, assignment, secure media, order-card image generation |
| `apps.production` | `ProductionStatusHistory`, `OrderNote`, department status transitions, credits trigger |
| `apps.targets` | `EmployeeTarget`, `CompletionCredit`, overlap protection |
| `apps.reports` | Admin-only read-only reporting endpoints |
| `apps.common` | health check only (no models) |

---

## 3. Current `User` model — verified facts

`backend/apps/accounts/models.py`

```python
class User(AbstractUser, TimeStampedUUIDModel):   # line 24
    full_name = models.CharField(max_length=150)
    employee_code = models.CharField(max_length=40, unique=True)
    role = models.CharField(max_length=20, choices=Role.choices,
                            default=Role.OPERATOR, db_index=True)   # line 39
```

- PK is a **UUID** (`TimeStampedUUIDModel.id`), inherited ordering `["full_name", "username"]`,
  unique constraint `uniq_user_employee_code`, index `(role, is_active)`.
- `USERNAME_FIELD = "username"` (inherited, not overridden).
  `REQUIRED_FIELDS = ["email"]` (inherited).
- `Role` is a **hardcoded `TextChoices`**: `ADMIN`, `CUTTING_MAN`, `OPERATOR` (lines 17–21).
- `role` is a **single-valued CharField**: one role per user, no temporal/history table.
- Role helpers: `is_admin`, `is_cutting_man`, `is_operator`, `is_employee` (lines 63–78) — all
  direct string comparisons against `self.role`.
- **`Django Groups` and `user_permissions` are registered in Django Admin but are never consulted
  by any view, permission class, selector or service.** Verified by exhaustive grep; there is no
  `has_perm(`/`permission_required(`/`get_all_permissions(` call anywhere in `apps/`.
- **`is_superuser` is never consulted by application code.** It grants Django Admin access only
  (`is_staff` also required by `django.contrib.admin`). A `superuser=True, is_active=True` user
  with `role=OPERATOR` has **operator-level API access**, not admin-level.
- `User.objects.create_superuser()` **fails in practice**: `createsuperuser` prompts for
  `employee_code` and `full_name`, which are declared `blank` implicitly (no `blank=True`), and
  `full_name` has no default; the manager's `create_superuser` does not supply them.
  **Verified by introspection**, not by interactive prompt: `User(username="x")` yields
  `full_name=""`, `employee_code=""`, `role="OPERATOR"` in memory, and the DB rejects the empty
  `employee_code` only through uniqueness (first row would succeed with `""`). See finding **M-02**.

### Existing fixed-role touch-points (complete inventory)

| # | File:line | Code | Kind |
|---|---|---|---|
| 1 | `apps/accounts/models.py:63-78` | `is_admin`, `is_cutting_man`, `is_operator`, `is_employee` | helpers |
| 2 | `apps/accounts/permissions.py:19` | `user.role == Role.ADMIN` (`IsAdmin`) | permission class |
| 3 | `apps/accounts/permissions.py:29` | `user.is_employee` (`IsEmployee`) | permission class (unused) |
| 4 | `apps/accounts/permissions.py:41` | `user.role == Role.ADMIN` (`IsAdminOrReadOnly`) | permission class (unused) |
| 5 | `apps/orders/selectors.py:16` | `if user.role == Role.ADMIN: return base` | queryset scoping |
| 6 | `apps/orders/services.py:20-21` | `_ROLE_FOR_DEPARTMENT` map | assignment validation |
| 7 | `apps/orders/services.py:40` | `if user.role != expected_role` | assignment validation |
| 8 | `apps/orders/views.py:200` | `if user.role == Role.ADMIN` (status) | view branch |
| 9 | `apps/orders/views.py:208` | `department_for_role(user.role)` | view branch |
| 10 | `apps/production/services.py:19-20` | `_DEPARTMENT_FOR_ROLE` map | department resolution |
| 11 | `apps/production/services.py:83` | `employee.role != Role.ADMIN and department != department_for_role(...)` | service authorization |
| 12 | `apps/production/services.py:95` | `employee.role != Role.ADMIN and assignee != employee` | service authorization |
| 13 | `apps/production/services.py:145` | `author.role != Role.ADMIN` (notes) | service authorization |
| 14 | `apps/targets/services.py:14-15` | `_DEPARTMENT_FOR_ROLE` map | target validation |
| 15 | `apps/targets/services.py:21` | `_DEPARTMENT_FOR_ROLE.get(employee.role)` | target validation |
| 16 | `apps/reports/views.py:67,71,93` | `role__in=[...]`, `role=` | reporting filters |
| 17 | `apps/accounts/serializers.py:103,112` | `new_role != Role.CUTTING_MAN/OPERATOR` | role-change guard |
| 18 | `apps/accounts/serializers.py:164` | `token["role"] = user.role` | JWT claim |
| 19 | `apps/accounts/admin.py` | `role` editable in `fieldsets`/`add_fieldsets` | Django Admin |

Two permission classes (`IsEmployee`, `IsAdminOrReadOnly`) are **dead code** — no importer.

---

## 4. Authentication

### 4.1 Endpoints (`apps/accounts/urls.py`)

| Method | Path | View | Permission classes |
|---|---|---|---|
| POST | `/api/v1/auth/login/` | `LoginView(TokenObtainPairView)` | `AllowAny` |
| POST | `/api/v1/auth/refresh/` | `RefreshView(TokenRefreshView)` | `AllowAny` |
| POST | `/api/v1/auth/logout/` | `LogoutView` | `IsAuthenticated` |
| GET/PATCH | `/api/v1/auth/me/` | `MeView` | `IsAuthenticated, IsActiveUser` |

### 4.2 Behaviour

- **Login takes `username` + `password` only.** `TokenPairSerializer` extends
  `TokenObtainPairSerializer`; `TokenPairSerializer.get_token()` adds `role`, `employee_code`,
  `full_name` claims (`serializers.py:158-166`) and the response embeds the full user object.
- **No email login.** Email is collected, returned, and searchable, but never used as an
  identifier.
- **Inactive users** are rejected at login (`authenticate()` → `ModelBackend.user_can_authenticate`)
  and at refresh (`TokenRefreshSerializer` checks `is_active`).
- **Token lifetime:** access 60 min, refresh 7 days, rotation **on**, blacklist after rotation
  **on**, blacklist app installed (`rest_framework_simplejwt.token_blacklist`).
- **MFA: none. Session auth: none.** `AUTHENTICATION_BACKENDS` is not set (Django default:
  `ModelBackend`).
- **Password change: absent.** No endpoint accepts a current/new password pair.
- **Password reset / forgot password: absent.** `django.contrib.auth.urls` is not mounted;
  `EMAIL_BACKEND` is only configured in `development.py` (console) and is **unset in base and
  production** (defaults to SMTP to localhost).
- **Email verification: absent.** No `email_verified` field, no verification token, no flow.
- **Invitations: absent.** No model, endpoint, or token.
- **Rate limiting: absent.** No `DEFAULT_THROTTLE_CLASSES`, no `AnonRateThrottle`, no
  `ScopedRateThrottle`, no login-attempt table, no lockout. Unlimited credential guessing.
- **Failed-login tracking: absent.**
- **Token revocation on deactivation:** works only because `JWTAuthentication` re-loads the user and
  `AuthenticationForm`/`TokenRefreshSerializer` check `is_active`. There is no per-user token
  versioning, so **permission claims inside an already-issued access token remain readable by the
  client for up to 60 minutes** — the server ignores them (they are never used for authorization),
  which is the only reason this is not a live vulnerability.

### 4.3 Password handling

- Hashing: Django defaults (`PBKDF2PasswordHasher`); dev uses `MD5PasswordHasher` first for speed
  (`config/settings/development.py`).
- `AUTH_PASSWORD_VALIDATORS` lists all four standard validators (`base.py`).
- **`EmployeeCreateSerializer.create()` calls `User.objects.create_user(password=…, …)` without
  `validate_password()`** (`serializers.py:66-68`). Only `min_length=8` is enforced. The four
  configured validators are therefore **never applied to admin-created accounts**.

---

## 5. Authorization

### 5.1 Endpoint authorization map (as implemented)

| Method | Path | Gate | Scope applied |
|---|---|---|---|
| POST | `/api/v1/auth/login/` | `AllowAny` | — |
| POST | `/api/v1/auth/refresh/` | `AllowAny` | — |
| POST | `/api/v1/auth/logout/` | authenticated | — |
| GET/PATCH | `/api/v1/auth/me/` | authenticated + active | self only (`request.user`) |
| GET | `/api/v1/employees/` | `IsAdmin` | all users |
| POST | `/api/v1/employees/` | `IsAdmin` | — |
| GET | `/api/v1/employees/{id}/` | `IsAdmin` | all users |
| PATCH | `/api/v1/employees/{id}/` | `IsAdmin` | any user, incl. superusers |
| POST | `/api/v1/employees/{id}/deactivate/` | `IsAdmin` | any user, incl. self/superusers |
| GET | `/api/v1/orders/` | authenticated | `orders_for_user` |
| POST | `/api/v1/orders/` | `IsAdmin` | — |
| GET | `/api/v1/orders/{id}/` | authenticated | `orders_for_user` via `get_object()` |
| PATCH | `/api/v1/orders/{id}/` | `IsAdmin` | — |
| PATCH | `/api/v1/orders/{id}/assign/` | `IsAdmin` | — |
| GET | `/api/v1/orders/{id}/assignments/` | authenticated | order-scoped only |
| GET | `/api/v1/orders/{id}/original-image/` | authenticated | order-scoped only |
| GET | `/api/v1/orders/{id}/generated-image/` | authenticated | order-scoped only |
| PATCH | `/api/v1/orders/{id}/status/` | authenticated | order-scoped + department check |
| GET | `/api/v1/orders/{id}/history/` | authenticated | order-scoped only |
| GET/POST | `/api/v1/orders/{id}/notes/` | authenticated | order-scoped + department check on POST |
| GET | `/api/v1/targets/` (list/retrieve) | `IsAdmin` | all |
| POST/PATCH | `/api/v1/targets/` | `IsAdmin` | — |
| GET | `/api/v1/reports/dashboard/` | `IsAdmin` | all |
| GET | `/api/v1/reports/employees/` | `IsAdmin` | all |
| GET | `/api/v1/reports/production/` | `IsAdmin` | all |
| GET | `/api/v1/reports/targets/` | `IsAdmin` | all |
| GET | `/api/v1/health/` | `AllowAny` (see `apps/common/health.py`) | — |

### 5.2 Data scoping — the entire mechanism today

`apps/orders/selectors.py::orders_for_user` is the **only** scoped queryset in the system:

```python
base = Order.objects.select_related("cutting_man", "operator", "created_by")
if user.role == Role.ADMIN:
    return base
return base.filter(Q(cutting_man=user) | Q(operator=user))
```

- Two scopes exist implicitly: *all orders* (ADMIN) and *currently assigned orders* (everyone else).
- There is **no** department scope, **no** created-by-me scope, **no** per-permission scope, and
  **no** user-level restriction.
- Order-scoped sub-resources (assignments, images, history, notes) are protected only by
  `get_object()` resolving through `orders_for_user`, which is correct for BOLA but means
  **history and media share the same visibility as the current order** — a user who can view an
  order automatically sees its full assignment and status history (see finding **M-07**).
- Targets, reports, employee lists and audit-worthy history have **no** row-level scoping at all.
- All filtering is done in SQL (`.filter()`), never in Python. This is good and must be preserved.

### 5.3 Department logic

Department is **derived from the fixed role** in three separate, duplicated maps:

- `apps/orders/services.py:20-21` — `CUTTING → CUTTING_MAN`, `OPERATOR → OPERATOR`
- `apps/production/services.py:19-20` — the same map
- `apps/targets/services.py:14-15` — the same map again

`apps/production/services.py::department_for_role(role)` maps a role to a single department, so
**a user can act in exactly one department**, determined by their role. There is no department
entity, no membership, no primary/additional department, and no way to grant cross-department
access to a user.

Assignment validation (`orders/services.py::resolve_assignee`) requires
`user.role == expected_role` for the target department — so assigning an employee to a department
is also fixed-role-based.

### 5.4 Object-level checks that do exist (and are correct)

- `update_department_status` re-verifies the assignee **against a `select_for_update()` row**, so a
  concurrent reassignment cannot let a stale check pass (`production/services.py:88-101`).
- Status updates for non-admins are constrained to the role-derived department.
- Notes for non-admins are constrained to `GENERAL` or the role-derived department.
- Order images are served only through authenticated endpoints (no static `/media/` handler); the
  router deliberately omits `static(settings.MEDIA_URL, …)` in `config/urls.py:39-44`.

---

## 6. Existing tests — what they actually constrain

The suite is strong on business rules and weak on authorization *dimensions*:

- **Covered:** login/refresh/logout/me, inactive-login rejection, employee admin-only CRUD,
  PUT/DELETE not exposed, order visibility (admin vs assignee vs outsider), image access control,
  order-number validation, image limits, assignment/reassignment history, status transitions,
  no-op transitions, credit attribution rules A/B/C, concurrent completion (single credit),
  transactional rollback, target overlap + concurrency, role-change-with-active-assignment guard.
- **Not covered anywhere:** custom roles, multiple roles, permission union, permission removal
  taking effect, deactivated roles, any scope other than all/assigned, department scope, user-level
  scope restriction, password change/reset, email login, email verification, invitations,
  rate limiting, last-superuser protection, self-lockout, audit logging, superuser/admin
  separation, Django Admin bypass, permission staleness in JWTs, audit log tamper resistance.
- Tests use `APIClient.force_authenticate(user=…)`, i.e. they bypass JWT entirely. JWT-specific
  behaviour (claims, staleness, blacklisting) is only tested through the login/refresh endpoints.
- Fixtures (`backend/conftest.py`) create users with `role=Role.ADMIN|CUTTING_MAN|OPERATOR` and
  `is_staff=True` for the admin. **Any change that breaks `role=`-based fixture construction or
  `user.role` reads breaks the entire suite.**

---

## 7. Migration state

| App | Migrations |
|---|---|
| `accounts` | `0001_initial` only |
| `orders` | `0001_initial`, `0002_order_chk_order_overall_status_consistent` |
| `production` | `0001_initial` |
| `targets` | `0001_initial`, `0002_target_overlap_exclusion`, `0003_alter_completioncredit_target` |
| `reports` | none (no models) |
| `auth`, `contenttypes`, `sessions`, `admin`, `token_blacklist` | framework |

No RBAC-related tables exist. `makemigrations --check` reports no drift.

---

## 8. Django Admin exposure

`apps/accounts/admin.py::UserAdmin` extends `BaseUserAdmin` with:

- `role` in both `fieldsets` and `add_fieldsets` — an admin-site user can set any role directly.
- `is_active`, `is_staff`, `is_superuser`, `groups`, `user_permissions` all editable.
- **Deletion is not disabled** — unlike every other model in the project, where historical records
  have `has_delete_permission → False` or `PROTECT` FKs.
- No self-lockout guard, no last-superuser guard, no audit trail.

Django Admin is therefore a **complete authorization bypass** relative to the API: it can change
`role`, flip `is_superuser`, delete users, and grant `Group`/`user_permissions` that the API
ignores. `is_staff` is required, and the admin site is mounted at `/admin/`
(`config/urls.py:18`) in every environment.

---

## 9. Findings (verified, severity-classified)

Severity uses: **HIGH** = exploitable privilege escalation / data loss / missing mandatory control;
**MEDIUM** = defence-in-depth gap or operational risk with a precondition; **LOW** = hygiene.

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| H-01 | HIGH | **No password change, reset, or forgot-password flow.** A compromised or forgotten password can only be fixed by an administrator editing the account in Django Admin. | `apps/accounts/urls.py` (4 routes), no `set_password` call in any view |
| H-02 | HIGH | **Admin-created accounts bypass all four configured password validators.** Only `min_length=8` applies. | `apps/accounts/serializers.py:66-68`; `AUTH_PASSWORD_VALIDATORS` in `base.py` |
| H-03 | HIGH | **Django Admin is a full authorization bypass** (role, `is_superuser`, deletion, groups) with no audit trail and no lockout protection. | `apps/accounts/admin.py`; `/admin/` mounted unconditionally |
| H-04 | HIGH | **No protection against administrative lockout.** An admin can deactivate themselves, demote the last admin, or delete the only account able to administer the system. Nothing checks "at least one active administrator remains". | `EmployeeViewSet.deactivate`, `EmployeeUpdateSerializer` (no guard) |
| H-05 | HIGH | **No audit logging of any security-sensitive change.** Role changes, deactivations, assignments, and status changes leave only domain rows, not actor/action/before/after records. | no audit model/app; grep for `AuditLog` → none |
| H-06 | HIGH | **No login rate limiting, throttling, or failed-login tracking.** Unlimited password guessing against `/auth/login/`. | `REST_FRAMEWORK` has no `DEFAULT_THROTTLE_*`; no attempt model |
| H-07 | HIGH | **1,276 PostgreSQL data files (~65 MB) are committed to Git** (`backend/pgdata/`), including on-disk database pages. This leaks data and makes the repo unreproducible. | `git ls-files backend/pgdata | wc -l`; `git status` shows many modified |
| M-01 | MEDIUM | **Role model is closed.** No operation can create a role, add a permission to a role, or give a user a second role. Every new business role requires a code change and a deployment. | `Role(TextChoices)`; single `role` column |
| M-02 | MEDIUM | **`createsuperuser` is broken** — `employee_code`/`full_name` are required by the DB but not supplied by the manager, and `USERNAME_FIELD` is `username` while login is username-based. | `manage.py createsuperuser` path; model fields at `models.py:30-36` |
| M-03 | MEDIUM | **`User.role` is unconstrained at the API edge for updates**: `EmployeeUpdateSerializer` accepts any `Role` choice and no check enforces that a user keeps a usable role. | `serializers.py:74-120` |
| M-04 | MEDIUM | **No permission catalogue.** Authorization decisions are hardcoded `role ==` comparisons; there is no way to express "can view orders but not edit them". | `permissions.py`, `selectors.py`, `production/services.py` |
| M-05 | MEDIUM | **Department is not an entity.** Role→department is duplicated in 3 modules; adding a department or allowing cross-department staff requires code changes in all three. | `orders/services.py:20`, `production/services.py:19`, `targets/services.py:14` |
| M-06 | MEDIUM | **Target/department coupling is role-based**: a target can only be created for a user whose *role* maps to the requested department, so a multi-skilled employee cannot hold targets in two departments. | `targets/services.py:18-33` |
| M-07 | MEDIUM | **History and media visibility are not separately controllable.** Anyone who can view an order can read its full assignment history, status history, notes, and both images. There is no `view_history`-style permission. | `orders/views.py` `assignments`, `history`, `notes`, image actions |
| M-08 | MEDIUM | **Deactivating a user strands their active assignments.** `deactivate` only flips `is_active`; the user remains the current `cutting_man`/`operator` on open orders, so those orders point at an unusable assignee and can no longer be progressed by them. | `apps/accounts/views.py::deactivate` |
| M-09 | MEDIUM | **Superuser and business admin are disconnected planes.** `is_superuser` grants nothing in the API; `role=ADMIN` grants everything and can be granted by any admin. There is no rule preventing an admin from editing/deactivating a superuser. | `permissions.py`; `EmployeeViewSet` (no target check) |
| M-10 | MEDIUM | **JWT carries stale authorization claims** (`role`, `employee_code`, `full_name`) for up to 60 minutes. They are not used server-side today, but they are consumed by clients and would become a live vulnerability the moment any client trusts them. | `serializers.py:158-166` |
| M-11 | MEDIUM | **`IsEmployee` and `IsAdminOrReadOnly` are dead code**; the real checks live inline in services and views, so permission classes do not describe the system. | `permissions.py:23-45` (no importers) |
| M-12 | MEDIUM | **Reports mix active and inactive employees in performance data** (`EmployeePerformanceView` filters only on role, not `is_active`), while the dashboard filters `is_active=True`. | `reports/views.py:88-96` vs `:63-73` |
| M-13 | MEDIUM | **Profile `PATCH /auth/me/` accepts `role` silently** (read-only field), returning 200 while ignoring it — no error, no audit. Harmless today but masks client bugs and any future field addition. | `serializers.py:122-150`, `views.py::MeView.patch` |
| L-01 | LOW | Role vocabulary duplicated between `Role` choices, the three department maps and the three report filters. | `common/enums.py::Department`, three services |
| L-02 | LOW | `EmployeeViewSet` exposes `search`/`ordering` without `filter_backends`; defaults from settings supply them, so this works only by global configuration. | `accounts/views.py:110-114` |
| L-03 | LOW | `LoginSerializer` exists only for schema documentation and is not wired to the login view. | `serializers.py:175-182` |
| L-04 | LOW | No `CONN_HEALTH_CHECKS`, no `ATOMIC_REQUESTS`; concurrency safety is per-service, which is deliberate but undocumented. | `base.py` `DATABASES` |
| L-05 | LOW | `apps/orders/urls.py` and `apps/production/views.py` are empty files, which reads as unfinished scaffolding. | file contents |

**No CRITICAL HTTP authorization bypass was found.** Order and media IDOR attempts resolve to
404/401 because `get_object()` always goes through the scoped queryset; this is the strongest part
of the current design.

---

## 10. Invariants that must survive migration

Derived from code and tests — breaking any of these is a regression:

1. Order visibility: admin → all; employee → current assignment only; outsider → 404 (not 403).
2. Order/media/history/notes are reachable only through the scoped queryset (BOLA-safe).
3. Employee API: `GET`, `POST`, `PATCH` only; `PUT`/`DELETE` → 405; deactivate via action only.
4. Role change blocked while the employee holds active (non-completed) assignments in the
   department that the new role would revoke.
5. `resolve_assignee` rejects wrong-department, inactive, and non-existent employees with 400.
6. Status transitions: non-admin cannot touch the other department; must be the current assignee;
   check re-verified under `select_for_update`.
7. No-op status transition creates no history row and no credit.
8. Crediting: current assignee at completion time, never the actor; reassignment never re-credits.
9. `UNIQUE(employee, order, target)` on credits; target fields immutable once credited.
10. `overall_status` always derived; DB check constraint enforces consistency.
11. Target overlap serialised by a lock on the `User` row; DB exclusion constraint as backstop.
12. `employee_code` uppercased and unique; `order_number` charset/length validated.
13. Media served only through authenticated endpoints; `Cache-Control: private, no-store`.
14. Inactive users cannot login, cannot refresh, and are rejected by `IsActiveUser`.
15. Existing secrets stay in `.env`; nothing sensitive is returned by any serializer.

---

## 11. Constraints discovered (they shape Phase 2)

- **`cryptography` is not installed** and no new dependency is authorised. Secret-at-rest for SMTP
  credentials therefore cannot use a vetted AEAD library in this environment. Options: derive from
  an environment-held key using a library already present (none suitable), or keep the secret out of
  the database entirely. The second option is chosen (see Phase 2 §9).
- **Existing tests construct users with `role=` and read `user.role`.** Removing or renaming that
  field in the same release would break 164 tests and, more importantly, the documented API
  contract (`user.role`, `role_display`, employee create/patch `role`).
- **`USERNAME_FIELD` is `username`.** Switching it to `email` would break `create_user(username=…)`
  across the suite and every existing employee record without an email. Email login must therefore
  be added as an *identifier resolution* step, not by re-keying the model. (Recorded as an
  architectural decision in Phase 2 §10, not as a silent assumption.)
- **Only one real database row exists** (`OPERATOR` with an email), so a data migration has a
  trivial dataset to handle but must still be written correctly for other deployments.

---

## 12. NOT VERIFIED

The following could not be established from the repository and are **not** asserted anywhere in
later phases:

- **NOT VERIFIED:** behaviour of any client application that consumes the `role` claim in the JWT.
  No frontend or mobile client is present in this repository.
- **NOT VERIFIED:** production SMTP deliverability and the real `EMAIL_*` environment values in
  deployment (no deployment manifests or CI configuration are present).
- **NOT VERIFIED:** historical production database content in other environments. Only the local
  cluster was inspected (1 user).
- **NOT VERIFIED:** whether `backend/pgdata/` is also present in other branches, tags, or clones
  (only the current branch's index was inspected).
- **NOT VERIFIED:** performance characteristics at production data volume. No load or benchmark
  harness exists in the repository, so no performance claim is made in this work.

---

## 13. Audit conclusion

The existing system is a **well-built fixed-role application** with genuinely careful business-rule
handling (row-locked status transitions, idempotent credits, BOLA-safe media delivery, derived
status with a DB check constraint). Its authorization model, however, is a single `role` column
compared against three hardcoded constants in ten source locations, with:

- no permission catalogue,
- no role lifecycle or multi-role support,
- no department entity,
- no per-permission or per-record scoping beyond all/assigned,
- no audit trail,
- no login hardening, password lifecycle, or invitation workflow,
- and a Django Admin surface that bypasses all of it.

The migration in Phases 4–8 must therefore **add** a permission/scope/role layer, **bridge** the
existing `role` field into it so that all 164 existing tests and all historical data keep working,
and only then retire the hardcoded comparisons — never the reverse order.
