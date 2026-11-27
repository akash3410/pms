# Phase 3 — Migration Plan

**Objective:** move POMS from a fixed `role` column to the Phase 2 dynamic RBAC model **without
losing a single business record and without breaking the existing API contract**.

---

## 1. Guiding rules

1. **Additive first.** Every schema change in Phases 4–7 is a new table, a nullable column, or a
   column with a default. No destructive `ALTER`, no table rename, no column drop.
2. **Preserve identity.** `User.id` (UUID), `password` hashes, `employee_code`, `Order.id`,
   `AssignmentHistory`/`ProductionStatusHistory`/`CompletionCredit` rows are never rewritten.
3. **No data deletion.** `User.role` is kept (transitional). Nothing is dropped in this release.
4. **Reversible where safe.** All migrations have a working `reverse` except the seed
   backfill, which is idempotent and therefore safe to re-run rather than reverse (see §6).
5. **Bridge, then replace.** The legacy role is bridged into RBAC in the same migration that seeds
   the catalogue, so authorization can be swapped module-by-module with a green suite throughout.

---

## 2. Existing → new role mapping

| Existing `User.role` | New `Role.code` | New role name | Notes |
|---|---|---|---|
| `ADMIN` | `ADMIN` | Admin | all non-`system.*` permissions at `ALL` |
| `CUTTING_MAN` | `CUTTING_MAN` | Cutting Man | ASSIGNED scopes limited to `assignment_types=["CUTTING"]`; `DEPARTMENT` membership → `CUTTING` |
| `OPERATOR` | `OPERATOR` | Operator | ASSIGNED scopes limited to `assignment_types=["OPERATOR"]`; `DEPARTMENT` membership → `OPERATOR` |

`Role.is_system=True` for these three; they may not be deleted or have their `code` changed, but
their permission sets are editable data.

Department mapping for the backfill:

| Existing `User.role` | Department membership |
|---|---|
| `CUTTING_MAN` | `CUTTING`, `is_primary=True` |
| `OPERATOR` | `OPERATOR`, `is_primary=True` |
| `ADMIN` | none (the Admin role carries `ALL` scopes) |

---

## 3. Database migration sequence

Applied in this order; each is a separate migration file.

| # | App | Migration | Contents | Reversible |
|---|---|---|---|---|
| 1 | `rbac` | `0001_initial` | `Department`, `Permission`, `Role`, `RolePermission`, `UserRole`, `UserScopeRestriction`, `DepartmentMembership` + constraints/indexes | yes (drop tables) |
| 2 | `audit` | `0001_initial` | `AuditLog` + indexes | yes |
| 3 | `accounts` | `0002_rbac_auth_fields` | `User.email_verified_at`, `User.requires_email_verification`, unique-lower-email constraint; `Invitation`, `OneTimeToken`, `LoginAttempt`, `EmailConfiguration`, `SystemSetting` | yes |
| 4 | `rbac` | `0002_seed_catalogue` | idempotent `get_or_create` of departments, all permissions with `supported_scopes`, the three system roles and their `RolePermission` rows | forward-only (idempotent); reverse deletes only the seeded rows it created |
| 5 | `rbac` | `0003_backfill_legacy_roles` | for each user: `UserRole` for the mapped system role, `DepartmentMembership` for production roles; sets `Admin` role for `is_superuser=True` | forward-only (idempotent) |
| 6 | `accounts` | `0004_seed_system_settings` | `SystemSetting` defaults (`invitation_expiry_hours=72`, `require_email_verification=False`), `EmailConfiguration` singleton | forward-only (idempotent) |
| 7 | `rbac` | `0004_add_invitation_settings_permission` | adds the Admin-grantable `invitations.manage_settings` permission and grants it to `ADMIN` | yes |

No existing column is altered except adding the two nullable/defaulted `User` fields, and no
existing row is deleted. `backend/pgdata` is **not** touched by migrations (it is a local cluster
directory, not an app; its presence in Git is finding H-07 and is out of scope for this migration —
removing it is a separate, explicitly authorised Git operation).

---

## 4. Data preservation strategy

| Data | Strategy |
|---|---|
| `User` rows, UUID PKs, password hashes | untouched |
| `User.role` | retained; kept in sync by an explicit bridge service (`sync_legacy_role`) that assigns/revokes only *system* role assignments and *system* department memberships |
| `employee_code`, `full_name`, email | untouched |
| `Order` + both assignee FKs | untouched; no new columns |
| `AssignmentHistory` | untouched; remains the historical record. Current assignment still read from `Order.cutting_man/operator` |
| `ProductionStatusHistory`, `OrderNote` | untouched |
| `EmployeeTarget`, `CompletionCredit` | untouched; `UNIQUE(employee, order, target)` and `PROTECT` unchanged |
| Reports | untouched; queries only change their authorization gate |
| Role/permission history | new `AuditLog` rows from cutover onward; pre-cutover history does not exist and is **not** fabricated |

New users created after cutover through `User.objects.create_user(role=…)` (tests, fixtures,
management scripts) are bridged by a `post_save` signal that calls the same
`sync_legacy_role` service, so all 164 existing tests keep their fixtures working.

---

## 5. Code cutover order (each step keeps the suite green)

| Step | Change | Gate |
|---|---|---|
| 1 | Add `rbac` + `audit` apps, migrations, seed, backfill | `pytest -q` → 164 passed; `makemigrations --check` clean |
| 2 | Add `EffectiveAccess`, scope registry, permission classes (unused) | unit tests for access/scope |
| 3 | Rewire `orders` (view/create/edit/assign/media/history/notes) | orders + accounts suites green |
| 4 | Rewire `production` status + notes services | production suite green |
| 5 | Rewire `employees`, `targets`, `reports` | full suite green |
| 6 | Add password lifecycle, email login, verification, invitations, rate limiting | auth tests green |
| 7 | Add admin self-lockout, last-superuser guard, Django Admin hardening | security tests green |
| 8 | Delete dead permission classes (`IsEmployee`, `IsAdminOrReadOnly`); `IsAdmin` retained only as a thin alias over `roles.manage_roles`? **No** — removed once unused | `grep -rn "IsAdmin(" apps/` returns nothing |

At no point is a permission check removed before its replacement is verified.

---

## 6. Rollback strategy

**Application rollback (preferred, always available):**
1. Redeploy the previous release image/commit.
2. The new tables and nullable columns are ignored by old code; `User.role` still exists and is
   authoritative for the old code path.
3. No data restore is required for a code-only rollback.

**Schema rollback (only if the release must be fully reverted):**

```bash
cd backend
.venv/bin/python manage.py migrate accounts 0001   # drops new columns/tables in accounts
.venv/bin/python manage.py migrate audit zero      # drops audit_log
.venv/bin/python manage.py migrate rbac zero       # drops rbac tables
```

Reverse is **not** offered for `0002_seed_catalogue`, `0003_backfill_legacy_roles`,
`0004_seed_system_settings`: they are idempotent, so re-running forward is safe and cheaper than a
reverse that could delete an administrator's data-derived role assignment. Reverse those by
deleting only rows whose `is_system=True` **and** `created_at` equals the migration window, and only
after confirming no custom role references them — documented here rather than automated because it
is inherently environment-specific.

**Irreversible by intent:** the audit log. It is append-only; rolling it back means losing the
security trail for that window. Take a backup before deploying (§8) so it can be restored if a
compliance requirement demands it.

---

## 7. Deployment sequence

```
1. BACKUP      pg_dump -Fc -f poms_pre_rbac_$(date +%F).dump
2. BUILD       pip install -r requirements.txt  (no new packages)  &&  collectstatic
3. MIGRATE     manage.py migrate            # additive only
4. VERIFY      manage.py check  &&  the queries in §9
5. SMOKE       login (username AND email), GET /orders, GET /employees as admin,
               PATCH one order status as the assigned employee, GET /rbac/roles
6. SERVE       gunicorn config.wsgi:application
```

Zero-downtime note: steps 1–4 run before the new workers start. Because the migrations are additive
and the previous release ignores the new tables, a mixed old/new fleet is safe during the rollout.

---

## 8. Backup requirements

| Item | Requirement |
|---|---|
| Database | `pg_dump -Fc` immediately before `migrate`; retain ≥ 7 days; verify with `pg_restore --list` |
| Media | copy `MEDIA_ROOT` (order-card originals/generated) — migrations do not touch it, but the deploy window is when accidental loss happens |
| Secrets | `.env` / secret store exported by the operator (never committed) |
| Audit | record the deploy commit SHA in `AuditLog` metadata via the release process (manual note is acceptable) |

Restore procedure (only on failure):

```bash
pg_restore -d poms --clean --if-exists poms_pre_rbac_YYYY-MM-DD.dump
```

---

## 9. Verification queries

Run after `migrate`; all must return the stated result.

```sql
-- 1. Catalogue complete (42 permissions expected)
SELECT count(*) FROM rbac_permission WHERE is_system;

-- 2. Every system permission declares at least one supported scope
SELECT key FROM rbac_permission WHERE jsonb_array_length(supported_scopes::jsonb) = 0;

-- 3. Three system roles seeded
SELECT code, is_active, is_system FROM rbac_role ORDER BY code;

-- 4. No user is left without a role (expect 0)
SELECT count(*) FROM accounts_user u
WHERE NOT EXISTS (SELECT 1 FROM rbac_userrole ur
                  WHERE ur.user_id = u.id AND ur.revoked_at IS NULL);

-- 5. Legacy role vs assigned system role mismatch (expect 0)
SELECT u.id, u.role, r.code
FROM accounts_user u
JOIN rbac_userrole ur ON ur.user_id = u.id AND ur.revoked_at IS NULL
JOIN rbac_role r ON r.id = ur.role_id AND r.is_system
WHERE r.code <> u.role;

-- 6. `system.*` permissions must not be granted to any role (expect 0)
SELECT rp.id FROM rbac_rolepermission rp
JOIN rbac_permission p ON p.id = rp.permission_id
WHERE p.key LIKE 'system.%';

-- 7. Department memberships match legacy production roles (expect 0)
SELECT u.id FROM accounts_user u
WHERE u.role = 'CUTTING_MAN'
  AND NOT EXISTS (SELECT 1 FROM rbac_departmentmembership m
                  JOIN rbac_department d ON d.id = m.department_id
                  WHERE m.user_id = u.id AND m.ended_at IS NULL AND d.code = 'CUTTING');

-- 8. Duplicate live user roles (expect 0 rows)
SELECT user_id, role_id, count(*) FROM rbac_userrole
WHERE revoked_at IS NULL GROUP BY 1,2 HAVING count(*) > 1;

-- 9. Exactly one active superuser minimum (expect >= 1)
SELECT count(*) FROM accounts_user WHERE is_superuser AND is_active;
```

---

## 10. Acceptance gate for the migration

The migration is accepted only when:

- [ ] `makemigrations --check` reports no changes.
- [ ] `migrate` completes from an empty database and from the pre-migration database.
- [ ] All 164 pre-existing tests pass **unmodified**.
- [ ] All §9 queries return the stated expectation.
- [ ] Login works with a legacy `username` credential and with an email identifier.
- [ ] An `ADMIN` user can list employees, all orders, targets and reports (legacy behaviour).
- [ ] A `CUTTING_MAN` sees only currently assigned orders, can update only their own department
      status, and cannot list employees (legacy behaviour).
- [ ] The audit log contains the role/permission changes made during smoke testing.
