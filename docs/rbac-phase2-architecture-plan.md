# POMS — Dynamic RBAC Architecture & Implementation
## Phase 2: Detailed Architecture and Migration Plan

**Date:** 2026-11-25  
**Status:** For Approval — DO NOT IMPLEMENT  
**Based on:** Phase 1 Read-Only Audit Report + Confirmed Business Decisions  
**Codebase verified:** Django 5.2.18, DRF 3.16, SimpleJWT 5.5, PostgreSQL 16, custom `accounts.User(AbstractUser)`

---

## 1. Verified Facts (from codebase)

| Fact | Evidence |
|------|----------|
| Custom `User` extends `AbstractUser` + `TimeStampedUUIDModel` (UUID PK) | `apps/accounts/models.py:26` |
| Hardcoded `Role` TextChoices: ADMIN, CUTTING_MAN, OPERATOR | `apps/accounts/models.py:20-23` |
| `User.role` CharField, default `OPERATOR`, db_index | `apps/accounts/models.py:39-44` |
| Role helper properties: `is_admin`, `is_cutting_man`, `is_operator`, `is_employee` | `apps/accounts/models.py:62-77` |
| `UserManager` is Django default; no custom create_user/create_superuser | `apps/accounts/migrations/0001_initial.py:47` |
| Hardcoded permission classes: `IsAdmin`, `IsEmployee`, `IsAdminOrReadOnly` | `apps/accounts/permissions.py` |
| `_DEPARTMENT_FOR_ROLE` duplicated in 3 services | `orders/services.py:19-22`, `production/services.py:18-21`, `targets/services.py:13-16` |
| `orders_for_user`: ADMIN sees all, employee sees only assigned orders | `orders/selectors.py:9-18` |
| `update_department_status`: ADMIN any dept, employee only own dept role | `production/services.py:83` |
| `add_order_note`: ADMIN any dept, employee GENERAL + own dept | `production/services.py:145-151` |
| `validate_target_department`: dept must match role | `targets/services.py:19-34` |
| Reports filtered by `role__in=[CUTTING_MAN, OPERATOR]` | `reports/views.py:67,71,93` |
| Token contains `role` claim | `serializers.py:164` |
| EmployeeViewSet: IsAuthenticated + IsAdmin | `views.py:85` |
| 164 tests exist; fixtures create users with hardcoded roles | `conftest.py:27-57` |
| `AUTH_USER_MODEL = "accounts.User"` already set | `config/settings/base.py:150` |

---

## 2. Assumptions vs Recommendations vs Unresolved Decisions

### Verified facts
- All items in Section 1 above are verified against source code.

### Recommendations (to be confirmed by user)
- Superuser bypasses all permission checks (`is_superuser` → allow all). Django convention.
- Business Admin role gets ALL business permissions (not system authority).
- `orders.view_all_orders` is a separate explicit permission for full data scope.

### Unresolved decisions (require user approval — Section 16)
- Duplicate role assignment: 400 vs idempotent 200.
- Role deletion: block (409) vs cascade vs soft-delete.
- Permission catalog: fixed/code-defined vs dynamic/superuser-creatable.
- Cache TTL value.
- Last Superuser protection: API only vs model `clean()` vs both.

---

## 3. Detailed Database Schema and Model Relationships

### 3.1 New tables (app: `accounts`)

**`accounts_role`** — dynamic business role
| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| id | UUID | NO | gen_random_uuid() | PK |
| name | VARCHAR(100) | NO | | UNIQUE |
| description | TEXT | YES | '' | |
| is_active | BOOLEAN | NO | TRUE | |
| created_by | UUID | NO | | FK → accounts_user(id), ON DELETE PROTECT |
| created_at | TIMESTAMPTZ | NO | now() | |
| updated_at | TIMESTAMPTZ | NO | now() | |

Indexes: `(is_active, name)`, unique on `name`.

**`accounts_permission`** — granular permission
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

Indexes: `(module, is_active)`, unique on `codename`.

**`accounts_userrole`** — user-role assignment (M2M through table)
| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| id | UUID | NO | gen_random_uuid() | PK |
| user_id | UUID | NO | | FK → accounts_user(id), CASCADE |
| role_id | UUID | NO | | FK → accounts_role(id), CASCADE |
| assigned_by | UUID | NO | | FK → accounts_user(id), PROTECT |
| assigned_at | TIMESTAMPTZ | NO | now() | |

Constraints: UNIQUE(user_id, role_id). Indexes: `(user_id, role_id)`.

**`accounts_rolepermission`** — role-permission assignment (M2M through table)
| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| id | UUID | NO | gen_random_uuid() | PK |
| role_id | UUID | NO | | FK → accounts_role(id), CASCADE |
| permission_id | UUID | NO | | FK → accounts_permission(id), CASCADE |
| assigned_by | UUID | NO | | FK → accounts_user(id), PROTECT |
| assigned_at | TIMESTAMPTZ | NO | now() | |

Constraints: UNIQUE(role_id, permission_id). Indexes: `(role_id, permission_id)`.

### 3.2 Model relationships

```
User (existing)
    │
    ├── user_roles (FK, CASCADE) ── UserRole ◄── role (FK, CASCADE) ── Role
    │                                          │                       │
    │                                          └── role_permissions ── RolePermission ── permission (FK, CASCADE) ── Permission
    │
    └── (existing: is_superuser, is_staff, is_active, groups, user_permissions)
```

### 3.3 Existing User model — no schema change in Phase 2
- Keep `User.role` field (do NOT drop until after migration verification).
- Add `has_perm()`, `has_any_perm()`, `has_all_perm()` methods to `User` (Python-level, no DB change).
- Keep `Role` TextChoices enum in code until final cleanup migration.

### 3.4 Migration numbering
Existing latest migration: `accounts 0001_initial`. New migrations start at `0002`.

---

## 4. Complete Permission Catalog

Based on actual existing API actions and business workflows verified in the codebase.

### 4.1 Orders module (`orders`)

| Codename | Name | API Endpoint | Method |
|----------|------|--------------|--------|
| orders.view_order | View Order | GET /api/v1/orders/, GET /api/v1/orders/{id}/ | List/Retrieve |
| orders.create_order | Create Order | POST /api/v1/orders/ | Create |
| orders.update_order | Update Order | PATCH /api/v1/orders/{id}/ | Partial update |
| orders.delete_order | Delete Order | — | Reserved (no delete endpoint exists) |
| orders.assign_order | Assign Order | PATCH /api/v1/orders/{id}/assign/ | Custom action |
| orders.change_order_status | Change Order Status | PATCH /api/v1/orders/{id}/status/ | Custom action |
| orders.view_order_images | View Order Images | GET /.../original-image/, GET /.../generated-image/ | Custom actions |
| orders.view_order_history | View Order History | GET /api/v1/orders/{id}/history/ | Custom action |
| orders.view_order_notes | View Order Notes | GET /api/v1/orders/{id}/notes/ | Custom action |
| orders.add_order_note | Add Order Note | POST /api/v1/orders/{id}/notes/ | Custom action |
| orders.view_order_assignments | View Assignments | GET /api/v1/orders/{id}/assignments/ | Custom action |

### 4.2 Employees module (`employees`)

| Codename | Name | API Endpoint | Method |
|----------|------|--------------|--------|
| employees.view_employee | View Employee | GET /api/v1/employees/, GET /api/v1/employees/{id}/ | List/Retrieve |
| employees.create_employee | Create Employee | POST /api/v1/employees/ | Create |
| employees.update_employee | Update Employee | PATCH /api/v1/employees/{id}/ | Partial update |
| employees.deactivate_employee | Deactivate Employee | POST /api/v1/employees/{id}/deactivate/ | Custom action |
| employees.assign_roles | Assign Roles | POST/DELETE /api/v1/employees/{id}/roles/ | Custom action |

### 4.3 Production module (`production`)

| Codename | Name | API Endpoint | Method |
|----------|------|--------------|--------|
| production.update_cutting_status | Update Cutting Status | PATCH /api/v1/orders/{id}/status/ (dept=CUTTING) | Custom action |
| production.update_operator_status | Update Operator Status | PATCH /api/v1/orders/{id}/status/ (dept=OPERATOR) | Custom action |
| production.add_note_cutting | Add Cutting Note | POST /api/v1/orders/{id}/notes/ (dept=CUTTING) | Custom action |
| production.add_note_operator | Add Operator Note | POST /api/v1/orders/{id}/notes/ (dept=OPERATOR) | Custom action |
| production.add_note_general | Add General Note | POST /api/v1/orders/{id}/notes/ (dept=GENERAL) | Custom action |
| production.view_history | View Production History | GET /api/v1/orders/{id}/history/ | Custom action |
| production.view_notes | View Production Notes | GET /api/v1/orders/{id}/notes/ | Custom action |

### 4.4 Targets module (`targets`)

| Codename | Name | API Endpoint | Method |
|----------|------|--------------|--------|
| targets.view_target | View Target | GET /api/v1/targets/, GET /api/v1/targets/{id}/ | List/Retrieve |
| targets.create_target | Create Target | POST /api/v1/targets/ | Create |
| targets.update_target | Update Target | PATCH /api/v1/targets/{id}/ | Partial update |
| targets.delete_target | Delete Target | DELETE /api/v1/targets/{id}/ | Destroy (blocked if credits exist) |

### 4.5 Reports module (`reports`)

| Codename | Name | API Endpoint | Method |
|----------|------|--------------|--------|
| reports.view_dashboard | View Dashboard | GET /api/v1/reports/dashboard/ | List |
| reports.view_employee_report | View Employee Report | GET /api/v1/reports/employees/ | List |
| reports.view_production_report | View Production Report | GET /api/v1/reports/production/ | List |
| reports.view_target_report | View Target Report | GET /api/v1/reports/targets/ | List |

### 4.6 Roles & Permissions module (`roles` / `permissions`)

| Codename | Name | API Endpoint | Method |
|----------|------|--------------|--------|
| roles.view_role | View Role | GET /api/v1/roles/, GET /api/v1/roles/{id}/ | List/Retrieve |
| roles.create_role | Create Role | POST /api/v1/roles/ | Create |
| roles.update_role | Update Role | PATCH /api/v1/roles/{id}/ | Partial update |
| roles.delete_role | Delete Role | DELETE /api/v1/roles/{id}/ | Destroy |
| roles.assign_permissions | Assign Permissions | POST/DELETE /api/v1/roles/{id}/permissions/ | Custom action |
| permissions.view_permission | View Permission | GET /api/v1/permissions/, GET /api/v1/permissions/{id}/ | List/Retrieve |

### 4.7 Data-scope permission (`orders`)

| Codename | Name | Purpose |
|----------|------|---------|
| orders.view_all_orders | View All Orders | Bypass data-scope filter; see every order (Business Admin) |

**Total: ~46 granular permissions across 8 modules.**

### 4.8 Initial role templates (migration data)

| Role | Permissions |
|------|-------------|
| ADMIN | All business permissions (orders, employees, production, targets, reports) + orders.view_all_orders |
| CUTTING_MAN | orders.view_order, orders.change_order_status, production.update_cutting_status, production.add_note_cutting, production.add_note_general, production.view_history, production.view_notes, orders.view_order_assignments |
| OPERATOR | orders.view_order, orders.change_order_status, production.update_operator_status, production.add_note_operator, production.add_note_general, production.view_history, production.view_notes, orders.view_order_assignments |

---

## 5. Permission vs Data-Scope Architecture

### 5.1 Core principle (separate concepts)

- **Permission** = "May the user perform action X on resource type Y?" (checked at the API gate / DRF permission class).
- **Data Scope** = "Which specific instances of resource Y may this user see or modify?" (checked at the queryset / selector layer).

Having `orders.view_order` must NOT automatically mean viewing every order.

### 5.2 Enforcement layers

| Layer | Responsibility | Implementation point |
|-------|----------------|----------------------|
| Permission check | `has_perm(codename)` | DRF `HasPermission` class on `has_permission` |
| Data-scope filter | Instance visibility | `get_queryset()` / selectors, filtered by assignments |

### 5.3 Data-scope rules (current behavior preserved exactly)

| Resource | Django Superuser | Business Admin (all perms) | Employee (Cutting/Operator) |
|----------|------------------|----------------------------|------------------------------|
| Orders (list/retrieve) | All orders | All orders (if `orders.view_all_orders`) | Only assigned orders (cutting_man OR operator) |
| Order status update | Any department | Any department | Only currently assigned department |
| Order notes | Any dept + GENERAL | Any dept + GENERAL | GENERAL + own department only |
| Order history | All | All | Only assigned orders |
| Employees | All | All | None (endpoint admin-only) |
| Targets | All | All | None (endpoint admin-only) |
| Reports | All | All | None (endpoint admin-only) |
| Roles / Permissions | All | None (unless `roles.*` granted) | None |

### 5.4 Special permission: `orders.view_all_orders`
Explicit data-scope override for Business Admins who need full order visibility without being Django Superusers. Not granted to employees by default.

---

## 6. Multiple-Role Assignment & Effective Permission Calculation

### 6.1 User model extension (Python methods, no DB change)

Add to `User`:
```python
def has_perm(self, perm: str) -> bool:
    if self.is_superuser:
        return True
    if not self.is_active:
        return False
    return perm in self._effective_permissions()

def has_any_perm(self, perms: list[str]) -> bool:
    if self.is_superuser:
        return True
    if not self.is_active:
        return False
    effective = self._effective_permissions()
    return any(p in effective for p in perms)

def has_all_perms(self, perms: list[str]) -> bool:
    if self.is_superuser:
        return True
    if not self.is_active:
        return False
    effective = self._effective_permissions()
    return all(p in effective for p in perms)
```

### 6.2 PermissionService (effective permission computation)

```
get_effective_permissions(user) -> set[str]:
    if user.is_superuser: return {"*"}   # sentinel = all permissions
    if not user.is_active: return set()
    cache key = f"rbac:user_perms:{user.pk}"
    if cached: return cached
    perms = Permission.objects.filter(
        role_permissions__role__user_roles__user=user,
        role_permissions__role__user_roles__role__is_active=True,
        role_permissions__role__user_roles__role__is_active=True,  # role active
        is_active=True,                                              # permission active
    ).values_list("codename", flat=True).distinct()
    cache.set(key, set(perms), TTL)
    return set(perms)
```

Key SQL semantics (verified logic):
- JOIN `UserRole` → `Role` (must be `is_active=True`) → `RolePermission` → `Permission` (must be `is_active=True`)
- Result = UNION of codenames across ALL active roles assigned to the user
- Removing one role does NOT remove permissions from another active role (union semantics)

### 6.3 DRF permission classes

| Class | Behavior |
|-------|----------|
| `HasPermission` | `has_perm(required_permission)` from view attribute |
| `HasAnyPermission` | `has_any_perm(required_permissions)` |
| `HasAllPermissions` | `has_all_perms(required_permissions)` |
| `IsActiveUser` | Kept unchanged (rejects deactivated users) |

Usage pattern on views:
```python
permission_classes = [IsAuthenticated, IsActiveUser, HasPermission]
required_permission = "orders.create_order"
```

Superuser bypass: `has_perm` returns True for `is_superuser` before consulting cache/DB. **Never cache superuser status.**

---

## 7. Superuser and Business Admin Security Boundary

### 7.1 Operations exclusively for Django Superusers (`is_superuser=True`)

| Operation | Enforcement |
|-----------|-------------|
| Create/promote Django Superusers | `UserManager.create_superuser` only; API `create`/`update` block `is_superuser`/`is_staff` writes from non-superusers |
| Change `is_superuser` flag | Serializer field guarded: only `request.user.is_superuser` may set |
| Change `is_staff` flag | Same guard |
| Modify Django `Group` / `Permission` | Admin site only; not exposed via API |
| Access Django admin site | `is_staff` requirement (unchanged) |
| Manage RBAC system itself | `roles.*` permissions; Business Admin can manage roles/perms but cannot elevate to system authority |

### 7.2 Business Admin (dynamic role with all business permissions)

**CAN:**
- Manage all business users (create, update, deactivate)
- Assign/remove business roles to users
- Create/update/deactivate business roles
- Assign/revoke permissions to roles
- Full CRUD on Orders, Employees, Targets, Reports
- All production operations (both departments)

**CANNOT:**
- Create or promote Django Superusers
- Modify `is_superuser` or `is_staff` on any user
- Access Django admin site (unless also `is_staff=True`, set only by superuser)
- Bypass data-scope rules (still sees only assigned orders unless `orders.view_all_orders` granted)
- Grant `roles.*` permissions to roles they don't themselves hold (defense: serializer validates assigner holds the permission being granted, or restrict `roles.assign_permissions` to superusers)

### 7.3 Implementation guard (serializer level)

In `EmployeeCreateSerializer`/`EmployeeUpdateSerializer.validate()`:
- Fields `is_superuser`, `is_staff`, `groups`, `user_permissions` are writable only when `request.user.is_superuser`; otherwise raise `ValidationError`.

---

## 8. Department and Production Authorization Architecture

### 8.1 Current coupling (verified)
- `_DEPARTMENT_FOR_ROLE` / `_ROLE_FOR_DEPARTMENT` hardcoded in 3 service files (CUTTING_MAN→CUTTING, OPERATOR→OPERATOR, ADMIN→both).
- `update_department_status`: `employee.role != Role.ADMIN and department != department_for_role(employee.role)` → deny.
- `add_order_note`: employees limited to GENERAL + `department_for_role(role)`.
- `validate_target_department`: target dept must equal role-mapped dept.

### 8.2 Decoupled design (permission-based, role-department mapping removed)

**Department access = permission, not role name.**

| Permission | Grants |
|------------|--------|
| production.update_cutting_status | Update CUTTING dept status |
| production.update_operator_status | Update OPERATOR dept status |
| production.add_note_cutting | Add notes to CUTTING dept |
| production.add_note_operator | Add notes to OPERATOR dept |
| production.add_note_general | Add notes to GENERAL dept |

**Assignment validation (`resolve_assignee`):** check `user.has_perm(expected_perm)` for the department, not `user.role == expected_role`. This allows a user with multiple roles (e.g., Cutting + Operator) to be assigned to either department.

### 8.3 Migration compatibility (3-phase)
1. Keep role-based mapping alongside new permission-based checks (dual validation, log discrepancies).
2. Migrate validation logic to permission-based; create permissions for existing roles.
3. Remove role-based mapping entirely (after `User.role` removal).

---

## 9. API Endpoint Specifications

### 9.1 Roles (`/api/v1/roles/`)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/roles/` | `roles.view_role` | List roles (paginated, filterable by is_active) |
| POST | `/roles/` | `roles.create_role` | Create role (+ optional permission_ids) |
| GET | `/roles/{id}/` | `roles.view_role` | Retrieve role with assigned permissions |
| PATCH | `/roles/{id}/` | `roles.update_role` | Update name, description, is_active |
| DELETE | `/roles/{id}/` | `roles.delete_role` | Delete role (blocked if assigned to users) |
| POST | `/roles/{id}/permissions/` | `roles.assign_permissions` | Grant permissions to role |
| DELETE | `/roles/{id}/permissions/{perm_id}/` | `roles.assign_permissions` | Revoke permission from role |
| GET | `/roles/{id}/users/` | `roles.view_role` | List users assigned this role |

### 9.2 Permissions (`/api/v1/permissions/`)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/permissions/` | `permissions.view_permission` | List catalog (grouped by module, filterable by is_active) |
| GET | `/permissions/{id}/` | `permissions.view_permission` | Retrieve permission detail |

### 9.3 User Roles (`/api/v1/employees/{id}/roles/`)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/employees/{id}/roles/` | `employees.view_employee` | List user's assigned roles |
| POST | `/employees/{id}/roles/` | `employees.assign_roles` | Assign a role to user |
| DELETE | `/employees/{id}/roles/{role_id}/` | `employees.assign_roles` | Remove role from user |

### 9.4 Effective Permissions (`/api/v1/employees/{id}/effective-permissions/`)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/employees/{id}/effective-permissions/` | `employees.view_employee` | View computed effective permissions (union) |

### 9.5 Employees (`/api/v1/employees/`) — extended

| Method | Path | Permission | Notes |
|--------|------|------------|-------|
| GET | `/employees/` | `employees.view_employee` | List |
| POST | `/employees/` | `employees.create_employee` | Superuser-only fields guarded |
| GET | `/employees/{id}/` | `employees.view_employee` | Retrieve |
| PATCH | `/employees/{id}/` | `employees.update_employee` | Superuser-only fields guarded |
| POST | `/employees/{id}/deactivate/` | `employees.deactivate_employee` | Soft-deactivate |

### 9.6 Existing endpoints — permission mapping

| Endpoint | Current permission | New required permission |
|----------|-------------------|-------------------------|
| GET/POST /employees/ | IsAdmin | employees.view_employee / employees.create_employee |
| PATCH/DELETE /employees/{id}/ | IsAdmin | employees.update_employee / employees.deactivate_employee |
| GET /orders/ | IsAuthenticated | orders.view_order (+ data scope in queryset) |
| POST/PATCH /orders/ | IsAdmin | orders.create_order / orders.update_order |
| PATCH /orders/{id}/assign/ | IsAdmin | orders.assign_order |
| PATCH /orders/{id}/status/ | IsAuthenticated (role-based dept) | orders.change_order_status + production.update_*_status |
| GET/POST /orders/{id}/notes/ | IsAuthenticated | orders.view_order_notes / orders.add_order_note (+ production.add_note_*) |
| GET /orders/{id}/history/ | IsAuthenticated | orders.view_order_history |
| GET /targets/ | IsAdmin | targets.view_target |
| POST/PATCH/DELETE /targets/{id}/ | IsAdmin | targets.create_target / targets.update_target / targets.delete_target |
| GET /reports/* | IsAdmin | reports.view_* |

Auth endpoints (`/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`) unchanged: `AllowAny` / `IsAuthenticated` / `IsActiveUser`.

---

## 10. Existing-User Data Migration Strategy

### 10.1 Mapping (no silent permission grants)

| Current `User.role` | Dynamic role created | Permissions granted |
|---------------------|----------------------|---------------------|
| ADMIN | `ADMIN` (full business administrator) | All business permissions + `orders.view_all_orders` |
| CUTTING_MAN | `CUTTING_MAN` | Cutting dept permissions + view own orders |
| OPERATOR | `OPERATOR` | Operator dept permissions + view own orders |

Each existing user receives exactly the permissions their old role provided. No user gains additional permissions. Inactive users still mapped (preserves history).

Superusers with `is_superuser=True`: retain `is_superuser` AND get the dynamic role matching their old `role` (they keep system authority + business role).

### 10.2 Migration phases

| Migration | Type | Description | Reversible |
|-----------|------|-------------|------------|
| 0002_rbac_models | Schema | Create Role, Permission, UserRole, RolePermission tables | Yes (drop tables) |
| 0003_populate_permissions | Data | Insert ~46 permission catalog rows | Yes (delete rows) |
| 0004_create_initial_roles | Data | Create ADMIN/CUTTING_MAN/OPERATOR roles; map perms; create UserRole rows for all existing users | Yes (delete rows) |
| 0005_verify_migration | Data (no schema) | Assert effective perms == old role perms for every user; raise on mismatch | N/A |
| 0006_remove_legacy_role | Schema | Remove `User.role` field and `role`/`is_active` index | **No** (requires backup restore) |

### 10.3 Dual-write transition (Migrations 0002–0005)
- Old `User.role` remains authoritative for auth.
- New RBAC tables populated but not yet used for authorization.
- Code reads both, logs discrepancies; after 0005 verification, switch auth to new system.
- Then remove `User.role` (0006) and hardcoded checks in code cleanup phase.

### 10.4 Migration 0005 verification query
For every user: compute effective perms from new tables; compare to expected perms derived from old `role`; assert equality. Any mismatch aborts migration.

---

## 11. Migration Ordering and Rollback Strategy

### 11.1 Sequence
```
0002_rbac_models.py          ← schema only
0003_populate_permissions.py ← data (permissions)
0004_create_initial_roles.py ← data (roles + user mappings)
0005_verify_migration.py     ← verification (no schema)
0006_remove_legacy_role.py   ← schema (remove User.role) — after verification
Code deployment              ← replace hardcoded checks with permission classes
```

### 11.2 Rollback procedures
| Migration | Rollback |
|-----------|----------|
| 0002 | `migrate accounts 0001` — drops new tables |
| 0003 | `migrate accounts 0002` — deletes permissions |
| 0004 | `migrate accounts 0003` — deletes roles/UserRole/RolePermission |
| 0005 | None needed (verification only) |
| 0006 | Cannot auto-rollback; restore `User.role` column + data from pre-migration backup |

### 11.3 Pre-migration checklist
- [ ] Full database backup (pg_dump)
- [ ] Test migration on staging with production data snapshot
- [ ] Verify all 164 tests pass with new RBAC
- [ ] Document rollback runbook
- [ ] Confirm at least one Django Superuser remains after migration

---

## 12. Cache Strategy and Permission Invalidation Rules

### 12.1 Cache design
- Key format: `rbac:user_perms:{user_uuid}`
- Value: set of permission codenames (JSON-serializable list)
- TTL: 300 seconds (5 minutes), configurable via setting `RBAC_PERM_CACHE_TTL`
- Backend: Django cache (LocMem in dev/test, Redis in production)
- **Never cache superuser status** — always check `user.is_superuser` directly.

### 12.2 Invalidation triggers (Django signals)

| Event | Signal | Action |
|-------|--------|--------|
| UserRole created | post_save | invalidate user |
| UserRole deleted | post_delete | invalidate user |
| Role.is_active changed | pre_save (diff detected) | invalidate all users with that role |
| RolePermission created/deleted | post_save/post_delete | invalidate all users with that role |
| Permission.is_active changed | pre_save (diff detected) | invalidate all users with roles having that permission |
| User.is_active changed | pre_save (diff detected) | invalidate that user |

Signal handlers live in `apps/accounts/signals.py`, connected in `apps/accounts/apps.py.ready()`.

### 12.3 Cache invalidation helper (`PermissionService`)
- `invalidate_user_permissions(user)` — delete single key
- `invalidate_role_permissions(role)` — delete keys for all users with that role
- `invalidate_permission(permission)` — delete keys for all users whose roles have that permission

---

## 13. Comprehensive RBAC Test Plan (including negative security tests)

### 13.1 Unit tests (model/service layer)
- `TestRoleModel`: CRUD, unique name, is_active filtering, created_by
- `TestPermissionModel`: catalog rows, module grouping, unique codename
- `TestUserRoleModel`: unique(user,role), cascade delete on user/role, assigned_by/audit
- `TestRolePermissionModel`: unique(role,permission), cascade delete
- `TestPermissionService`: effective permission union across multiple roles; cache hit/miss; superuser returns `{"*"}`; inactive user returns empty set; inactive role/permission excluded
- `TestPermissionServiceInvalidation`: all 6 signal triggers clear the right cache keys

### 13.2 Permission class tests
- `TestHasPermission`: grant/deny, superuser bypass, inactive user deny, missing view attr → allow
- `TestHasAnyPermission`: any/none matching
- `TestHasAllPermissions`: all/partial matching

### 13.3 API tests (ViewSet level)
**Role management:**
- superuser can create role with permissions
- business admin without `roles.create_role` → 403
- role CRUD lifecycle
- role permission assignment/revocation
- role delete blocked (409) when assigned to users
- inactive role → permissions not effective

**User role assignment:**
- assign multiple roles → union of permissions
- remove one role → other roles' permissions intact
- duplicate assignment idempotent (decision #1)
- assigned_by / assigned_at populated

**Effective permissions:**
- superuser → all perms
- inactive user → no perms
- cache invalidation on UserRole/RolePermission change

### 13.4 Integration tests (business workflows)
- cutting man can update cutting status; cannot update operator status
- admin can update both departments
- business admin with dynamic ADMIN role has full business access
- data scope preserved: employees see only assigned orders
- order assignment validates permission (not role name)
- target creation validates permission (not role name)
- note department restriction: GENERAL + own dept only

### 13.5 Negative security tests (critical)
| Test | Expected |
|------|----------|
| business admin POST /employees/ with `is_superuser=true` | 400 |
| business admin PATCH /employees/{id}/ with `is_superuser` | 400 |
| business admin PATCH /employees/{id}/ with `is_staff` | 400 |
| business admin cannot grant `roles.*` permissions | 403 |
| role named "ADMIN" with no permissions → no access | 403 |
| inactive role (is_active=False) → permissions not effective | 403 |
| inactive permission (is_active=False) → not granted | 403 |
| direct API POST /orders/ without permission → 403 (backend enforcement) | 403 |
| JWT token role claim = "ADMIN" but no perms → 403 | 403 |
| last superuser cannot be deactivated/deleted | 400/403 |
| removing one role does not remove another role's permissions | 200, perms intact |

### 13.6 Regression tests (existing functionality)
- accounts.test_api (~35 tests)
- orders.test_api (~55 tests)
- production.test_api (~35 tests)
- targets.test_api (~30 tests)
- reports.test_api (~10 tests)
- model tests (~15 tests)

### 13.7 Migration tests
- migration preserves ADMIN / CUTTING_MAN / OPERATOR permissions
- migration grants no extra permissions
- migration leaves `is_superuser` users unchanged
- migration 0005 verification passes on real data snapshot

---

## 14. File-by-File Implementation Sequence with Dependencies

### Phase A: Core RBAC models & services (foundation)
| # | File | Type | Depends on |
|---|------|------|------------|
| A1 | `apps/accounts/models/rbac.py` | New | — |
| A2 | `apps/accounts/models/__init__.py` | Modify (export) | A1 |
| A3 | `apps/accounts/services/rbac.py` | New | A1 (models) |
| A4 | `apps/accounts/services/__init__.py` | Modify (export) | A3 |
| A5 | `apps/accounts/permissions/rbac.py` | New | A3 (PermissionService) |
| A6 | `apps/accounts/permissions/__init__.py` | Modify (export) | A5 |
| A7 | `apps/accounts/signals.py` | New | A1, A3 |
| A8 | `apps/accounts/apps.py` | Modify (connect signals) | A7 |
| A9 | `apps/accounts/models.py` | Modify (add has_perm methods) | A3 |

### Phase B: Permission catalog population (data)
| # | File | Type | Depends on |
|---|------|------|------------|
| B1 | `apps/accounts/management/commands/populate_permissions.py` | New | A1 |
| B2 | `apps/accounts/migrations/0002_rbac_models.py` | New | A1 |
| B3 | `apps/accounts/migrations/0003_populate_permissions.py` | New | B2 |
| B4 | `apps/accounts/migrations/0004_create_initial_roles.py` | New | B3 |
| B5 | `apps/accounts/migrations/0005_verify_migration.py` | New | B4 |

### Phase C: RBAC admin APIs
| # | File | Type | Depends on |
|---|------|------|------------|
| C1 | `apps/accounts/serializers/rbac.py` | New | A1, A3 |
| C2 | `apps/accounts/views/rbac.py` | New | C1, A3 |
| C3 | `apps/accounts/urls.py` | Modify (add RBAC routes) | C2 |
| C4 | `config/api_urls.py` | Modify (include roles/permissions) | C3 |

### Phase D: Authorization refactor (replace hardcoded checks)
| # | File | Type | Depends on |
|---|------|------|------------|
| D1 | `apps/accounts/permissions.py` | Modify (keep IsActiveUser; add HasPermission import path) | A5 |
| D2 | `apps/accounts/views.py` | Modify (EmployeeViewSet → HasPermission; guard is_superuser/is_staff) | A5, D1 |
| D3 | `apps/accounts/serializers.py` | Modify (guard superuser fields; remove role default) | D2 |
| D4 | `apps/orders/selectors.py` | Modify (orders_for_user → check orders.view_all_orders) | A3 |
| D5 | `apps/orders/views.py` | Modify (IsAdmin → HasPermission; status action uses perms) | A5 |
| D6 | `apps/orders/services.py` | Modify (resolve_assignee → permission-based; remove _ROLE_FOR_DEPARTMENT) | A3 |
| D7 | `apps/production/services.py` | Modify (department_for_role → permission-based; remove _DEPARTMENT_FOR_ROLE) | A3 |
| D8 | `apps/targets/services.py` | Modify (validate_target_department → permission-based; remove _DEPARTMENT_FOR_ROLE) | A3 |
| D9 | `apps/reports/views.py` | Modify (IsAdmin → HasPermission) | A5 |
| D10 | `apps/accounts/admin.py` | Modify (remove role from fieldsets/list_filter) | — |

### Phase E: User model cleanup (after migration verification)
| # | File | Type | Depends on |
|---|------|------|------------|
| E1 | `apps/accounts/models.py` | Modify (remove Role TextChoices, role field, role properties) | B5, D1–D10 |
| E2 | `apps/accounts/migrations/0006_remove_legacy_role.py` | New | E1 |
| E3 | `apps/accounts/serializers.py` | Modify (remove role field from serializers) | E1 |
| E4 | `apps/accounts/views.py` | Modify (remove role references) | E1 |

### Phase F: Tests
| # | File | Type | Depends on |
|---|------|------|------------|
| F1 | `apps/accounts/tests/test_rbac_models.py` | New | A1 |
| F2 | `apps/accounts/tests/test_rbac_services.py` | New | A3 |
| F3 | `apps/accounts/tests/test_rbac_permissions.py` | New | A5 |
| F4 | `apps/accounts/tests/test_rbac_api.py` | New | C2 |
| F5 | `apps/accounts/tests/test_rbac_security.py` | New | C2, D2 |
| F6 | `apps/accounts/tests/test_rbac_migration.py` | New | B5 |
| F7 | `conftest.py` | Modify (fixtures use dynamic roles) | B4 |
| F8 | All existing test files | Modify (assertions use permissions) | D1–D10 |

### Phase G: Documentation
| # | File | Type |
|---|------|------|
| G1 | `docs/rbac-architecture.md` | New |
| G2 | `docs/rbac-permission-catalog.md` | New |
| G3 | `docs/rbac-migration-guide.md` | New |
| G4 | `docs/api-documentation.md` | Update |

---

## 15. Decisions Requiring Your Approval

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| 1 | Duplicate role assignment (user already has role) | A) 400 error B) Idempotent 200 | **B** |
| 2 | `orders.view_all_orders` separate permission | A) Separate permission B) Implied by view_order + Admin role | **A** |
| 3 | Department permission granularity | A) One per dept (update_cutting_status/update_operator_status) B) Single update_status + dept in body | **A** |
| 4 | Note department permissions | A) Separate per cut/operator/general B) Single add_note + service validation | **A** |
| 5 | Cache TTL | A) 300s B) 60s C) 900s | **A** |
| 6 | Superuser permission bypass | A) `is_superuser` → `{"*"}` B) Superuser checks perms but holds `roles.*` | **A** |
| 7 | Last Superuser protection | A) API only B) Model `clean()` only C) Both | **C** |
| 8 | Role deletion with active UserRoles | A) Block (409) B) Cascade delete UserRoles C) Soft-delete (is_active=False) | **A** |
| 9 | Permission catalog management | A) Fixed (code-defined, populated by migration) B) Dynamic (superuser can create via API) | **A** |
| 10 | Transition dual-write | A) Full dual-write in code during migration B) Migration-only, switch after 0005 verify | **B** |
| 11 | Overwrite existing `docs/rbac-phase2-architecture-plan.md` | A) Yes B) No (create new file) | — |

---

## 16. Risk Assessment & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Migration breaks existing user access | Medium | High | Dual-write, 0005 verification, staged rollout |
| Cache staleness → permission lag | Low | Medium | 300s TTL + explicit invalidation on all mutations |
| Performance regression on permission checks | Low | Medium | Cache, DB indexes, distinct() |
| Test suite failures during transition | High | Medium | Update fixtures first, run incrementally |
| Data scope regression (employees see wrong orders) | Low | High | Preserve `orders_for_user` logic exactly; regression tests |
| Superuser lockout | Very Low | Critical | Last-superuser protection; admin site fallback |
| Role name grants privilege by mistake | Medium | High | Negative test: role "ADMIN" with no perms → 403 |

---

## Stop. Awaiting your approval.

This Phase 2 plan is complete. No files have been modified and no implementation has begun. Please review and approve (including the 11 decisions in Section 15) before I proceed to Phase 3 Implementation.
