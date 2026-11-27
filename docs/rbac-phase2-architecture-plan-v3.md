# POMS — Dynamic RBAC Architecture & Implementation
## Phase 2: Detailed Architecture and Migration Plan (Revision 3 — Final)

**Date:** 2026-11-25  
**Status:** For Approval — DO NOT IMPLEMENT  
**Document policy:** New revisioned document; Revision 1 (`rbac-phase2-architecture-plan.md`) and Revision 2 (`rbac-phase2-architecture-plan-v2.md`) left unchanged.  
**Codebase verified:** Django 5.2.18, DRF 3.16, SimpleJWT 5.5, PostgreSQL 16, custom `accounts.User(AbstractUser)`

---

## 1. Executive Summary

This document is the final Phase 2 architecture and migration plan for POMS Dynamic RBAC. It supersedes Revision 1 and Revision 2. No source code, migrations, tests, or database changes are made by this document.

The design introduces four new tables (`Role`, `Permission`, `UserRole`, `RolePermission`) that enable dynamic business roles, granular permissions, multiple roles per user, and union-based effective permission computation. Django Superusers retain exclusive system-level authority; Business Admins have full business-module access but zero RBAC management authority.

Key security properties enforced by design:
- Default deny on every endpoint (missing required permission → 403).
- Business Admin cannot create/update/delete roles, manage permissions, or assign/remove roles.
- Last active Django Superuser cannot be deactivated, demoted, or deleted via API, Django Admin, or centralized service.
- Permission cache uses generation-based invalidation to prevent stale-read races.
- Immutable audit log records all RBAC mutations.

---

## 2. Confirmed Decisions

| # | Decision | Value |
|---|----------|-------|
| D1 | RBAC management authority | Django Superusers only; Business Admin has zero RBAC authority |
| D2 | RBAC visibility | Superusers full visibility; Business Admin/Employees view own effective permissions only |
| D3 | Permission catalog | Fixed/code-defined, populated by migration; no arbitrary permission creation via API |
| D4 | Django `has_perm()` | NOT overridden; dedicated `has_business_permission()` methods used |
| D5 | Superuser bypass | Yes (`is_superuser` → all business permissions); never cached |
| D6 | Cache TTL | Configurable `RBAC_PERM_CACHE_TTL`, default 300 seconds |
| D7 | Cache backend | LocMem (dev/test); Redis (production) |
| D8 | Cache invalidation | Generation/version-based + `transaction.on_commit` signals |
| D9 | `orders.view_all_orders` | Grantable through a business role (separate permission) |
| D10 | Duplicate role assignment | Idempotent (200 if already assigned) |
| D11 | Role deletion | Blocked (409) if assigned to users |
| D12 | Last Superuser protection | Multiple layers: API + Django Admin + centralized service + DB locking |
| D13 | Migration | Staged; legacy `User.role` retained until code independence confirmed; removal in separate migration |
| D14 | Documentation | New revisioned document only; existing revisions unchanged |
| D15 | Department permissions | Separate per department (cutting/operator/general) |
| D16 | Note permissions | Separate per department |
| D17 | Django Admin RBAC | Accessible only to Django Superusers; non-superuser staff gain no RBAC capability |

---

## 3. Final Database Schema

### 3.1 New tables (app: `accounts`)

All tables inherit `TimeStampedUUIDModel` (UUID PK, `created_at`, `updated_at`).

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
| role_id | UUID | NO | | FK → accounts_role(id), CASCADE |
| assigned_by | UUID | NO | | FK → accounts_user(id), PROTECT |
| assigned_at | TIMESTAMPTZ | NO | now() | |

Constraints: UNIQUE(user_id, role_id). Indexes: `(user_id, role_id)`.
Deletion policy: CASCADE on user/role delete. Role delete blocked at application layer if UserRole rows exist (409).

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
| actor_id | UUID | YES | | FK → accounts_user(id), SET NULL (actor may be deleted) |
| action | VARCHAR(50) | NO | | e.g. `role.create`, `userrole.assign` |
| target_type | VARCHAR(50) | NO | | `role`, `permission`, `userrole`, `rolepermission`, `user` |
| target_id | UUID | YES | | UUID of target object |
| before_state | JSONB | YES | | Serialized before state |
| after_state | JSONB | YES | | Serialized after state |
| metadata | JSONB | YES | | Request ID, IP, user agent, etc. |
| created_at | TIMESTAMPTZ | NO | now() | |

Indexes: `(actor_id, created_at)`, `(target_type, target_id)`, `(created_at)`.
Deletion policy: **Never cascade-delete audit rows.** On related object delete, audit rows retain `target_id` and `before_state`/`after_state`; `actor_id` SET NULL if actor deleted.

### 3.2 Model relationships

```
User (existing)
    │
    ├── user_roles (FK CASCADE) ── UserRole ◄── role (FK CASCADE) ── Role
    │                                          │                       │
    │                                          └── role_permissions ── RolePermission ── permission (FK CASCADE) ── Permission
    │
    └── (existing: is_superuser, is_staff, is_active, groups, user_permissions)

RBACAuditLog (standalone; actor FK SET NULL; target by type+id)
```

### 3.3 Existing User model
- `User.role` field retained during Phase 2; removed only in a separate, later migration after code independence confirmed.
- Dedicated business methods added: `has_business_permission()`, `get_effective_business_permissions()`, `has_any_business_permission()`, `has_all_business_permissions()`.
- `User.has_perm()` is NOT overridden.
- `Role` TextChoices enum retained in code until final cleanup.

---

## 4. Final Permission Catalog

### 4.1 Orders module (`orders`)

| Codename | Name | Endpoint | Method |
|----------|------|----------|--------|
| orders.view_order | View Order | GET /api/v1/orders/, GET /api/v1/orders/{id}/ | List/Retrieve |
| orders.create_order | Create Order | POST /api/v1/orders/ | Create |
| orders.update_order | Update Order | PATCH /api/v1/orders/{id}/ | Partial update |
| orders.delete_order | Delete Order | — | Reserved (no delete endpoint) |
| orders.assign_order | Assign Order | PATCH /api/v1/orders/{id}/assign/ | Custom action |
| orders.change_order_status | Change Order Status | PATCH /api/v1/orders/{id}/status/ | Custom action |
| orders.view_order_images | View Order Images | GET /.../original-image/, GET /.../generated-image/ | Custom actions |
| orders.view_order_history | View Order History | GET /api/v1/orders/{id}/history/ | Custom action |
| orders.view_order_notes | View Order Notes | GET /api/v1/orders/{id}/notes/ | Custom action |
| orders.add_order_note | Add Order Note | POST /api/v1/orders/{id}/notes/ | Custom action |
| orders.view_order_assignments | View Assignments | GET /api/v1/orders/{id}/assignments/ | Custom action |
| orders.view_all_orders | View All Orders (data-scope override) | — | Used in queryset filter |

### 4.2 Employees module (`employees`)

| Codename | Name | Endpoint | Method | Restricted to |
|----------|------|----------|--------|---------------|
| employees.view_employee | View Employee | GET /api/v1/employees/, GET /api/v1/employees/{id}/ | List/Retrieve | — |
| employees.create_employee | Create Employee | POST /api/v1/employees/ | Create | — |
| employees.update_employee | Update Employee | PATCH /api/v1/employees/{id}/ | Partial update | — |
| employees.deactivate_employee | Deactivate Employee | POST /api/v1/employees/{id}/deactivate/ | Custom | — |
| employees.assign_roles | Assign Roles | POST/DELETE /api/v1/employees/{id}/roles/ | Custom | Superuser only |

### 4.3 Production module (`production`)

| Codename | Name | Endpoint | Method |
|----------|------|----------|--------|
| production.update_cutting_status | Update Cutting Status | PATCH /api/v1/orders/{id}/status/ (dept=CUTTING) | Custom |
| production.update_operator_status | Update Operator Status | PATCH /api/v1/orders/{id}/status/ (dept=OPERATOR) | Custom |
| production.add_note_cutting | Add Cutting Note | POST /api/v1/orders/{id}/notes/ (dept=CUTTING) | Custom |
| production.add_note_operator | Add Operator Note | POST /api/v1/orders/{id}/notes/ (dept=OPERATOR) | Custom |
| production.add_note_general | Add General Note | POST /api/v1/orders/{id}/notes/ (dept=GENERAL) | Custom |
| production.view_history | View Production History | GET /api/v1/orders/{id}/history/ | Custom |
| production.view_notes | View Production Notes | GET /api/v1/orders/{id}/notes/ | Custom |

### 4.4 Targets module (`targets`)

| Codename | Name | Endpoint | Method |
|----------|------|----------|--------|
| targets.view_target | View Target | GET /api/v1/targets/, GET /api/v1/targets/{id}/ | List/Retrieve |
| targets.create_target | Create Target | POST /api/v1/targets/ | Create |
| targets.update_target | Update Target | PATCH /api/v1/targets/{id}/ | Partial update |
| targets.delete_target | Delete Target | DELETE /api/v1/targets/{id}/ | Destroy |

### 4.5 Reports module (`reports`)

| Codename | Name | Endpoint | Method |
|----------|------|----------|--------|
| reports.view_dashboard | View Dashboard | GET /api/v1/reports/dashboard/ | List |
| reports.view_employee_report | View Employee Report | GET /api/v1/reports/employees/ | List |
| reports.view_production_report | View Production Report | GET /api/v1/reports/production/ | List |
| reports.view_target_report | View Target Report | GET /api/v1/reports/targets/ | List |

### 4.6 Roles & Permissions module — SUPERUSER ONLY

| Codename | Name | Endpoint | Method | Restricted to |
|----------|------|----------|--------|---------------|
| roles.view_role | View Role | GET /api/v1/roles/, GET /api/v1/roles/{id}/ | List/Retrieve | Superuser only |
| roles.create_role | Create Role | POST /api/v1/roles/ | Create | Superuser only |
| roles.update_role | Update Role | PATCH /api/v1/roles/{id}/ | Partial update | Superuser only |
| roles.delete_role | Delete Role | DELETE /api/v1/roles/{id}/ | Destroy | Superuser only |
| roles.assign_permissions | Assign Permissions | POST/DELETE /api/v1/roles/{id}/permissions/ | Custom | Superuser only |
| permissions.view_permission | View Permission | GET /api/v1/permissions/, GET /api/v1/permissions/{id}/ | List/Retrieve | Superuser only |

### 4.7 Authentication module (`auth`) — unchanged

| Codename | Name | Endpoint |
|----------|------|----------|
| auth.login | Login | POST /api/v1/auth/login/ |
| auth.refresh | Refresh Token | POST /api/v1/auth/refresh/ |
| auth.logout | Logout | POST /api/v1/auth/logout/ |
| auth.view_profile | View Profile | GET /api/v1/auth/me/ |
| auth.update_profile | Update Profile | PATCH /api/v1/auth/me/ |

### 4.8 Initial role templates (migration data)

| Role | Permissions |
|------|-------------|
| ADMIN | All business permissions (orders, employees, production, targets, reports) + `orders.view_all_orders` |
| CUTTING_MAN | orders.view_order, orders.change_order_status, production.update_cutting_status, production.add_note_cutting, production.add_note_general, production.view_history, production.view_notes, orders.view_order_assignments |
| OPERATOR | orders.view_order, orders.change_order_status, production.update_operator_status, production.add_note_operator, production.add_note_general, production.view_history, production.view_notes, orders.view_order_assignments |

**Total: ~46 granular permissions across 8 modules. Catalog fixed; superusers assign existing catalog permissions to roles dynamically. No API endpoint creates new permission codenames.**

---

## 5. Final Endpoint Authorization Matrix

For every endpoint: API-level required permission, service-level checks, data-scope, department assignment, status-transition.

### 5.1 Employees endpoints

| Endpoint | Method | API permission | Service-level checks | Data-scope | Dept assignment | Status-transition |
|----------|--------|----------------|----------------------|------------|-----------------|-------------------|
| /employees/ | GET | employees.view_employee | None | All (admin) / None (non-admin) | N/A | N/A |
| /employees/ | POST | employees.create_employee | Guard is_superuser/is_staff fields | N/A | N/A | N/A |
| /employees/{id}/ | GET | employees.view_employee | None | N/A | N/A | N/A |
| /employees/{id}/ | PATCH | employees.update_employee | Guard is_superuser/is_staff fields | N/A | N/A | N/A |
| /employees/{id}/deactivate/ | POST | employees.deactivate_employee | Last-superuser protection | N/A | N/A | N/A |
| /employees/{id}/roles/ | GET | employees.view_employee | None | N/A | N/A | N/A |
| /employees/{id}/roles/ | POST | employees.assign_roles (superuser only) | Idempotent duplicate | N/A | N/A | N/A |
| /employees/{id}/roles/{role_id}/ | DELETE | employees.assign_roles (superuser only) | None | N/A | N/A | N/A |
| /employees/{id}/effective-permissions/ | GET | employees.view_employee | Own only | N/A | N/A | N/A |

### 5.2 Orders endpoints

| Endpoint | Method | API permission | Service-level checks | Data-scope | Dept assignment | Status-transition |
|----------|--------|----------------|----------------------|------------|-----------------|-------------------|
| /orders/ | GET | orders.view_order | None | Admin/all; employee assigned only | N/A | N/A |
| /orders/{id}/ | GET | orders.view_order | Object-level via queryset | Assigned or all | N/A | N/A |
| /orders/ | POST | orders.create_order | resolve_assignee for cutting_man + operator | N/A | Cutting→cutting_man perm; Operator→operator perm | N/A |
| /orders/{id}/ | PATCH | orders.update_order | Object-level via queryset | Assigned or all | N/A | N/A |
| /orders/{id}/assign/ | PATCH | orders.assign_order | resolve_assignee (permission-based) | N/A | Target dept permission | N/A |
| /orders/{id}/status/ | PATCH | orders.change_order_status + production.update_*_status | Four-layer validation | Visible orders only | Current assignee for dept | Existing status rules |
| /orders/{id}/history/ | GET | orders.view_order_history | None | Assigned or all | N/A | N/A |
| /orders/{id}/notes/ | GET | orders.view_order_notes | None | Assigned or all | N/A | N/A |
| /orders/{id}/notes/ | POST | orders.add_order_note + production.add_note_* | Dept restriction (GENERAL+own for employees) | Visible orders only | Matching note dept perm | N/A |
| /orders/{id}/assignments/ | GET | orders.view_order_assignments | None | Assigned or all | N/A | N/A |
| /orders/{id}/original-image/ | GET | orders.view_order_images | Object-level via queryset | Assigned or all | N/A | N/A |
| /orders/{id}/generated-image/ | GET | orders.view_order_images | Object-level via queryset | Assigned or all | N/A | N/A |

### 5.3 Permission overlap resolution

| Overlapping pair | Resolution |
|------------------|------------|
| `orders.change_order_status` vs `production.update_cutting_status`/`production.update_operator_status` | Both required for status action: `orders.change_order_status` gates the API endpoint; `production.update_cutting_status` or `production.update_operator_status` gates the department-specific operation in the service layer. Non-redundant: API permission ≠ department permission. |
| `orders.add_order_note` vs `production.add_note_cutting`/`production.add_note_operator`/`production.add_note_general` | Both required for note creation: `orders.add_order_note` gates the API endpoint; `production.add_note_*` gates the department-specific note operation. |

### 5.4 Targets endpoints

| Endpoint | Method | API permission | Service-level checks | Data-scope | Dept assignment | Status-transition |
|----------|--------|----------------|----------------------|------------|-----------------|-------------------|
| /targets/ | GET | targets.view_target | None | N/A | N/A | N/A |
| /targets/{id}/ | GET | targets.view_target | None | N/A | N/A | N/A |
| /targets/ | POST | targets.create_target | validate_target_department (permission-based) | N/A | Target dept must match employee permission | N/A |
| /targets/{id}/ | PATCH | targets.update_target | validate_target_department | N/A | Target dept must match employee permission | N/A |
| /targets/{id}/ | DELETE | targets.delete_target | Blocked if completion credits exist | N/A | N/A | N/A |

### 5.5 Reports endpoints

| Endpoint | Method | API permission | Service-level checks | Data-scope | Dept assignment | Status-transition |
|----------|--------|----------------|----------------------|------------|-----------------|-------------------|
| /reports/dashboard/ | GET | reports.view_dashboard | None | All | N/A | N/A |
| /reports/employees/ | GET | reports.view_employee_report | None | All | N/A | N/A |
| /reports/production/ | GET | reports.view_production_report | None | All | N/A | N/A |
| /reports/targets/ | GET | reports.view_target_report | None | All | N/A | N/A |

### 5.6 Roles & Permissions endpoints (superuser only)

| Endpoint | Method | API permission | Additional restriction |
|----------|--------|----------------|----------------------|
| /roles/ | GET | roles.view_role | Superuser only |
| /roles/ | POST | roles.create_role | Superuser only |
| /roles/{id}/ | GET | roles.view_role | Superuser only |
| /roles/{id}/ | PATCH | roles.update_role | Superuser only |
| /roles/{id}/ | DELETE | roles.delete_role | Superuser only; 409 if assigned |
| /roles/{id}/permissions/ | POST | roles.assign_permissions | Superuser only |
| /roles/{id}/permissions/{perm_id}/ | DELETE | roles.assign_permissions | Superuser only |
| /permissions/ | GET | permissions.view_permission | Superuser only |
| /permissions/{id}/ | GET | permissions.view_permission | Superuser only |

### 5.7 Default deny rule
Every ViewSet and custom DRF action must explicitly declare `required_business_permission` (or `required_business_permissions`). A missing declaration = 403, never accidental allow. Auth endpoints (`/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`) use existing `AllowAny`/`IsAuthenticated`/`IsActiveUser` and are unchanged.

---

## 6. Data-Scope and Department Authorization Rules

### 6.1 Permission ≠ data scope ≠ department assignment (three separate checks)

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
expected_perm = {CUTTING: "production.update_cutting_status", OPERATOR: "production.update_operator_status"}[department]
if not user.has_business_permission(expected_perm):
    raise BusinessRuleError(...)
```
This allows a user with multiple roles (Cutting + Operator) to be assigned to either department.

---

## 7. Migration and Rollback Strategy

### 7.1 Migration sequence

| Migration | Type | Description | Reversible | Legacy `User.role` after |
|-----------|------|-------------|------------|--------------------------|
| 0002_rbac_models | Schema | Create Role, Permission, UserRole, RolePermission, RBACAuditLog tables | Yes (drop tables) | Present |
| 0003_populate_permissions | Data | Insert fixed permission catalog (~46 rows) | Yes (delete rows) | Present |
| 0004_create_initial_roles | Data | Create ADMIN/CUTTING_MAN/OPERATOR roles; map perms; create UserRole rows for all existing users | Yes (delete rows) | Present |
| 0005_verify_migration | Data (no schema) | Assert effective perms == old role perms for every user; raise on mismatch | N/A | Present |
| [Deploy RBAC-compatible code] | — | Legacy `User.role` retained; old code paths still work | N/A | Present |
| [Full regression + security tests] | — | 164 existing tests + new RBAC/security tests | N/A | Present |
| [Confirm code independent of User.role] | — | All services/views/selectors/tests use permission-based checks | N/A | Present |
| 0006_remove_legacy_role | Schema | Remove `User.role` field and related index | **No** (backup restore only) | Removed |

### 7.2 Deployment compatibility rule
Never remove a database field while deployed code still depends on it. `User.role` remains until every service/view/selector/test has been migrated to permission-based checks and the full test suite passes.

### 7.3 Migration 0005 verification
For every user: compute effective perms from new tables; compare to expected perms derived from old `role`; assert equality. Any mismatch aborts. Superusers verified to retain `is_superuser`.

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

## 8. Cache Architecture

### 8.1 Cache design
- Key format: `rbac:user_perms:{user_uuid}`
- Value: JSON object `{"version": <int>, "permissions": [<codename>, ...]}`
- TTL: `RBAC_PERM_CACHE_TTL` setting, default 300 seconds
- Backend: LocMem (dev/test); Redis (production)
- **Never cache superuser status** — always check `user.is_superuser` directly.

### 8.2 Generation-based cache (race-condition fix)

Each user has a permission generation counter incremented on any mutation affecting their effective permissions:

```
cache key: "rbac:user_perms:{user_uuid}" → {"version": N, "permissions": [...]}
cache key: "rbac:user_version:{user_uuid}" → N (integer counter)
```

**Read path:**
1. Read version key `V_cache`.
2. Read permissions key; if present and its embedded `version == V_cache`, return permissions.
3. Otherwise, query DB, compute permissions, write `{"version": V_db, "permissions": ...}` where `V_db` is read fresh from version key inside the same transaction.

**Write path (mutation):**
1. Inside `transaction.atomic()`, increment version counter for affected user(s).
2. On commit (`transaction.on_commit`), delete permissions cache key for affected user(s).
3. Version key remains; next read sees new version and re-fetches.

This prevents the stale-write race:
- Request A reads version=5, permissions=P_old (cache miss, about to write).
- Request B mutates, increments version to 6, commits, deletes permissions key.
- Request A writes `{"version": 5, "permissions": P_old}` — but the embedded version (5) ≠ current version key (6), so subsequent reads reject it and re-fetch.

Alternatively, use `cache.add()` (set-if-absent) for the permissions key so only the first writer wins, combined with version checking on read.

### 8.3 Invalidation triggers (on_commit)

| Event | Signal | Timing | Action |
|-------|--------|--------|--------|
| UserRole created/deleted | post_save/post_delete | on_commit | increment version + delete perms cache for user |
| Role.is_active changed | pre_save (diff) | on_commit post_save | increment version + delete perms cache for all users with role |
| RolePermission created/deleted | post_save/post_delete | on_commit | increment version + delete perms cache for all users with role |
| Permission.is_active changed | pre_save (diff) | on_commit post_save | increment version + delete perms cache for all users with roles having that permission |
| User.is_active changed | pre_save (diff) | on_commit post_save | increment version + delete perms cache for user |

Security-sensitive revocation does NOT rely only on the 300-second TTL; explicit invalidation occurs on every mutation.

---

## 9. Last Superuser Protection

### 9.1 Protection layers

| Layer | Mechanism |
|-------|-----------|
| API | `EmployeeViewSet.deactivate` and `EmployeeUpdateSerializer.validate()` reject deactivation/demotion of the last active superuser |
| Django Admin | `UserAdmin` overrides `delete_model`/`delete_queryset`/`save_model` to block last superuser removal |
| Centralized service | `accounts/services/user_management.py` `deactivate_user()` / `demote_user()` enforce last-superuser rule in a transaction with `select_for_update()` |
| Database locking | `select_for_update()` on superuser rows within transaction; counts active superusers under lock |
| Direct ORM | Not preventable via ORM alone; documented limitation; audit log captures direct mutations; admin/API are the supported paths |

### 9.2 Concurrency-safe algorithm

```
def deactivate_user(target_user, actor):
    with transaction.atomic():
        target = User.objects.select_for_update().get(pk=target_user.pk)
        if target.is_superuser and target.is_active:
            active_count = User.objects.filter(is_superuser=True, is_active=True).count()
            if active_count <= 1:
                raise LastSuperuserError("Cannot deactivate the last active superuser.")
        # ... proceed
```

Same pattern for demotion (removing `is_superuser`) and deletion. `select_for_update()` serializes concurrent attempts; only one succeeds.

### 9.3 Direct ORM limitations
Direct `User.objects.filter(is_superuser=True).update(is_active=False)` bypasses application-layer protection. This is a documented limitation; mitigation is audit logging + database-level restrictions (e.g., PostgreSQL row-level security or revoking direct table access from application users) as an optional deployment hardening step.

### 9.4 Tests
- Simultaneous attempts to deactivate the last active superuser (threading.Barrier): exactly one succeeds.
- Demotion of last superuser via PATCH → 400.
- Deletion of last superuser via API → 400/403.
- Django Admin delete of last superuser blocked.
- Centralized service rejects last-superuser demotion.

---

## 10. Immutable Audit Architecture

### 10.1 Audit events

| Event | Action value | Target type |
|-------|-------------|-------------|
| Role created | role.create | role |
| Role updated | role.update | role |
| Role deactivated | role.deactivate | role |
| Role deleted | role.delete | role |
| Permission assigned to role | rolepermission.assign | rolepermission |
| Permission revoked from role | rolepermission.revoke | rolepermission |
| Permission activated | permission.activate | permission |
| Permission deactivated | permission.deactivate | permission |
| User role assigned | userrole.assign | userrole |
| User role removed | userrole.remove | userrole |
| User deactivated | user.deactivate | user |
| Last superuser protected | superuser.protect | user |

### 10.2 Audit record fields

| Field | Description |
|-------|-------------|
| actor_id | User who performed the action (SET NULL if actor deleted) |
| action | Action name (from table above) |
| target_type | `role`, `permission`, `userrole`, `rolepermission`, `user` |
| target_id | UUID of target object |
| before_state | JSON snapshot before change |
| after_state | JSON snapshot after change |
| metadata | Request ID, IP, user agent, timestamp |
| created_at | Immutable timestamp |

### 10.3 Survival guarantees
- Audit rows are **never cascade-deleted** when roles, permissions, or users are deleted/deactivated.
- `target_id` is retained even if the target object no longer exists (soft reference).
- `actor_id` uses `SET NULL` so audit survives actor deletion.
- Audit table has no FK constraints that would cascade deletions.

### 10.4 Implementation
Audit entries are created inside the same `transaction.atomic()` as the mutation, using `transaction.on_commit` to write audit rows only on successful commit. Audit service is centralized: `accounts/services/audit.py` `log_rbac_event()`.

---

## 11. Business Admin Permission Boundary (Proof)

**Business Admin is a normal business role, never a Django Superuser.** It cannot receive:

- `roles.create_role`
- `roles.update_role`
- `roles.delete_role`
- `roles.assign_permissions`
- `employees.assign_roles`

**Enforcement:**
1. All RBAC ViewSets (`RoleViewSet`, `UserRoleViewSet`) check `request.user.is_superuser` explicitly on every mutating action, in addition to permission classes.
2. The migration's initial `ADMIN` role receives business permissions only (orders, employees, production, targets, reports) — it does NOT receive `roles.*` or `employees.assign_roles`.
3. Tests assert business admin with dynamic ADMIN role gets 403 on all RBAC mutation endpoints.

**Business Admin CAN:**
- Full CRUD on Orders, Employees, Targets, Reports (business operations)
- All production operations
- View own effective permissions
- View roles (read-only, if `roles.view_role` granted — but recommended: not granted at all)

---

## 12. RBAC Visibility Policy

| Actor | Can view RBAC config (roles/permissions) | Can mutate RBAC config | Can view own effective permissions | Can view other users' effective permissions |
|-------|------------------------------------------|------------------------|------------------------------------|---------------------------------------------|
| Django Superuser | Yes | Yes | Yes | Yes |
| Business Admin | No | No | Yes | No |
| Employee | No | No | Yes | No |

- `GET /roles/` and `GET /permissions/` require superuser (not just `roles.view_role`/`permissions.view_permission`).
- `GET /employees/{id}/effective-permissions/` requires the requester to be the same user or a superuser.
- No non-superuser may inspect or manage roles, role assignments, or permission configuration.

---

## 13. Final Consistency Review

| Item | Status | Notes |
|------|--------|-------|
| Contradictory statements | Resolved | All revisions aligned to Revision 3 |
| Missing endpoint permissions | Resolved | Section 5 covers all endpoints |
| Incorrect permission names | Resolved | All codenames match Section 4 |
| Missing custom DRF actions | Resolved | assign, status, history, notes, images, assignments, deactivate, roles, effective-permissions all listed |
| Migration ordering | Resolved | Section 7 sequence with verification step |
| Rollback gaps | Resolved | Section 7.4 covers all migrations; 0006 backup-only |
| Superuser bootstrap | Resolved | Section 7.5 |
| Inactive-user behavior | Resolved | Empty permission set; excluded from queries |
| Role/permission deletion + audit | Resolved | Section 8.1 (audit survives); Section 3.1 (deletion policy) |
| JWT legacy role claim | Resolved | Informational only; server re-validates |
| Multiple-role union semantics | Resolved | Section 6 (union of active roles) |
| Employee assignment + dept scope | Resolved | Section 6.4 permission-based resolve_assignee |
| Business workflow compatibility | Resolved | Existing validation rules preserved |

### Items requiring codebase verification (not assumed)
- Exact URL names/basenames used by DRF routers for custom actions (`assign`, `status`, etc.) — verify against `apps/orders/views.py`, `apps/targets/views.py`.
- `EmployeeTargetViewSet` location (`apps/targets/views.py`) — verify custom action decorators.
- `ProductionStatusHistorySerializer`, `OrderNoteSerializer` field shapes — verify serializers.
- `OverallStatus`, `NoteDepartment`, `ProductionStatus` enum values — verify `common/enums.py`.
- Existing test fixture structure in `conftest.py` — verify before updating fixtures (Phase 3 only).
- Whether `rest_framework_simplejwt.token_blacklist` is migrated — verify migrations.

---

## 14. Comprehensive Positive and Negative Security Tests

### 14.1 Positive tests

| Test | Description |
|------|-------------|
| Superuser creates role with permissions | POST `/roles/` → 201 |
| Superuser updates role | PATCH `/roles/{id}/` → 200 |
| Superuser deactivates role | PATCH `/roles/{id}/` is_active=false → 200 |
| Superuser assigns role to user | POST `/employees/{id}/roles/` → 200 |
| User with multiple roles gets union of permissions | Effective permissions = union |
| Removing one role preserves another's permissions | Remove role A; role B perms intact |
| Idempotent duplicate role assignment | POST same role twice → 200 both |
| Superuser bypasses all permission checks | `has_business_permission()` → True |
| Inactive user gets no permissions | Empty set |
| Inactive role excluded | Permissions not effective |
| Inactive permission excluded | Not granted |
| Cache invalidation on UserRole change | Next read re-fetches |
| Cutting man updates cutting status | Has `production.update_cutting_status` |
| Admin updates both departments | Has both dept permissions |
| Business admin full business access | Dynamic ADMIN role works |
| Data scope preserved | Employees see only assigned orders |

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
| Employee GET `/employees/{id}/effective-permissions/` (other user) | 403 |
| Role named "ADMIN" with no permissions | 403 on all endpoints |
| Inactive role → permissions not effective | 403 |
| Inactive permission → not granted | 403 |
| Direct API POST `/orders/` without permission | 403 |
| JWT token role claim="ADMIN" but no perms | 403 |
| Last superuser deactivation via API | 400 |
| Last superuser demotion via API (`is_superuser=false`) | 400 |
| Last superuser deletion via API | 400/403 |
| Concurrent last-superuser deactivation (threading.Barrier) | Exactly one succeeds |
| Missing required permission on ViewSet | 403 (default deny) |
| Business admin PATCH `/employees/{id}/` with `is_superuser` | 400 |
| Business admin PATCH `/employees/{id}/` with `is_staff` | 400 |
| Role delete with active UserRole | 409 |

### 14.3 Last-superuser concurrency test
Two simultaneous requests to deactivate the last active superuser, synchronized with `threading.Barrier(2)`. Exactly one returns 200; the other returns 400. Afterward, exactly one active superuser remains.

### 14.4 Regression tests
accounts.test_api (~35), orders.test_api (~55), production.test_api (~35), targets.test_api (~30), reports.test_api (~10), model tests (~15) — all must pass with legacy `User.role` still present during transition.

---

## 15. Final Implementation Sequence

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

### Phase E: Legacy field removal (only after code independence confirmed)
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
| G1 | `docs/rbac-phase2-architecture-plan-v3.md` | New (this document) |

---

## 16. Remaining Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Superuser lockout during migration | Very Low | Critical | Multi-layer last-superuser protection; admin site fallback |
| Cache stale-read race | Low | Medium | Generation-based cache + on_commit invalidation; 300s TTL backstop |
| Performance regression on permission checks | Low | Medium | Cache, DB indexes, distinct() |
| Test suite failures during transition | High | Medium | Legacy `User.role` retained during transition; update fixtures incrementally |
| Data scope regression | Low | High | Preserve `orders_for_user` logic; four-layer validation; regression tests |
| Business Admin gains RBAC authority | Low | Critical | Explicit `is_superuser` checks in all RBAC views; negative security tests |
| Default-deny oversight on new ViewSet | Medium | High | Code review: every ViewSet declares `required_business_permission` |
| JWT role claim stale vs RBAC tables | Low | Medium | Server re-validates; claim informational only |
| Direct ORM bypass of last-superuser protection | Low | Critical | Documented limitation; audit log; optional DB-level hardening |
| `User.role` removal too early | Medium | High | Enforced deployment sequence; code independence verified before 0006 |

---

## 17. Implementation Approval Checklist

Before Phase 3 implementation begins, confirm:

- [ ] All 17 confirmed decisions (Section 2) are approved.
- [ ] Database schema (Section 3) matches intended design.
- [ ] Permission catalog (Section 4) covers all existing API actions.
- [ ] Endpoint authorization matrix (Section 5) has no missing endpoints.
- [ ] Data-scope and department rules (Section 6) preserve existing behavior.
- [ ] Migration sequence (Section 7) is acceptable; rollback procedures understood.
- [ ] Cache architecture (Section 8) with generation-based invalidation is approved.
- [ ] Last-superuser protection (Section 9) covers all required layers.
- [ ] Immutable audit architecture (Section 10) is acceptable.
- [ ] Business Admin boundary proof (Section 11) is acceptable.
- [ ] RBAC visibility policy (Section 12) is acceptable.
- [ ] Implementation sequence (Section 15) is acceptable.
- [ ] Remaining risks (Section 16) are accepted.
- [ ] Items marked "requires codebase verification" (Section 13) will be verified in Phase 3 before code changes.

---

**STOP.** This document is complete. No source code has been modified, no migrations created, no database writes executed, no tests modified, and no implementation begun. Revision 1 and Revision 2 documents are left unchanged.

Awaiting explicit approval before Phase 3 Implementation.
