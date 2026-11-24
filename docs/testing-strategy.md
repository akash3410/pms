# Testing Strategy

Testing is mandatory. An endpoint is not "done" until its behaviour, including
permissions and edge cases, is covered by automated tests.

## Tools
- **pytest** + **pytest-django** (primary runner)
- Django TestCase (available for DB-heavy tests)
- `ruff` for lint

## Configuration
- `backend/pyproject.toml` sets `DJANGO_SETTINGS_MODULE` and test paths.
- Tests live alongside apps (`apps/<app>/tests/` or `test_*.py`).
- The test database is created/destroyed automatically by pytest-django
  (requires the DB role to have `CREATEDB`).

## Run
```bash
cd backend
source .venv/bin/activate
pytest                 # full suite
pytest -k assignment   # targeted
pytest --cov=apps --cov=common
```

## Test layers

### Models
Field constraints, unique constraints, role/choices, `__str__`, derived fields.

### Services (business logic)
- Assignment / reassignment correctness + atomicity + history rows.
- Status transition + history + overall-status derivation.
- Image generation (from original only; regenerated on reassignment).
- Completion credit creation + dedup (no double credit on reopen/re-complete).
- Target period boundary math (daily/weekly/monthly).

### Permissions (security)
- Admin-only endpoints reject employees (403).
- Employees see only their assigned orders.
- Cutting user cannot change operator status (and vice-versa).
- Inactive employee cannot log in or be assigned.
- Clients cannot forge history/credit or set `overall_status`.

### API endpoints
Happy paths + validation errors + auth errors + status codes.

## Required scenarios (from spec)
- **Auth:** valid/invalid login, refresh, invalid token, inactive login, RBAC.
- **Orders:** create, duplicate number, invalid image, missing fields, retrieve,
  employee-specific filtering.
- **Assignment:** valid/invalid role, inactive employee, reassignment, history
  preservation, image regeneration, rollback on failure.
- **Production:** dept status update, unauthorized dept/employee, completed→
  pending, repeated completion, history, overall status.
- **Targets:** daily/weekly(Mon–Sun)/monthly boundaries, completion-date rule,
  duplicate prevention, reopen behaviour, reassignment credit, overlap validation.
- **Security:** cross-employee order access, admin-only access, cross-department
  status change, history tamper attempts.

## Reporting limitations honestly
If an environment (e.g., PostgreSQL) is unavailable, the report states this
explicitly rather than fabricating results.