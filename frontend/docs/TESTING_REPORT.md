# Testing Report

What was actually run against the real backend, what passed, what failed, and what
remains untested. Every number below comes from a command executed during this
build; nothing is projected.

## Environment

| Item | Value |
| --- | --- |
| OS | Linux |
| Backend | Django dev server `127.0.0.1:8000` (`manage.py runserver --noreload`), PostgreSQL on port `55432` |
| Frontend | Vite dev server `127.0.0.1:5173`, `/api` proxy to the backend |
| Browser automation | Playwright (`playwright-core`) driving `/usr/bin/google-chrome`, headless |
| Test account | Temporary superuser `qa_frontend_verify` created for the run and deleted afterwards |
| Database | Development database; all fixtures removed afterwards (see §7) |

The QA harnesses were disposable scripts outside the repo. They are described here
so the checks can be repeated; they are not part of the application code.

## 1. Static checks

```bash
cd frontend
npx tsc -b --noEmit      # clean
npx eslint .             # 0 errors, 5 warnings
npm run build            # success
```

* TypeScript strict build: **pass**, no diagnostics.
* ESLint: **0 errors**, 5 `react-refresh/only-export-components` warnings in
  `components/ui/badge.tsx`, `button.tsx` and `features/auth/session.tsx`. These
  files intentionally export both a component and its variants/hook; the warning is
  accepted rather than suppressed.
* Production build: **pass** in 7.39 s. Route-level code splitting is active; the
  largest chunks are `index` 490.24 kB (gzip 158.62 kB), `hooks` 391.56 kB
  (gzip 115.48 kB), `forms` 129.50 kB (gzip 39.69 kB), `dashboard-page`
  78.15 kB (gzip 21.79 kB), `react` 52.09 kB, `query` 36.18 kB. Every other route
  chunk is under 23 kB.

## 2. Endpoint sweep (19 GET endpoints)

Authenticated as the QA superuser, every frontend-facing read endpoint was called
and its **shape** compared with the TypeScript type used by the client. All
returned `200`:

`/reports/dashboard/`, `/reports/employees/`, `/reports/production/`,
`/reports/targets/`, `/rbac/roles/`, `/rbac/permissions/`, `/rbac/departments/`,
`/rbac/users/{id}/roles/`, `/rbac/users/{id}/scope-restrictions/`,
`/rbac/users/{id}/effective-permissions/`, `/invitations/`,
`/invitations/settings/`, `/audit-logs/`, `/system/settings/`, `/system/email/`,
`/orders/`, `/employees/`, `/targets/`.

Two shape notes that changed the client: `effective-permissions` returns both
`superuser` and `is_superuser`, and `invitations/settings` exposes only
`invitation_expiry_hours` + `max_invitation_expiry_hours`.

## 3. Browser smoke suite — T1 (27 checks)

Logged in through the UI and walked the real app:

```
PASS  login page renders credentials form
PASS  anonymous /orders redirects to /login
PASS  invalid credentials show an error — "Invalid credentials."
PASS  login lands on an authenticated route
PASS  dashboard renders real KPI cards — total orders, completed today,
      active production staff, completion rate, targets, completion credits
PASS  route /orders renders
PASS  orders page shows empty or table state
PASS  route /production renders
PASS  route /employees renders
PASS  route /targets renders
PASS  route /reports renders
PASS  reports page shows production tab
PASS  route /admin/roles renders
PASS  route /admin/permissions renders
PASS  route /admin/departments renders
PASS  departments page lists CUTTING
PASS  route /admin/invitations renders
PASS  route /admin/audit renders
PASS  route /system/settings renders
PASS  route /system/email renders
PASS  route /profile renders
PASS  route /change-password renders
PASS  role detail opens permission editor
PASS  unknown route shows 404 page
PASS  logout returns to login
PASS  mobile login has no horizontal overflow (390 px)
PASS  no unexpected console errors
```

Result: **27/27**. The single intentional `401` from the invalid-credentials step
is excluded from the console-error assertion.

## 4. API workflow suite — T2 (33 checks)

Drove the full write lifecycle through the same HTTP client contract the UI uses:
create employees, create an order with a real PNG upload, exercise business rules,
update production status, reassign, add notes, create targets, verify reports,
rotate RBAC grants, patch settings.

```
PASS  sign in
PASS  API rejects CUTTING_MAN creation (known backend defect) — 403
PASS  create OPERATOR employee
PASS  create second OPERATOR employee
PASS  create order with image upload
PASS  order starts PENDING with both departments assigned
PASS  duplicate order number rejected — 400
PASS  assignee department mismatch rejected — 400
PASS  retrieve order detail
PASS  original image served with permission check (PNG bytes, image/png)
PASS  generated order-card image generated
PASS  create target
PASS  department status IN_PROGRESS rejected — 400
PASS  cutting COMPLETED moves the order to IN_PROGRESS
PASS  operator status -> COMPLETED completes the order
PASS  admin status update without department rejected — 400
PASS  reassignment keeps status and writes history
PASS  assignment history available
PASS  production status history available
PASS  add order note
PASS  overlapping target rejected — 400
PASS  target detail reports achieved credits
PASS  dashboard reflects created order and credits
PASS  employee performance report credits the cutting man
PASS  production report counts a completed order
PASS  create role
PASS  grant permission at scope ALL
PASS  role history records the change
PASS  delete temporary role
PASS  scope restriction accepted for assignable permission
PASS  system settings readable and writable
PASS  out-of-range invitation expiry rejected — 400
PASS  audit log records the fixture activity
```

Result: **33/33**.

Findings that came out of this suite (all correct backend behaviour, my initial
test assumptions were wrong):

* Department statuses are `PENDING`/`COMPLETED` only; `IN_PROGRESS` is derived.
* `assign` is `PATCH`, not `POST`.
* A reassignment to the same employee is a no-op (test needed a second operator).
* Completion credits exist only for departments that had a target at completion
  time; a target created afterwards earns nothing for past completions.

## 5. UI write-flow suite — T3 (8 checks)

Ran in the browser with the production build's real components:

```
PASS  image upload shows a preview
PASS  create order through the UI (multipart + both assignee selects)
PASS  detail page shows the new order
PASS  detail page renders the order image
PASS  status dialog updates the department
PASS  cutting now reads completed
PASS  reassignment takes effect in the UI
PASS  no unexpected console errors
```

Result: **8/8**. This confirms the multipart upload, Radix selects, mutation
invalidation and refetching all work against the live API, not just in isolation.

## 6. Defects found and fixed

1. **Roles and departments lists were always empty.** `URLSearchParams.get()`
   returns `null`; the pages derived `is_active` from it, sending
   `is_active=false` on every request. Fixed by collapsing `null` to `undefined`
   in `roles-list-page.tsx` and `departments-list-page.tsx`. Re-verified in the
   browser: CUTTING and the ADMIN role now render.
2. **Broken `/profile/password` links.** The topbar account menu and the profile
   page linked to a route that does not exist. Both now point at
   `/change-password`; the smoke suite re-ran clean afterwards.

## 7. Backend defect found (not fixed — backend is out of scope)

`POST /employees/` with `role: "CUTTING_MAN"` (or `ADMIN`) returns
**403 "Creating an account with this role requires user-management permission."**
even for a superuser holding every permission.

Root cause: `backend/apps/accounts/services.py:505` calls `get_access(actor)` where
`get_access` expects a **request** (`apps/rbac/access.py:174`). It therefore reads
`getattr(request, "user", None)` from a `User` instance, resolves to `None`, and
denies everyone.

Impact: no Cutting Man account can be created through the API, so a fresh install
cannot create an order through the UI. The workflow suite pre-created the Cutting
Man fixture with the ORM to continue testing everything else. This is recorded in
`KNOWN_LIMITATIONS.md`; fixing it is a one-line change in the service layer
(pass the request or build `EffectiveAccess(actor)`), but the brief forbids backend
edits.

## 8. Data cleanup

After the runs, every fixture was deleted through the ORM (the API deliberately
offers no order/target delete):

* every test order (and its original/generated image files), plus their notes,
  status history, assignment history and completion credits;
* all test targets;
* 9 temporary accounts (`qa-*`, `qa_fixture_*`, including `qa_frontend_verify`) with
  their role assignments, scope restrictions, department memberships and
  one-time tokens;
* the temporary `QA Role …` role.

Post-cleanup state: `users = ["admin"]`, `orders = 0`, `credits = 0`,
`permissions = 42`, `roles = 3` (all system), `memberships = 1`, settings
`invitation_expiry_hours = 72`, `require_email_verification = False` — the same as
before testing. Audit-log rows describing the test activity were left in place,
because the log is append-only by design.

## 9. Not tested (and why)

| Area | Reason |
| --- | --- |
| Invitation email delivery, resend, cancel | Needs a working SMTP backend; no mail was sent. |
| Forgot/reset password, email verification | Token delivery requires email; token-invalid states were only inspected in code. |
| Accept-invitation completion | No invitation token was issued. |
| Email test send | SMTP not configured in the dev environment. |
| Employee deactivate/reactivate | Would have altered fixture state mid-run; endpoint shape is typed and rendered. |
| Adding/removing department memberships, assigning roles, superuser toggle | Same reason; mutations are wired and typed. |
| Permission catalogue create/edit/activate | Not exercised; the list endpoint is verified. |
| 403 UX with a limited-privilege account | Only a superuser account was used, so the guard and 403 state were not seen in the browser. |
| Access-token expiry / refresh replay | Would require waiting out the token lifetime or manipulating the backend setting. |
| Production build served by `vite preview` | Dev server was used for all browser tests. |
| Cross-browser (Firefox/Safari), real mobile devices | Chrome only; mobile was emulated by viewport. |
| Load/performance, accessibility audit (axe) | Out of scope for this pass. |

These are the gaps to close before calling the frontend production-ready.
