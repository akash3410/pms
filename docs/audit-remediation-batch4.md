# POMS Backend — Audit Remediation Batch 4 (POMS-AUDIT-016, 019, 007)

Scope: data protection and API consistency. No changes to the completion-credit
decisions (Rules A/B/C); no historical data rewritten.

## Verification summary

- `manage.py check` → **0 issues**
- `makemigrations --check` → **no changes** (migration committed)
- `ruff check .` → **clean**
- `manage.py spectacular` → **0 errors / 0 warnings**
- `pytest --cov=apps` → **155 passed**, **92%** coverage, on **PostgreSQL 16.15**

## Database changes (reviewed before applying)

- `targets/0003_alter_completioncredit_target.py` — alters
  `CompletionCredit.target` from `on_delete=CASCADE` to `on_delete=PROTECT`.
  Additive metadata change (FK `ON DELETE` action); no data is modified or
  deleted. Applied successfully; `makemigrations --check` reports no drift.

## POMS-AUDIT-016 — Role change of an assigned employee

- `apps/accounts/serializers.py` — `EmployeeUpdateSerializer.validate()` rejects a
  `role` change that would invalidate an **active** (non-completed) assignment:
  - active Cutting assignment ⇒ new role must be `CUTTING_MAN`;
  - active Operator assignment ⇒ new role must be `OPERATOR`;
  - otherwise a clear `400` (`{"errors": {"role": [...]}}`).
- No silent reassignment, no `AssignmentHistory` deletion. Non-role fields
  (`full_name`, `employee_code`, `email`, `is_active`) remain editable.

Tests: `apps/accounts/test_api.py::TestEmployeeRoleChange` (blocked for active
cutting/operator assignments; non-role update allowed; allowed when no
assignments).

## POMS-AUDIT-019 — CompletionCredit deletion protection

- `apps/targets/models.py` — `CompletionCredit.target` is now `on_delete=PROTECT`
  (migration above). Deleting a target that has credits raises `ProtectedError`;
  credits are preserved.
- `apps/targets/admin.py` — `EmployeeTargetAdmin.has_delete_permission` returns
  `False` for a target with credits; `CompletionCreditAdmin.has_delete_permission`
  always returns `False` (credits are immutable). This protects Django admin
  deletion in addition to the ORM/DB guard.

Tests: `apps/targets/test_api.py::TestCompletionCreditProtection` (target with
credits cannot be deleted; credit survives; admin blocks deleting credit-bearing
targets and credits).

## POMS-AUDIT-007 (remaining) — Employee API contract

- The `EmployeeViewSet` exposes only `GET`/`POST` on the list, `GET`/`PATCH` on the
  detail, plus the `deactivate` action (`POST`) — `PUT`/`DELETE` are excluded via
  `http_method_names` (405). This was verified against the generated OpenAPI schema.
- `apps/accounts/test_api.py::TestEmployeeAPIContract` asserts the viewset's
  `http_method_names` and that the generated schema for `/employees/`,
  `/employees/{id}/` and `/employees/{id}/deactivate/` contains exactly the
  documented operations (no `put`/`delete`).
- Docs updated (`api-documentation.md`, `business-rules.md`) to describe the
  role-change restriction and the credit/target deletion protection.

## Data protection implications

- No endpoint deletes `CompletionCredit`; admin deletion is blocked; target
  deletion is blocked while credits exist (PROTECT). Existing rows untouched.
- Role changes are validated against current assignments without mutating orders
  or history.