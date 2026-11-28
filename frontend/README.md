# POMS Web Frontend

React + TypeScript single-page client for the POMS (Production Order Management
System) Django REST backend that already lives in this repository under
`backend/`.

The frontend is a **pure consumer** of the existing API. No backend file, model,
endpoint, permission key, or business rule was changed, duplicated, or
"simplified" for the client. Where the API does not offer something, the UI either
uses what the API does offer or the gap is documented in
[`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md).

## Stack

| Concern | Choice |
| --- | --- |
| Runtime / build | React 19, TypeScript 5.9 (strict), Vite 7 |
| Routing | React Router 7 (data-agnostic `BrowserRouter`, code-split routes) |
| Server state | TanStack Query 5 |
| Forms / validation | React Hook Form 7 + Zod 4 (`zodResolver`) |
| HTTP | Axios with request/response interceptors |
| Styling | Tailwind CSS 4 (`@tailwindcss/vite`) + CSS variables |
| Components | Hand-written shadcn/ui-style primitives on Radix UI; Lucide icons |
| Charts | Recharts 3 |
| Notifications | Sonner |

## Quick start

Prerequisites: the backend running and a reachable PostgreSQL instance (the repo
ships a bundled one on port `55432`).

```bash
# 1. Backend (separate terminal, from the repository root)
cd backend
.venv/bin/python manage.py migrate          # first run only
.venv/bin/python manage.py runserver 127.0.0.1:8000

# 2. Frontend
cd frontend
cp .env.example .env                        # optional; defaults already work
npm install
npm run dev                                 # http://127.0.0.1:5173
```

The Vite dev server proxies `/api` to `VITE_PROXY_TARGET`
(`http://127.0.0.1:8000` by default), so the browser never needs CORS.

Production build:

```bash
npm run build      # tsc -b && vite build  -> dist/
npm run preview
```

## Configuring the API URL

All configuration is build-time environment variables (Vite `import.meta.env`).
See `.env.example`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api/v1` | Absolute or relative base of the REST API, including the version prefix. |
| `VITE_PROXY_TARGET` | `http://127.0.0.1:8000` | Dev-only proxy destination for `/api`. |
| `VITE_APP_NAME` | `POMS` | Product name used in the shell and document title. |

If the API is served from the same origin as the built SPA (recommended), keep
`VITE_API_BASE_URL=/api/v1`. For a separately hosted API use the full origin,
e.g. `VITE_API_BASE_URL=https://poms.example.com/api/v1`, and make sure the
backend allows the SPA origin.

No secret is compiled into the bundle: the client only ever holds a user's own
JWT after they sign in.

## Authentication and access model

* `POST /auth/login/` returns `{ access, refresh, user }`. The access and refresh
  tokens and a cached user snapshot are kept in `localStorage`
  (`poms.access`, `poms.refresh`, `poms.user`).
* The Axios client attaches `Authorization: Bearer <access>` and refreshes an
  expired access token **once** per expiry, replaying the queued requests.
  A failed refresh clears the session and emits one `onSessionExpired` event.
* Authorisation is taken from `GET /rbac/users/{id}/effective-permissions/`.
  Nothing about permissions is hardcoded per role: the sidebar, route guards,
  buttons and page sections are all driven by the permission keys the backend
  returns. `superuser: true` short-circuits the key lookup exactly as the backend
  does.
* Hiding UI is only UX. Every mutating request is still validated by the backend,
  and `403` responses are rendered as an explicit "not permitted" state instead of
  a blank screen or a silent failure.

## Project layout

```
src/
  app/            router, layout shell, navigation model, guards, providers
  components/
    ui/           hand-written Radix primitives (button, dialog, select, table…)
    layout/       sidebar, topbar, page header, breadcrumbs
    feedback/     loading / empty / error states, permission-denied state
    shared/       cross-feature widgets (user refs, status badges, pagination)
  features/
    auth/         session provider, login, password, invitation acceptance, profile
    orders/       list, create, details (assign, status, history, notes), dialogs
    production/   "My work" queue for assigned employees
    employees/    list, create, details, deactivate/reactivate
    targets/      list, create/edit, details, progress widget
    dashboard/    KPI cards, distribution and recent-order panels
    reports/      production / employee / target reports with windows
    rbac/         roles, permission catalogue, departments, user access
    invitations/  invitations and invitation settings
    audit/        audit log with detail dialog
    settings/     system settings, email configuration and test send
  lib/
    api/          axios client, token store, error normalisation, shared types
    config.ts     environment-derived configuration
    format.ts     date/number helpers
```

Every `features/<name>` folder follows the same shape: `types.ts` (API shapes),
`api.ts` (endpoint calls only), `hooks.ts` (TanStack Query wrappers),
`pages/` and `components/`.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server with `/api` proxy. |
| `npm run build` | Type-check the whole project, then production build to `dist/`. |
| `npm run preview` | Serve the built bundle locally. |
| `npm run typecheck` | `tsc -b --noEmit`. |
| `npm run lint` | ESLint 9 flat config (typescript-eslint, react-hooks, react-refresh). |

## Documentation

| Document | Content |
| --- | --- |
| [`docs/FRONTEND_BACKEND_INTEGRATION_MAP.md`](docs/FRONTEND_BACKEND_INTEGRATION_MAP.md) | Screen → endpoints → permission keys → payloads. |
| [`docs/FRONTEND_FEATURE_TRACEABILITY.md`](docs/FRONTEND_FEATURE_TRACEABILITY.md) | Every requested capability with an honest status. |
| [`docs/IMPLEMENTATION_PROGRESS.md`](docs/IMPLEMENTATION_PROGRESS.md) | What was built, in what order, what is left. |
| [`docs/API_INTEGRATION_NOTES.md`](docs/API_INTEGRATION_NOTES.md) | Contract quirks, error handling, pagination, media. |
| [`docs/TESTING_REPORT.md`](docs/TESTING_REPORT.md) | Commands run and their real results. |
| [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md) | Backend gaps, frontend limits, operational notes. |

## Verification status

Type-check, lint and production build are clean (0 errors; 5 `react-refresh`
warnings from files that export both components and helpers by design). The app
was exercised against the live backend with a Playwright smoke suite (27/27), an
API workflow suite (33/33) and a UI write-flow suite (8/8). Details, including
what was *not* verified, are in [`docs/TESTING_REPORT.md`](docs/TESTING_REPORT.md).
