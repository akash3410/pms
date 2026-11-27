# POMS — Dynamic RBAC Architecture & Implementation
## Phase 2: Detailed Architecture and Migration Plan (Revision 2)

**Date:** 2026-11-25  
**Status:** For Approval — DO NOT IMPLEMENT  
**Based on:** Phase 1 Read-Only Audit Report + Confirmed Business Decisions + Mandatory Architecture Corrections  
**Codebase verified:** Django 5.2.18, DRF 3.16, SimpleJWT 5.5, PostgreSQL 16, custom `accounts.User(AbstractUser)`  
**Document policy:** New revisioned document; existing `rbac-phase2-architecture-plan.md` left unchanged.

---

## 0. Summary of Changes from Revision 1 (all marked CHANGED)

| # | Area | Revision 1 | Revision 2 |
|---|------|-----------|------------|
| C1 | RBAC management authority | Business Admin could manage roles/perms | **CHANGED**: Django Superusers only; Business Admin has zero RBAC authority |
| C2 | Permission catalog creation | Dynamic/superuser-creatable via API considered | **CHANGED**: Fixed/code-defined only; no arbitrary permission codenames via API |
| C3 | Migration / legacy field removal | Remove `User.role` in migration 0006 shortly after verification | **CHANGED**: Staged sequence; legacy field retained until all code verified independent; removal in separate, later migration |
| C4 | `User.has_perm()` override | Override Django's `has_perm()` | **CHANGED**: Do NOT override; use dedicated `has_business_permission()` etc. |
| C5 | Last Superuser protection | Model `clean()` + API | **CHANGED**: Multiple layers — API, Django Admin, centralized service; concurrency-safe |
| C6 | Data scope vs permission | Permission checked separately | **CHANGED**: Every protected operation validates permission + order visibility + department + status rules |
| C7 | Role deletion | Block if assigned (already) | Confirmed: Block if assigned to users |
| C8 | Documentation | Overwrite existing | **CHANGED**: New revisioned document |

Confirmed user decisions incorporated: idempotent duplicate assignment; `orders.view_all_orders` separate; separate dept permissions; separate note permissions; 300s cache TTL; superuser bypass yes; role deletion blocked; fixed permission catalog; staged migration; new doc.

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
| Django `AbstractUser` provides `is_superuser`, `is_staff`, `groups`, `user_permissions`, `has_perm()` | Django core |
| `OrderViewSet.get_permissions()` returns `IsAuthenticated` for list/retrieve (no role gate on read) | `orders/views.py:70-73` |
| `order_status` action checks `user.role == Role.ADMIN` inline | `orders/views.py:200` |

---

## 2. Corrected Architecture

### 2.1 Core design principles

1. **Superuser-only RBAC management.** Only `is_superuser=True` users may create/update/deactivate/delete roles, manage the permission catalog, assign/revoke permissions, and assign/remove roles from users. Business Admin has full business-module access but zero RBAC authority.
2. **Django `has_perm()` is NOT overridden.** Dedicated business methods are used: `has_business_permission()`, `get_effective_business_permissions()`, `has_any_business_permission()`, `has_all_business_permissions()`.
3. **Permission ≠ data scope.** A business permission grants the right to attempt an action; data-scope and assignment checks still apply per operation.
4. **Default deny.** A ViewSet/action with no required business permission defined must not accidentally allow access; permission classes must explicitly require a permission or explicitly allow.
5. **Every custom DRF action has explicit permission enforcement.** No action relies solely on object-level checks in services.

### 2.2 Django permission compatibility decision

**Decision (CHANGED from Rev 1): Do NOT override `User.has_perm()`.**

**Rationale:**
- Django `ModelBackend`, Django Admin, and `django.contrib.auth` internals call `user.has_perm()`. Overriding it changes system-wide authorization semantics and risks subtle inconsistencies with admin, groups, and `user_permissions`.
- Business RBAC is a separate layer from Django's system permission model. Mixing them creates a security boundary risk: Business Admin could inadvertently be granted system perms through Django's `user_permissions`/`groups`.
- Dedicated methods (`has_business_permission()`, etc.) make the boundary explicit and auditable. DRF permission classes call these dedicated methods, not `has_perm()`.

**Implementation:**
```python
# On User model (Python methods, no DB change)
def has_business_permission(self, codename: str) -> bool:
    if self.is_superuser:
        return True
    if not self.is_active:
        return False
    return codename in self.get_effective_business_permissions()

def get_effective_business_permissions(self) -> set[str]:
    if self.is_superuser:
        return {"*"}
    if not self.is_active:
        return set()
    # ... query RBAC tables ...
```

`is_superuser` bypass: `has_business_permission()` returns True for superusers before consulting cache/DB. **Never cache superuser status.**

---

## 3. Corrected Security Boundaries

### 3.1 Operations exclusively for Django Superusers (`is_superuser=True`)

| Operation | Enforcement |
|-----------|-------------|
| Create business role | `roles.create_role` + `request.user.is_superuser` check in view/service |
| Update business role | `roles.update_role` + superuser check |
| Deactivate/delete business role | `roles.delete_role` + superuser check |
| Manage permission catalog | `permissions.view_permission` (read) — create/update/delete of catalog entries restricted to superusers only (no API for creating new codenames) |
| Assign/revoke role permissions | `roles.assign_permissions` + superuser check |
| Assign/remove user roles | `employees.assign_roles` + superuser check |
| Create/promote Django Superusers | `UserManager.create_superuser` only; API blocks `is_superuser`/`is_staff` writes from non-superusers |
| Change `is_superuser` / `is_staff` / `groups` / `user_permissions` | Serializer guard: only `request.user.is_superuser` may set |
| Access Django admin site | `is_staff` (unchanged); set only by superuser |
| Manage RBAC configuration | Superuser only |

### 3.2 Business Admin (dynamic role with all business permissions)

**CAN:**
- Full CRUD on Orders, Employees, Targets, Reports (business operations only)
- All production operations (both departments)
- View own effective permissions

**CANNOT — absolutely no RBAC authority:**
- Create, update, deactivate, or delete business roles
- Manage the permission catalog
- Assign or revoke permissions from roles
- Assign or remove roles from users
- Create/promote Django Superusers
- Modify `is_superuser`, `is_staff`, `groups`, `user_permissions`
- Access Django admin site (unless separately `is_staff=True`, set only by superuser)
- Bypass data-scope or assignment restrictions

### 3.3 Implementation guard (serializer + view level)

In `EmployeeCreateSerializer`/`EmployeeUpdateSerializer.validate()`:
- Fields `is_superuser`, `is_staff`, `groups`, `user_permissions` are writable only when `request.user.is_superuser`; otherwise raise `ValidationError`.

In RBAC ViewSets (`RoleViewSet`, `PermissionViewSet`, `UserRoleViewSet`):
- Every action checks `request.user.is_superuser` explicitly (defense in depth, in addition to permission classes). Business Admin with `roles.view_role` may read roles but cannot mutate.

---

## 4. Corrected Permission Catalog

### 4.1 Fixed/code-defined catalog (populated by migration, not creatable via API)

Permission codenames follow `module.action` format. The API exposes `permissions.view_permission` (read-only catalog). No endpoint allows creating new permission codenames.

### 4.2 Orders module (`orders`)

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
| orders.view_all_orders | View All Orders (data-scope override) | — | Used in queryset filter, not an endpoint |

### 4.3 Employees module (`employees`)

| Codename | Name | Endpoint | Method |
|----------|------|----------|--------|
| employees.view_employee | View Employee | GET /api/v1/employees/, GET /api/v1/employees/{id}/ | List/Retrieve |
| employees.create_employee | Create Employee | POST /api/v1/employees/ | Create |
| employees.update_employee | Update Employee | PATCH /api/v1/employees/{id}/ | Partial update |
| employees.deactivate_employee | Deactivate Employee | POST /api/v1/employees/{id}/deactivate/ | Custom action |
| employees.assign_roles | Assign Roles | POST/DELETE /api/v1/employees/{id}/roles/ | Custom action |

### 4.4 Production module (`production`)

| Codename | Name | Endpoint | Method |
|----------|------|----------|--------|
| production.update_cutting_status | Update Cutting Status | PATCH /api/v1/orders/{id}/status/ (dept=CUTTING) | Custom action |
| production.update_operator_status | Update Operator Status | PATCH /api/v1/orders/{id}/status/ (dept=OPERATOR) | Custom action |
| production.add_note_cutting | Add Cutting Note | POST /api/v1/orders/{id}/notes/ (dept=CUTTING) | Custom action |
| production.add_note_operator | Add Operator Note | POST /api/v1/orders/{id}/notes/ (dept=OPERATOR) | Custom action |
| production.add_note_general | Add General Note | POST /api/v1/orders/{id}/notes/ (dept=GENERAL) | Custom action |
| production.view_history | View Production History | GET /api/v1/orders/{id}/history/ | Custom action |
| production.view_notes | View Production Notes | GET /api/v1/orders/{id}/notes/ | Custom action |

### 4.5 Targets module (`targets`)

| Codename | Name | Endpoint | Method |
|----------|------|----------|--------|
| targets.view_target | View Target | GET /api/v1/targets/, GET /api/v1/targets/{id}/ | List/Retrieve |
| targets.create_target | Create Target | POST /api/v1/targets/ | Create |
| targets.update_target | Update Target | PATCH /api/v1/targets/{id}/ | Partial update |
| targets.delete_target | Delete Target | DELETE /api/v1/targets/{id}/ | Destroy (blocked if credits exist) |

### 4.6 Reports module (`reports`)

| Codename | Name | Endpoint | Method |
|----------|------|----------|--------|
| reports.view_dashboard | View Dashboard | GET /api/v1/reports/dashboard/ | List |
| reports.view_employee_report | View Employee Report | GET /api/v1/reports/employees/ | List |
| reports.view_production_report | View Production Report | GET /api/v1/reports/production/ | List |
| reports.view_target_report | View Target Report | GET /api/v1/reports/targets/ | List |

### 4.7 Roles & Permissions module (`roles` / `permissions`) — SUPERUSER ONLY

| Codename | Name | Endpoint | Method | Restricted to |
|----------|------|----------|--------|---------------|
| roles.view_role | View Role | GET /api/v1/roles/, GET /api/v1/roles/{id}/ | List/Retrieve | Superuser (read for others) |
| roles.create_role | Create Role | POST /api/v1/roles/ | Create | Superuser only |
| roles.update_role | Update Role | PATCH /api/v1/roles/{id}/ | Partial update | Superuser only |
| roles.delete_role | Delete Role | DELETE /api/v1/roles/{id}/ | Destroy | Superuser only |
| roles.assign_permissions | Assign Permissions | POST/DELETE /api/v1/roles/{id}/permissions/ | Custom action | Superuser only |
| permissions.view_permission | View Permission | GET /api/v1/permissions/, GET /api/v1/permissions/{id}/ | List/Retrieve | Read-only catalog |

### 4.8 Authentication module (`auth`) — unchanged

| Codename | Name | Endpoint |
|----------|------|----------|
| auth.login | Login | POST /api/v1/auth/login/ |
| auth.refresh | Refresh Token | POST /api/v1/auth/refresh/ |
| auth.logout | Logout | POST /api/v1/auth/logout/ |
| auth.view_profile | View Profile | GET /api/v1/auth/me/ |
| auth.update_profile | Update Profile | PATCH /api/v1/auth/me/ |

**Total: ~46 granular permissions across 8 modules. Catalog is fixed; superusers assign existing catalog permissions to roles dynamically.**

### 4.9 Initial role templates (migration data)

| Role | Permissions |
|------|-------------|
| ADMIN | All business permissions (orders, employees, production, targets, reports) + `orders.view_all_orders` |
| CUTTING_MAN | orders.view_order, orders.change_order_status, production.update_cutting_status, production.add_note_cutting, production.add_note_general, production.view_history, production.view_notes, orders.view_order_assignments |
| OPERATOR | orders.view_order, orders.change_order_status, production.update_operator_status, production.add_note_operator, production.add_note_general, production.view_history, production.view_notes, orders.view_order_assignments |

---

## 5. Permission vs Data-Scope Architecture (corrected)

### 5.1 Core principle (unchanged but reinforced)

- **Permission** = "May the user perform action X on resource type Y?" — checked at API gate.
- **Data Scope** = "Which specific instances may this user see/modify?" — checked at queryset/selector layer.
- **Assignment validation** = "Is this user assigned to this order's department?" — checked in services.

**A business permission alone must never bypass order assignment restrictions.** Every protected production operation validates all four:

1. Required business permission.
2. Order visibility/assignment (data scope).
3. Department-specific authorization.
4. Existing business status-transition rules.

### 5.2 Enforcement layers

| Layer | Responsibility | Implementation |
|-------|----------------|----------------|
| Permission check | `has_business_permission(codename)` | DRF permission class on `has_permission` |
| Data-scope filter | Instance visibility | `get_queryset()` / selectors |
| Assignment validation | Department + assignment check | Service layer (`resolve_assignee`, `update_department_status`) |
| Status-transition rules | Business state machine | Service layer (existing rules preserved) |

### 5.3 Data-scope rules (current behavior preserved exactly)

| Resource | Django Superuser | Business Admin | Employee (Cutting/Operator) |
|----------|------------------|----------------|------------------------------|
| Orders list/retrieve | All orders | All orders (if `orders.view_all_orders`) | Only assigned orders (cutting_man OR operator) |
| Order status update | Any dept | Any dept | Only currently assigned department + permission |
| Order notes | Any dept + GENERAL | Any dept + GENERAL | GENERAL + own department only + permission |
| Order history | All | All | Only assigned orders |
| Employees | All | All | None (endpoint restricted) |
| Targets | All | All | None (endpoint restricted) |
| Reports | All | All | None (endpoint restricted) |
| Roles / Permissions | All | Read-only roles; no mutation | None |

### 5.4 Special permission: `orders.view_all_orders`
Explicit data-scope override for Business Admins who need full order visibility without being Django Superusers. Not granted to employees by default.

---

## 6. Multiple-Role Assignment & Effective Permission Calculation

### 6.1 User model extension (dedicated methods, NOT overriding `has_perm`)

Add to `User`:
```python
def has_business_permission(self, codename: str) -> bool:
    if self.is_superuser:
        return True
    if not self.is_active:
        return False
    return codename in self.get_effective_business_permissions()

def get_effective_business_permissions(self) -> set[str]:
    if self.is_superuser:
        return {"*"}
    if not self.is_active:
        return set()
    # cache lookup or DB query

def has_any_business_permission(self, codenames: list[str]) -> bool:
    effective = self.get_effective_business_permissions()
    if self.is_superuser:
        return True
    if not self.is_active:
        return False
    return any(c in effective for c in codenames)

def has_all_business_permissions(self, codenames: list[str]) -> bool:
    effective = self.get_effective_business_permissions()
    if self.is_superuser:
        return True
    if not self.is_active:
        return False
    return all(c in effective for c in codenames)
```

### 6.2 PermissionService (effective permission computation)

```
get_effective_business_permissions(user) -> set[str]:
    if user.is_superuser: return {"*"}
    if not user.is_active: return set()
    cache key = f"rbac:user_perms:{user.pk}"
    if cached: return cached
    perms = Permission.objects.filter(
        role_permissions__role__user_roles__user=user,
        role_permissions__role__user_roles__role__is_active=True,
        is_active=True,
    ).values_list("codename", flat=True).distinct()
    cache.set(key, set(perms), TTL)
    return set(perms)
```

**Union semantics:** Permissions from ALL active assigned roles are unioned. Removing one role does NOT remove permissions from another active role.

**Inactive handling:** Inactive roles and inactive permissions are excluded by the `is_active=True` filters. Inactive users return empty set.

### 6.3 DRF permission classes (default deny)

| Class | Behavior |
|-------|----------|
| `HasBusinessPermission` | Requires `view.required_business_permission`; calls `user.has_business_permission()`. If view has no required permission defined → **deny** (default deny, not allow). |
| `HasAnyBusinessPermission` | Requires `view.required_business_permissions`; any match. If none defined → deny. |
| `HasAllBusinessPermissions` | Requires all. If none defined → deny. |
| `IsActiveUser` | Kept unchanged (rejects deactivated users). |

**Default deny rule:** Every ViewSet must explicitly declare `required_business_permission` (or `required_business_permissions`) per action. A missing declaration = 403, never accidental allow.

### 6.4 Explicit permission on every custom DRF action

All custom actions (`assign`, `status`, `history`, `notes`, `original_image`, `generated_image`, `assignments`, `deactivate`, `roles`, `effective-permissions`) declare explicit permission requirements. No action relies solely on service-layer checks.

---

## 7. Department and Production Authorization Architecture (corrected)

### 7.1 Current coupling (verified)
- `_DEPARTMENT_FOR_ROLE` / `_ROLE_FOR_DEPARTMENT` hardcoded in 3 service files.
- `update_department_status`: role-based dept check.
- `add_order_note`: employees limited to GENERAL + role-mapped dept.
- `validate_target_department`: target dept must equal role-mapped dept.

### 7.2 Decoupled design (permission-based)

**Department access = permission, not role name.**

| Permission | Grants |
|------------|--------|
| production.update_cutting_status | Update CUTTING dept status |
| production.update_operator_status | Update OPERATOR dept status |
| production.add_note_cutting | Add notes to CUTTING dept |
| production.add_note_operator | Add notes to OPERATOR dept |
| production.add_note_general | Add notes to GENERAL dept |

### 7.3 Four-layer validation for every protected operation

Example — `update_department_status(order, employee, department, new_status)`:
1. **Permission:** `employee.has_business_permission("production.update_cutting_status")` (or operator variant).
2. **Data scope:** Employee may only update orders they can see (per `orders_for_user` scope).
3. **Department assignment:** Employee must be the current assignee for that department on that order (existing row-lock check preserved).
4. **Status-transition rules:** Existing `ProductionStatus` transition rules preserved (Rule A/B/C).

Example — `add_order_note(order, author, department, body)`:
1. **Permission:** `production.add_note_cutting` / `_operator` / `_general` matching `department`.
2. **Data scope:** Author may only note orders they can see.
3. **Department restriction:** Employees: GENERAL + own department only; Admin/Business Admin: any.
4. **Body non-empty:** existing validation preserved.

### 7.4 `resolve_assignee` — permission-based (not role-based)
```python
expected_perm = {CUTTING: "production.update_cutting_status", OPERATOR: "production.update_operator_status"}[department]
if not user.has_business_permission(expected_perm):
    raise BusinessRuleError(...)
```
This allows a user with multiple roles (Cutting + Operator) to be assigned to either department.

### 7.5 Migration compatibility (3-phase)
1. Keep role-based mapping alongside new permission-based checks (dual validation, log discrepancies).
2. Migrate validation logic to permission-based.
3. Remove role-based mapping entirely (after `User.role` removal).

---

## 8. Corrected Database Schema and Model Relationships

### 8.1 New tables (app: `accounts`)

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

**`accounts_permission`**
| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| id | UUID | NO | gen_random_uuid() | PK |
| codename | VARCHAR(100) | NO | | UNIQUE |
| name | VARCHAR(200) | NO | | |
| module | VARCHAR(50) | NO | | db_index |
| description | TEXT | YES | '' | |
| is_active | BOOLEAN | NO | TRUE | |
| created_at | TIMESTAMPTZ | NO | now() | |
| updated_at | TIMESTAMPTZ | NO | now() | |

**`accounts_userrole`** (user-role assignment)
| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| id | UUID | NO | gen_random_uuid() | PK |
| user_id | UUID | NO | | FK → accounts_user(id), CASCADE |
| role_id | UUID | NO | | FK → accounts_role(id), CASCADE |
| assigned_by | UUID | NO | | FK → accounts_user(id), PROTECT |
| assigned_at | TIMESTAMPTZ | NO | now() | |

Constraints: UNIQUE(user_id, role_id). Index: (user_id, role_id).
**Deletion policy:** CASCADE on user/role delete (role delete blocked if assigned → UserRole rows must be cleared first).

**`accounts_rolepermission`** (role-permission assignment)
| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| id | UUID | NO | gen_random_uuid() | PK |
| role_id | UUID | NO | | FK → accounts_role(id), CASCADE |
| permission_id | UUID | NO | | FK → accounts_permission(id), CASCADE |
| assigned_by | UUID | NO | | FK → accounts_user(id), PROTECT |
| assigned_at | TIMESTAMPTZ | NO | now() | |

Constraints: UNIQUE(role_id, permission_id). Index: (role_id, permission_id).
**Deletion policy:** CASCADE on role/permission delete. Permission deactivation (is_active=False) excluded from effective perms but row retained for audit.

### 8.2 Model relationships

```
User (existing)
    │
    ├── user_roles (FK CASCADE) ── UserRole ◄── role (FK CASCADE) ── Role
    │                                          │                       │
    │                                          └── role_permissions ── RolePermission ── permission (FK CASCADE) ── Permission
    │
    └── (existing: is_superuser, is_staff, is_active, groups, user_permissions)
```

### 8.3 Existing User model — no schema change in Phase 2
- Keep `User.role` field (do NOT drop until all code verified independent).
- Add dedicated business methods (no DB change).
- Keep `Role` TextChoices enum in code until final cleanup migration.

### 8.4 Required DB indexes

| Table | Index | Purpose |
|-------|-------|---------|
| accounts_role | (is_active, name) | Active role lookup |
| accounts_role | unique(name) | Uniqueness |
| accounts_permission | (module, is_active) | Module-scoped queries |
| accounts_permission | unique(codename) | Uniqueness |
| accounts_userrole | (user_id, role_id) | Unique + user's roles |
| accounts_userrole | unique(user_id, role_id) | Prevent duplicates |
| accounts_rolepermission | (role_id, permission_id) | Unique + role's perms |
| accounts_rolepermission | unique(role_id, permission_id) | Prevent duplicates |

---

## 9. API Endpoint Specifications (corrected)

### 9.1 Roles (`/api/v1/roles/`) — SUPERUSER ONLY for mutations

| Method | Path | Permission | Additional restriction |
|--------|------|------------|----------------------|
| GET | `/roles/` | `roles.view_role` | Readable by any with perm; mutations superuser only |
| POST | `/roles/` | `roles.create_role` | **Superuser only** |
| GET | `/roles/{id}/` | `roles.view_role` | |
| PATCH | `/roles/{id}/` | `roles.update_role` | **Superuser only** |
| DELETE | `/roles/{id}/` | `roles.delete_role` | **Superuser only**; blocked (409) if assigned to users |
| POST | `/roles/{id}/permissions/` | `roles.assign_permissions` | **Superuser only** |
| DELETE | `/roles/{id}/permissions/{perm_id}/` | `roles.assign_permissions` | **Superuser only** |
| GET | `/roles/{id}/users/` | `roles.view_role` | List users with this role |

### 9.2 Permissions (`/api/v1/permissions/`) — read-only catalog

| Method | Path | Permission |
|--------|------|------------|
| GET | `/permissions/` | `permissions.view_permission` |
| GET | `/permissions/{id}/` | `permissions.view_permission` |

**No POST/PUT/DELETE/ PATCH on permissions via API.** Catalog is fixed/code-defined.

### 9.3 User Roles (`/api/v1/employees/{id}/roles/`) — SUPERUSER ONLY

| Method | Path | Permission | Additional restriction |
|--------|------|------------|----------------------|
| GET | `/employees/{id}/roles/` | `employees.view_employee` | |
| POST | `/employees/{id}/roles/` | `employees.assign_roles` | **Superuser only**; idempotent (200 if already assigned) |
| DELETE | `/employees/{id}/roles/{role_id}/` | `employees.assign_roles` | **Superuser only** |

### 9.4 Effective Permissions (`/api/v1/employees/{id}/effective-permissions/`)

| Method | Path | Permission |
|--------|------|------------|
| GET | `/employees/{id}/effective-permissions/` | `employees.view_employee` |

### 9.5 Employees (`/api/v1/employees/`) — extended

| Method | Path | Permission | Notes |
|--------|------|------------|-------|
| GET | `/employees/` | `employees.view_employee` | |
| POST | `/employees/` | `employees.create_employee` | Superuser-only fields guarded |
| GET | `/employees/{id}/` | `employees.view_employee` | |
| PATCH | `/employees/{id}/` | `employees.update_employee` | Superuser-only fields guarded |
| POST | `/employees/{id}/deactivate/` | `employees.deactivate_employee` | Last-superuser protection applied |

### 9.6 Existing endpoints — permission mapping (default deny)

| Endpoint | Action | Required business permission |
|----------|--------|------------------------------|
| GET /employees/ | list | employees.view_employee |
| POST /employees/ | create | employees.create_employee |
| GET /employees/{id}/ | retrieve | employees.view_employee |
| PATCH /employees/{id}/ | update | employees.update_employee |
| POST /employees/{id}/deactivate/ | deactivate | employees.deactivate_employee |
| POST/DELETE /employees/{id}/roles/ | assign/remove | employees.assign_roles (superuser only) |
| GET /orders/ | list | orders.view_order |
| GET /orders/{id}/ | retrieve | orders.view_order |
| POST /orders/ | create | orders.create_order |
| PATCH /orders/{id}/ | update | orders.update_order |
| PATCH /orders/{id}/assign/ | assign | orders.assign_order |
| PATCH /orders/{id}/status/ | status | orders.change_order_status + production.update_*_status |
| GET /orders/{id}/history/ | history | orders.view_order_history |
| GET /orders/{id}/notes/ | notes | orders.view_order_notes |
| POST /orders/{id}/notes/ | add note | orders.add_order_note + production.add_note_* |
| GET /orders/{id}/assignments/ | assignments | orders.view_order_assignments |
| GET /orders/{id}/original-image/ | image | orders.view_order_images |
| GET /orders/{id}/generated-image/ | image | orders.view_order_images |
| GET /targets/ | list | targets.view_target |
| POST /targets/ | create | targets.create_target |
| PATCH /targets/{id}/ | update | targets.update_target |
| DELETE /targets/{id}/ | delete | targets.delete_target |
| GET /reports/dashboard/ | dashboard | reports.view_dashboard |
| GET /reports/employees/ | employee report | reports.view_employee_report |
| GET /reports/production/ | production report | reports.view_production_report |
| GET /reports/targets/ | target report | reports.view_target_report |
| GET /roles/ | list roles | roles.view_role |
| GET /permissions/ | list perms | permissions.view_permission |

Auth endpoints (`/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`) unchanged.

---

## 10. Existing-User Data Migration Strategy

### 10.1 Mapping (no silent permission grants)

| Current `User.role` | Dynamic role | Permissions granted |
|---------------------|--------------|---------------------|
| ADMIN | `ADMIN` | All business permissions + `orders.view_all_orders` |
| CUTTING_MAN | `CUTTING_MAN` | Cutting dept permissions + view own orders |
| OPERATOR | `OPERATOR` | Operator dept permissions + view own orders |

- Superusers with `is_superuser=True` retain `is_superuser` AND receive the dynamic role matching their old `role`. If a superuser has no legacy business role, they retain `is_superuser` only (no business role auto-assigned — complies with "no automatic default business role").
- Inactive users still mapped (preserves history).
- No user gains permissions beyond their old role.

### 10.2 Migration phases (corrected sequence)

| Migration | Type | Description | Reversible | Legacy `User.role` after |
|-----------|------|-------------|------------|--------------------------|
| 0002_rbac_models | Schema | Create Role, Permission, UserRole, RolePermission tables | Yes (drop tables) | Present |
| 0003_populate_permissions | Data | Insert fixed permission catalog (~46 rows) | Yes (delete rows) | Present |
| 0004_create_initial_roles | Data | Create ADMIN/CUTTING_MAN/OPERATOR roles; map perms; create UserRole rows for all existing users | Yes (delete rows) | Present |
| 0005_verify_migration | Data (no schema) | Assert effective perms == old role perms for every user; raise on mismatch | N/A | Present |
| Code deployment | — | Deploy RBAC-compatible code; legacy `User.role` retained; old code paths still work | N/A | Present |
| Regression/security tests | — | Full 164-test suite + new RBAC/security tests | N/A | Present |
| 0006_remove_legacy_role | Schema | Remove `User.role` field and related index — ONLY after step 7 confirmed | **No** (backup restore only) | Removed |

### 10.3 Deployment compatibility rule
Never remove a database field while deployed code still depends on it. `User.role` remains until every service/view/selector/test has been migrated to permission-based checks and the full test suite passes.

### 10.4 Migration 0005 verification
For every user: compute effective perms from new tables; compare to expected perms derived from old `role`; assert equality. Any mismatch aborts. Superusers verified to retain `is_superuser`.

### 10.5 Ambiguous cases
| Case | Handling |
|------|----------|
| Superuser with `is_superuser=True`, `role=ADMIN` | Keeps `is_superuser` + dynamic `ADMIN` role |
| Superuser with no legacy business role | Keeps `is_superuser` only; no business role auto-assigned |
| Inactive users | Still role-mapped (history preserved) |
| Users with no role (shouldn't exist) | No role assigned (complies with no-default rule) |

---

## 11. Corrected Migration Ordering and Rollback Strategy

### 11.1 Sequence
```
0002_rbac_models.py          ← schema only, reversible
0003_populate_permissions.py ← data (permissions), reversible
0004_create_initial_roles.py ← data (roles + user mappings), reversible
0005_verify_migration.py     ← verification only, no DB changes
[Deploy RBAC-compatible code; legacy User.role retained]
[Run full regression + security tests]
[Confirm code independent of User.role]
0006_remove_legacy_role.py   ← schema, NOT reversible without backup
```

### 11.2 Rollback procedures
| Migration | Rollback |
|-----------|----------|
| 0002 | `migrate accounts 0001` — drops new tables |
| 0003 | `migrate accounts 0002` — deletes permissions |
| 0004 | `migrate accounts 0003` — deletes roles/UserRole/RolePermission |
| 0005 | None needed (verification only) |
| Code deployment | Revert to previous code version (legacy `User.role` still present) |
| 0006 | Cannot auto-rollback; restore `User.role` column + data from pre-migration pg_dump backup |

### 11.3 Pre-migration checklist
- [ ] Full database backup (pg_dump)
- [ ] Test migration on staging with production data snapshot
- [ ] Verify all 164 existing tests pass
- [ ] Verify new RBAC/security tests pass
- [ ] Confirm all code independent of `User.role`
- [ ] Confirm at least one Django Superuser remains
- [ ] Document rollback runbook

---

## 12. Cache Strategy and Permission Invalidation Rules

### 12.1 Cache design
- Key format: `rbac:user_perms:{user_uuid}`
- Value: JSON list of permission codenames
- TTL: 300 seconds (5 minutes), configurable via `RBAC_PERM_CACHE_TTL`
- Backend: Django cache (LocMem in dev/test, Redis in production)
- **Never cache superuser status** — always check `user.is_superuser` directly.

### 12.2 Concurrency-safe invalidation
Invalidation signals fire on commit (via `transaction.on_commit`) to avoid clearing cache for a transaction that later rolls back:

| Event | Signal | Timing | Action |
|-------|--------|--------|--------|
| UserRole created | post_save | on_commit | invalidate user |
| UserRole deleted | post_delete | on_commit | invalidate user |
| Role.is_active changed | pre_save (diff) | on_commit post_save | invalidate all users with that role |
| RolePermission created/deleted | post_save/post_delete | on_commit | invalidate all users with that role |
| Permission.is_active changed | pre_save (diff) | on_commit post_save | invalidate all users with roles having that permission |
| User.is_active changed | pre_save (diff) | on_commit post_save | invalidate that user |

### 12.3 Cache invalidation helper (`PermissionService`)
- `invalidate_user_permissions(user)` — delete single key
- `invalidate_role_permissions(role)` — delete keys for all users with that role
- `invalidate_permission(permission)` — delete keys for all users whose roles have that permission

### 12.4 Cache safety during concurrent transactions
- Signals use `transaction.on_commit` so invalidation only happens for committed changes.
- Read path: cache miss → DB query → set cache. Stale cache max age = TTL (300s), bounded by invalidation on writes.

---

## 13. Comprehensive RBAC Test Plan (including negative security tests)

### 13.1 Unit tests (model/service layer)
- `TestRoleModel`: CRUD, unique name, is_active filtering, created_by audit
- `TestPermissionModel`: catalog rows, module grouping, unique codename
- `TestUserRoleModel`: unique(user,role), cascade delete, assigned_by/audit, idempotent duplicate
- `TestRolePermissionModel`: unique(role,permission), cascade delete
- `TestPermissionService`: effective permission union across multiple roles; cache hit/miss; superuser returns `{"*"}`; inactive user returns empty set; inactive role/permission excluded; removing one role preserves another's perms
- `TestPermissionServiceInvalidation`: all signal triggers clear correct keys; on_commit timing

### 13.2 Permission class tests
- `TestHasBusinessPermission`: grant/deny, superuser bypass, inactive user deny, missing required permission → 403 (default deny), inactive permission excluded
- `TestHasAnyBusinessPermission`: any/none matching
- `TestHasAllBusinessPermissions`: all/partial matching

### 13.3 API tests (ViewSet level)
**Role management (superuser only):**
- superuser can create/update/deactivate/delete role
- business admin POST/PATCH/DELETE `/roles/` → 403
- business admin POST/DELETE `/roles/{id}/permissions/` → 403
- role delete blocked (409) when assigned to users
- idempotent duplicate role assignment → 200

**User role assignment (superuser only):**
- superuser assigns multiple roles → union of permissions
- superuser removes one role → other roles' permissions intact
- business admin POST/DELETE `/employees/{id}/roles/` → 403
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
- four-layer validation on status update: permission + data scope + department + status rules

### 13.5 Negative security tests (critical)
| Test | Expected |
|------|----------|
| business admin POST /employees/ with `is_superuser=true` | 400 |
| business admin PATCH /employees/{id}/ with `is_superuser` | 400 |
| business admin PATCH /employees/{id}/ with `is_staff` | 400 |
| business admin POST/PATCH/DELETE `/roles/` | 403 |
| business admin POST/DELETE `/roles/{id}/permissions/` | 403 |
| business admin POST/DELETE `/employees/{id}/roles/` | 403 |
| role named "ADMIN" with no permissions → no access | 403 |
| inactive role → permissions not effective | 403 |
| inactive permission → not granted | 403 |
| direct API POST /orders/ without permission → 403 (backend enforcement) | 403 |
| JWT token role claim = "ADMIN" but no perms → 403 | 403 |
| last active superuser cannot be deactivated/deleted/demoted | 400/403 |
| missing required permission on ViewSet → 403 (default deny) | 403 |
| removing one role does not remove another role's permissions | 200, perms intact |
| inactive user → all business permissions denied | 403 |

### 13.6 Last Superuser protection tests (multiple layers)
- API: PATCH/PUT deactivate last superuser → 400
- API: PATCH/PUT remove last superuser's `is_superuser` → 400
- Service layer: centralized user-management service blocks last superuser demotion
- Concurrent requests: race-condition test with threading.Barrier — only one succeeds

### 13.7 Regression tests (existing functionality)
- accounts.test_api (~35), orders.test_api (~55), production.test_api (~35), targets.test_api (~30), reports.test_api (~10), model tests (~15)

### 13.8 Migration tests
- migration preserves ADMIN/CUTTING_MAN/OPERATOR permissions
- migration grants no extra permissions
- migration leaves `is_superuser` users unchanged
- migration 0005 verification passes on real data snapshot
- superuser with no legacy role keeps `is_superuser` only

---

## 14. Additional Required Review (resolved)

| Review item | Resolution |
|-------------|------------|
| UserRole/RolePermission deletion policies | CASCADE on user/role/permission delete; role delete blocked (409) if UserRole rows exist; must clear assignments first |
| Cache invalidation during concurrent transactions | Signals use `transaction.on_commit`; only committed changes invalidate |
| Missing required permission on ViewSet | Default deny: view must explicitly declare required permission; missing = 403 |
| Every custom DRF action has explicit permission | All custom actions declare `required_business_permission`; verified in endpoint table |
| Role/permission mutations audited | `assigned_by` + `assigned_at` on UserRole and RolePermission; created_by/updated_at on Role and Permission |
| JWT role claims staleness | Token `role` claim retained for backward compatibility but server always re-validates against RBAC tables; claim is informational only |
| Inactive users and roles rejected consistently | `is_active=False` user → empty permission set; inactive role/permission excluded from query |
| Superusers without legacy business role | Retain `is_superuser` only; no automatic business role assigned |
| All existing API endpoints covered by catalog | Yes — endpoint table in Section 9.6 maps every existing endpoint to a business permission |

---

## 15. Corrected File-by-File Implementation Sequence

### Phase A: Core RBAC models & services (foundation)
| # | File | Type | Depends on |
|---|------|------|------------|
| A1 | `apps/accounts/models/rbac.py` | New | — |
| A2 | `apps/accounts/models/__init__.py` | Modify (export) | A1 |
| A3 | `apps/accounts/services/rbac.py` | New | A1 |
| A4 | `apps/accounts/services/__init__.py` | Modify | A3 |
| A5 | `apps/accounts/permissions/rbac.py` | New | A3 |
| A6 | `apps/accounts/permissions/__init__.py` | Modify | A5 |
| A7 | `apps/accounts/signals.py` | New | A1, A3 |
| A8 | `apps/accounts/apps.py` | Modify (connect signals) | A7 |
| A9 | `apps/accounts/models.py` | Modify (add dedicated business methods, NOT override has_perm) | A3 |

### Phase B: Permission catalog + migrations
| # | File | Type | Depends on |
|---|------|------|------------|
| B1 | `apps/accounts/management/commands/populate_permissions.py` | New | A1 |
| B2 | `apps/accounts/migrations/0002_rbac_models.py` | New | A1 |
| B3 | `apps/accounts/migrations/0003_populate_permissions.py` | New | B2 |
| B4 | `apps/accounts/migrations/0004_create_initial_roles.py` | New | B3 |
| B5 | `apps/accounts/migrations/0005_verify_migration.py` | New | B4 |

### Phase C: RBAC admin APIs (superuser only)
| # | File | Type | Depends on |
|---|------|------|------------|
| C1 | `apps/accounts/serializers/rbac.py` | New | A1, A3 |
| C2 | `apps/accounts/views/rbac.py` | New | C1, A3 |
| C3 | `apps/accounts/urls.py` | Modify | C2 |
| C4 | `config/api_urls.py` | Modify | C3 |

### Phase D: Authorization refactor (default deny, four-layer validation)
| # | File | Type | Depends on |
|---|------|------|------------|
| D1 | `apps/accounts/permissions.py` | Modify (keep IsActiveUser; new classes import from rbac) | A5 |
| D2 | `apps/accounts/views.py` | Modify (guard superuser fields; EmployeeViewSet → HasBusinessPermission; superuser-only checks on RBAC views) | A5, D1 |
| D3 | `apps/accounts/serializers.py` | Modify (guard is_superuser/is_staff/groups/user_permissions; remove role default) | D2 |
| D4 | `apps/orders/selectors.py` | Modify (orders_for_user → check orders.view_all_orders) | A3 |
| D5 | `apps/orders/views.py` | Modify (IsAdmin → HasBusinessPermission; every action explicit perm) | A5 |
| D6 | `apps/orders/services.py` | Modify (resolve_assignee → permission-based; four-layer validation) | A3 |
| D7 | `apps/production/services.py` | Modify (permission-based dept checks; four-layer validation) | A3 |
| D8 | `apps/targets/services.py` | Modify (permission-based dept validation) | A3 |
| D9 | `apps/reports/views.py` | Modify (IsAdmin → HasBusinessPermission) | A5 |
| D10 | `apps/accounts/admin.py` | Modify (last superuser protection in admin) | — |

### Phase E: Legacy field removal (only after code independence confirmed)
| # | File | Type | Depends on |
|---|------|------|------------|
| E1 | `apps/accounts/models.py` | Modify (remove Role TextChoices, role field, role properties) | B5, D1–D10 |
| E2 | `apps/accounts/migrations/0006_remove_legacy_role.py` | New | E1 |
| E3 | `apps/accounts/serializers.py` | Modify (remove role field) | E1 |
| E4 | `apps/accounts/views.py` | Modify (remove role references) | E1 |

### Phase F: Tests
| # | File | Type |
|---|------|------|
| F1 | `apps/accounts/tests/test_rbac_models.py` | New |
| F2 | `apps/accounts/tests/test_rbac_services.py` | New |
| F3 | `apps/accounts/tests/test_rbac_permissions.py` | New |
| F4 | `apps/accounts/tests/test_rbac_api.py` | New |
| F5 | `apps/accounts/tests/test_rbac_security.py` | New |
| F6 | `apps/accounts/tests/test_rbac_migration.py` | New |
| F7 | `apps/accounts/tests/test_rbac_last_superuser.py` | New |
| F8 | `conftest.py` | Modify (fixtures use dynamic roles) |
| F9 | All existing test files | Modify (assertions use permissions) |

### Phase G: Documentation (new revisioned docs)
| # | File | Type |
|---|------|------|
| G1 | `docs/rbac-phase2-architecture-plan-v2.md` | New (this document) |
| G2 | `docs/rbac-permission-catalog.md` | New |
| G3 | `docs/rbac-migration-guide.md` | New |

---

## 16. Remaining Risks and Unresolved Decisions

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Superuser lockout during migration | Very Low | Critical | Last-superuser protection across API/Admin/service; admin site fallback |
| Cache staleness → permission lag | Low | Medium | 300s TTL + on_commit invalidation on all mutations |
| Performance regression on permission checks | Low | Medium | Cache, DB indexes, distinct(), select_related |
| Test suite failures during transition | High | Medium | Update fixtures first; run incrementally; legacy field retained during transition |
| Data scope regression | Low | High | Preserve `orders_for_user` logic; four-layer validation; regression tests |
| Business Admin accidentally gains RBAC authority | Low | Critical | Explicit `is_superuser` checks in every RBAC view; negative security tests |
| Default-deny oversight on a new ViewSet | Medium | High | Code review checklist: every ViewSet declares required_business_permission |
| JWT role claim stale vs RBAC tables | Low | Medium | Server re-validates; claim informational only; document in security notes |
| `User.role` removal too early | Medium | High | Enforced deployment sequence: code independence verified before 0006 |

**Unresolved decisions (require approval):**
1. Cache backend: LocMem (dev) vs Redis (prod) — infrastructure decision.
2. Whether `orders.view_all_orders` should be grantable to Business Admin via role or only directly — policy decision.
3. Whether to add a `RBAC_PERM_CACHE_TTL` setting or hardcode 300s — configuration decision.
4. Whether Django Admin `UserAdmin` should be customized to hide RBAC-relevant fields from Business Admin `is_staff` users — UI decision.

---

## Stop. Awaiting your explicit approval.

This revised Phase 2 document (Revision 2) is complete. The existing `rbac-phase2-architecture-plan.md` was left unchanged per your instruction. No source code has been modified, no migrations created, no database writes executed, and no implementation begun.

Please review and approve (including the corrected security boundaries, migration sequence, Django permission compatibility, and four-layer validation) before I proceed to Phase 3 Implementation.
