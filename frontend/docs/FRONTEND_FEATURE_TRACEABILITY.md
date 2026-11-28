# Frontend Feature Traceability

Status vocabulary:

| Status | Meaning |
| --- | --- |
| **VERIFIED** | Exercised against the live backend during this build (UI or direct API through the same client contract) and behaved as documented. |
| **IMPLEMENTED** | Code complete, type-checked, and the endpoints it calls were exercised, but *this exact interaction* was not driven end-to-end. |
| **PARTIAL** | Works, with a documented limitation. |
| **BLOCKED** | Cannot work because the backend lacks or rejects something; see `KNOWN_LIMITATIONS.md`. |

No row is "VERIFIED" unless it was actually run. Evidence refers to
`TESTING_REPORT.md` sections.

## 1. Platform & shell

| Capability | Where | Status | Evidence |
| --- | --- | --- | --- |
| Strict TypeScript project, path aliases, production build | `tsconfig*.json`, `vite.config.ts` | VERIFIED | `tsc -b --noEmit`, `npm run build` |
| Lint configuration (flat config, hooks rules) | `eslint.config.js` | VERIFIED | `npx eslint .` → 0 errors |
| Code-split routes, vendor chunking | `app/router.tsx`, `vite.config.ts` | VERIFIED | build output, T1 route walk |
| App shell: sidebar generated from effective permissions, mobile drawer, topbar account menu | `components/layout/*`, `app/navigation.ts` | VERIFIED | T1 navigation + mobile overflow check |
| Anonymous → login redirect with return path | `app/guards.tsx` | VERIFIED | T1 (redirect + post-login restore) |
| Permission-denied state per route (no blank screens) | `app/guards.tsx`, `components/feedback/states.tsx` | IMPLEMENTED | guard code; no limited-permission account was used in the final run |
| 404 route | `app/router.tsx` | VERIFIED | T1 |
| Session refresh with request replay | `lib/api/client.ts` | IMPLEMENTED | interceptor inspected; expiry not forced in tests |
| Session expiry → sign-out + notice | `features/auth/session.tsx` | IMPLEMENTED | not forced in tests |
| Tokens in `localStorage` | `lib/api/tokens.ts` | VERIFIED (behaviour) / PARTIAL (hardening) | see limitations |

## 2. Authentication & account

| Capability | Status | Evidence |
| --- | --- | --- |
| Sign in with email or username | VERIFIED | T1 (valid + invalid credentials) |
| Sign out | VERIFIED | T1 (account menu → sign out → `/login`) |
| Forgot-password request | IMPLEMENTED | form + endpoint wired; no email was sent in tests |
| Reset-password with token | IMPLEMENTED | page handles missing/invalid token states; not exercised with a real token |
| Accept invitation (set password) | IMPLEMENTED | public page + endpoint; no invitation was issued in tests |
| Email verification + resend | IMPLEMENTED | pages and endpoints wired; not exercised with a real token |
| Profile view | VERIFIED | T1 `/profile` renders live data |
| Profile update (name/email) | IMPLEMENTED | mutation wired; not submitted in tests |
| Change password | IMPLEMENTED | form validation + endpoint wired; not submitted (would invalidate the QA credential) |
| Show own effective access and inherited roles | VERIFIED | T1 `/profile` renders access summary |

## 3. Orders

| Capability | Status | Evidence |
| --- | --- | --- |
| Order list with search, status filters, ordering, pagination | VERIFIED | T1 render; T2 `GET /orders/` shapes |
| Create order (multipart image + both assignees) | VERIFIED | T3 UI create, T2 API create (201) |
| Original image preview before upload | VERIFIED | T3 |
| Reject invalid image upload with the backend's message | VERIFIED | T3 (first run used a corrupt PNG; backend message surfaced) |
| Duplicate order number rejected | VERIFIED | T2 (400) |
| Assignee with wrong department role rejected | VERIFIED | T2 (400) |
| Order detail with both images (authenticated blob endpoints) | VERIFIED | T3 (2 images rendered), T2 (bytes + content type) |
| Edit order metadata / replace original image | IMPLEMENTED | `PATCH /orders/{id}/` wired and typed; not driven through the UI |
| Assign / reassign a department | VERIFIED | T3 UI reassign; T2 API (status preserved, history appended) |
| Department status update as admin (must name department) | VERIFIED | T3 UI, T2 API (missing department → 400) |
| `IN_PROGRESS` rejected as a department status | VERIFIED | T2 (400, matches enum) |
| Status history, assignment history, notes read | VERIFIED | T1 tabs render; T2 collections returned |
| Add note | VERIFIED | T2 (201) |
| Status equal to current is a no-op | IMPLEMENTED | backend rule documented; UI disables unchanged submit |

## 4. Production

| Capability | Status | Evidence |
| --- | --- | --- |
| "My work" queue (assigned, active/all toggle, paging) | VERIFIED | T1 renders live data |
| Employee updates own department status | IMPLEMENTED | UI path exists; verified only as admin through the order detail |
| Admin scope indicator | VERIFIED | T1 render |

## 5. Employees

| Capability | Status | Evidence |
| --- | --- | --- |
| Employee list with search and ordering | VERIFIED | T1 render; T2 shape |
| Employee details with RBAC roles and department memberships | VERIFIED | T1 render |
| Create OPERATOR account | VERIFIED | T2 (201) |
| Create CUTTING_MAN / ADMIN account | BLOCKED | T2: 403 for a superuser — backend defect, see limitations |
| Edit employee (email etc.) | IMPLEMENTED | `PATCH` wired; not submitted |
| Deactivate / reactivate | IMPLEMENTED | actions wired with backend message surfaced; not submitted |

## 6. Targets

| Capability | Status | Evidence |
| --- | --- | --- |
| Target list with filters (employee, department, period) | VERIFIED | T1 render; T2 shape |
| Create target | VERIFIED | T2 (201) |
| Overlapping period rejected | VERIFIED | T2 (400) |
| Target detail with achieved credits | VERIFIED | T2 (`achieved_count`), T1 render |
| Edit `target_count`; immutable fields after credits | IMPLEMENTED | form implements the rule; not edited in tests |
| Delete target | BLOCKED | no DELETE endpoint on the backend |
| Progress widget | VERIFIED | T1 render |

## 7. Dashboard & reports

| Capability | Status | Evidence |
| --- | --- | --- |
| Dashboard KPIs from live data | VERIFIED | T1 (numbers matched DB), T2 (KPIs changed after creating/completing an order) |
| Distribution panels + recent orders + empty states | VERIFIED | T1 render |
| Production report | VERIFIED | T2 (completed order reflected) |
| Employee performance report (+ windows) | VERIFIED | T2 (credit attributed to the cutting employee) |
| Target achievement report | VERIFIED | T1 render; T2 shape |
| Report windowing with `limit`/`offset` within backend caps | IMPLEMENTED | client clamps to 500; not exercised at the cap |
| CSV/PDF export | Not requested / not offered by the backend | — |

## 8. RBAC

| Capability | Status | Evidence |
| --- | --- | --- |
| Roles list with search/active/system filters | VERIFIED | T1 (after fixing the `is_active` filter bug) |
| Create role | VERIFIED | T2 (201, then deleted) |
| Role details + permission editor (replace-all grants) | VERIFIED | T1 editor opens; T2 `PUT` grants at `ALL` scope, history written |
| Role activate/deactivate/delete | IMPLEMENTED (delete VERIFIED in T2) | activate/deactivate wired; delete exercised |
| Role change history | VERIFIED | T2 (history entries after grant change) |
| Permission catalogue list/create/edit/activate | IMPLEMENTED | list VERIFIED in T1/T2; mutations wired, not submitted |
| Departments list (with active filter) | VERIFIED | T1 (CUTTING listed after the filter fix) |
| Department details + memberships list | VERIFIED | T1 render |
| Add/remove membership, set primary department | IMPLEMENTED | mutations wired; not submitted |
| User access page: roles, restrictions, superuser, effective access | VERIFIED | T1 render; T2 restriction `PUT` accepted |
| Scope restriction cannot widen access | VERIFIED (contract) | backend enforces AND-only restrictions; client only offers the documented shape |

## 9. Invitations

| Capability | Status | Evidence |
| --- | --- | --- |
| Invitation list with status/email filters | VERIFIED | T1 render; T2 shape |
| Create invitation (email dispatch) | IMPLEMENTED | form + endpoint wired; no email sent in tests |
| Resend / cancel | IMPLEMENTED | actions wired; not submitted |
| Invitation expiry settings | VERIFIED | T2 read/write within range; out-of-range rejected |

## 10. Audit & settings

| Capability | Status | Evidence |
| --- | --- | --- |
| Audit log list with filters, search, paging | VERIFIED | T1 render; T2 (fixture activity appeared) |
| Audit detail dialog | VERIFIED | T1 opens detail from live row |
| System settings read/update | VERIFIED | T2 (200, same-value write; invalid value rejected) |
| Email configuration read/update | IMPLEMENTED | GET VERIFIED (T1/T2); PATCH wired with write-only password handling, not submitted |
| Test email send | IMPLEMENTED | endpoint wired with result toast; not sent (no SMTP configured) |

## 11. Cross-cutting UX

| Capability | Status | Evidence |
| --- | --- | --- |
| Loading / empty / error states on every data screen | VERIFIED | T1 all routes rendered with real states |
| Field-level + form-level API error rendering | VERIFIED | T3 (invalid image error surfaced on the field) |
| Toasts for mutations | VERIFIED | T3 (assignment updated) |
| Accessible dialogs/selects (Radix) and focus handling | VERIFIED (open/close, option selection) | T1/T3 |
| No horizontal overflow at mobile width | VERIFIED | T1 (390 px login and shell) |
| Mobile navigation drawer | VERIFIED | T1 shell at mobile width |
| Dark mode / i18n | Not in scope | — |
