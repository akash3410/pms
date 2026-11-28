# Known Limitations

Everything below is real and was observed, not hypothetical. Backend items are
**not** worked around by weakening client-side rules or by inventing endpoints.

## 1. Backend defect: non-OPERATOR accounts cannot be created

**Symptom.** `POST /employees/` with `role: "CUTTING_MAN"` or `role: "ADMIN"`
returns `403 {"detail":"Creating an account with this role requires
user-management permission."}` even for a superuser whose effective permissions
include everything.

**Cause.** `backend/apps/accounts/services.py:505` calls `get_access(actor)`.
`get_access` (`apps/rbac/access.py:174`) is designed for a DRF **request** and
reads `getattr(request, "user", None)`. Given a `User` instance it resolves to
`None`, so `has_permission()` / `has_scope()` are always false.

**Impact.** A fresh installation cannot create a Cutting Man through the API,
therefore cannot create an order through the UI (an order requires a Cutting Man
and an Operator). This is a genuine backend gap, not a frontend bug.

**Workaround used for testing.** The Cutting Man fixture was created directly with
the ORM so the rest of the flow could be verified.

**Suggested fix (backend, one line).** Pass the request through, or build the
access object from the actor directly:

```python
access = EffectiveAccess(actor)          # instead of get_access(actor)
```

Nothing in the frontend needs to change; the error is already surfaced verbatim.

## 2. Backend gaps that shape the UI

| Gap | Consequence in the frontend |
| --- | --- |
| `GET /employees/` has no `role` / `is_active` filterset (only `search` + `ordering`) | Assignee pickers request `page_size=200` and filter client-side by role/active; employees list shows all roles with a search box. Large installations may need a backend filter. |
| No "orders assigned to me" endpoint | "My work" reads the permission-scoped order list (`page_size=100`, `-updated_at`) and selects rows where the user holds Cutting/Operator. An employee with more than 100 recent scoped orders would not see older assignments on that page. |
| No DELETE for orders or targets | The UI offers no delete; correction is by status/metadata update (orders) or `target_count` edit (targets). |
| No edit/cancel-and-edit for invitations | Cancel + create a new invitation is the only path. |
| No pagination on `GET /rbac/departments/{id}/members/` | Very large departments return all members; the UI renders them in one table. |
| No totals for report windows | Employee and target reports are arrays windowed by `limit`/`offset` (backend caps `limit` at 500, default 100). The UI shows the window, not a grand total. |
| Report "dashboard" maps are sparse | Empty maps render as empty states; the frontend never fabricates zero rows. |
| `GET /orders/{id}/history/`, `/assignments/`, `/notes/` are paginated (default page size 20) | Tabs page independently; role history by contrast is a plain array capped at 200 events. |
| Audit log is append-only | No mutation UI; test activity remains in the log by design. |
| Invitation settings endpoint exposes only two fields | The dialog edits only `invitation_expiry_hours`, capped by `max_invitation_expiry_hours` from the server. |
| Order images are served through authenticated endpoints | `<img src>` cannot be used; images are fetched with the bearer token as blobs and object URLs are revoked on unmount. This means images cannot be cached by a CDN or opened in a new tab without the token. |
| Department statuses are only `PENDING`/`COMPLETED` | `IN_PROGRESS` is a derived overall status; the UI never offers it as a department action (the API rejects it, verified). |

## 3. Frontend limitations

* **Tokens in `localStorage`.** `poms.access` / `poms.refresh` are readable by any
  script on the origin, so an XSS bug becomes token theft. The safer pattern is an
  `HttpOnly` refresh cookie, which requires a backend change (and CSRF handling), so
  it was not adopted unilaterally. Mitigations in place: no `dangerouslySetInnerHTML`
  in app code, no third-party scripts, tokens never logged, session cleared on
  refresh failure.
* **Access snapshot lifetime.** Effective permissions are fetched on boot and after
  login, not polled. If an administrator changes a user's roles while that user is
  signed in, the UI keeps the old view until reload; every request is still
  authorised by the backend, so this is a UX staleness issue, not a security hole.
  A 403 from a stale grant renders the permission notice.
* **Client-side filtering for assignees.** As above, capped at the first 200
  employees by `employee_code`.
* **Bundle size.** The base `index` chunk is ~490 kB (159 kB gzip) and a shared
  `hooks` vendor chunk is ~392 kB (115 kB gzip); route chunks are small (≤ 23 kB).
  Further reduction needs manual chunk tuning or dropping Recharts from the initial
  dashboard.
* **No dark mode, no i18n.** The design tokens are single-theme and copy is English
  only; the brief did not ask for either.
* **No optimistic updates.** Mutations invalidate queries and refetch; on a slow
  connection the change appears after the round-trip. This favours correctness
  (server-computed statuses/credits) over perceived speed.
* **No CSV/PDF export.** The backend offers no export endpoint and the brief did not
  request client-side export.
* **Wide tables on small screens.** Tables scroll horizontally inside their card;
  there is no card/stacked layout for narrow viewports.
* **No offline mode / service worker.** The app requires the API.

## 4. Security posture

* Hiding navigation and buttons is **not** treated as security. Every route guard
  is paired with backend authorisation; `403` is rendered explicitly rather than as
  an empty page.
* No secret, API key or SMTP credential is present in the bundle or the repository.
  Email configuration is write-only from the client's perspective.
* No mock data, fake users, or invented endpoints exist anywhere in `src/`. Empty
  and error states are real API outcomes.
* `backend/` was not modified in any way during this work.

## 5. Deployment notes

* Static hosting must rewrite unknown paths to `index.html` (SPA history routing),
  otherwise deep links such as `/orders/{id}` return 404 from the web server.
* Serve the SPA and API from the same origin to keep `VITE_API_BASE_URL=/api/v1`;
  otherwise set the absolute API URL and configure CORS/CSRF on the backend.
* Use HTTPS in any shared environment: bearer tokens travel in headers and are
  stored in `localStorage`.
* The dev proxy (`VITE_PROXY_TARGET`) exists only for `vite dev`; production builds
  use `VITE_API_BASE_URL` directly.
