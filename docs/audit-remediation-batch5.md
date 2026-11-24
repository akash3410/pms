# POMS Backend — Audit Remediation Batch 5 (POMS-AUDIT-011–015, 017, 018)

Quality and production hardening. No architectural changes; no data rewritten.

## Verification summary

- `manage.py check` → **0 issues** (development **and** production settings)
- `makemigrations --check` → **no changes**
- `ruff check .` → **clean**
- `manage.py spectacular` → **0 errors / 0 warnings**
- `pytest --cov=apps` → **159 passed**, **93%** coverage, on **PostgreSQL 16.15**
- No migrations were required for this batch.

## Findings

### POMS-AUDIT-011 — Unused permission classes — RESOLVED
- `apps/orders/permissions.py` (`IsOrderAssigneeOrAdmin`, `IsAdminForWrite`) had
  **no references** anywhere. Order access control is already enforced by
  `OrderViewSet.get_permissions()` (admin for create/update/partial_update/assign)
  and object scoping via `get_queryset()` (`orders_for_user`).
- Action: removed the genuinely unused module. No behaviour change.

### POMS-AUDIT-012 — Argon2 hasher configured without dependency — RESOLVED
- `config/settings/production.py` declares `Argon2PasswordHasher` but
  `argon2-cffi` was neither installed nor declared (would raise
  `ImproperlyConfigured` at production startup).
- Action: added `argon2-cffi>=23.1,<25.0` to `requirements.txt` and installed it.
  Verified `Argon2PasswordHasher` imports and `manage.py check
  --settings=config.settings.production` passes. Password-hashing behaviour is
  unchanged (Argon2 remains the configured strong hasher).

### POMS-AUDIT-013 — Dashboard completion date used updated_at — RESOLVED
- `apps/reports/views.py` `DashboardView` now derives `orders_completed_today`
  from `ProductionStatusHistory` (`new_status=COMPLETED` created today) rather
  than `updated_at`. This counts orders whose overall completion (last department
  reaching `COMPLETED`) happened today, and ignores non-completion updates.
- Tests: `apps/targets/test_api.py::TestReportsHardening`
  (`test_dashboard_counts_completed_today_from_history`,
  `test_dashboard_ignores_updated_at_only_changes`).

### POMS-AUDIT-014 — Misleading serializer docstring — RESOLVED
- `TokenPairSerializer` claimed it "authenticates inactive users safely", which is
  false (inactive users are still rejected by the authenticator). Corrected the
  docstring to describe the real behaviour (adds role/employee_code/full_name
  claims and embeds the user payload; inactive users remain rejected).

### POMS-AUDIT-015 — Logout response semantics — RESOLVED
- `LogoutView` returned `205 Reset Content` (inappropriate for a stateless
  token-blacklist endpoint). Changed to **`204 No Content`** (success, no body).
  Updated the test and `docs/api-documentation.md`.

### POMS-AUDIT-017 — Unbounded reports — RESOLVED
- `apps/reports/views.py` `EmployeePerformanceView` and `TargetsReportView` now
  bound their querysets via `?limit=` (default `100`, max `500`) and `?offset=`.
  Response shape (JSON array) is unchanged.
- Tests: `TestReportsHardening`
  (`test_targets_report_respects_limit`, `test_employees_report_respects_limit`).

### POMS-AUDIT-018 — Test media files not cleaned up — RESOLVED
- Added an autouse pytest fixture in `conftest.py` that redirects `MEDIA_ROOT` to
  a per-test temporary directory (clearing the cached storage location), so
  test-generated order-card images are auto-cleaned and never written to the real
  media tree. Verified the real `backend/media` directory is unchanged by a test
  run (file count identical before/after). No user data is touched.

## Files changed (git review note)

The repository has **no commits** (fresh working tree), so `git diff` has no
baseline; the full tree is untracked. Batch 5 touched:
- `backend/apps/orders/permissions.py` (removed)
- `backend/apps/reports/views.py`
- `backend/apps/accounts/views.py` (logout 204)
- `backend/apps/accounts/serializers.py` (docstring)
- `backend/conftest.py` (media isolation)
- `backend/requirements.txt` (argon2-cffi)
- `backend/apps/accounts/test_api.py`, `backend/apps/targets/test_api.py` (tests)
- `docs/api-documentation.md`, `docs/audit-remediation-batch5.md`