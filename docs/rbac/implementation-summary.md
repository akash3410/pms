# Implementation Summary — Dynamic RBAC Release

**Date:** 2026-11-28
**Scope:** replace the fixed-role authorization system with database-driven RBAC, granular scopes,
multi-role users, email authentication, invitations, and an audit trail — on the existing POMS
codebase, without losing data or breaking the existing API contract.

---

## 1. What was added

| Area | Module | Content |
|---|---|---|
| Authorization core | `apps/rbac/` | `Permission`, `Role`, `RolePermission`, `UserRole`, `UserScopeRestriction`, `Department`, `DepartmentMembership`; `EffectiveAccess`; scope registry; permission classes; lifecycle services |
| Audit | `apps/audit/` | append-only `AuditLog` + `record()` (redaction, request context, request id) and a read-only API |
| Identity | `apps/accounts/` | email login, password change/reset, email verification, invitations, login throttling, `SystemSetting`, `EmailConfiguration`; `User.email_verified_at`, `requires_email_verification` |
| Business rewiring | `orders`, `production`, `targets`, `reports` | every `role ==` authorization check replaced with a permission + scope check; department resolution now data-driven |

## 2. What was removed

- `IsAdmin`, `IsEmployee`, `IsAdminOrReadOnly` permission classes (dead or role-hardcoded).
- Every `user.role == …` authorization comparison (grep confirms none remain outside the
  transitional bridge and the legacy role-change business validation).
- Role-derived department maps duplicated in three services.
- Custom authorization claims (`role`, `employee_code`, `full_name`) from the JWT.
- Django Admin's ability to edit security state, add accounts, or delete accounts.

## 3. What was preserved

- All UUID primary keys, password hashes, `employee_code`, `full_name`, orders, assignments,
  status history, notes, targets, credits and reports.
- The existing API contract (`role`/`role_display` in user payloads; `role` accepted on employee
  create/update), now served from a transitional bridge.
- All 164 pre-existing tests (one weak password literal updated because validators are now enforced).
- The existing business rules: assignment validation, status transitions under a row lock, no-op
  transitions, credit attribution A/B/C, target overlap protection, secure media delivery.

## 4. Files

New: `apps/rbac/**`, `apps/audit/**`, `apps/accounts/auth.py`, `apps/accounts/services.py`,
`apps/accounts/test_auth_security.py`, `apps/accounts/migrations/0002_rbac_auth_fields.py`,
`apps/accounts/migrations/0003_seed_system_settings.py`.

Modified: `apps/accounts/{models,apps,admin,permissions,serializers,urls,views,test_api}.py`,
`apps/orders/{selectors,views}.py`, `apps/production/services.py`, `apps/targets/{services,views}.py`,
`apps/reports/views.py`, `apps/common/health.py`, `config/api_urls.py`, `config/settings/base.py`.

Migrations: 6 new (3 `rbac`, 1 `audit`, 2 `accounts`), all additive.

## 5. Verification executed

| Check | Result |
|---|---|
| `pytest -q` | **225 passed** |
| `manage.py check` | no issues |
| `manage.py makemigrations --check --dry-run` | no changes detected |
| `manage.py migrate` on an existing database | applied cleanly, data preserved |
| `manage.py spectacular` | 61 paths, 0 warnings, 0 errors |
| `ruff check apps common config` | clean |
| `manage.py createsuperuser --noinput` | works (derives `full_name`/`employee_code`) |

## 6. Documents

| Document | Purpose |
|---|---|
| `phase-1-existing-system-audit.md` | verified state of the old system + findings |
| `phase-2-architecture.md` | final design, ERD, evaluation flows, decisions |
| `phase-3-migration-plan.md` | mapping, migration sequence, verification queries, rollback |
| `api-documentation.md` | endpoint reference, permissions, workflows |
| `deployment-and-rollback.md` | operational runbook |
| `phase-10-final-security-acceptance-report.md` | independent review, residual findings, verdict |

## 7. Deliberate transitional debt

`User.role` remains as a compatibility field. It is **never read for authorization**; a post-save
signal mirrors it onto the mapped system role and department. Removing it requires a client
migration to `/rbac/users/{id}/roles/`, after which the field, the bridge and the legacy
role-change validation can be deleted in one follow-up release.
