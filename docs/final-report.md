# Final Technical Report — POMS Backend (Phases 1–7)

## 1. Summary

A production-grade **Django + DRF** backend for the Production Order Management
System was built from an empty workspace. It delivers JWT authentication with
role-based + object-level authorization, order management with multipart image
upload and Pillow-based order-card generation, employee assignment/reassignment
with immutable history, department-level production status with history and
notes, employee targets with deduplicated completion credit, and reporting
endpoints. PostgreSQL is the database. The OpenAPI schema generates cleanly and
an automated test suite of **95 tests** passes.

## 2. What was implemented (by phase)

- **Phase 1 — Foundation:** modular settings (`base`/`development`/`production`),
  `.env` configuration, isolated user-space PostgreSQL 16 cluster (no sudo),
  dependency install, app skeletons, `common` utilities, docs, git init.
- **Phase 2 — Models:** custom `User` (roles ADMIN/CUTTING_MAN/OPERATOR),
  `Order`, `AssignmentHistory`, `ProductionStatusHistory`, `OrderNote`,
  `EmployeeTarget`, `CompletionCredit`. UUID PKs, unique constraints, indexes,
  `PROTECT` FKs, derived overall status. Admin registered. Model tests.
- **Phase 3 — Auth:** JWT login/refresh/logout (refresh-token blacklist)/me,
  custom token claims, role + object permissions, admin employee CRUD + soft
  deactivate, RBAC tests.
- **Phase 4 — Orders/Images:** order CRUD (admin), multipart upload + server-side
  file validation, assignment/reassignment (atomic + history), Pillow overlay
  generated from the **original only**, centralised image config, regeneration
  on reassignment, visibility scoping, workflow tests.
- **Phase 5 — Production:** department status updates (department derived from
  employee role), immutable status history, problem notes, overall status
  derivation, reopen support, row-locked transactions, tests.
- **Phase 6 — Targets/Reports:** daily/weekly(Mon–Sun)/monthly targets, calendar
  period math, completion-credit with `UNIQUE(employee, order, target)` dedup,
  completion-date rule, overlap validation, dashboard/employee/production/targets
  reports, boundary + integration tests.
- **Phase 7 — Validation:** clean OpenAPI schema (0 warnings/0 errors, 20 paths),
  full suite green, security coverage, live end-to-end smoke test, integrity
  review, documentation.

## 3. Key design decisions

- **UUID primary keys** to avoid sequential-id enumeration.
- **Derived overall status** computed in `Order.save()`; never set by clients.
- **Completion credit** is a separate immutable ledger keyed by
  `(employee, order, target)` so reopen/re-complete never double-counts and
  reassignment never transfers credit.
- **Employee-submitted department is never trusted** — derived from role.
- **Original image is never modified**; generation always re-reads the original.
- **Transactions + `select_for_update`** for status changes; **atomic** for
  create/assign.
- **Environment-driven config**, secrets never committed; production settings
  fail fast on insecure defaults.

## 4. Files created (high level)

```
backend/
  config/{settings/{base,development,production}.py, urls.py, api_urls.py, wsgi.py, asgi.py}
  apps/accounts/{models,serializers,views,permissions,urls,admin,tests,test_api}.py
  apps/orders/{models,serializers,views,permissions,services,selectors,images,admin,tests,test_api}.py
  apps/production/{models,serializers,views,services,selectors,admin,tests,test_api}.py
  apps/targets/{models,serializers,views,services,admin,tests,test_services,test_api}.py
  apps/reports/{views,urls}.py
  common/{models,enums,pagination,exceptions,utils/{file_validation,date_ranges}}.py
  manage.py, requirements.txt, requirements-dev.txt, pyproject.toml, .env.example
docs/{architecture,database-design,business-rules,api-documentation,testing-strategy,development-roadmap,development-setup,final-report}.md
README.md, .gitignore
```

## 5. Dependencies added

`Django 5.2`, `djangorestframework 3.16`, `djangorestframework-simplejwt`,
`django-cors-headers`, `django-filter`, `drf-spectacular`, `psycopg[binary]`,
`Pillow`, `python-dotenv`, `gunicorn`; dev: `pytest`, `pytest-django`,
`pytest-cov`, `ruff`.

## 6. Database changes

Initial migrations for `accounts`, `orders`, `production`, `targets`, plus
`token_blacklist`. Applied successfully to PostgreSQL. Constraints include
`uniq_user_employee_code`, `uniq_completion_credit_employee_order_target`, and
`order.order_number` uniqueness; indexes on statuses, employees, and dates.

## 7. Commands executed (reference env)

```bash
virtualenv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
# private Postgres cluster on port 55432 (see docs/development-setup.md)
python manage.py migrate
python manage.py check            # no issues
python manage.py spectacular --file /tmp/schema.yml   # 0 warnings, 0 errors
pytest                            # 95 passed
ruff check .                      # all checks passed
```

## 8. Test results (actual)

- `pytest`: **95 passed** (models, services, permissions, API endpoints).
- `manage.py check`: **0 issues**.
- `ruff check`: **clean**.
- OpenAPI schema: **0 warnings, 0 errors, 20 paths**.
- Live smoke test (real PostgreSQL): login → create employees → create order
  (generated image produced) → cutting complete (IN_PROGRESS) → operator
  complete (COMPLETED) → history (2 events) → dashboard → RBAC 403 for
  employee on reports → employee sees only own orders. All as expected.
- Image verification: original and generated are both 400×300 but **differ**
  (overlay drawn); original file untouched.

## 9. Known limitations / notes

- **Overlay coordinates are placeholders** (no real sample order-card image was
  provided). They are centralised in `apps/orders/images.py`
  (`DEFAULT_IMAGE_OVERLAY_CONFIG`) and documented as needing adjustment against
  a real sample.
- The **reference DB is a private user-space PostgreSQL cluster** on port 55432;
  switch `.env` to a managed PostgreSQL for deployment.
- A **dev admin user** (`admin` / `admin12345`) and smoke-test rows exist in the
  local dev database only.

## 10. Acceptance criteria status

All backend acceptance criteria are met: server initialises; PostgreSQL works;
migrations apply; custom JWT auth works; three roles supported; role + object
permissions enforced; order creation + image upload work; assignment/reassignment
work with preserved history; generated images are independent of originals;
department updates work with preserved history; notes work; overall status is
derived; daily/weekly/monthly targets work with deduplication; reporting endpoints
work; Swagger docs are available; automated tests implemented and passing;
security-sensitive operations validated; documentation complete. The backend is
ready for a Web or Flutter client.