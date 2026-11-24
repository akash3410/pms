# API Documentation

The API is versioned under `/api/v1/`. Interactive docs are served live from the
running server (kept in sync with code via drf-spectacular):

- **Swagger UI:** `/api/docs/`
- **ReDoc:** `/api/redoc/`
- **OpenAPI schema:** `/api/schema/`

## Conventions

### Authentication
JWT Bearer tokens. Obtain via login, send as `Authorization: Bearer <access>`.
DRF default permission is `IsAuthenticated`.

### Success responses
Standard DRF shapes. Lists are paginated:

```json
{
  "count": 42,
  "next": "http://.../api/v1/orders/?page=2",
  "previous": null,
  "results": [ { /* ... */ } ]
}
```

Pagination params: `page`, `page_size` (max 200). Filtering/search/ordering are
enabled per endpoint via query params.

### Error envelope
All API errors use a consistent shape:

```json
{
  "detail": "Human readable message",
  "errors": { "field": ["message"] }
}
```

Validation errors put field messages under `errors`.

### Status codes
- `200` OK, `201` Created, `204` No Content
- `400` Validation error
- `401` Unauthenticated (missing/expired token)
- `403` Authenticated but not permitted (role/object-level)
- `404` Not found
- `409` Conflict (e.g., duplicate order number)
- `500` Server error

## Endpoints (target contract)

> This is the target contract. Endpoints are enabled phase by phase; the live
> schema at `/api/docs/` is authoritative once implemented.

### Authentication
| Method | URL | Role | Auth | Notes |
|--------|-----|------|------|-------|
| POST | `/api/v1/auth/login/` | Public | No | `{username, password}` → access + refresh |
| POST | `/api/v1/auth/refresh/` | Public | No | `{refresh}` → new access |
| POST | `/api/v1/auth/logout/` | Any | Yes | Blacklist refresh token → `204 No Content` |
| GET  | `/api/v1/auth/me/` | Any | Yes | Current user profile |

### Employees (ADMIN only)
| Method | URL | Notes |
|--------|-----|-------|
| GET | `/api/v1/employees/` | list (filter/search/paginate) |
| POST | `/api/v1/employees/` | create |
| GET | `/api/v1/employees/{id}/` | retrieve |
| PATCH | `/api/v1/employees/{id}/` | update (not password here) |
| POST | `/api/v1/employees/{id}/deactivate/` | soft deactivate |

`PUT` and `DELETE` are **not** supported on `/api/v1/employees/{id}/` (respond
`405`). Records are never physically deleted; use `deactivate/` for soft removal.
Every employee endpoint requires the `ADMIN` role — non-admins receive `403`.

`PATCH` may change `role`, but a role change is rejected with `400` if the
employee currently holds an **active** (not-yet-completed) assignment in a
department the new role is incompatible with (e.g. changing a Cutting Man who has
active cutting orders to `OPERATOR`). Reassign their orders first; the API never
reassigns silently. Non-role fields (`full_name`, `employee_code`, `email`,
`is_active`) are always editable. The generated OpenAPI schema for
`/employees/{id}/` exposes only `get` and `patch` (no `put`/`delete`).

### Orders
| Method | URL | Role | Notes |
|--------|-----|------|-------|
| GET | `/api/v1/orders/` | ADMIN: all; employee: assigned only | list |
| POST | `/api/v1/orders/` | ADMIN | multipart: image + cutting_man + operator + order_number |
| GET | `/api/v1/orders/{id}/` | ADMIN or assignee | retrieve |
| PATCH | `/api/v1/orders/{id}/` | ADMIN | update non-status fields |
| GET | `/api/v1/orders/{id}/original-image/` | ADMIN or assignee | stream original image bytes |
| GET | `/api/v1/orders/{id}/generated-image/` | ADMIN or assignee | stream generated card image bytes |

### Assignment
| Method | URL | Role | Notes |
|--------|-----|------|-------|
| PATCH | `/api/v1/orders/{id}/assign/` | ADMIN | `{department, employee_id}` (re)assign |
| GET | `/api/v1/orders/{id}/assignments/` | ADMIN or assignee | assignment history |

### Production
| Method | URL | Role | Notes |
|--------|-----|------|-------|
| PATCH | `/api/v1/orders/{id}/status/` | assignee of that dept | `{status, note?}` |
| GET | `/api/v1/orders/{id}/history/` | ADMIN or assignee | status history |
| GET | `/api/v1/orders/{id}/notes/` | ADMIN or assignee | list notes |
| POST | `/api/v1/orders/{id}/notes/` | ADMIN or assignee | `{department, body}` |

### Targets (ADMIN)
| Method | URL | Notes |
|--------|-----|-------|
| GET | `/api/v1/targets/` | list |
| POST | `/api/v1/targets/` | create (overlap validation) |
| GET | `/api/v1/targets/{id}/` | retrieve |
| PATCH | `/api/v1/targets/{id}/` | update |

### Reports
| Method | URL | Role |
|--------|-----|------|
| GET | `/api/v1/reports/dashboard/` | ADMIN |
| GET | `/api/v1/reports/employees/` | ADMIN |
| GET | `/api/v1/reports/production/` | ADMIN |
| GET | `/api/v1/reports/targets/` | ADMIN |

Each endpoint is documented in detail (role, auth, request body, query params,
success/error responses, validation) in the final API documentation pass
(Phase 7), synchronized with the OpenAPI schema.

- `/reports/dashboard/` `orders_completed_today` counts orders whose **overall**
  completion (the last department reaching `COMPLETED`) happened today, derived
  from `ProductionStatusHistory` timestamps — not the generic `updated_at`.
- `/reports/employees/` and `/reports/targets/` return lists and accept
  `?limit=` (default `100`, max `500`) and `?offset=` to bound the query; the
  response shape is unchanged (a JSON array).
---

## Implementation status (Phase 7)

All endpoints listed above are implemented and verified. The live, authoritative
schema is generated at `/api/schema/` (Swagger UI at `/api/docs/`).

Notes on actual behaviour:

- **Production status** (`PATCH /orders/{id}/status/`) is an action on the orders
  resource. For **employees** the target department is derived **server-side**
  from their role (a Cutting Man can only change cutting, an Operator only
  operator) — the client cannot choose a foreign department. **Admins** must
  pass `department` explicitly and may act on either.
- **History** (`GET /orders/{id}/history/`) and **notes**
  (`GET|POST /orders/{id}/notes/`) are likewise order-scoped actions.
- **Order creation** is `multipart/form-data` (`order_number`, `original_image`,
  `cutting_man`, `operator`). The `generated_image` is produced server-side.
- **Overall order status** is always derived; it is read-only in every response.
- **Targets** reject overlapping ranges for the same `(employee, period_type)`
  and enforce that `department` matches the employee's role. Overlap detection
  is serialised per employee (row lock) **and** backed by a PostgreSQL exclusion
  constraint (`btree_gist` + `daterange`), so concurrent creates cannot produce
  overlapping ranges even if the service check is bypassed. Once a target has
  earned completion credits, its credit-attribution fields (`employee`,
  `department`, `period_type`, `start_date`, `end_date`) become immutable —
  attempts to change them return `400`; only `target_count` stays editable.
- **Completion credit** is created only on a real transition **into**
  `COMPLETED`, and is awarded to the employee **currently assigned** to that
  department (an Admin actor does not redirect the credit to itself). It is
  idempotent per target period (`UNIQUE(employee, order, target)`).
- **Historical attribution is protected.** `CompletionCredit` rows are never
  modified or deleted by any endpoint; `CompletionCredit.target` uses
  `on_delete=PROTECT`, so deleting a target that has credits fails with a
  conflict (credits preserved), and the Django admin blocks deletion of credits
  and credit-bearing targets.
- **No-op status requests** (requested status equals the current status, for any
  status) return `200` but create no `ProductionStatusHistory` row, no
  `CompletionCredit`, and change no completion metadata.
- **Reassignment preserves status.** Reassigning an already-`COMPLETED`
  department keeps it `COMPLETED` and awards the new assignee nothing; the prior
  assignee's credit is retained. An Admin may explicitly set the department back
  to `PENDING`, and a later genuine `PENDING → COMPLETED` credits the then-current
  assignee.
- **`order_number`** is a human-facing business identifier with a strict,
  documented format: 1–64 chars, must start alphanumeric, then only letters,
  digits, spaces, `-`, `_`. Path separators, traversal sequences (`.`), control
  characters and other unsafe filename characters are rejected with a `400`
  serializer error (never a `500`). Uniqueness stays case-sensitive. Stored image
  paths are keyed on the order's immutable UUID, **not** `order_number`, so upload
  paths can never be influenced by client input.
- **Image uploads** are bounded by both a byte-size limit and pixel/dimension
  caps to prevent decompression-bomb memory exhaustion; oversized or malformed
  images are rejected with `400`. All limits and allowed formats are centralised
  in `apps/orders/images.py` (`ImageLimits`), which is the single source of truth
  used by both upload validation and image generation.
- **Overall status integrity** is enforced by a database `CHECK` constraint
  (`chk_order_overall_status_consistent`): `overall_status` can never disagree
  with the two department statuses, so a stale value is impossible even via a raw
  bulk `UPDATE`. Application code treats the service layer as authoritative and
  performs no bulk status updates.
- **Order images** are **not** exposed as public `/media/` URLs. The serializer
  returns authenticated endpoint paths (`.../original-image/`,
  `.../generated-image/`); the bytes are streamed only to ADMINs and the order's
  assignees (others get `404`, anonymous `401`). Responses are sent with
  `Cache-Control: private, no-store` and a `Content-Disposition` filename.
  Deployments must **not** serve the `MEDIA_ROOT` directory directly via the web
  server; route all image traffic through the authenticated endpoints above.

### Database prerequisites / deployment notes

- **`btree_gist` extension** — required by the target-overlap exclusion
  constraint (`uniq_target_no_overlap`). It is a trusted extension in PostgreSQL
  13+, so a normal application role with `CREATE` on the database can install it
  (the migration runs `CREATE EXTENSION IF NOT EXISTS btree_gist`). On managed
  PostgreSQL (e.g. RDS/Cloud SQL) ensure the extension is available/allow-listed,
  or pre-create it with an administrative role before deploying.
- **`orders` CHECK constraint** and **`targets` exclusion constraint** are added
  by migrations `orders.0002` and `targets.0002` respectively; both are additive
  and validated against existing data before applying.

Consistent error envelope and pagination apply to all endpoints (see top).
