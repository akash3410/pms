# Architecture

POMS is a modular Django backend organised by **domain app** with a clean
separation of responsibilities. Business logic lives in **services**, not in
views or serializers.

## Layered responsibilities

| Layer            | Responsibility                                                        | Location |
|------------------|-----------------------------------------------------------------------|----------|
| Models           | Data structure, relations, DB-level constraints, model validation     | `apps/*/models.py` |
| Serializers      | Input validation & output representation (no business rules)          | `apps/*/serializers.py` |
| Views/ViewSets   | HTTP request/response handling only                                   | `apps/*/views.py` |
| Permissions      | Role-based + object-level authorization                              | `apps/*/permissions.py` |
| Services         | Multi-step business workflows, wrapped in DB transactions            | `apps/*/services.py`, `common/services/` |
| Selectors        | Reusable, optimised read queries (`select_related`/`prefetch_related`)| `apps/*/selectors.py` |
| Utilities        | Shared helpers (image config, date math, etc.)                       | `common/utils/` |

## Request flow (typical write)

```
HTTP request
  → URL router (config/api_urls.py → app urls.py)
  → DRF View/ViewSet
  → Permission check (role + object ownership)
  → Serializer (validate input)
  → Service (business logic, DB transaction)
  → Model(s) saved (history/credit written atomically)
  → Serializer (render response)
  → Consistent JSON response
```

## App boundaries

- **accounts** — custom `User`, roles (ADMIN / CUTTING_MAN / OPERATOR), JWT auth.
- **orders** — `Order`, `AssignmentHistory`, order-card images (original + generated).
- **production** — department status history, problem notes, completion credits.
- **targets** — `EmployeeTarget` + completion-credit aggregation for targets.
- **reports** — read-only dashboard and reporting endpoints.
- **common** — abstract base model (UUID PK + timestamps), pagination, error handler.

## Configuration strategy

- `config/settings/base.py` — shared config, reads env vars (via python-dotenv).
- `config/settings/development.py` — DEBUG, fast MD5 hashing, permissive CORS.
- `config/settings/production.py` — strict security, refuses insecure defaults.
- Selected via `DJANGO_SETTINGS_MODULE` (default: `development` in `manage.py`).

## Why services & transactions

Operations like *assign/reassign an employee* and *change production status*
touch multiple tables (current assignment, immutable history, regenerated
image, completion credit). These are wrapped in `transaction.atomic()` so they
**succeed or fail together**, guaranteeing consistency and an accurate audit
trail.

## API conventions

- Versioned base path: `/api/v1/`.
- JWT Bearer auth; DRF default permission is `IsAuthenticated`.
- Consistent error envelope (see `common/exceptions.py`).
- Page-number pagination (`common/pagination.py`), DjangoFilterBackend,
  search and ordering.
- OpenAPI/Swagger via drf-spectacular at `/api/docs/`.