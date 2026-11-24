# Development Roadmap

Phased delivery. Each phase was implemented and verified before moving on.

## Phase 1 — Project Foundation  ✅
- [x] Inspect workspace (empty), confirm toolchain.
- [x] Backend structure + modular settings (base/dev/prod).
- [x] Environment variables via `.env` + `.env.example`.
- [x] PostgreSQL integration (isolated private cluster in reference env).
- [x] Dependencies installed.
- [x] App skeletons registered; `common` utilities.
- [x] Initial docs, `.gitignore`, `README`.
- [x] `manage.py check`, migrations applied, runserver smoke test.

## Phase 2 — Database & Core Models  ✅
- [x] Custom `User` model (accounts) with roles.
- [x] `Order`, `AssignmentHistory` (orders).
- [x] `ProductionStatusHistory`, `OrderNote` (production).
- [x] `EmployeeTarget`, `CompletionCredit` (targets).
- [x] Admin registrations for all models.
- [x] Model tests (UUID PK, constraints, derived overall status, dedup).
- [x] Migrations applied.

## Phase 3 — Authentication & Authorization  ✅
- [x] JWT login/refresh/logout (blacklist)/me.
- [x] Custom token claims (role, employee_code, full_name).
- [x] Role-based permissions (`IsAdmin`, `IsEmployee`, ...).
- [x] Employee management CRUD (admin) + deactivate.
- [x] Access-restriction tests (inactive login, RBAC, self-profile).

## Phase 4 — Order & Assignment Management  ✅
- [x] Order CRUD (admin) + multipart image upload + validation.
- [x] Assignment + reassignment + immutable history.
- [x] Pillow overlay (original → generated) + regeneration on reassignment.
- [x] Centralised image config; placeholder coordinates documented.
- [x] Workflow tests (create, duplicate, invalid image, role, visibility,
      reassign, history, regeneration).

## Phase 5 — Production Management  ✅
- [x] Department status updates (server-derived department for employees).
- [x] Immutable status history + problem notes.
- [x] Overall status derivation (PENDING/IN_PROGRESS/COMPLETED).
- [x] Reopen (Completed → Pending) + repeated completion.
- [x] Transactional integrity (`select_for_update` + atomic).
- [x] Tests (dept isolation, unassigned employee, admin override, history, notes).

## Phase 6 — Targets & Reports  ✅
- [x] Daily / weekly (Mon–Sun) / monthly targets with period math.
- [x] Completion-credit logic + dedup (`UNIQUE(employee, order, target)`).
- [x] Completion-date rule (credit on actual completion date).
- [x] Overlap validation for same (employee, period_type).
- [x] Dashboard / employees / production / targets reports.
- [x] Calendar-boundary & edge-case tests.

## Phase 7 — Final API Validation  ✅
- [x] OpenAPI schema generation clean (0 warnings, 0 errors); Swagger UI + ReDoc.
- [x] Full automated suite green (95 tests).
- [x] Security/permission coverage across endpoints.
- [x] Live end-to-end smoke test against real PostgreSQL (login → order →
      status → history → reports → RBAC).
- [x] Database integrity review (unique constraints, indexes, PROTECT FKs).
- [x] Documentation updated; final report produced (`docs/final-report.md`).