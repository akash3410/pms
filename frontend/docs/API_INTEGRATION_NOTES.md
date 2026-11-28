# API Integration Notes

Practical notes on how the SPA talks to the POMS API, including the contract
details that cost time and the rules the client deliberately does **not**
re-implement.

## Base URL and transport

* `VITE_API_BASE_URL` (default `/api/v1`) is the Axios `baseURL`. In development
  Vite proxies `/api` to `VITE_PROXY_TARGET`, so same-origin requests avoid CORS.
* All requests `Accept: application/json` with a 30 s timeout; JSON bodies are
  serialised by Axios, multipart bodies are built with `FormData` (never set
  `Content-Type` manually for those — the browser must add the boundary).
* `get/post/patch/put/del` helpers return `response.data`. `204 No Content`
  resolves to an empty string; callers treat mutation success via TanStack Query
  callbacks rather than the body.
* `pruneParams` drops `undefined`, `null`, `""` and empty arrays so the API never
  receives `?status=` or `?search=` noise. **Do not** pre-compute booleans from
  nullable search params without collapsing `null` to `undefined`: `false` is a
  real filter value, and sending `is_active=false` silently hides every row. This
  was the one real frontend bug found during smoke testing.

## Authentication

* `POST /auth/login/` body is `{ email, password }`. The `email` field accepts a
  username as well as an email address, so one form serves both.
* Response: `{ access, refresh, user }`. The user object is the same shape as
  `GET /auth/me/`.
* The interceptor attaches `Authorization: Bearer <access>` to every request and
  refreshes on `401` exactly once:
  * the refresh call is itself excluded (`AUTH_FREE_PATHS`) so a bad refresh token
    cannot loop;
  * every request that arrives while a refresh is in flight awaits the same
    promise and is then replayed with the new token;
  * a failed refresh clears tokens/cached user and fires `onSessionExpired`, which
    the session provider turns into a redirect to `/login` with a notice.
* `POST /auth/logout/` takes `{ refresh }`; the client clears local state even if
  the call fails (e.g. the refresh token already expired).
* Tokens and the cached user live in `localStorage` under `poms.access`,
  `poms.refresh`, `poms.user`. This is an XSS-exposure trade-off, not a backend
  requirement — see `KNOWN_LIMITATIONS.md`.

## Authorisation

* `GET /rbac/users/{id}/effective-permissions/` returns:

  ```json
  {
    "user": "<uuid>",
    "is_superuser": true,
    "superuser": true,
    "permissions": { "orders.view_order": [{ "scope": "ALL", "options": {} }] },
    "restrictions": { "orders.view_order": { "scope": "OWN", "options": {} } }
  }
  ```

  Both `superuser` and `is_superuser` appear; the client treats either as the
  bypass flag, matching `EffectiveAccess` on the server.
* `permissions` maps a key to a **list** of grants (one per role), so scope checks
  ask "does any grant carry this scope". `restrictions` is a single grant per key
  and can only narrow access.
* The client never derives permissions from `user.role` or role names. The legacy
  `role` field is displayed for continuity only.
* `403` is rendered as an explicit "not permitted" alert or state; a `404` on a
  scoped detail endpoint (the backend hides out-of-scope objects) is rendered as
  "not found or not accessible", not as a crash.

## Pagination and filtering

* Default page size is 20 (`PAGE_SIZE`). List endpoints return
  `{ count, next, previous, results }`. The client uses page numbers + `page_size`
  and shows total pages from `count`.
* **Exceptions that are not paginated** (return plain JSON):
  * `GET /rbac/departments/{id}/members/` → array
  * `GET /rbac/roles/{id}/permissions/` → array
  * `GET /rbac/roles/{id}/history/` → array (last 200 audit events, no envelope)
  * `GET /reports/{employees,targets}/` → array, windowed by `limit`/`offset`
  * `effective-permissions`, `invitations/settings`, `system/settings`,
    `system/email` → single objects

  `GET /orders/{id}/history/`, `/assignments/` and `/notes/` **are** paginated
  (envelope), unlike the role history action.
* Filters are backend `filterset_fields`, not free-form. The client only offers
  values the endpoint documents:

  | Endpoint | Filters | Search | Ordering whitelist |
  | --- | --- | --- | --- |
  | `/orders/` | `overall_status`, `cutting_status`, `operator_status` | order number, assignee name/code | `created_at`, `order_number`, `overall_status` |
  | `/employees/` | none | `full_name`, `employee_code`, `username`, `email` | `employee_code`, `full_name`, `date_joined` |
  | `/targets/` | `employee`, `department`, `period_type` | — | `start_date`, `end_date`, `created_at` |
  | `/rbac/roles/` | `is_active`, `is_system` | `code`, `name`, `description` | `code`, `name`, `created_at` |
  | `/rbac/permissions/` | `module`, `is_active`, `is_system` | `key`, `name`, `description` | `module`, `action`, `created_at` |
  | `/rbac/departments/` | `is_active`, `is_production` | `code`, `name` | — |
  | `/invitations/` | `status`, `email` | — | — |
  | `/audit-logs/` | `action`, `target_type`, `actor` | `action`, `target_type`, `target_id`, `actor_label`, `request_id` | `created_at`, `action` |

* Lists that drive selection dropdowns (permission catalogue, assignee pickers)
  request `page_size=200`/`page_size=500` explicitly and tolerate the backend
  returning fewer.

## Media

Order images are **not** public URLs. The serializers return a URL to a
permission-checked endpoint (`orders.view_media`), so `<img src>` cannot be used
directly: the client fetches the bytes with the bearer token via
`getObjectUrl()` and renders a blob URL that the component revokes on unmount.
Uploads are `multipart/form-data` with `original_image`; the backend validates the
file (the client's own type/size check is UX only) and generates a separate card
image from the original without modifying it.

## Orders

* Create requires `order_number` (unique, validated format), `original_image`,
  `cutting_man` (a `CUTTING_MAN` account) and `operator` (an `OPERATOR` account).
  Statuses are never sent by the client.
* `PATCH /orders/{id}/` accepts JSON metadata or multipart when replacing the
  original image; replacing the original regenerates the card image.
* `PATCH /orders/{id}/assign/` is **PATCH**, not POST. Reassignment appends an
  immutable history row, keeps the department status and never moves completion
  credit (the backend credits the holder at completion time).
* `PATCH /orders/{id}/status/` accepts only `PENDING`/`COMPLETED` per department.
  `IN_PROGRESS` is rejected with a validation error (it is a derived
  `overall_status`). Admins (`ALL` scope) must include `department`; for assignee
  employees the backend derives the department and rejects departments they do not
  currently hold. A status equal to the current value is a no-op.
* `GET /orders/{id}/status/` does not exist — status is a PATCH-only action.

## Targets

* `POST /targets/` requires `employee`, `department`, `period_type`,
  `start_date`, `end_date`, `target_count`. The backend enforces that the employee
  belongs to the department/role, the date range is valid and periods do not
  overlap (all confirmed live with 400s).
* After a target earns completion credits, employee/department/period/dates are
  immutable; only `target_count` may change. The form shows this instead of
  letting the user hit the error.
* There is no DELETE; UI never offers one.

## RBAC mutations

* `PUT /rbac/roles/{id}/permissions/` replaces the **entire** grant list:
  `{ "permissions": [{ "permission": "orders.view_order", "scope": "ALL", "options": {} }] }`.
  The editor diffs locally but always submits the complete list.
* Department members are managed by path-scoped sub-resources:
  `POST /rbac/departments/{id}/members/` (`{ user }`), `DELETE …/members/{membershipId}/`,
  `POST …/members/{membershipId}/primary/`.
* User role assignment: `POST /rbac/users/{id}/roles/` (`{ role }`),
  `DELETE /rbac/users/{id}/roles/{assignmentId}/`.
* `DELETE /rbac/users/{id}/scope-restrictions/` requires a **request body**
  (`{ "permission": "<key>" }`), so the client calls
  `del(url, { data: { permission } })`.
* `POST /rbac/users/{id}/superuser/` toggles the flag and requires
  `system.manage_superusers` regardless of other grants.

## Settings and email

* `GET /invitations/settings/` exposes only `invitation_expiry_hours` and the
  ceiling `max_invitation_expiry_hours`; the dialog validates against the server
  value rather than a hardcoded bound.
* `GET/PATCH /system/settings/` keys used: `invitation_expiry_hours`,
  `require_email_verification`.
* `GET/PATCH /system/email/` returns configuration with the credential masked or
  omitted; password inputs are write-only. `POST /system/email/test/` takes an
  optional `{ email }` and returns a result the UI shows as a toast plus inline
  text. Nothing is logged.

## Errors

`lib/api/errors.ts` produces:

| Backend response | `ApiError.detail` | `fieldErrors` |
| --- | --- | --- |
| `400` with `{ field: ["msg"] }` | first message | full map |
| `400` with `{ "detail": { "field": "msg" } }` | the message | mapped when a field is known |
| `400`/`409` with `{ "detail": "text" }` | text | `{}` |
| `403` | backend text, or a permission notice | `{}` |
| `404` | "not found or not accessible" | `{}` |
| network/timeout | offline/timeout message | `{}` |
| `5xx` | generic failure message with request id if present | `{}` |

Forms render `fieldErrors` under the matching input and the general message as an
alert; list/detail pages render an error state with a retry button. The client
never swallows an error into an empty state.
