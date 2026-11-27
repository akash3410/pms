# POMS — Dynamic RBAC Architecture & Implementation
## Phase 1: Read-Only Code Audit Report

**Date:** 2026-11-25  
**Auditor:** Senior Backend Engineer / Software Architect  
**Scope:** Complete existing POMS backend implementation

---

## Executive Summary

The existing POMS backend is a well-structured, production-oriented Django 5.2.18 application with:
- **164 collected tests** (pytest suite)
- **Django REST Framework + SimpleJWT** authentication
- **Custom User model** with UUID primary keys
- **Hardcoded 3-role system** (ADMIN, CUTTING_MAN, OPERATOR) via `TextChoices`
- **Role-based permissions** implemented as custom DRF permission classes
- **Object-level authorization** in services and selectors
- **PostgreSQL 16** with database-level constraints
- **OpenAPI documentation** via drf-spectacular

**Critical Finding:** The current system has **hardcoded business roles** and **no dynamic RBAC infrastructure**. The requirements demand a fully dynamic system where roles, permissions, and assignments are manageable by a Django Superuser at runtime.

---

## A. Existing Architecture

### Project Structure
```
backend/
├── config/                    # Django settings, URLs, WSGI/ASGI
│   ├── settings/
│   │   ├── base.py           # Core settings (302 lines)
│   │   ├── development.py    # Dev overrides
│   │   └── production.py     # Prod overrides (not read)
├── apps/
│   ├── accounts/             # Custom User, auth, employee management
│   ├── orders/               # Orders, assignments, image generation
│   ├── production/           # Status history, notes, completion credits
│   ├── targets/              # Employee targets, completion credits
│   └── reports/              # Dashboard & analytical reports
├── common/                   # Shared base models, pagination, exceptions, utils
└── manage.py
```

### Technology Stack Verified
| Component | Version |
|-----------|---------|
| Python | 3.12.3 |
| Django | 5.2.18 (requirements: `>=5.2,<5.3`) |
| DRF | 3.16 |
| SimpleJWT | 5.5 |
| PostgreSQL | 16 (configured for port 55432) |
| Pillow | 11.0 |
| drf-spectacular | 0.28 |

### Key Architectural Patterns
1. **Service Layer Pattern** — Business logic in `services.py`, separated from views
2. **Selector Pattern** — Read queries in `selectors.py`
3. **Transaction Atomicity** — All multi-step operations wrapped in `@transaction.atomic`
4. **Row-Level Locking** — `select_for_update()` for concurrency control
5. **UUID Primary Keys** — All models inherit `TimeStampedUUIDModel`
6. **Defense-in-Depth Validation** — Serializer + Service + DB constraints

---

## B. Existing User and Role Design

### User Model (`apps/accounts/models.py:26-88`)

```python
class Role(models.TextChoices):
    ADMIN = "ADMIN", _("Admin")
    CUTTING_MAN = "CUTTING_MAN", _("Cutting Man")
    OPERATOR = "OPERATOR", _("Operator")

class User(AbstractUser, TimeStampedUUIDModel):
    full_name = models.CharField(max_length=150)
    employee_code = models.CharField(max_length=40, unique=True)
    role = models.CharField(
        max_length=20,
        choices=Role.choices,
        default=Role.OPERATOR,           # <-- HARDCODED DEFAULT
        db_index=True,
    )
    
    # Role helper properties (apps/accounts/models.py:62-77)
    @property
    def is_admin(self) -> bool:
        return self.role == Role.ADMIN
    
    @property
    def is_cutting_man(self) -> bool:
        return self.role == Role.CUTTING_MAN
    
    @property
    def is_operator(self) -> bool:
        return self.role == Role.OPERATOR
    
    @property
    def is_employee(self) -> bool:
        return self.role in {Role.CUTTING_MAN, Role.OPERATOR}
```

**Key Observations:**
- ❌ **Hardcoded `TextChoices` enum** — Roles cannot be created dynamically
- ❌ **Default role `OPERATOR`** — Violates "no automatic default business role" requirement
- ❌ **Single role per user** — No support for multiple roles
- ❌ **Role = authorization** — Role name directly grants access (no permission layer)
- ✅ UUID PK, timestamps, employee_code uniqueness
- ✅ `is_active` for soft deletion (preserves history)
- ✅ Uses Django's `AbstractUser` — retains `is_superuser`, `is_staff`, `groups`, `user_permissions`

### User Manager
- **Uses Django's default `UserManager`** (`apps/accounts/migrations/0001_initial.py:47`)
- **No custom `create_user`/`create_superuser`** — Superusers created via Django's built-in command
- **No automatic business role assignment on superuser creation** — ✅ Complies with requirement

### Authentication (`apps/accounts/views.py`, `serializers.py`)
- JWT via `rest_framework_simplejwt`
- `TokenPairSerializer` adds `role`, `employee_code`, `full_name` to access token claims
- Login/refresh/logout/me endpoints under `/api/v1/auth/`
- `IsActiveUser` permission rejects tokens for deactivated users (defense in depth)

---

## C. Existing Permission Design

### Permission Classes (`apps/accounts/permissions.py`)

```python
class IsAdmin(BasePermission):           # Line 12-19
    def has_permission(self, request, view):
        return user.role == Role.ADMIN    # Hardcoded role check

class IsEmployee(BasePermission):        # Line 22-29
    def has_permission(self, request, view):
        return user.is_employee           # Hardcoded role check

class IsAdminOrReadOnly(BasePermission): # Line 32-41
    def has_permission(self, request, view):
        if request.method in SAFE_METHODS: return True
        return user.role == Role.ADMIN    # Hardcoded role check

class IsActiveUser(BasePermission):      # Line 44-50
    def has_permission(self, request, view):
        return user.is_active
```

**Issues:**
- ❌ **All permissions check hardcoded `Role.ADMIN` or `Role.CUTTING_MAN`/`OPERATOR`**
- ❌ **No permission catalog** — No granular permissions like `orders.create_order`
- ❌ **No dynamic permission assignment** — Cannot assign permissions to roles at runtime
- ❌ **Role name IS the permission** — Violates "role names cannot grant privileges by themselves"

### Object-Level Authorization (Services)

| File | Check | Line |
|------|-------|------|
| `orders/selectors.py` | `user.role == Role.ADMIN` | 16 |
| `orders/views.py` | `user.role == Role.ADMIN` | 200 |
| `production/services.py` | `employee.role != Role.ADMIN` | 83, 95, 145 |
| `targets/services.py` | `Role.CUTTING_MAN`/`OPERATOR` mapping | 13-16, 19-33 |
| `reports/views.py` | `role__in=[Role.CUTTING_MAN, Role.OPERATOR]` | 67, 71, 93 |

---

## D. Current API Authorization Behavior

### Endpoint Protection Matrix

| Endpoint | Permission Classes | Effective Access |
|----------|-------------------|------------------|
| `/api/v1/auth/login/` | `AllowAny` | Public |
| `/api/v1/auth/refresh/` | `AllowAny` | Public |
| `/api/v1/auth/logout/` | `IsAuthenticated` | Any authenticated |
| `/api/v1/auth/me/` | `IsAuthenticated, IsActiveUser` | Any active user |
| `/api/v1/employees/` (GET/POST) | `IsAuthenticated, IsAdmin` | ADMIN only |
| `/api/v1/employees/{id}/` (GET/PATCH) | `IsAuthenticated, IsAdmin` | ADMIN only |
| `/api/v1/employees/{id}/deactivate/` | `IsAuthenticated, IsAdmin` | ADMIN only |
| `/api/v1/orders/` (GET) | `IsAuthenticated` | ADMIN: all; Employee: assigned only |
| `/api/v1/orders/` (POST/PATCH) | `IsAuthenticated, IsAdmin` | ADMIN only |
| `/api/v1/orders/{id}/assign/` | `IsAuthenticated, IsAdmin` | ADMIN only |
| `/api/v1/orders/{id}/status/` | `IsAuthenticated` | ADMIN: any dept; Employee: own dept only |
| `/api/v1/orders/{id}/history/` | `IsAuthenticated` | ADMIN or assignee |
| `/api/v1/orders/{id}/notes/` | `IsAuthenticated` | ADMIN: any dept; Employee: GENERAL/own dept |
| `/api/v1/targets/` | `IsAuthenticated, IsAdmin` | ADMIN only |
| `/api/v1/reports/*` | `IsAuthenticated, IsAdmin` | ADMIN only |
| `/api/v1/health/` | `AllowAny` | Public |

### Visibility Logic (`orders/selectors.py:9-18`)
```python
def orders_for_user(user) -> QuerySet[Order]:
    base = Order.objects.select_related("cutting_man", "operator", "created_by")
    if user.role == Role.ADMIN:
        return base
    return base.filter(Q(cutting_man=user) | Q(operator=user))
```

---

## E. Hardcoded Role Dependencies (Complete Inventory)

### 1. Model Definitions
| File | Line | Dependency |
|------|------|------------|
| `accounts/models.py` | 20-23 | `Role` TextChoices enum (ADMIN, CUTTING_MAN, OPERATOR) |
| `accounts/models.py` | 42 | `default=Role.OPERATOR` |
| `accounts/models.py` | 63-77 | `is_admin`, `is_cutting_man`, `is_operator`, `is_employee` properties |

### 2. Permission Classes
| File | Line | Dependency |
|------|------|------------|
| `accounts/permissions.py` | 19 | `user.role == Role.ADMIN` |
| `accounts/permissions.py` | 29 | `user.is_employee` (role check) |
| `accounts/permissions.py` | 41 | `user.role == Role.ADMIN` |

### 3. Serializers
| File | Line | Dependency |
|------|------|------------|
| `accounts/serializers.py` | 48 | `default=Role.OPERATOR` |
| `accounts/serializers.py` | 103, 112 | `Role.CUTTING_MAN`, `Role.OPERATOR` role change validation |

### 4. Views
| File | Line | Dependency |
|------|------|------------|
| `orders/views.py` | 200 | `user.role == Role.ADMIN` |
| `orders/selectors.py` | 16 | `user.role == Role.ADMIN` |
| `production/services.py` | 18-21, 83, 95, 145 | `_DEPARTMENT_FOR_ROLE` mapping, role checks |
| `targets/services.py` | 13-16, 19-33 | `_DEPARTMENT_FOR_ROLE` mapping, role validation |
| `reports/views.py` | 67, 71, 93 | `role__in=[Role.CUTTING_MAN, Role.OPERATOR]` |

### 5. Tests (Fixtures & Assertions)
| File | Lines | Dependency |
|------|-------|------------|
| `conftest.py` | 33, 45, 56 | Fixtures create users with hardcoded roles |
| `accounts/test_api.py` | 51, 126, 130, 151, 182, 224, 272, 278, 286, 291, 309, 314 | Role assertions |
| `orders/test_api.py` | 127, 138, 151, 174, 221, 296 | Role assertions |
| `production/test_api.py` | 108, 245, 300, 451, 465 | Role assertions |
| `targets/test_api.py` | 45, 59, 61, 86, 87, 119, 122, 135, 140, 146, 162, 192, 193, 202, 203, 212, 213, 223, 224, 232, 233, 327, 337, 342, 343, 351, 352, 362, 363, 372, 373, 382, 383, 391, 392, 406, 407, 416, 417, 426, 427, 436, 437, 446, 447, 456, 457, 466, 467, 476, 477, 486, 487, 496, 497, 506, 507, 516, 517, 526, 527 | Role assertions |

### 6. Services — Department-Role Mapping
```python
# production/services.py:18-21
_DEPARTMENT_FOR_ROLE = {
    Role.CUTTING_MAN: Department.CUTTING,
    Role.OPERATOR: Department.OPERATOR,
}

# targets/services.py:13-16 (DUPLICATE)
_DEPARTMENT_FOR_ROLE = {
    Role.CUTTING_MAN: Department.CUTTING,
    Role.OPERATOR: Department.OPERATOR,
}

# orders/services.py:19-22 (DUPLICATE)
_ROLE_FOR_DEPARTMENT = {
    Department.CUTTING: Role.CUTTING_MAN,
    Department.OPERATOR: Role.OPERATOR,
}
```

**Critical:** This mapping is duplicated in 3 places and hardcodes the relationship between business roles and departments.

---

## F. Security Issues Identified

| # | Issue | Severity | Location |
|---|-------|----------|----------|
| 1 | **No granular permission system** — All authorization is role-name-based | HIGH | Entire codebase |
| 2 | **Role name = privilege** — `Role.ADMIN` string grants full access | HIGH | `permissions.py`, `selectors.py`, `views.py` |
| 3 | **Default role assignment** — New users get `OPERATOR` automatically | MEDIUM | `models.py:42`, `serializers.py:48` |
| 4 | **Single role per user** — No support for multiple roles | MEDIUM | `User.role` field |
| 5 | **No permission catalog** — Cannot audit what permissions exist | MEDIUM | N/A (missing) |
| 6 | **Duplicated role-department mapping** — 3 locations, DRY violation | LOW | `services.py` ×3 |
| 7 | **Superuser = Business Admin conflation** — `is_superuser` not separated from business roles | MEDIUM | `models.py` (uses AbstractUser) |
| 8 | **No API for role/permission management** — Only employee CRUD exists | MEDIUM | `accounts/views.py` |
| 9 | **Token contains role claim** — Client could potentially spoof (though server re-validates) | LOW | `serializers.py:164-166` |
| 10 | **No audit trail for role assignments** — `User.role` changes not logged | LOW | `models.py`, `serializers.py` |

---

## G. Database Migration Risks

### Current Schema (from `accounts/migrations/0001_initial.py`)

```sql
-- User table has:
role VARCHAR(20) NOT NULL DEFAULT 'OPERATOR'  -- TextChoices constraint at app level
```

### Migration Challenges

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Existing users have hardcoded roles** | All 164 tests create users with `Role.ADMIN`/`CUTTING_MAN`/`OPERATOR` | Map existing roles to new dynamic roles during migration |
| **Role field is `CharField` with choices** | Cannot directly convert to FK without data migration | Multi-step migration: add new tables → populate → switch FK → drop old field |
| **Default `OPERATOR` role** | Violates "no automatic default" requirement | Remove default in new schema; require explicit assignment |
| **Tests depend on hardcoded roles** | All 164 tests will break if role enum changes | Update test fixtures to use dynamic role creation |
| **Department-role mapping in services** | Business logic assumes 1:1 role→department | Decouple: permissions grant department access, not roles |
| **No existing Role/Permission tables** | New tables needed | Create in new migration; no existing data to preserve |

### Existing Migrations
- `accounts`: 1 migration (initial)
- `orders`: 2 migrations (initial + check constraint)
- `production`: 1 migration (initial)
- `targets`: 1 migration (initial)
- `reports`: 1 migration (initial)

---

## H. Existing Test Coverage

### Test Inventory (164 tests collected)

| Module | Test Files | Test Classes | Tests |
|--------|------------|--------------|-------|
| accounts | `tests.py`, `test_api.py` | 6 | ~35 |
| orders | `tests.py`, `test_api.py` | 10 | ~55 |
| production | `tests.py`, `test_api.py` | 6 | ~35 |
| targets | `tests.py`, `test_api.py` | 6 | ~30 |
| reports | `test_api.py` (in targets) | 2 | ~10 |

### Test Patterns
- **Fixtures in `conftest.py`** create users with hardcoded roles
- **API tests** use `force_authenticate` and assert on role-based behavior
- **Concurrency tests** use `threading.Barrier` for race condition validation
- **Model tests** validate constraints and business rules

### Tests That Will Break During RBAC Migration
1. All fixtures creating users with `role=Role.ADMIN/CUTTING_MAN/OPERATOR`
2. All assertions checking `user.role == Role.X`
3. All permission tests expecting `IsAdmin`/`IsEmployee` behavior
4. All service tests checking department-role mapping

---

## I. Architecture Gaps vs. Requirements

| Requirement | Current State | Gap |
|-------------|---------------|-----|
| **Dynamic role creation** | Hardcoded `TextChoices` | Complete redesign needed |
| **No mandatory default role** | `default=Role.OPERATOR` | Remove default; require explicit assignment |
| **Multiple roles per user** | Single `role` CharField | New `UserRole` M2M through table |
| **Granular permission catalog** | None | New `Permission` model + catalog |
| **Role-permission assignment** | None | New `RolePermission` M2M through table |
| **Superuser ≠ Business Admin** | Conflated (no separation) | Enforce via permission checks only |
| **Permission-based API auth** | Role-name-based | Replace all `IsAdmin` with permission checks |
| **Admin APIs for RBAC** | Only employee CRUD | New ViewSets for Role, Permission, UserRole, RolePermission |
| **Effective permission = union of roles** | Single role | Compute union at auth time |
| **Inactive role/permission handling** | N/A | Filter by `is_active` in permission computation |

---

## J. Recommended Target Architecture

### Database Schema (Conceptual)

```sql
-- 1. Business Roles (dynamic, created by Superuser)
CREATE TABLE accounts_role (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,        -- e.g., "ADMIN", "MANAGER", "CUTTER"
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES accounts_user(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Permission Catalog (granular, module.action)
CREATE TABLE accounts_permission (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codename VARCHAR(100) UNIQUE NOT NULL,    -- e.g., "orders.create_order"
    name VARCHAR(200) NOT NULL,               -- Human-readable
    module VARCHAR(50) NOT NULL,              -- "orders", "employees", etc.
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. User-Role Assignment (M2M with audit)
CREATE TABLE accounts_userrole (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES accounts_user(id) ON DELETE CASCADE,
    role_id UUID REFERENCES accounts_role(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES accounts_user(id),
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (user_id, role_id)
);

-- 4. Role-Permission Assignment (M2M with audit)
CREATE TABLE accounts_rolepermission (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID REFERENCES accounts_role(id) ON DELETE CASCADE,
    permission_id UUID REFERENCES accounts_permission(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES accounts_user(id),
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (role_id, permission_id)
);
```

### Permission Catalog (Initial)

| Module | Permissions |
|--------|-------------|
| **orders** | `orders.view_order`, `orders.create_order`, `orders.update_order`, `orders.delete_order`, `orders.assign_order`, `orders.change_order_status`, `orders.view_order_images` |
| **employees** | `employees.view_employee`, `employees.create_employee`, `employees.update_employee`, `employees.deactivate_employee`, `employees.assign_roles` |
| **production** | `production.view_production`, `production.update_cutting_status`, `production.update_operator_status`, `production.add_note`, `production.view_history` |
| **targets** | `targets.view_target`, `targets.create_target`, `targets.update_target`, `targets.delete_target` |
| **reports** | `reports.view_dashboard`, `reports.view_employee_report`, `reports.view_production_report`, `reports.view_target_report` |
| **roles** | `roles.view_role`, `roles.create_role`, `roles.update_role`, `roles.delete_role`, `roles.assign_permissions` |
| **permissions** | `permissions.view_permission` |

### Authorization Flow

```
Request → JWT Auth → User.is_active? → Get effective permissions:
    UNION(
        SELECT permission_id FROM accounts_rolepermission rp
        JOIN accounts_userrole ur ON rp.role_id = ur.role_id
        WHERE ur.user_id = request.user.id
          AND ur.role_id IN (SELECT id FROM accounts_role WHERE is_active)
          AND rp.permission_id IN (SELECT id FROM accounts_permission WHERE is_active)
    )
→ Check required permission in effective set → Allow/Deny
```

### Caching Strategy
- Cache effective permissions per user (key: `user_perms:{user_id}`)
- Invalidate on: UserRole change, RolePermission change, Role.is_active change, Permission.is_active change
- TTL: 5 minutes (configurable)
- **Never cache superuser status** — Always check `user.is_superuser` directly

---

## Migration Strategy (High-Level)

### Phase 1: Schema & Models (New Migration)
1. Create `Role`, `Permission`, `UserRole`, `RolePermission` models
2. Populate `Permission` catalog with all identified permissions
3. Create initial `Role` records matching current hardcoded roles (ADMIN, CUTTING_MAN, OPERATOR)
4. Create `RolePermission` mappings to replicate current behavior
5. Create `UserRole` records for all existing users based on their current `role` field

### Phase 2: Authorization Refactor
1. Implement `EffectivePermission` service/manager
2. Create new permission classes (e.g., `HasPermission("orders.create_order")`)
3. Replace all `IsAdmin`, `IsEmployee`, `IsAdminOrReadOnly` checks
4. Update `orders_for_user`, `department_for_role` to use permissions

### Phase 3: Admin APIs
1. `RoleViewSet` — CRUD + activate/deactivate + assign permissions
2. `PermissionViewSet` — List catalog (read-only for non-superusers)
3. `UserRoleViewSet` — Assign/remove roles from users
4. `UserViewSet` — Extend to show effective permissions

### Phase 4: Cleanup
1. Remove `User.role` field (after verification)
2. Remove hardcoded `Role` TextChoices
3. Remove `IsAdmin`, `IsEmployee`, `IsAdminOrReadOnly` permission classes
4. Remove duplicated `_DEPARTMENT_FOR_ROLE` mappings

### Phase 5: Tests
1. Update all fixtures to use dynamic role creation
2. Add comprehensive RBAC tests per requirements
3. Run full suite, verify no regressions

---

## Unresolved Business Decisions (Require Human Input)

1. **Should existing ADMIN users get a dynamic "ADMIN" role with all permissions?**
   - Recommendation: Yes, create "Full Business Administrator" role during migration

2. **Should department access be a permission or derived from role?**
   - Current: Role → Department mapping
   - Proposed: Permissions like `production.update_cutting_status`, `production.update_operator_status`

3. **Should Superusers bypass all permission checks?**
   - Current: `is_superuser` not checked in custom permissions
   - Recommendation: Yes, `is_superuser` → allow all (Django convention)

4. **Permission granularity level?**
   - Current proposal: Per-action (create/read/update/delete)
   - Alternative: Per-resource (orders/employees/etc.)

5. **Cache invalidation strategy for production?**
   - Options: Signal-based, explicit in service layer, or hybrid

6. **Should `employee_code` remain unique identifier for employees?**
   - Currently used in URLs and API responses — keep as-is

---

## Files Requiring Changes (Preliminary)

### New Files
- `apps/accounts/models/rbac.py` — Role, Permission, UserRole, RolePermission models
- `apps/accounts/permissions/rbac.py` — `HasPermission`, `HasAnyPermission` classes
- `apps/accounts/services/rbac.py` — Effective permission computation, caching
- `apps/accounts/views/rbac.py` — RoleViewSet, PermissionViewSet, UserRoleViewSet
- `apps/accounts/serializers/rbac.py` — Serializers for new models
- `apps/accounts/urls.py` — Extend with RBAC endpoints

### Modified Files
- `apps/accounts/models.py` — Remove `Role` TextChoices, `role` field, role properties
- `apps/accounts/permissions.py` — Replace with new permission classes
- `apps/accounts/serializers.py` — Remove role default, update EmployeeCreateSerializer
- `apps/accounts/views.py` — Update EmployeeViewSet to use new permissions
- `apps/orders/selectors.py` — Replace `user.role == Role.ADMIN` with permission check
- `apps/orders/views.py` — Replace role checks with permission checks
- `apps/orders/services.py` — Remove `_ROLE_FOR_DEPARTMENT`, use permissions
- `apps/production/services.py` — Remove `_DEPARTMENT_FOR_ROLE`, use permissions
- `apps/targets/services.py` — Remove `_DEPARTMENT_FOR_ROLE`, use permissions
- `apps/reports/views.py` — Replace role filters with permission checks
- `config/api_urls.py` — Register new RBAC ViewSets
- All test files — Update fixtures and assertions

---

## Next Steps

**Awaiting explicit approval to proceed to Phase 2: Architecture and Migration Plan.**

Upon approval, I will produce:
1. Detailed database schema with exact field types, indexes, constraints
2. Complete permission catalog with all identified permissions
3. API endpoint specifications (paths, methods, permissions, request/response)
4. Step-by-step migration plan with rollback procedures
5. Implementation sequence with file-level change breakdown
6. Test plan for each phase

---

*Report generated from comprehensive read-only audit of the POMS backend codebase. All findings verified against actual source code with file paths and line numbers cited.*