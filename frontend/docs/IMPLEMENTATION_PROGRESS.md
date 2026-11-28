# Implementation Progress

A build log of the frontend, in the order it was done, with the state of every
workstream at the end. Statuses match `FRONTEND_FEATURE_TRACEABILITY.md`.

## Summary

| Workstream | State |
| --- | --- |
| Project scaffold, tooling, design system | Done |
| API client, session, RBAC access layer | Done |
| Authentication & account screens | Done |
| App shell, navigation, guards, routing | Done |
| Orders | Done |
| Production ("My work") | Done |
| Employees | Done (one backend-blocked flow) |
| Targets | Done |
| Dashboard & reports | Done |
| RBAC administration | Done |
| Invitations | Done |
| Audit log | Done |
| System & email settings | Done |
| Documentation | Done |
| Automated verification | Done — see `TESTING_REPORT.md` |

No backend file was modified. `git status` under `backend/` stayed clean; all new
code lives under `frontend/`.

## 1. Scaffold and tooling

* Vite + React 19 + TypeScript strict (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`).
* Tailwind v4 through `@tailwindcss/vite` with design tokens in
  `src/index.css`; no `tailwind.config.js` needed.
* `components/ui/*` are hand-written shadcn-style wrappers over Radix
  primitives (button, input, label, select, dialog, dropdown, tabs, switch,
  checkbox, popover, tooltip, progress, avatar, separator, table, badge, card,
  misc alerts/skeleton).
* `eslint.config.js` (flat config) with typescript-eslint, react-hooks and
  react-refresh; `src/vite-env.d.ts` for `import.meta.env` and CSS imports.
* `vite.config.ts` splits vendor chunks (`react`, `query`, `forms`) and proxies
  `/api` in dev.

## 2. API layer and session

* `lib/api/client.ts`: Axios instance, bearer header, one in-flight refresh with a
  replay queue, `get/post/patch/put/del(url, config)` helpers (DELETE bodies are
  passed as `{ data }`), blob downloads for authenticated media, and a
  session-expired callback so the client stays router-free.
* `lib/api/errors.ts`: normalises DRF validation dicts, business-rule `detail`
  strings and dicts, network failures, and 401/403 into one `ApiError` with
  `detail`, `fieldErrors`, `status`.
* `lib/api/tokens.ts`: the only place that touches `localStorage`.
* `features/auth/session.tsx`: boot from cached user → `GET /auth/me/` →
  `GET /rbac/users/{id}/effective-permissions/`; exposes `user`, `login`,
  `logout`, `can`, `canAny`, `hasScope`, `refreshAccess`. The access layer is the
  only permission authority in the UI.
* `app/access.tsx` adds `useAccess`, `<Can>` and `<CanScope>` for section-level
  gating.

## 3. Shell and routing

* `app/router.tsx`: public routes outside the shell; `RequireAuth` + `AppShell`
  inside; per-route `RequirePermission`; `IndexRoute` picks the first screen the
  user may see (`reports.view_reports` → `orders.view_order` →
  `production.update_status` → `targets.view_targets`); 404 fallback.
* Pages are code-split through a typed `lazyPage` helper with a shared Suspense
  fallback, so a cold visit downloads only the shell plus that route.
* Sidebar items come from `app/navigation.ts`, which declares the backend
  permission keys per item; sections collapse when empty. Mobile uses a drawer;
  the topbar has the account menu, theme-free layout and sign-out.

## 4. Feature modules

All modules follow the same layering: `types.ts` → `api.ts` → `hooks.ts` →
`pages/`/`components/`.

1. **Auth** — login, forgot, reset, accept invitation, verify email, profile,
   change password. Shared `AuthLayout`; verified email notices surfaced from the
   backend message.
2. **Orders** — list with URL-synced filters (`?page`, `?search`,
   `?overall_status`…), create page with drag/drop image preview, details with
   both images, status card, assignment/status-history/notes tabs, and dialogs for
   assign, status change and note creation. Mutations invalidate the detail, the
   list and the dashboard.
3. **Production** — "My work" derived from the permission-scoped order list;
   active/completed toggle, paging, per-department status and note.
4. **Employees** — list, create, details, edit email, deactivate/reactivate with
   the backend's explanatory message.
5. **Targets** — list with URL filters, create/edit dialog implementing the
   role/department/date/overlap rules client-side *as UX only*, details with
   progress, immutable-field explanation once credits exist.
6. **Dashboard** — six KPI cards, orders-by-status, employees-by-department,
   employees-by-role, recent orders; every panel has a real empty state.
7. **Reports** — three tabs (production, employee performance, target
   achievement) with window controls mapped to `limit`/`offset`.
8. **RBAC** — roles list/details with the full permission editor (replace-all
   grants, scope + options), permissions catalogue, departments with membership
   management and primary department, user access page (roles, restrictions,
   superuser toggle, effective access viewer). All lists are URL-driven with
   `placeholderData` so paging/filtering does not flash.
9. **Invitations** — list, create, resend, cancel, and the expiry-settings
   dialog bounded by the server's `max_invitation_expiry_hours`.
10. **Audit** — filterable, searchable log with a detail dialog.
11. **Settings** — system settings (invitation expiry, email verification
    requirement) and email configuration with write-only password handling and a
    test-send action.

## 5. Notable fixes made during verification

| Issue | Resolution |
| --- | --- |
| Roles/departments lists rendered empty: `URLSearchParams.get()` returns `null`, which was sent as `is_active=null` (falsy on the backend) | Coerce to `undefined` in `roles-list-page.tsx` and `departments-list-page.tsx` |
| Topbar and profile linked to `/profile/password`, a route that does not exist | Both now link to `/change-password` |
| Two corrupted test images were rejected by the backend (correct behaviour) | Test fixture replaced with a valid PNG; the UI surfaced the backend message as a field error |
| Assignee picker had no candidates in the test data | Test fixture needed a second Cutting Man; the UI correctly reported "no other eligible employees" |
| Detail page read immediately after create showed the previous page while the lazy chunk loaded | Test waits for the heading; no app defect |

## 6. Remaining work / next steps

Nothing in the requested scope is unimplemented on the frontend. The open items
are:

1. **Backend defect blocking CUTTING_MAN creation** (`create_employee_account`
   passes a `User` to `get_access()`, which expects a request → always 403). Until
   fixed, cutting-man accounts can only be created out of band. See
   `KNOWN_LIMITATIONS.md` §1.
2. **Unverified flows that need external delivery**: invitation email dispatch,
   password reset email, email verification, SMTP test send, employee
   deactivation/reactivation, membership and role-assignment mutations. They are
   implemented and typed; they need a mail-capable environment and a second
   limited-privilege account to verify the 403 UX.
3. **Legacy-role creation of ADMIN accounts** is subject to the same permission
   rule as CUTTING_MAN, so it is only usable if that defect is fixed.
