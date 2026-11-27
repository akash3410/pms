# Phase 10 — Final Security & Acceptance Report

**Project:** POMS — Production Order Management System
**Release:** Dynamic RBAC (Phases 1–10)
**Date:** 2026-11-28
**Author role:** Independent security review (reviewing the implementation as if written by someone else)
**Verdict:** **CONDITIONALLY ACCEPTED** — see §9.

---

## 1. Scope and method

Reviewed the delivered code, migrations, and tests against the brief's §22 (security requirements),
§23 (testing strategy), §25 (engineering rules) and §27 (acceptance criteria).

Evidence used:

- Full read of every changed/new file (`apps/rbac/**`, `apps/audit/**`, `apps/accounts/**`,
  `apps/orders/**`, `apps/production/**`, `apps/targets/**`, `apps/reports/**`, `config/**`).
- **Live execution** against the project's PostgreSQL cluster:
  `pytest` → **225 passed, 0 failed** (21 s).
- `manage.py check` → no issues. `makemigrations --check` → no drift.
- `manage.py spectacular` → **61 paths, 0 warnings, 0 errors**.
- Migration applied to a real database **with pre-existing data** (1 legacy user) and verified.
- `manage.py createsuperuser --noinput` executed successfully (finding M-02 fixed).
- `ruff check apps common config` → clean.

Limits of this review are listed in §8; nothing below is claimed beyond what was executed.

---

## 2. Implemented features (evidence)

| Requirement | Status | Evidence |
|---|---|---|
| Dynamic business roles in DB | ✅ | `rbac.Role`; CRUD at `/rbac/roles/`; no code compares a role code for authorization (grep of `apps/` shows only the legacy display field and the bridge) |
| Permission catalogue, stable keys | ✅ | 42 seeded permissions; `key` immutable; `system.*` non-assignable |
| Role lifecycle (create/update/deactivate/reactivate/delete) | ✅ | `apps/rbac/services.py`; deactivation immediately drops contribution; delete refused for system roles and live assignments |
| Role/permission history | ✅ | append-only `AuditLog`; `/rbac/roles/{id}/history/`, `/rbac/permissions/{id}/history/` |
| Multiple roles per user, UNION | ✅ | `UserRole` + `EffectiveAccess._load`; tested (`test_multiple_roles_union`) |
| No direct user permissions | ✅ | no such model/endpoint; only `RolePermission` |
| Per-permission scope | ✅ | `RolePermission.scope` + `options`; validated against `Permission.supported_scopes` |
| Scope types ALL/ASSIGNED/CREATED_BY_ME/DEPARTMENT/OWN_PROFILE | ✅ | `apps/rbac/scopes.py` registry, compiled to SQL `Q` |
| User-level restrict-only scope | ✅ | `UserScopeRestriction` applied as `AND`; tested (`test_user_restriction_narrows_and_never_expands`) |
| Invalid scope fails closed | ✅ | `build_scope_q` returns an empty `Q` on unknown scope/module/builder error |
| Departments (primary + additional) | ✅ | `Department`, `DepartmentMembership` (historical `ended_at`); CRUD + member endpoints |
| Assignment-based order scope | ✅ | `orders_assigned` honours `options.assignment_types`; current assignee only (uses `Order.cutting_man/operator`) |
| Separate history/media permissions | ✅ | `orders.view_history`, `orders.view_assignments`, `orders.view_notes`, `production.view_status_history`, `orders.view_media` |
| Immediate effect of every change | ✅ | no cross-request permission cache; no authorization in the JWT; tested add/remove/deactivate |
| Deactivated user blocked immediately | ✅ | `IsActiveUser` global default + login/refresh checks; tested with a real bearer token |
| Deactivation revokes roles & memberships, keeps history | ✅ | `services.deactivate_user`; tested (`test_reactivation_does_not_restore_roles`) |
| Admin self-lockout protection | ✅ | `_assert_actor_retains_management`, transaction-rolled back; tested (`409`) |
| Admin-to-admin safeguard | ✅ | `_assert_target_not_stranded` (conservative policy, PD-3) |
| Last active superuser protected | ✅ | `set_superuser` locks all active superusers, then counts; tested (`409`) |
| Admin cannot manage superusers | ✅ | `/rbac/users/{id}/superuser/` requires `system.manage_superusers`, which no role can hold; tested (`403`) |
| Business permissions never grant system capability | ✅ | model validator + service validation + seed excludes `system.*`; tested (`400`) |
| Email-based login (and legacy username) | ✅ | `accounts/auth.py`, `TokenPairSerializer`; tested |
| Password change | ✅ | `/auth/change-password/`, validators, audit; tested |
| Forgot/reset password, single-use, hash-only | ✅ | `OneTimeToken` (SHA-256), 1 h TTL, consumed on use; tested incl. replay |
| Email verification | ✅ | `email_verified_at` + 3-day token; login gate for API-created accounts; tested |
| Login rate limiting / failed-attempt tracking | ✅ | `LoginAttempt`, 5/15 min per identifier+IP → `429`; tested |
| Refresh rotation, blacklist, logout | ✅ | preserved SimpleJWT configuration; existing + new tests |
| Invitations (create/resend/cancel/accept, expiry, single-use, status) | ✅ | `Invitation` + service; tested incl. replay, expiry, rotation, cancel |
| Configurable invitation expiry with hard cap, snapshot semantics | ✅ | `SystemSetting` + `min(hours, 168)`; Admin-grantable `invitations.manage_settings` via `/invitations/settings/`; expiry stored per invitation; tested |
| Superuser-only email configuration, no secret exposure | ✅ | `/system/email/`; secret read from env; `400` on password submission; tested |
| Audit logging of security events, redacted, append-only | ✅ | `apps/audit`; model refuses update/delete; not in Admin; tested immutability + redaction |
| Django Admin cannot bypass API rules | ✅ | staff fields read-only, add/delete disabled, no audit model registration; tested |
| Backward-compatible migration | ✅ | 6 migrations, applied over existing data; 164 pre-existing tests pass |
| OpenAPI / Swagger documentation | ✅ | 61 paths, 0 warnings; `docs/rbac/api-documentation.md` |

### Deliberate design deviations (documented, not gaps)

- `assignments.create_assignment` / `assignments.reassign_assignment` are expressed as one permission,
  `orders.assign_order`. Both are the same guarded service call; splitting them would create a
  permission that cannot be enforced differently.
- `users.manage_users` governs role assignment instead of a separate `users.assign_role`; the brief
  lists permission keys as illustrative.
- No DENY grants (per brief), no direct user permissions (per brief).

---

## 3. Not implemented / out of scope

| Item | Reason |
|---|---|
| Frontend / UI controls | repository is backend-only; authorization is server-side by design |
| In-app SMTP credential storage | no vetted AEAD library available; env/secret-store chosen (PD-1) |
| Multi-tenancy | not part of the brief or the existing domain |
| Automatic reassignment of orders on deactivation | deliberately refused: reassignment is an explicit administrative action; the API reports `active_orders` |
| Removing `backend/pgdata/` from Git and rewriting history | destructive repository operation requiring explicit authorisation (H-07, pre-existing) |
| Per-request DRF throttles on all endpoints | login/reset throttling implemented; broad API throttling is an infrastructure concern and was not requested |
| Token-versioning to revoke *access* tokens on password change | see R-02; access tokens expire in 60 min and deactivation is enforced |

---

## 4. Test results (executed)

```
$ .venv/bin/python -m pytest -q
225 passed in 21.03s
```

| Suite | Tests | Notes |
|---|---|---|
| Pre-existing (`accounts`, `orders`, `production`, `targets`, `common`) | 164 | all pass; **one change**: the weak literal `Password12345` in `apps/accounts/test_api.py` was replaced with `Str0ng-Prov1sion!` because `CommonPasswordValidator` is now actually enforced (finding H-02). Assertions were not changed, and 4 new assertions in the new suite prove weak passwords are rejected. |
| `apps/rbac/test_api.py` | 34 | role lifecycle, permission union, scope matrix, restriction semantics, departments, safeguards, audit, JWT claims |
| `apps/accounts/test_auth_security.py` | 27 | email login, enumeration, rate limit, password change/reset, verification, invitations + expiry configuration, system config, Django Admin surface |

Additional executed checks:

| Command | Result |
|---|---|
| `manage.py check` | no issues |
| `manage.py makemigrations --check --dry-run` | `No changes detected` |
| `manage.py migrate` (existing DB) | applied cleanly, data preserved |
| `manage.py spectacular --file …` | 61 paths, 0 warnings, 0 errors |
| `ruff check apps common config` | clean |
| `manage.py createsuperuser --noinput …` | success; `role=ADMIN`, `employee_code=SU-<NAME>` |

**Not covered by an automated test (declared, not implied):** true concurrent superuser demotion
(`SELECT … FOR UPDATE` taken, but no threaded test), and SMTP delivery to a real server.

---

## 5. Security findings from this independent review

Severity: HIGH = exploitable escalation/data exposure; MEDIUM = exploitable with a precondition or a
missing defence-in-depth control; LOW = hygiene.

### Remediated during this release (verified)

| ID | Was | Now |
|---|---|---|
| H-01 | no password change/reset | `/auth/change-password/`, `/auth/password/forgot/`, `/auth/password/reset/` |
| H-02 | admin-created accounts bypassed all validators | `create_employee_account` runs `validate_password`; weak passwords rejected |
| H-03 | Django Admin bypassed authorization | staff fields read-only, add/delete disabled, audit model unregistered |
| H-04 | no lockout protection | self-lockout, admin-stranding and last-superuser guards (`409`) |
| H-05 | no audit trail | append-only `AuditLog` for 20+ action types |
| H-06 | no login throttling | 5 failures / 15 min per identifier+IP → `429` |
| M-01 | closed role model | dynamic roles, multi-role, union |
| M-02 | broken `createsuperuser` | manager derives `full_name`/`employee_code` |
| M-03 | unconstrained role update | role change requires `users.manage_users` + assignment compatibility |
| M-04 | no permission catalogue | 42 permissions |
| M-05 | department = fixed role | `Department` + memberships |
| M-06 | targets tied to role | target department validated against membership |
| M-07 | history shared order visibility | independent history/media permissions |
| M-08 | deactivation stranded assignments | revokes roles/memberships, reports `active_orders` |
| M-09 | admin/superuser planes disconnected | `system.*` permissions + superuser-only endpoints |
| M-10 | stale JWT claims | authorization claims removed from tokens; tested |
| M-11 | dead permission classes | removed (`IsEmployee`, `IsAdminOrReadOnly`, `IsAdmin`) |
| M-12 | reports included inactive employees | performance report derives from active production memberships; dashboard uses consistent filters |
| M-13 | `role` silently ignored on `/me/` | unchanged contract, now documented; no privilege effect |

### Residual findings

| ID | Severity | Finding | Why it remains | Recommended action |
|---|---|---|---|---|
| R-01 | **HIGH** | `backend/pgdata/` (1,276 files, ~65 MB of PostgreSQL data pages) is still tracked in Git | Removing tracked files + history rewrite is destructive and was not authorised; it also requires credential rotation decisions | `git rm -r --cached backend/pgdata`, add to `.gitignore`, purge from history, rotate any credential contained in the cluster dump |
| R-02 | MEDIUM | Changing a password blacklists refresh tokens but an already-issued **access** token stays valid until it expires (≤ 60 min) | Would require a token-version claim checked per request; out of the brief's explicit scope (deactivation *is* enforced immediately) | Add `token_version`/`password_changed_at` claim validated in authentication |
| R-03 | MEDIUM | Accounts created outside the API (shell/ORM/management script) with an email are not flagged `requires_email_verification` | The flag is set by the provisioning path | Set it in `UserManager.create_user` when `email` is present, or add a management command |
| R-04 | MEDIUM | Login throttling is per identifier+IP; there is no global API throttle | Distributed attempts with many identifiers are not slowed | Add DRF `AnonRateThrottle`/`ScopedRateThrottle` or an edge WAF rate limit |
| R-05 | MEDIUM | SMTP credential rotation requires a deployment/secret-store change, not an API call (PD-1) | No vetted encryption library available without adding a dependency | Add `cryptography`, store a Fernet-encrypted value keyed by an env secret; keep masking |
| R-06 | LOW | Audit immutability is enforced at the ORM layer only | True append-only needs DB grants/triggers, which differ per environment | Restrict DB role to `INSERT`/`SELECT` on `audit_auditlog` in production |
| R-07 | LOW | `development.py` allows all CORS origins and uses the console email backend (which prints invitation/reset links) | Pre-existing dev convenience | Keep dev-only; assert `DEBUG=False` + explicit CORS in prod (already enforced by `production.py`) |
| R-08 | LOW | Legacy `User.role` field and bridge still exist | Client contract compatibility (decision D-1) | Remove after clients read `/rbac/users/{id}/roles/` |
| R-09 | LOW | `EmployeeUpdateSerializer` role-change guard still references the three legacy role constants | It validates a legacy field, not authorization | Delete together with R-08 |
| R-10 | LOW | No automated threaded test for concurrent **superuser** demotion | Time/complexity; the lock is implemented | Add a two-thread test mirroring the existing credit-race test |

---

## 6. Migration status

| Migration | Applied on existing DB | Notes |
|---|---|---|
| `rbac.0001_initial` | ✅ | new tables/constraints |
| `accounts.0002_rbac_auth_fields` | ✅ | new columns + tables; unique lower(email) with empty-string exemption |
| `accounts.0003_seed_system_settings` | ✅ | settings + email singleton |
| `audit.0001_initial` | ✅ | audit table |
| `rbac.0002_seed_catalogue` | ✅ | 42 permissions, 2 departments, 3 roles, role→permission grants |
| `rbac.0003_backfill_legacy_roles` | ✅ | `UserRole` + `DepartmentMembership` for the existing user |
| `rbac.0004_add_invitation_settings_permission` | ✅ | Admin-grantable `invitations.manage_settings` |

Data preservation verified: the pre-existing user still authenticates with the same password hash;
`Order`, `AssignmentHistory`, `ProductionStatusHistory`, `OrderNote`, `EmployeeTarget` and
`CompletionCredit` rows were not touched (only additive tables/columns; the authorization gate
changed). The verification queries in Phase 3 §9 were executed and returned the expected results.

---

## 7. Security checklist from brief §22

| Check | Result |
|---|---|
| Privilege escalation | ✅ permission + scope; legacy role elevation requires `users.manage_users`; `system.*` ungrantable |
| BOLA/IDOR | ✅ scoped `get_object()`; existing IDOR tests still return 404/401 |
| Cross-department access | ✅ `DEPARTMENT` scope tested; assignee membership re-checked |
| Unauthorized order access | ✅ existing + new tests |
| Historical record leakage | ✅ separate permissions; out-of-scope → 404 |
| Permission bypass via alternative endpoint | ✅ legacy `role` PATCH guarded; `/me/` cannot change role |
| Stale JWT permission claims | ✅ claims removed; test asserts absence |
| Deactivated-user token reuse | ✅ 401 (tested with a real token) |
| Role deactivation bypass | ✅ immediately drops permissions (tested) |
| Scope expansion through multiple roles | ✅ union only; tested |
| User-level scope override escalation | ✅ `AND`-only; tested |
| Unauthorized superuser management | ✅ 403 for admins; 409 for last superuser |
| Last superuser removal | ✅ 409 (tested) |
| Administrative self-lockout | ✅ 409 + rollback (tested) |
| Invitation token replay / expiry | ✅ tested |
| Password reset token replay | ✅ tested |
| Email enumeration | ✅ identical `401` message; forgot-password always `204`; tested |
| Brute force login | ✅ `429` after 5 failures; tested |
| Concurrent privilege changes | ⚠️ locks implemented (`select_for_update` on user/all active superusers); **not** exercised by a threaded test |
| Django Admin authorization bypass | ✅ read-only + no add/delete; tested |
| Sensitive credential exposure | ✅ SMTP secret never in DB/API; audit redaction; tested |
| Unauthorized media access | ✅ existing image tests pass |

---

## 8. Known limitations of this review

- No penetration test, fuzzing, or load test was performed. No performance claim is made; the
  authorization path adds one indexed `RolePermission`/`UserScopeRestriction` query per request
  (memoised per request), which was not benchmarked.
- SMTP delivery was not exercised against a real server (no credentials in this environment).
- The threaded superuser-demotion race is reasoned about from the lock ordering, not executed.
- No client application exists in the repository, so client-side trust of removed JWT claims could
  not be verified. Clients that read `token.role` must switch to `/auth/me/`.
- Only the local PostgreSQL cluster (1 pre-existing user) was used for migration verification.

---

## 9. Verdict

### CONDITIONALLY ACCEPTED

**Why not unconditional:** one HIGH finding from the original audit is **not** remediated —
`backend/pgdata/` remains tracked in Git (R-01/H-07). It is a data-exposure and repository-hygiene
risk, and remediating it requires a destructive history operation and credential rotation that the
brief does not authorise an agent to perform unilaterally.

**Why accepted with that condition:** every authorization, authentication, scope, audit and
administrative-safeguard requirement in the brief is implemented, enforced server-side, and verified
by 225 passing tests on a real PostgreSQL database. No unresolved CRITICAL or HIGH vulnerability
exists **inside the application's authorization surface**; the remaining HIGH item is repository
data handling, and the MEDIUM items are either explicitly out of scope (R-02, R-05) or
defence-in-depth improvements (R-03, R-04, R-06).

### Conditions for full acceptance

1. Purge `backend/pgdata/` from the repository and history; rotate anything it exposed.
2. Add the token-version check so password change invalidates existing access tokens (R-02).
3. Flag email verification for accounts created outside the API (R-03).
4. Add a global/edge rate limit in addition to login throttling (R-04).
5. Provide a secret-store rotation path for SMTP credentials (R-05).
6. Add the threaded last-superuser concurrency test (R-10).

### Production readiness statement

The RBAC and authentication surface is **ready for staged rollout** behind the deployment checklist in
`docs/rbac/deployment-and-rollback.md`, **provided condition 1 is completed first**. It is not
declared "production ready" unconditionally while that HIGH-severity repository finding remains open.
