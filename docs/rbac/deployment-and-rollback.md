# Deployment & Rollback — Dynamic RBAC Release

**Audience:** operator performing the production deployment.
**Risk:** medium (schema-additive migration + authorization cutover).
**Downtime:** none required; migrations are additive and the previous release ignores the new tables.

---

## 1. Preconditions

| Item | Requirement |
|---|---|
| Python | 3.12 |
| Dependencies | **No new packages.** `pip install -r requirements.txt` is unchanged (`cryptography` is deliberately *not* required). |
| Database | PostgreSQL 16; the `rbac` app uses a partial unique index (`ON CONFLICT`-free) which requires PostgreSQL (not SQLite) |
| Access | Ability to set environment variables / secret-store entries for the target environment |
| Backup | Completed §2 before running any migration |

### Environment variables (new or newly meaningful)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DJANGO_SETTINGS_MODULE` | yes | `config.settings.development` | use `config.settings.production` in prod |
| `DJANGO_SECRET_KEY` | yes (prod) | — | Django secret |
| `DJANGO_ALLOWED_HOSTS` | yes (prod) | — | comma-separated hosts |
| `CORS_ALLOWED_ORIGINS` | prod | — | must not be `*` in production |
| `FRONTEND_URL` | recommended | `http://localhost:3000` | base URL for invitation/reset links |
| `DEFAULT_FROM_EMAIL` | recommended | `no-reply@poms.local` | envelope sender |
| `EMAIL_BACKEND` | optional | console in DEBUG, SMTP otherwise | override transport |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_USE_TLS`, `EMAIL_TIMEOUT` | optional | — | SMTP transport (non-secret) |
| `EMAIL_HOST_PASSWORD` | if SMTP auth | — | **SMTP credential; never stored in the DB, never returned by the API** |
| `INVITATION_EXPIRY_HOURS` | optional | `72` | initial value only; afterwards an Admin with `invitations.manage_settings` manages it via `/api/v1/invitations/settings/` (hard cap 168 h) |

`SystemSetting` and `EmailConfiguration` are seeded by migration `accounts.0003`; the API can change
the non-secret fields afterwards.

---

## 2. Backup (mandatory)

```bash
STAMP=$(date +%F-%H%M)
pg_dump -Fc -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" \
        -d "$POSTGRES_DB" -f "poms_pre_rbac_${STAMP}.dump"
pg_restore --list "poms_pre_rbac_${STAMP}.dump" > /dev/null && echo "backup verified"

# Media is untouched by migrations, but snapshot it before the window.
tar czf "poms_media_${STAMP}.tgz" -C /srv/poms/backend media
```

Record the release commit SHA and the backup filename in the change ticket.

---

## 3. Deploy

```bash
cd /srv/poms/backend
git fetch --all && git checkout <release-sha>

.venv/bin/pip install -r requirements.txt        # no new packages
.venv/bin/python manage.py check
.venv/bin/python manage.py migrate               # additive only
.venv/bin/python manage.py collectstatic --noinput
```

Expected migration output (order):

```
rbac.0001_initial
accounts.0002_rbac_auth_fields
accounts.0003_seed_system_settings
audit.0001_initial
rbac.0002_seed_catalogue
rbac.0003_backfill_legacy_roles
rbac.0004_add_invitation_settings_permission
```

Then restart the application workers (`systemctl restart poms-api` or the equivalent).

### First superuser (if the deployment has none)

```bash
DJANGO_SUPERUSER_PASSWORD='<strong>' .venv/bin/python manage.py createsuperuser \
  --noinput --username=opsroot --email=ops@example.com
```

`full_name` and `employee_code` are derived automatically (`SU-<USERNAME>`), so the command works
non-interactively.

---

## 4. Verification

### 4.1 Structural queries

```sql
-- 42 seeded permissions
SELECT count(*) FROM rbac_permission WHERE is_system;                       -- expect 42
-- every permission declares at least one scope
SELECT key FROM rbac_permission
 WHERE jsonb_array_length(supported_scopes::jsonb) = 0;                     -- expect 0 rows
-- three system roles
SELECT code, is_active, is_system FROM rbac_role ORDER BY code;             -- ADMIN/CUTTING_MAN/OPERATOR
-- no user without a live role
SELECT count(*) FROM accounts_user u
 WHERE NOT EXISTS (SELECT 1 FROM rbac_userrole ur
                    WHERE ur.user_id = u.id AND ur.revoked_at IS NULL);     -- expect 0
-- legacy role and assigned system role agree
SELECT u.id, u.role, r.code FROM accounts_user u
 JOIN rbac_userrole ur ON ur.user_id = u.id AND ur.revoked_at IS NULL
 JOIN rbac_role r ON r.id = ur.role_id AND r.is_system
 WHERE r.code <> u.role;                                                    -- expect 0 rows
-- no business role holds a system permission
SELECT rp.id FROM rbac_rolepermission rp
 JOIN rbac_permission p ON p.id = rp.permission_id
 WHERE p.key LIKE 'system.%';                                               -- expect 0 rows
-- production employees have their department membership
SELECT u.id FROM accounts_user u
 WHERE u.role IN ('CUTTING_MAN','OPERATOR')
   AND NOT EXISTS (SELECT 1 FROM rbac_departmentmembership m
                    JOIN rbac_department d ON d.id = m.department_id
                    WHERE m.user_id = u.id AND m.ended_at IS NULL
                      AND d.code = u.role);                                -- expect 0 rows
-- at least one active superuser
SELECT count(*) FROM accounts_user WHERE is_superuser AND is_active;       -- expect >= 1
```

### 4.2 API smoke tests

```bash
API=https://poms.example.com/api/v1

# 1. legacy username login still works
curl -s -X POST $API/auth/login/ -H 'Content-Type: application/json' \
  -d '{"username":"admin1","password":"..."}' | jq '.user.roles'

# 2. email login
curl -s -X POST $API/auth/login/ -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"..."}' | jq '.access'

# 3. admin can read employees, orders, targets, reports
TOKEN=...   # access token from step 1
for p in employees orders targets reports/dashboard rbac/roles; do
  printf '%s -> ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' \
    -H "Authorization: Bearer $TOKEN" "$API/$p/"
done

# 4. a production employee is denied employee management and sees only assigned orders
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $EMP" $API/employees/   # 403
curl -s -H "Authorization: Bearer $EMP" $API/orders/ | jq '.count'

# 5. RBAC surface is live
curl -s -H "Authorization: Bearer $TOKEN" $API/rbac/permissions/ | jq '.count'
curl -s -H "Authorization: Bearer $TOKEN" $API/audit-logs/ | jq '.count'
```

### 4.3 Behavioural checks

| Check | Expected |
|---|---|
| Deactivate a test account, then reuse its access token | `401` |
| Revoke a permission from a role, retry as a holder | `403`, no re-login needed |
| Restrict a user's `orders.view_order` to `ASSIGNED` | list shrinks immediately |
| Attempt to demote the only superuser | `409` |
| Attempt to remove your own `roles.manage_roles` | `409` |
| Attempt to grant `system.manage_superusers` to a role | `400` |
| `GET /system/email/` as a non-superuser | `403` |
| `GET /system/email/` as superuser | `200`, contains `has_password`, never a password |

---

## 5. Rollback

### 5.1 Code-only (preferred, no data loss)

```bash
git checkout <previous-release-sha>
.venv/bin/pip install -r requirements.txt
systemctl restart poms-api
```

The previous release ignores the new tables and columns, and `accounts.User.role` still exists and is
still populated, so the old code path works unchanged.

### 5.2 Schema rollback (only if the release must be fully undone)

```bash
.venv/bin/python manage.py migrate rbac zero
.venv/bin/python manage.py migrate audit zero
.venv/bin/python manage.py migrate accounts 0001
```

Consequences: all roles, permission assignments, department memberships, invitations, one-time
tokens, login attempts, system settings and the **entire audit trail** are destroyed. Take the §2
backup first; restoring it is the only way to keep that data.

`rbac.0002_seed_catalogue` and `rbac.0003_backfill_legacy_roles` are forward-only by design (they are
idempotent and non-destructive; a reverse would have to guess which rows came from migration versus
application use). Re-running them forward is safe.

### 5.3 Data restore

```bash
systemctl stop poms-api
dropdb -h "$POSTGRES_HOST" -U "$POSTGRES_USER" "$POSTGRES_DB"
createdb -h "$POSTGRES_HOST" -U "$POSTGRES_USER" "$POSTGRES_DB"
pg_restore -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
           --clean --if-exists "poms_pre_rbac_${STAMP}.dump"
tar xzf "poms_media_${STAMP}.tgz" -C /srv/poms/backend media
systemctl start poms-api
```

---

## 6. Post-deployment monitoring (first 24 h)

- `401`/`403` rate per endpoint — a spike on `/employees/` or `/reports/` usually means a role's
  permission set was changed during the window.
- `409` on `/rbac/...` — expected only when someone attempted a safeguarded change; review the audit
  log for the actor and intent.
- `429` on `/auth/login/` — credential-stuffing attempt; correlate by identifier/IP.
- Audit log growth and any `action` values you did not expect.
- Email delivery: `POST /system/email/test/` after configuring SMTP.

---

## 7. Operational notes

- **SMTP credential rotation** is a deployment action (secret store → restart). It is deliberately
  not an API operation (Phase 2 PD-1). The API never reads or returns the value.
- **Invitation expiry** changes apply to *new* invitations only; existing `expires_at` values are
  snapshotted.
- **`User.role` is transitional.** It is still accepted by the employee API for compatibility and is
  mirrored into RBAC by a bridge. Once every client reads `/rbac/users/{id}/roles/`, the field and
  the bridge can be removed in a follow-up release (no data migration needed — the RBAC rows are
  already authoritative).
- **`backend/pgdata/` is still tracked in Git** (Phase 1 finding H-07). Removing it requires
  `git rm -r --cached backend/pgdata`, a `.gitignore` entry, and a history rewrite/credential
  rotation decision. That is a destructive repository operation and must be explicitly authorised;
  it is **not** part of this deployment.
