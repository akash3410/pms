# POMS — Dynamic RBAC Architecture & Implementation
## Phase 2: Detailed Architecture and Migration Plan (Revision 4 — Final)

**Date:** 2026-11-25  
**Status:** For Approval — DO NOT IMPLEMENT  
**Document policy:** New revisioned document; Revision 1 (`rbac-phase2-architecture-plan.md`), Revision 2 (`rbac-phase2-architecture-plan-v2.md`), and Revision 3 (`rbac-phase2-architecture-plan-v3.md`) left unchanged.  
**Codebase verified:** Django 5.2.18, DRF 3.16, SimpleJWT 5.5, PostgreSQL 16, custom `accounts.User(AbstractUser)`

---

## 1. Executive Summary

This document is the final Phase 2 architecture and migration plan for POMS Dynamic RBAC. It supersedes Revision 3. No source code, migrations, tests, or database changes are made by this document.

The design introduces five new tables (`Role`, `Permission`, `UserRole`, `RolePermission`, `RBACAuditLog`) plus a singleton `rbac_cache_generation` table. It enables dynamic business roles, granular permissions, multiple roles per user, union-based effective permission computation, generation-consistent caching, concurrency-safe last-superuser protection, and immutable audit logging.

Django Superusers retain exclusive system-level authority. Business Admins have full business-module access but zero RBAC management authority.

Key security properties enforced by design:
- Default deny on every endpoint (missing required permission → 403).
- Business Admin cannot create/update/delete roles, manage permissions, or assign/remove roles.
- Last active Django Superuser cannot be deactivated, demoted, or deleted via API, Django Admin, or centralized service (concurrency-safe via advisory lock).
- Permission cache uses a persistent DB generation counter as the source of truth; stale reads are impossible.
- Immutable audit log records all RBAC mutations inside the same transaction as the mutation.

---

## 2. Explicit Decisions and Resolved Ambiguities

| # | Decision | Value | Changed from Rev 3? |
|---|----------|-------|---------------------|
| D1 | RBAC management authority | Django Superusers only; Business Admin zero RBAC authority | No |
| D2 | RBAC visibility | Specified endpoints superuser-only; effective-permissions self-or-superuser | **Yes** — tightened (Section 12) |
| D3 | Permission catalog | Fixed/code-defined; no arbitrary permission creation via API | No |
| D4 | Django `has_perm()` | NOT overridden; dedicated `has_business_permission()` methods | No |
| D5 | Superuser bypass | Yes (`is_superuser` → all business permissions); never cached | No |
| D6 | Cache TTL | Configurable `RBAC_PERM_CACHE_TTL`, default 300 seconds | No |
| D7 | Cache backend | LocMem (dev/test); Redis (production) | No |
| D8 | Cache consistency | Persistent DB generation counter; generation validated on every read | **Yes** — replaced pure cache counter (Section 8) |
| D9 | `orders.view_all_orders` | Grantable through a business role; grants all-order visibility | No |
| D10 | Duplicate role assignment | Idempotent (200 if already assigned) | No |
| D11 | Role deletion | Blocked (409) if assigned; FK uses `PROTECT` | **Yes** — CASCADE→PROTECT (Section 4) |
| D12 | Last Superuser protection | Transaction-scoped PostgreSQL advisory lock + singleton lock | **Yes** — replaced `select_for_update` only (Section 9) |
| D13 | Migration | Staged; legacy `User.role` removed only after full verification + approval | **Yes** — verification phase moved before removal (Section 7) |
| D14 | Audit integrity | Audit row in same `transaction.atomic()` as mutation; `on_commit` only for external effects | **Yes** — moved out of `on_commit` (Section 10) |
| D15 | Permission count | 43 total; 36 business; 7 superuser-only; 7 modules | **Yes** — exact counts computed (Section 4) |
| D16 | Django Admin RBAC | Superuser only; non-superuser staff gain no RBAC capability | No |

Resolved ambiguities:
- **`orders.view_all_orders`**: Grants all-order visibility to any user whose active role includes it, including Business Admin. It is a business permission, not superuser-only.
- **Permission activation/deactivation**: Migration/admin-service-only; no API endpoint to activate/deactivate permissions. `is_active` is toggled via the admin service (superuser only).
- **Inactive roles/permissions**: Excluded from effective permission computation by `is_active=True` filters in the permission query.
- **`employees.assign_roles` and `roles.*`**: Explicitly excluded from the Business ADMIN role; superuser-only.

---

## 3. Final Database Schema

### 3.1 New tables (app: `accounts`)

All RBAC tables inherit `TimeStampedUUIDModel` (UUID PK, `created_at`, `updated_at`) except `rbac_cache_generation`.

**`accounts_role`**
| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| id | UUID | NO | gen_random_uuid() | PK |
| name | VARCHAR(100) | NO | | UNIQUE |
| description | TEXT | YES | '' | |
| is_active | BOOLEAN | NO | TRUE | |
| created_by | UUID | NO | | FK → accounts_user(id), ON DELETE PROTECT |
| created_at | TIMESTAMPTZ | NO | now() | |
| updated_at | TIMESTAMPTZ | NO | now() | |

Indexes: `(is_active, name)`; unique on `name`.

**`accounts_permission`**
| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| id | UUID | NO | gen_random_uuid() | PK |
| codename | VARCHAR(100) | NO | | UNIQUE, format `module.action` |
| name | VARCHAR(200) | NO | | Human-readable |
| module | VARCHAR(50) | NO | | db_index |
| description | TEXT | YES | '' | |
| is_active | BOOLEAN | NO | TRUE | |
| created_at | TIMESTAMPTZ | NO | now() | |
| updated_at | TIMESTAMPTZ | NO | now() | |

Indexes: `(module, is_active)`; unique on `codename`.

**`accounts_userrole`**
| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| id | UUID | NO | gen_random_uuid() | PK |
| user_id | UUID | NO | | FK → accounts_user(id), CASCADE |
| role_id | UUID | NO | | FK → accounts_role(id), **PROTECT** |
| assigned_by | UUID | NO | | FK → accounts_user(id), PROTECT |
| assigned_at | TIMESTAMPTZ | NO | now() | |

Constraints: UNIQUE(user_id, role_id). Indexes: `(user_id, role_id)`.
**Deletion policy:** `role_id` FK uses `ON DELETE PROTECT` — a Role cannot be deleted while UserRole rows reference it. Application converts `ProtectedError` to HTTP 409.

**`accounts_rolepermission`**
| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| id | UUID | NO | gen_random_uuid() | PK |
| role_id | UUID | NO | | FK → accounts_role(id), CASCADE |
| permission_id | UUID | NO | | FK → accounts_permission(id), CASCADE |
| assigned_by | UUID | NO | | FK → accounts_user(id), PROTECT |
| assigned_at | TIMESTAMPTZ | NO | now() | |

Constraints: UNIQUE(role_id, permission_id). Indexes: `(role_id, permission_id)`.

**`accounts_rbacauditlog`** (immutable audit)
| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| id | UUID | NO | gen_random_uuid() | PK |
| actor_id | UUID | YES | | FK → accounts_user(id), ON DELETE SET NULL |
| action | VARCHAR(50) | NO | | e.g. `role.create`, `userrole.assign` |
| target_type | VARCHAR(50) | NO | | `role`, `permission`, `userrole`, `rolepermission`, `user` |
| target_id | UUID | YES | | UUID of target object (soft reference; retained after target deletion) |
| before_state | JSONB | YES | | Serialized before state |
| after_state | JSONB | YES | | Serialized after state |
| metadata | JSONB | YES | | Request ID, IP, user agent |
| created_at | TIMESTAMPTZ | NO | now() | |

Indexes: `(actor_id, created_at)`, `(target_type, target_id)`, `(created_at)`.
**Deletion policy:** Audit rows are never cascade-deleted. `actor_id` SET NULL if actor deleted. `target_id` retained as soft reference. No update/delete endpoints for audit records.

**`rbac_cache_generation`** (singleton — durable source of truth for cache generations)
| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| id | INTEGER | NO | 1 | PK, CHECK (id = 1) |
| generation | BIGINT | NO | 0 | Incremented on every permission-affecting mutation |
| updated_at | TIMESTAMPTZ | NO | now() | |

Exactly one row exists (`id=1`). Enforced by `CHECK (id = 1)` and application logic.

### 3.2 Model relationships

```
User (existing)
    │
    ├── user_roles (FK CASCADE) ── UserRole ◄── role (FK PROTECT) ── Role
    │                                          │                       │
    │                                          └── role_permissions ── RolePermission ── permission (FK CASCADE) ── Permission
    │
    └── (existing: is_superuser, is_staff, is_active, groups, user_permissions)

RBACAuditLog (standalone; actor FK SET NULL; target by type+id)
rbac_cache_generation (singleton; no FK relationships)
```

### 3.3 Existing User model
- `User.role` field retained during Phase 2; removed only in a separate, later migration after full verification (Section 7).
- Dedicated business methods added: `has_business_permission()`, `get_effective_business_permissions()`, `has_any_business_permission()`, `has_all_business_permissions()`.
- `User.has_perm()` is NOT overridden.
- `Role` TextChoices enum retained in code until final cleanup.

---

## 4. Final Permission Catalog with Exact Counts

### 4.1 Counts

| Category | Count |
|----------|-------|
| Total permissions | **43** |
| Business permissions (grantable to Business Admin roles) | **36** |
| Superuser-only permissions (never grantable to Business Admin) | **7** |
| Modules | **7** (orders, employees, production, targets, reports, roles/permissions, auth) |

### 4.2 Orders module (`orders`) — 12 permissions

| # | Codename | Name | Endpoint | Method |
|---|----------|------|----------|--------|
| 1 | orders.view_order | View Order | GET /api/v1/orders/, GET /api/v1/orders/{id}/ | List/Retrieve |
| 2 | orders.create_order | Create Order | POST /api/v1/orders/ | Create |
| 3 | orders.update_order | Update Order | PATCH /api/v1/orders/{id}/ | Partial update |
| 4 | orders.delete_order | Delete Order | — | Reserved (no delete endpoint) |
| 5 | orders.assign_order | Assign Order | PATCH /api/v1/orders/{id}/assign/ | Custom action |
| 6 | orders.change_order_status | Change Order Status | PATCH /api/v1/orders/{id}/status/ | Custom action |
| 7 | orders.view_order_images | View Order Images | GET /.../original-image/, GET /.../generated-image/ | Custom actions |
| 8 | orders.view_order_history | View Order History | GET /api/v1/orders/{id}/history/ | Custom action |
| 9 | orders.view_order_notes | View Order Notes | GET /api/v1/orders/{id}/notes/ | Custom action |
| 10 | orders.add_order_note | Add Order Note | POST /api/v1/orders/{id}/notes/ | Custom action |
| 11 | orders.view_order_assignments | View Assignments | GET /api/v1/orders/{id}/assignments/ | Custom action |
| 12 | orders.view_all_orders | View All Orders (data-scope override) | — | Used in queryset filter |

### 4.3 Employees module (`employees`) — 5 permissions

| # | Codename | Name | Endpoint | Method | Restricted to |
|---|----------|------|----------|--------|---------------|
| 13 | employees.view_employee | View Employee | GET /api/v1/employees/, GET /api/v1/employees/{id}/ | List/Retrieve | — |
| 14 | employees.create_employee | Create Employee | POST /api/v1/employees/ | Create | — |
| 15 | employees.update_employee | Update Employee | PATCH /api/v1/employees/{id}/ | Partial update | — |
| 16 | employees.deactivate_employee | Deactivate Employee | POST /api/v1/employees/{id}/deactivate/ | Custom | — |
| 17 | employees.assign_roles | Assign Roles | POST/DELETE /api/v1/employees/{id}/roles/ | Custom | Superuser only |

### 4.4 Production module (`production`) — 7 permissions

| # | Codename | Name | Endpoint | Method |
|---|----------|------|----------|--------|
| 18 | production.update_cutting_status | Update Cutting Status | PATCH /api/v1/orders/{id}/status/ (dept=CUTTING) | Custom |
| 19 | production.update_operator_status | Update Operator Status | PATCH /api/v1/orders/{id}/status/ (dept=OPERATOR) | Custom |
| 20 | production.add_note_cutting | Add Cutting Note | POST /api/v1/orders/{id}/notes/ (dept=CUTTING) | Custom |
| 21 | production.add_note_operator | Add Operator Note | POST /api/v1/orders/{id}/notes/ (dept=OPERATOR) | Custom |
| 22 | production.add_note_general | Add General Note | POST /api/v1/orders/{id}/notes/ (dept=GENERAL) | Custom |
| 23 | production.view_history | View Production History | GET /api/v1/orders/{id}/history/ | Custom |
| 24 | production.view_notes | View Production Notes | GET /api/v1/orders/{id}/notes/ | Custom |

### 4.5 Targets module (`targets`) — 4 permissions

| # | Codename | Name | Endpoint | Method |
|---|----------|------|----------|--------|
| 25 | targets.view_target | View Target | GET /api/v1/targets/, GET /api/v1/targets/{id}/ | List/Retrieve |
| 26 | targets.create_target | Create Target | POST /api/v1/targets/ | Create |
| 27 | targets.update_target | Update Target | PATCH /api/v1/targets/{id}/ | Partial update |
| 28 | targets.delete_target | Delete Target | DELETE /api/v1/targets/{id}/ | Destroy |

### 4.6 Reports module (`reports`) — 4 permissions

| # | Codename | Name | Endpoint | Method |
|---|----------|------|----------|--------|
| 29 | reports.view_dashboard | View Dashboard | GET /api/v1/reports/dashboard/ | List |
| 30 | reports.view_employee_report | View Employee Report | GET /api/v1/reports/employees/ | List |
| 31 | reports.view_production_report | View Production Report | GET /api/v1/reports/production/ | List |
| 32 | reports.view_target_report | View Target Report | GET /api/v1/reports/targets/ | List |

### 4.7 Roles & Permissions module — 6 permissions (SUPERUSER ONLY)

| # | Codename | Name | Endpoint | Method | Restricted to |
|---|----------|------|----------|--------|---------------|
| 33 | roles.view_role | View Role | GET /api/v1/roles/, GET /api/v1/roles/{id}/ | List/Retrieve | Superuser only |
| 34 | roles.create_role | Create Role | POST /api/v1/roles/ | Create | Superuser only |
| 35 | roles.update_role | Update Role | PATCH /api/v1/roles/{id}/ | Partial update | Superuser only |
| 36 | roles.delete_role | Delete Role | DELETE /api/v1/roles/{id}/ | Destroy | Superuser only |
| 37 | roles.assign_permissions | Assign Permissions | POST/DELETE /api/v1/roles/{id}/permissions/ | Custom | Superuser only |
| 38 | permissions.view_permission | View Permission | GET /api/v1/permissions/, GET /api/v1/permissions/{id}/ | List/Retrieve | Superuser only |

### 4.8 Authentication module (`auth`) — 5 permissions (unchanged)

| # | Codename | Name | Endpoint |
|---|----------|------|----------|
| 39 | auth.login | Login | POST /api/v1/auth/login/ |
| 40 | auth.refresh | Refresh Token | POST /api/v1/auth/refresh/ |
| 41 | auth.logout | Logout | POST /api/v1/auth/logout/ |
| 42 | auth.view_profile | View Profile | GET /api/v1/auth/me/ |
| 43 | auth.update_profile | Update Profile | PATCH /api/v1/auth/me/ |

### 4.9 Superuser-only permissions (never grantable to Business Admin)

1. `employees.assign_roles`
2. `roles.view_role`
3. `roles.create_role`
4. `roles.update_role`
5. `roles.delete_role`
6. `roles.assign_permissions`
7. `permissions.view_permission`

**Total: 7 superuser-only permissions.**

### 4.10 Business ADMIN role permissions (initial migration data)

All 36 business permissions (categories 1–32 above, including `orders.view_all_orders`). **None** of the 7 superuser-only permissions.

**Verification rule:** The Business ADMIN role must not contain any permission whose codename prefix is `roles.`, `permissions.`, or exactly `employees.assign_roles`.

### 4.11 Permission activation/deactivation

- No API endpoint creates, activates, or deactivates permissions.
- `is_active` on `accounts_permission` is toggled only by the migration/admin service (superuser only).
- Inactive permissions are excluded from effective permission computation.

### 4.12 Inactive roles and permissions

- Inactive roles (`Role.is_active = False`): excluded via `role__is_active=True` filter; their permissions are not effective.
- Inactive permissions (`Permission.is_active = False`): excluded via `is_active=True` filter; not granted.
- Revocation (deactivating a permission or removing a RolePermission) takes effect immediately via cache invalidation (Section 8).

---

## 5. Complete Endpoint Authorization Matrix

Default deny rule: Every ViewSet and custom DRF action must explicitly declare `required_business_permission` (or `required_business_permissions`). A missing declaration → 403, never accidental allow.

### 5.1 Employees endpoints

| Endpoint | Method | API permission | Superuser-only enforcement | Service-level checks | Data-scope | Dept assignment | Status-transition |
|----------|--------|----------------|---------------------------|----------------------|------------|-----------------|-------------------|
| /employees/ | GET | employees.view_employee | No | None | All (admin) / None (non-admin) | N/A | N/A |
| /employees/ | POST | employees.create_employee | No | Guard is_superuser/is_staff fields | N/A | N/A | N/A |
| /employees/{id}/ | GET | employees.view_employee | No | None | N/A | N/A | N/A |
| /employees/{id}/ | PATCH | employees.update_employee | No | Guard is_superuser/is_staff fields | N/A | N/A | N/A |
| /employees/{id}/deactivate/ | POST | employees.deactivate_employee | No | Last-superuser protection | N/A | N/A | N/A |
| /employees/{id}/roles/ | GET | employees.assign_roles | **Yes** | None | N/A | N/A | N/A |
| /employees/{id}/roles/ | POST | employees.assign_roles | **Yes** | Idempotent duplicate | N/A | N/A | N/A |
| /employees/{id}/roles/{role_id}/ | DELETE | employees.assign_roles | **Yes** | None | N/A | N/A | N/A |
| /employees/{id}/effective-permissions/ | GET | employees.view_employee | Self-or-superuser | Own only / superuser any | N/A | N/A | N/A |

### 5.2 Orders endpoints

| Endpoint | Method | API permission | Superuser-only enforcement | Service-level checks | Data-scope | Dept assignment | Status-transition |
|----------|--------|----------------|---------------------------|----------------------|------------|-----------------|-------------------|
| /orders/ | GET | orders.view_order | No | None | Admin/all; employee assigned only | N/A | N/A |
| /orders/{id}/ | GET | orders.view_order | No | Object-level via queryset | Assigned or all | N/A | N/A |
| /orders/ | POST | orders.create_order | No | resolve_assignee (cutting_man + operator) | N/A | Cutting→cutting_man perm; Operator→operator perm | N/A |
| /orders/{id}/ | PATCH | orders.update_order | No | Object-level via queryset | Assigned or all | N/A | N/A |
| /orders/{id}/assign/ | PATCH | orders.assign_order | No | resolve_assignee (permission-based) | N/A | Target dept permission | N/A |
| /orders/{id}/status/ | PATCH | orders.change_order_status + production.update_cutting_status OR production.update_operator_status | No | Four-layer validation | Visible orders only | Current assignee for dept | Existing status rules |
| /orders/{id}/history/ | GET | orders.view_order_history | No | None | Assigned or all | N/A | N/A |
| /orders/{id}/notes/ | GET | orders.view_order_notes | No | None | Assigned or all | N/A | N/A |
| /orders/{id}/notes/ | POST | orders.add_order_note + production.add_note_cutting OR _operator OR _general | No | Dept restriction (GENERAL+own for employees) | Visible orders only | Matching note dept perm | N/A |
| /orders/{id}/assignments/ | GET | orders.view_order_assignments | No | None | Assigned or all | N/A | N/A |
| /orders/{id}/original-image/ | GET | orders.view_order_images | No | Object-level via queryset | Assigned or all | N/A | N/A |
| /orders/{id}/generated-image/ | GET | orders.view_order_images | No | Object-level via queryset | Assigned or all | N/A | N/A |

### 5.3 Permission overlap resolution

| Overlapping pair | Resolution |
|------------------|------------|
| `orders.change_order_status` vs `production.update_cutting_status`/`production.update_operator_status` | Both required for the status action. `orders.change_order_status` gates the API endpoint; `production.update_cutting_status` (or `_operator`) gates the department-specific operation in the service layer. Non-redundant: API permission ≠ department permission. |
| `orders.add_order_note` vs `production.add_note_cutting`/`production.add_note_operator`/`production.add_note_general` | Both required for note creation. `orders.add_order_note` gates the API endpoint; `production.add_note_*` gates the department-specific note operation. |

### 5.4 Targets endpoints

| Endpoint | Method | API permission | Superuser-only enforcement | Service-level checks | Data-scope | Dept assignment | Status-transition |
|----------|--------|----------------|---------------------------|----------------------|------------|-----------------|-------------------|
| /targets/ | GET | targets.view_target | No | None | N/A | N/A | N/A |
| /targets/{id}/ | GET | targets.view_target | No | None | N/A | N/A | N/A |
| /targets/ | POST | targets.create_target | No | validate_target_department (permission-based) | N/A | Target dept must match employee permission | N/A |
| /targets/{id}/ | PATCH | targets.update_target | No | validate_target_department | N/A | Target dept must match employee permission | N/A |
| /targets/{id}/ | DELETE | targets.delete_target | No | Blocked if completion credits exist | N/A | N/A | N/A |

### 5.5 Reports endpoints

| Endpoint | Method | API permission | Superuser-only enforcement | Service-level checks | Data-scope | Dept assignment | Status-transition |
|----------|--------|----------------|---------------------------|----------------------|------------|-----------------|-------------------|
| /reports/dashboard/ | GET | reports.view_dashboard | No | None | All | N/A | N/A |
| /reports/employees/ | GET | reports.view_employee_report | No | None | All | N/A | N/A |
| /reports/production/ | GET | reports.view_production_report | No | None | All | N/A | N/A |
| /reports/targets/ | GET | reports.view_target_report | No | None | All | N/A | N/A |

### 5.6 Roles & Permissions endpoints (superuser only)

| Endpoint | Method | API permission | Superuser-only enforcement |
|----------|--------|----------------|---------------------------|
| /roles/ | GET | roles.view_role | **Yes** |
| /roles/ | POST | roles.create_role | **Yes** |
| /roles/{id}/ | GET | roles.view_role | **Yes** |
| /roles/{id}/ | PATCH | roles.update_role | **Yes** |
| /roles/{id}/ | DELETE | roles.delete_role | **Yes** |
| /roles/{id}/permissions/ | POST | roles.assign_permissions | **Yes** |
| /roles/{id}/permissions/{perm_id}/ | DELETE | roles.assign_permissions | **Yes** |
| /permissions/ | GET | permissions.view_permission | **Yes** |
| /permissions/{id}/ | GET | permissions.view_permission | **Yes** |

### 5.7 Auth endpoints (unchanged)

| Endpoint | Method | Permission |
|----------|--------|-----------|
| /auth/login/ | POST | AllowAny |
| /auth/refresh/ | POST | AllowAny |
| /auth/logout/ | POST | IsAuthenticated |
| /auth/me/ | GET/PATCH | IsAuthenticated, IsActiveUser |

### 5.8 Visibility consistency (Sections 5 + 12 reconciled)

The following endpoints are explicitly **Superuser-only** (in addition to their API permission):
- GET `/employees/{id}/roles/`
- POST `/employees/{id}/roles/`
- DELETE `/employees/{id}/roles/{role_id}/`
- GET `/roles/`
- GET `/roles/{id}/`
- GET `/permissions/`
- GET `/permissions/{id}/`

The effective-permissions endpoint:
- A user may view their own effective permissions: `GET /employees/{self.id}/effective-permissions/` → allowed with `employees.view_employee`.
- A Django Superuser may view another user's effective permissions: `GET /employees/{other.id}/effective-permissions/` → allowed with `employees.view_employee` + `is_superuser`.
- No other cross-user access → 403.

---

## 6. Data-Scope and Department Rules

### 6.1 Three separate checks

Every protected production operation validates all applicable layers:

1. **API-level permission** (`HasBusinessPermission`): Does the user hold the required codename?
2. **Data-scope filter** (`get_queryset` / selectors): Which instances are visible?
3. **Department assignment** (service layer): Is the user the current assignee for this order's department?
4. **Status-transition rules** (service layer): Existing `ProductionStatus` transition rules preserved (Rule A/B/C).

### 6.2 Data-scope rules (current behavior preserved exactly)

| Resource | Django Superuser | Business Admin | Employee |
|----------|------------------|----------------|----------|
| Orders list/retrieve | All orders | All orders (if role grants `orders.view_all_orders`) | Only assigned orders (cutting_man OR operator) |
| Order status update | Any dept | Any dept | Only currently assigned department + permission |
| Order notes | Any dept + GENERAL | Any dept + GENERAL | GENERAL + own department only + permission |
| Order history | All | All | Only assigned orders |
| Employees | All | All | None (endpoint restricted) |
| Targets | All | All | None (endpoint restricted) |
| Reports | All | All | None (endpoint restricted) |
| Roles/Permissions | All | None | None |

### 6.3 Department permission mapping

| Department | Status permission | Note permission |
|------------|-------------------|-----------------|
| CUTTING | production.update_cutting_status | production.add_note_cutting |
| OPERATOR | production.update_operator_status | production.add_note_operator |
| GENERAL | N/A | production.add_note_general |

### 6.4 `resolve_assignee` — permission-based (not role-name-based)

```python
expected_perm = {
    Department.CUTTING: "production.update_cutting_status",
    Department.OPERATOR: "production.update_operator_status",
}[department]
if not user.has_business_permission(expected_perm):
    raise BusinessRuleError(...)
```
This allows a user with multiple roles (Cutting + Operator) to be assigned to either department. A business permission alone never bypasses order assignment restrictions — the four-layer validation still applies.

---

## 7. Migration and Rollback Strategy

### 7.1 Migration sequence

| Migration | Type | Description | Reversible | Legacy `User.role` after |
|-----------|------|-------------|------------|--------------------------|
| 0002_rbac_models | Schema | Create Role, Permission, UserRole, RolePermission, RBACAuditLog, rbac_cache_generation tables | Yes (drop tables) | Present |
| 0003_populate_permissions | Data | Insert fixed permission catalog (43 rows) | Yes (delete rows) | Present |
| 0004_create_initial_roles | Data | Create ADMIN/CUTTING_MAN/OPERATOR roles; map perms; create UserRole rows for all existing users | Yes (delete rows) | Present |
| 0005_verify_migration | Data (no schema) | Assert effective perms == old role perms for every user; raise on mismatch | N/A | Present |
| [Deploy RBAC-compatible code] | — | Legacy `User.role` retained; old code paths still work | N/A | Present |
| [Full regression + security tests] | — | 164 existing tests + new RBAC/security tests | N/A | Present |
| [Codebase-wide legacy-reference audit] | — | Confirm no service/view/selector/test references `User.role` for authorization | N/A | Present |
| [Backup confirmed] | — | pg_dump backup taken and verified | N/A | Present |
| [Explicit migration approval] | — | Operator approves legacy-field removal | N/A | Present |
| 0006_remove_legacy_role | Schema | Remove `User.role` field and related index | **No** (backup restore only) | Removed |

### 7.2 Phase E preconditions (all must be met before 0006)

1. All RBAC code is independent of `User.role` (no service/view/selector uses `user.role` for authorization).
2. Existing regression tests pass with the legacy field retained.
3. New RBAC security tests pass.
4. Codebase-wide legacy-reference audit passes (grep for `Role.`, `user.role`, `get_role_display`, `is_admin`, `is_cutting_man`, `is_operator`, `is_employee` in authorization paths).
5. Backup is confirmed (pg_dump + verified restore).
6. Explicit migration approval is obtained from the operator.

### 7.3 Post-removal requirement

After `0006_remove_legacy_role` is applied, a full regression test run must be executed to confirm no breakage from the field removal.

### 7.4 Rollback procedures

| Migration | Rollback |
|-----------|----------|
| 0002 | `migrate accounts 0001` — drops new tables |
| 0003 | `migrate accounts 0002` — deletes permissions |
| 0004 | `migrate accounts 0003` — deletes roles/UserRole/RolePermission |
| 0005 | None needed (verification only) |
| Code deployment | Revert to previous code version (legacy `User.role` still present) |
| 0006 | Cannot auto-rollback; restore `User.role` column + data from pre-migration pg_dump backup |

### 7.5 Superuser bootstrap

At least one Django Superuser must exist before migration. Migration 0004 maps existing users to roles but does not create or promote superusers. If no superuser exists, manual creation via `createsuperuser` is required before RBAC management APIs can be used.

### 7.6 Ambiguous cases

| Case | Handling |
|------|----------|
| Superuser with `role=ADMIN` | Keeps `is_superuser` + dynamic `ADMIN` role |
| Superuser with no legacy business role | Keeps `is_superuser` only; no business role auto-assigned |
| Inactive users | Still role-mapped (history preserved) |
| Users with no role | No role assigned (complies with no-default rule) |

---

## 8. Corrected Cache Architecture

### 8.1 Design principle

**The database is the durable source of truth for permission generations.** Cache entries are validated against a persistent generation counter stored in `rbac_cache_generation`. Authorization correctness never relies exclusively on a Redis/cache version counter.

### 8.2 Schema

```sql
CREATE TABLE rbac_cache_generation (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    generation BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
Exactly one row (`id=1`) enforced by `CHECK (id = 1)` and application logic.

### 8.3 Cache entry format

Key: `rbac:user_perms:{user_uuid}`  
Value: `{"generation": N, "permissions": ["codename1", "codename2", ...]}`  
TTL: `RBAC_PERM_CACHE_TTL` (default 300 seconds)

### 8.4 Read path

```
1. G_db = SELECT generation FROM rbac_cache_generation WHERE id = 1   -- single-row lookup, always current
2. entry = cache.get(key)
3. If entry exists AND entry["generation"] == G_db:
       return entry["permissions"]
4. Else:
       perms = query RBAC tables for user's effective permissions
       cache.set(key, {"generation": G_db, "permissions": perms}, TTL)
       return perms
```

### 8.5 Write path (permission-affecting mutation)

```
1. Inside transaction.atomic():
       UPDATE rbac_cache_generation SET generation = generation + 1 WHERE id = 1
       -- perform the RBAC mutation (UserRole, RolePermission, Role.is_active, etc.)
       -- create audit row (same transaction)
2. On commit (transaction.on_commit):
       cache.delete(key) for affected user(s)   -- optimization only; not required for correctness
```

### 8.6 How each requirement is satisfied

| Requirement | Mechanism |
|-------------|-----------|
| Cache entry associated with a generation | Entry stores `generation` read from `rbac_cache_generation` |
| Cache reads validate the generation | Step 3 of read path compares `entry["generation"] == G_db` |
| Stale writes rejected | A stale write (older generation) is rejected on the next read because `G_db` has advanced |
| Transaction rollback | Generation increment is inside the transaction; rollback reverts generation, so cache remains valid |
| Redis eviction / cache restart | Cache miss → read path re-fetches from DB with current `G_db` |
| Multiple application workers | All workers read the same `rbac_cache_generation` row; generation is DB-consistent |
| Interval between commit and `on_commit()` | Generation is incremented *before* commit and read directly from DB on every read; `on_commit` delete is only an optimization. No window where stale authorization is permitted. |
| Permission revocation not stale | Generation increments on revocation; next read sees advanced generation and re-fetches |

### 8.7 Generation-affecting events

| Event | Generation incremented? | Affected users |
|-------|------------------------|----------------|
| UserRole created | Yes | Target user only |
| UserRole deleted | Yes | Target user only |
| Role.is_active changed | Yes | All users with that role |
| RolePermission created/deleted | Yes | All users with that role |
| Permission.is_active changed | Yes | All users with roles having that permission |
| User.is_active changed | Yes | That user only |

---

## 9. Concurrency-Safe Last Superuser Protection

### 9.1 Design principle

The existing `select_for_update()` on only the target user row is insufficient because two concurrent operations targeting *different* superusers would not serialize against each other. When only two active superusers exist, two concurrent deactivation requests could both observe `count = 2` and both proceed, leaving zero active superusers.

**Fix:** A transaction-scoped PostgreSQL advisory lock (`pg_advisory_xact_lock`) on a fixed key, acquired at the start of every superuser-affecting operation. This serializes all superuser mutations across all workers and all target users.

### 9.2 Lock acquisition and release

- Lock key: fixed integer (e.g., `0x504F4D53` = "POMS"), registered as `SUPERUSER_ADVISORY_LOCK_ID`.
- Acquired via `SELECT pg_advisory_xact_lock(%s)` inside `transaction.atomic()`.
- Released automatically at transaction commit or rollback (transaction-scoped).
- No explicit release needed; PostgreSQL guarantees release at transaction end.

### 9.3 Algorithm (pseudocode)

```python
SUPERUSER_ADVISORY_LOCK_ID = 0x504F4D53  # "POMS"

def mutate_superuser(target_user, actor, operation):  # operation in {deactivate, demote, delete}
    with transaction.atomic():
        # 1. Acquire transaction-scoped advisory lock — serializes ALL superuser mutations
        cursor = connection.cursor()
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", [SUPERUSER_ADVISORY_LOCK_ID])

        # 2. Re-fetch target under lock
        target = User.objects.select_for_update().get(pk=target_user.pk)

        # 3. Count active superusers under the lock
        active_count = User.objects.filter(is_superuser=True, is_active=True).count()

        # 4. Evaluate invariant: at least one active superuser must remain
        target_will_become_inactive = (
            operation in ("deactivate", "delete") and target.is_active
        ) or (
            operation == "demote" and target.is_superuser
        )

        if target.is_superuser and target_will_become_inactive:
            if active_count <= 1:
                # Would leave zero active superusers
                raise LastSuperuserError(
                    "Cannot deactivate/demote/delete the last active Django Superuser."
                )

        # 5. Perform the mutation
        if operation == "deactivate":
            target.is_active = False
            target.save(update_fields=["is_active", "updated_at"])
        elif operation == "demote":
            target.is_superuser = False
            target.save(update_fields=["is_superuser", "updated_at"])
        elif operation == "delete":
            target.delete()

        # 6. Create audit row inside the same transaction
        RBACAuditLog.objects.create(
            actor=actor,
            action=f"superuser.{operation}",
            target_type="user",
            target_id=target.pk,
            before_state=...,
            after_state=...,
        )
    # 7. Lock released automatically on commit/rollback
```

### 9.4 Scenario analysis

**Scenario 1: Two concurrent attempts against the same last Superuser**
- Request A and B both call `deactivate_user(last_superuser)`.
- Both acquire the advisory lock serially (A first, then B).
- A: count = 1, target is active superuser → would leave 0 → **rejected** (400).
- Result: Invariant preserved.

**Scenario 2: Two concurrent attempts against different Superusers when only two active Superusers exist**
- Superusers X and Y are active (count = 2).
- Request A deactivates X; Request B deactivates Y. Both acquire the advisory lock serially.
- A: lock acquired, count = 2, X is active → deactivating X leaves 1 → **allowed**. Commits (count now 1).
- B: lock acquired (after A commits), count = 1, Y is active → deactivating Y leaves 0 → **rejected** (400).
- Result: Exactly one succeeds. Invariant preserved: at least one active superuser remains.

### 9.5 Repeated requests against an already inactive user

If the target user is already inactive (`is_active = False`) or already not a superuser, `target_will_become_inactive` is False. The operation is a no-op (returns 200 or "already inactive" 400, per existing API conventions). No invariant check is needed because no active superuser is being removed.

### 9.6 Concurrent operations targeting different Superusers (more than two active)

If 3+ active superusers exist, concurrent deactivations of different users proceed serially under the lock, each decrementing the count. The invariant (`count >= 1` after operation) is checked for each.

### 9.7 Django Admin bulk deletion

Django Admin `delete_queryset` and `delete_model` are overridden to:
1. Acquire the same advisory lock.
2. Count active superusers under the lock.
3. Reject bulk deletion if it would remove the last active superuser (HTTP 409 / admin error message).

### 9.8 Direct ORM operations

Direct `User.objects.filter(is_superuser=True).update(is_active=False)` bypasses the application-layer advisory lock. This is a **documented limitation**. Mitigation:
- Audit log captures the mutation (if signals or audit middleware are in place).
- Optional deployment hardening: PostgreSQL row-level security or revoking direct table UPDATE/DELETE privileges from the application database user, forcing all mutations through the API/service layer.

### 9.9 Error handling and audit

- `LastSuperuserError` → HTTP 400 (API) or admin error message (Django Admin).
- Audit row created inside the same transaction for allowed mutations.
- For rejected mutations, an audit row may be created with action `superuser.protect` (attempted but blocked), recording actor, target, and reason.

### 9.10 Concurrency tests

| Test | Description | Expected |
|------|-------------|----------|
| Concurrent deactivation of same last superuser | `threading.Barrier(2)`, both target the only active superuser | Exactly one 200, one 400; one active superuser remains |
| Concurrent deactivation of two different superusers (only two active) | `threading.Barrier(2)`, A targets X, B targets Y | Exactly one 200, one 400; one active superuser remains |
| Concurrent deactivation of three different superusers (three active) | `threading.Barrier(3)` | Two 200, one 400; one active superuser remains |
| Repeated deactivation of already-inactive superuser | Target already inactive | 200 (no-op) or 400 "already inactive"; invariant unaffected |
| Django Admin bulk delete including last superuser | Admin delete_queryset with last superuser included | 409 / admin error; last superuser retained |

---

## 10. Atomic and Immutable Audit Architecture

### 10.1 Design principle

Audit rows are created **inside** the same `transaction.atomic()` block as the corresponding RBAC mutation — never inside `transaction.on_commit()`. This guarantees atomicity: if the mutation rolls back, the audit row rolls back too.

`transaction.on_commit()` is used **only** for post-commit external effects (notifications, event dispatch, cache invalidation).

### 10.2 Mutation and audit atomicity

```python
with transaction.atomic():
    # 1. Perform RBAC mutation
    userrole = UserRole.objects.create(user=u, role=r, assigned_by=actor)

    # 2. Create audit row in the SAME transaction
    RBACAuditLog.objects.create(
        actor=actor,
        action="userrole.assign",
        target_type="userrole",
        target_id=userrole.id,
        before_state=None,
        after_state={"user_id": str(u.id), "role_id": str(r.id)},
        metadata={"request_id": request_id},
    )
# 3. on_commit: cache invalidation only (external effect)
transaction.on_commit(lambda: cache.delete(f"rbac:user_perms:{u.id}"))
```

If any step raises, the entire transaction (mutation + audit) rolls back.

### 10.3 Rollback behavior

- Mutation failure → audit row not persisted (rolled back together).
- No orphan audit rows without corresponding mutations.
- No mutations without audit rows.

### 10.4 Actor deletion behavior

- `actor_id` FK: `ON DELETE SET NULL`.
- If the actor user is deleted, audit rows retain `action`, `target_type`, `target_id`, `before_state`, `after_state`, `metadata`, `created_at`; `actor_id` becomes NULL.
- Audit trail survives actor deletion.

### 10.5 Target deletion behavior

- `target_id` is a soft reference (no FK to a specific table; `target_type` indicates the kind).
- If the target role/permission/user is deleted, the audit row retains `target_id` and `before_state`/`after_state` so the historical record remains interpretable.
- Audit rows are never cascade-deleted.

### 10.6 Update/delete prevention for audit records

- **Application controls:** No ViewSet, serializer, or service method allows updating or deleting `RBACAuditLog` rows.
- **Database controls:** Recommended (optional hardening) — PostgreSQL `REVOKE DELETE, UPDATE ON accounts_rbacauditlog FROM <app_user>` or a trigger that raises on `UPDATE/DELETE`. Not enforced by the base schema; deployment decision.

### 10.7 Immutability enforcement

| Layer | Enforcement |
|-------|-------------|
| Application | No CRUD endpoints for audit; only `log_rbac_event()` service function |
| Database | Not enforced by default; optional trigger/revoke for hardening |

### 10.8 Events requiring audit

All supported RBAC mutations produce an audit record:
- Role create/update/deactivate/delete
- Permission activation/deactivation
- Role permission assign/revoke
- User role assign/remove
- User deactivate
- Last superuser protection (blocked attempts)

---

## 11. Business Admin Security Boundary

### 11.1 Business Admin is NOT a Django Superuser

- Business Admin is a normal business role created and managed by Django Superusers.
- A Business Admin may receive full business-module access but must never gain system-level authority.

### 11.2 Business Admin CANNOT

| Operation | Enforcement |
|-----------|-------------|
| Create business role | `roles.create_role` + `is_superuser` check in view |
| Update business role | `roles.update_role` + `is_superuser` check |
| Deactivate/delete business role | `roles.delete_role` + `is_superuser` check |
| Manage permission catalog | `permissions.view_permission` is read-only; no API to create/activate/deactivate permissions |
| Assign/revoke permissions to roles | `roles.assign_permissions` + `is_superuser` check |
| Assign/remove roles to users | `employees.assign_roles` + `is_superuser` check |
| Create/promote Django Superusers | API blocks `is_superuser`/`is_staff` writes from non-superusers |
| Change `is_superuser` / `is_staff` / `groups` / `user_permissions` | Serializer guard: only `request.user.is_superuser` may set |
| Access Django admin site | `is_staff` (set only by superuser) |
| Modify RBAC configuration | Superuser-only endpoints (Section 5.6) |
| Bypass data-scope rules | `orders.view_all_orders` required for all-order visibility |

### 11.3 Business Admin CAN

| Operation | Permission |
|-----------|------------|
| Full CRUD on Orders | `orders.view_order/create/update/assign_order/change_order_status/view_order_images/view_order_history/view_order_notes/add_order_note/view_order_assignments` |
| Full CRUD on Employees (business fields only) | `employees.view_employee/create_employee/update_employee/deactivate_employee` (guarded: cannot set `is_superuser`/`is_staff`) |
| Full CRUD on Targets | `targets.view_target/create_target/update_target/delete_target` |
| Full CRUD on Reports | `reports.view_dashboard/view_employee_report/view_production_report/view_target_report` |
| All production operations | `production.update_cutting_status/update_operator_status/add_note_cutting/add_note_operator/add_note_general/view_history/view_notes` |
| View own effective permissions | `employees.view_employee` on self |
| All-order visibility | If role includes `orders.view_all_orders` |

### 11.4 Boundary proof

1. All RBAC ViewSets (`RoleViewSet`, `UserRoleViewSet`) check `request.user.is_superuser` explicitly on every mutating action, in addition to permission classes.
2. The initial `ADMIN` role (migration data) receives all 36 business permissions but **none** of the 7 superuser-only permissions.
3. Tests assert business admin with dynamic ADMIN role gets 403 on all RBAC mutation endpoints.
4. `employees.assign_roles` and all `roles.*`/`permissions.*` permissions are excluded from the Business ADMIN role.

---

## 12. RBAC Visibility Policy

| Actor | View RBAC config (roles/permissions) | Mutate RBAC config | View own effective permissions | View other users' effective permissions |
|-------|--------------------------------------|--------------------|-------------------------------|-----------------------------------------|
| Django Superuser | Yes | Yes | Yes | Yes |
| Business Admin | No | No | Yes | No |
| Employee | No | No | Yes | No |

- `GET /employees/{id}/roles/`, `POST /employees/{id}/roles/`, `DELETE /employees/{id}/roles/{role_id}/` → Superuser only.
- `GET /roles/`, `GET /roles/{id}/` → Superuser only.
- `GET /permissions/`, `GET /permissions/{id}/` → Superuser only.
- `GET /employees/{id}/effective-permissions/` → self (any authenticated user) or superuser (any user). No other cross-user access.

### 12.1 Negative visibility tests

| Test | Expected |
|------|----------|
| Business admin GET `/roles/` | 403 |
| Business admin GET `/permissions/` | 403 |
| Business admin POST `/employees/{id}/roles/` | 403 |
| Business admin DELETE `/employees/{id}/roles/{role_id}/` | 403 |
| Employee GET `/employees/{other.id}/effective-permissions/` | 403 |
| User GET `/employees/{self.id}/effective-permissions/` | 200 |
| Superuser GET `/employees/{other.id}/effective-permissions/` | 200 |

---

## 13. Cross-Section Consistency Verification

Review of Revision 3 contradictions, gaps, and errors — all resolved in Revision 4:

| Item | Rev 3 Issue | Rev 4 Resolution |
|------|-------------|------------------|
| Last superuser concurrency | `select_for_update` on target row only insufficient | Advisory lock serializes all superuser mutations (Section 9) |
| Cache consistency | Pure cache counter; stale-write race possible | Persistent `rbac_cache_generation` DB table; generation validated on every read (Section 8) |
| Endpoint visibility | Business Admin could view roles/permissions | Specified endpoints superuser-only; effective-permissions self-or-superuser (Sections 5, 12) |
| Role deletion protection | CASCADE FK vs blocked deletion conflict | `role_id` FK uses `PROTECT`; application converts `ProtectedError` to 409 (Section 4) |
| Audit integrity | Audit row in `on_commit` (not atomic with mutation) | Audit row in same `transaction.atomic()`; `on_commit` only for external effects (Section 10) |
| Migration sequence | Legacy field removal before full verification | Verification phase + approval before `0006_remove_legacy_role` (Section 7) |
| Permission counts | Approximate (~46) | Exact: 43 total, 36 business, 7 superuser-only, 7 modules (Section 4) |
| Business Admin boundary | Could potentially receive `roles.*` | Explicitly excluded; 7 superuser-only permissions enumerated (Section 11) |
| Overlapping permissions | Ambiguous API vs department permissions | Explicit overlap resolution (Section 5.3) |

### 13.1 Verification checklist

- [ ] Every custom DRF action has explicit permission enforcement: `assign`, `status`, `history`, `notes`, `original_image`, `generated_image`, `assignments`, `deactivate`, `roles`, `effective-permissions` — all listed in Section 5.
- [ ] Default-deny behavior: every ViewSet declares `required_business_permission`; missing → 403 (Section 5).
- [ ] Business Admin cannot manage RBAC: explicit `is_superuser` checks + 7 superuser-only permissions excluded from ADMIN role (Section 11).
- [ ] Existing production department and assignment rules preserved: four-layer validation + permission-based `resolve_assignee` (Section 6).
- [ ] Role deletion and audit survival: `PROTECT` FK + audit rows retained after target deletion (Sections 4, 10).
- [ ] Effective-permissions endpoint access: self-or-superuser only (Section 12).
- [ ] Employee list data scope: `employees.view_employee` returns all for admin, none for non-admin (Section 5.1).
- [ ] JWT legacy role claim: informational only; server re-validates against RBAC tables (Section 4, note).
- [ ] Multiple-role union semantics: permissions from all active roles unioned; removing one role preserves another's (Section 8, read path).

### 13.2 Codebase facts requiring verification in Phase 3

These could not be fully verified from the read-only audit and must be confirmed during implementation:

- Exact DRF router `basename` values and custom action URL names (`assign`, `status`, `history`, `notes`, etc.) in `apps/orders/views.py`, `apps/targets/views.py`.
- `EmployeeTargetViewSet` location and custom action decorators in `apps/targets/views.py`.
- Serializer field shapes for `ProductionStatusHistorySerializer`, `OrderNoteSerializer`, `StatusUpdateSerializer`, `OrderNoteCreateSerializer`.
- Enum values in `common/enums.py` (`OverallStatus`, `NoteDepartment`, `ProductionStatus`, `Department`).
- Whether `rest_framework_simplejwt.token_blacklist` migrations exist and are applied.
- Exact structure of `conftest.py` fixtures before updating them for dynamic roles.

These are implementation-phase verification items, not architectural blockers.

---

## 14. Positive, Negative, Concurrency, and Regression Tests

### 14.1 Positive tests

| Test | Description |
|------|-------------|
| Superuser creates role with permissions | POST `/roles/` → 201 |
| Superuser updates role | PATCH `/roles/{id}/` → 200 |
| Superuser deactivates role | PATCH `/roles/{id}/` is_active=false → 200 |
| Superuser assigns role to user | POST `/employees/{id}/roles/` → 200 |
| User with multiple roles gets union of permissions | Effective permissions = union across active roles |
| Removing one role preserves another's permissions | Remove role A; role B perms intact |
| Idempotent duplicate role assignment | POST same role twice → 200 both |
| Superuser bypasses all permission checks | `has_business_permission()` → True |
| Inactive user gets no permissions | Empty set |
| Inactive role excluded | Permissions not effective |
| Inactive permission excluded | Not granted |
| Cache invalidation on UserRole change | Next read re-fetches (generation advanced) |
| Cutting man updates cutting status | Has `production.update_cutting_status` |
| Admin updates both departments | Has both dept permissions |
| Business admin full business access | Dynamic ADMIN role works |
| Data scope preserved | Employees see only assigned orders |
| Last superuser protection allows non-last deactivation | Deactivating one of three superusers → 200 |

### 14.2 Negative security tests

| Test | Expected |
|------|----------|
| Business admin POST `/roles/` | 403 |
| Business admin PATCH `/roles/{id}/` | 403 |
| Business admin DELETE `/roles/{id}/` | 403 |
| Business admin POST `/roles/{id}/permissions/` | 403 |
| Business admin DELETE `/roles/{id}/permissions/{perm_id}/` | 403 |
| Business admin POST `/employees/{id}/roles/` | 403 |
| Business admin DELETE `/employees/{id}/roles/{role_id}/` | 403 |
| Business admin GET `/roles/` | 403 (no RBAC visibility) |
| Business admin GET `/permissions/` | 403 |
| Employee GET `/employees/{other.id}/effective-permissions/` | 403 |
| Role named "ADMIN" with no permissions | 403 on all endpoints |
| Inactive role → permissions not effective | 403 |
| Inactive permission → not granted | 403 |
| Direct API POST `/orders/` without permission | 403 |
| JWT token role claim="ADMIN" but no perms | 403 |
| Last superuser deactivation via API | 400 |
| Last superuser demotion via API (`is_superuser=false`) | 400 |
| Last superuser deletion via API | 400/403 |
| Missing required permission on ViewSet | 403 (default deny) |
| Business admin PATCH `/employees/{id}/` with `is_superuser` | 400 |
| Business admin PATCH `/employees/{id}/` with `is_staff` | 400 |
| Role delete with active UserRole | 409 |
| Business admin receives `employees.assign_roles` | 403 (not in ADMIN role) |
| Business admin receives `roles.create_role` | 403 (not in ADMIN role) |

### 14.3 Concurrency tests

| Test | Description | Expected |
|------|-------------|----------|
| Concurrent deactivation of same last superuser | `threading.Barrier(2)`, both target only active superuser | Exactly one 200/204, one 400; one active superuser remains |
| Concurrent deactivation of two different superusers (two active) | `threading.Barrier(2)`, A→X, B→Y | Exactly one 200, one 400; one active superuser remains |
| Concurrent deactivation of three superusers (three active) | `threading.Barrier(3)` | Two 200, one 400; one active superuser remains |
| Repeated deactivation of already-inactive superuser | Target already inactive | 200 (no-op) or 400 "already inactive" |
| Django Admin bulk delete including last superuser | Admin `delete_queryset` with last superuser | Rejected; last superuser retained |

### 14.4 Regression tests

| Suite | Must Pass |
|-------|-----------|
| accounts.test_api | ~35 tests |
| orders.test_api | ~55 tests |
| production.test_api | ~35 tests |
| targets.test_api | ~30 tests |
| reports.test_api | ~10 tests |
| Model tests | ~15 tests |
| New RBAC tests (Sections 14.1–14.3) | All new tests |

All regression tests run **with legacy `User.role` retained** (before `0006_remove_legacy_role`), then again **after** legacy-field removal (post-removal regression run required per Section 7.3).

---

## 15. Corrected Implementation Sequence

### Phase A: Core RBAC models & services
| # | File | Type | Depends on |
|---|------|------|------------|
| A1 | `apps/accounts/models/rbac.py` | New | — |
| A2 | `apps/accounts/models/__init__.py` | Modify (export) | A1 |
| A3 | `apps/accounts/services/rbac.py` | New | A1 |
| A4 | `apps/accounts/services/__init__.py` | Modify | A3 |
| A5 | `apps/accounts/services/audit.py` | New | A1 |
| A6 | `apps/accounts/services/user_management.py` | New | A1 |
| A7 | `apps/accounts/permissions/rbac.py` | New | A3 |
| A8 | `apps/accounts/permissions/__init__.py` | Modify | A7 |
| A9 | `apps/accounts/signals.py` | New | A1, A3, A5 |
| A10 | `apps/accounts/apps.py` | Modify (connect signals) | A9 |
| A11 | `apps/accounts/models.py` | Modify (add dedicated business methods) | A3 |

### Phase B: Migrations
| # | File | Type | Depends on |
|---|------|------|------------|
| B1 | `apps/accounts/migrations/0002_rbac_models.py` | New | A1, A5 |
| B2 | `apps/accounts/migrations/0003_populate_permissions.py` | New | B1 |
| B3 | `apps/accounts/migrations/0004_create_initial_roles.py` | New | B2 |
| B4 | `apps/accounts/migrations/0005_verify_migration.py` | New | B3 |

### Phase C: RBAC admin APIs (superuser only)
| # | File | Type | Depends on |
|---|------|------|------------|
| C1 | `apps/accounts/serializers/rbac.py` | New | A1, A3, A5 |
| C2 | `apps/accounts/views/rbac.py` | New | C1, A3, A5, A6 |
| C3 | `apps/accounts/urls.py` | Modify | C2 |
| C4 | `config/api_urls.py` | Modify | C3 |

### Phase D: Authorization refactor (default deny, four-layer validation)
| # | File | Type | Depends on |
|---|------|------|------------|
| D1 | `apps/accounts/permissions.py` | Modify (keep IsActiveUser; import from rbac) | A7 |
| D2 | `apps/accounts/views.py` | Modify (guard superuser fields; superuser-only RBAC views) | A5, D1 |
| D3 | `apps/accounts/serializers.py` | Modify (guard is_superuser/is_staff/groups/user_permissions) | D2 |
| D4 | `apps/orders/selectors.py` | Modify (orders_for_user → orders.view_all_orders) | A3 |
| D5 | `apps/orders/views.py` | Modify (explicit permission per action; default deny) | A7 |
| D6 | `apps/orders/services.py` | Modify (resolve_assignee permission-based; four-layer) | A3 |
| D7 | `apps/production/services.py` | Modify (permission-based dept; four-layer) | A3 |
| D8 | `apps/targets/services.py` | Modify (permission-based dept validation) | A3 |
| D9 | `apps/reports/views.py` | Modify (explicit permission per action) | A7 |
| D10 | `apps/accounts/admin.py` | Modify (last superuser protection in admin) | A6 |

### Phase E: Legacy field removal (only after all preconditions met)
| # | File | Type | Depends on |
|---|------|------|------------|
| E1 | `apps/accounts/models.py` | Modify (remove Role TextChoices, role field, properties) | B4, D1–D10 |
| E2 | `apps/accounts/migrations/0006_remove_legacy_role.py` | New | E1 |
| E3 | `apps/accounts/serializers.py` | Modify (remove role field) | E1 |
| E4 | `apps/accounts/views.py` | Modify (remove role references) | E1 |

### Phase F: Tests (new files only; existing tests not modified in Phase 2)
| # | File | Type |
|---|------|------|
| F1 | `apps/accounts/tests/test_rbac_models.py` | New |
| F2 | `apps/accounts/tests/test_rbac_services.py` | New |
| F3 | `apps/accounts/tests/test_rbac_permissions.py` | New |
| F4 | `apps/accounts/tests/test_rbac_api.py` | New |
| F5 | `apps/accounts/tests/test_rbac_security.py` | New |
| F6 | `apps/accounts/tests/test_rbac_migration.py` | New |
| F7 | `apps/accounts/tests/test_rbac_last_superuser.py` | New |

### Phase G: Documentation
| # | File | Type |
|---|------|------|
| G1 | `docs/rbac-phase2-architecture-plan-v4.md` | New (this document) |

---

## 16. Remaining Risks and Limitations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Superuser lockout during migration | Very Low | Critical | Multi-layer last-superuser protection; admin site fallback; `createsuperuser` recovery |
| Cache stale-read race | Low | Medium | Generation-based cache validated on every read; DB generation is source of truth |
| Performance regression on permission checks | Low | Medium | Cache, DB indexes, distinct(), single-row generation lookup |
| Test suite failures during transition | High | Medium | Legacy `User.role` retained during transition; update fixtures incrementally |
| Data scope regression | Low | High | Preserve `orders_for_user` logic; four-layer validation; regression tests |
| Business Admin gains RBAC authority | Low | Critical | Explicit `is_superuser` checks in all RBAC views; negative security tests; superuser-only permissions excluded from ADMIN role |
| Default-deny oversight on new ViewSet | Medium | High | Code review: every ViewSet declares `required_business_permission` |
| JWT role claim stale vs RBAC tables | Low | Medium | Server re-validates; claim informational only |
| Direct ORM bypass of last-superuser protection | Low | Critical | Documented limitation; audit log; optional DB-level hardening (RLS/revoke) |
| Direct ORM bypass of cache invalidation | Low | Medium | Generation validated on every read from DB; stale cache entries rejected |
| `User.role` removal too early | Medium | High | Enforced deployment sequence; preconditions in Section 7.2; explicit approval |
| Role deletion silently cascading assignments | Low | High | `role_id` FK uses `PROTECT`; `ProtectedError` → 409 |
| Audit row not written on mutation | Low | Critical | Audit in same `transaction.atomic()`; code review requirement |
| Permission catalog incomplete | Medium | High | Exact 43 permissions enumerated; verified against existing API actions |

### Limitations acknowledged

1. **Direct ORM mutations bypass application-layer protection** for last-superuser guards and cache invalidation. Mitigation: audit logging + optional DB-level hardening.
2. **Audit immutability is application-enforced by default**; database-level trigger/revoke is optional deployment hardening.
3. **Codebase verification items** in Section 13.2 must be confirmed during Phase 3 before implementation.
4. **No API endpoint to create/activate/deactivate permissions**; permission catalog is fixed and managed via migration/admin service.

---

## 17. Final Approval Checklist

Before Phase 3 implementation begins, confirm:

- [ ] All 16 confirmed decisions (Section 2) are approved.
- [ ] Database schema (Section 3) matches intended design, including `rbac_cache_generation` singleton and `PROTECT` on `userrole.role_id`.
- [ ] Permission catalog (Section 4) exact counts: 43 total, 36 business, 7 superuser-only, 7 modules.
- [ ] Endpoint authorization matrix (Section 5) has no missing endpoints; visibility policy reconciled (Section 12).
- [ ] Data-scope and department rules (Section 6) preserve existing behavior.
- [ ] Migration sequence (Section 7) is acceptable; Phase E preconditions understood; rollback procedures accepted.
- [ ] Cache architecture (Section 8) with persistent DB generation is approved.
- [ ] Last-superuser protection (Section 9) with advisory lock covers all required layers and scenarios.
- [ ] Audit architecture (Section 10) with atomic mutation+audit is acceptable.
- [ ] Business Admin boundary proof (Section 11) is acceptable.
- [ ] RBAC visibility policy (Section 12) is acceptable.
- [ ] Cross-section consistency verification (Section 13) is satisfactory.
- [ ] Test plan (Section 14) is comprehensive.
- [ ] Implementation sequence (Section 15) is acceptable.
- [ ] Remaining risks (Section 16) are accepted.
- [ ] Codebase verification items (Section 13.2) will be verified in Phase 3 before code changes.

---

**STOP.** This document (Revision 4) is complete. No source code has been modified, no migrations created, no database writes executed, no existing tests modified, and no implementation begun. Revisions 1, 2, and 3 are left unchanged.

Awaiting explicit approval before Phase 3 Implementation.
