# POMS Backend — Deployment Guide

This document describes the production deployment procedure for the POMS backend.

> **Scope**: This guide covers the Django backend only. Frontend deployment is out of scope.

---

## 1. Production Environment Variables

All secrets and environment-specific values are provided via environment variables. Create a `.env` file (never committed) or inject via your platform's secret management.

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DJANGO_SECRET_KEY` | 50+ char random string. Generate: `python -c "import secrets; print(secrets.token_urlsafe(50))"` | `django-insecure-xyz...` |
| `DJANGO_ALLOWED_HOSTS` | Comma-separated hostnames the app will serve. **Required in production.** | `api.example.com,www.example.com` |
| `POSTGRES_DB` | Database name | `poms` |
| `POSTGRES_USER` | Database user | `poms` |
| `POSTGRES_PASSWORD` | Database password (strong) | `********` |
| `POSTGRES_HOST` | Database host | `db.example.com` |
| `POSTGRES_PORT` | Database port | `5432` |

### Optional Variables (with defaults)

| Variable | Default | Description |
|----------|---------|-------------|
| `DJANGO_DEBUG` | `False` | Must be `False` in production |
| `DJANGO_LOG_LEVEL` | `INFO` | Log level for root logger |
| `POMS_LOG_LEVEL` | `INFO` | Log level for `poms` logger |
| `TIME_ZONE` | `Asia/Dhaka` | Application timezone |
| `CONN_MAX_AGE` | `60` | DB connection max age (seconds) |
| `POSTGRES_CONNECT_TIMEOUT` | `10` | DB connection timeout (seconds) |
| `PAGE_SIZE` | `20` | API pagination page size |
| `ACCESS_TOKEN_MINUTES` | `60` | JWT access token lifetime |
| `REFRESH_TOKEN_DAYS` | `7` | JWT refresh token lifetime |
| `ROTATE_REFRESH_TOKENS` | `True` | Rotate refresh tokens on use |
| `BLACKLIST_AFTER_ROTATION` | `True` | Blacklist rotated tokens |
| `MAX_ORDER_IMAGE_SIZE_MB` | `10` | Max upload size (MB) |
| `MAX_ORDER_IMAGE_PIXELS` | `40000000` | Max image pixels (40 MP) |
| `MAX_ORDER_IMAGE_DIMENSION` | `10000` | Max image dimension (px) |
| `ALLOWED_IMAGE_EXTENSIONS` | `jpg,jpeg,png,webp` | Allowed upload extensions |
| `ALLOWED_IMAGE_CONTENT_TYPES` | `image/jpeg,image/png,image/webp` | Allowed MIME types |
| `CORS_ALLOWED_ORIGINS` | *empty* | Comma-separated allowed CORS origins (production) |
| `CSRF_TRUSTED_ORIGINS` | *empty* | Comma-separated trusted CSRF origins |
| `SECURE_SSL_REDIRECT` | `True` | Redirect HTTP → HTTPS |
| `SECURE_HSTS_SECONDS` | `31536000` | HSTS max-age (1 year) |

### Production-Only Hardening (uncomment in `.env` when TLS is configured)

```bash
# SECURE_SSL_REDIRECT=True
# SECURE_HSTS_SECONDS=31536000
```

> **Never commit real `.env` files.** Use `.env.example` as a template.

---

## 2. PostgreSQL Preparation

### 2.1 Version Requirement

PostgreSQL **13 or later** (tested on 16.15). The `btree_gist` extension is required.

### 2.2 Extension: `btree_gist`

The target overlap exclusion constraint requires the `btree_gist` extension.

**Self-managed PostgreSQL:**

```sql
-- Run as superuser or database owner
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

**Managed PostgreSQL (RDS, Cloud SQL, Azure Database, etc.):**

- The migration runs `CREATE EXTENSION IF NOT EXISTS btree_gist;`
- The database role running migrations must have `CREATE` privilege on the database
- **OR** pre-create the extension with an admin role before deploying

| Platform | Notes |
|----------|-------|
| AWS RDS | `btree_gist` is in the [supported extensions list](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Extensions.html). Enable via `rds_superuser` or parameter group. |
| Google Cloud SQL | Supported. Use `cloudsqlsuperuser` or enable via flags. |
| Azure Database for PostgreSQL | Supported. Enable via Azure portal or CLI. |
| Supabase / Neon / Timescale | Supported by default. |

> If the migration fails with `permission denied to create extension`, pre-create it manually.

### 2.3 Database User Privileges

The application role needs:

```sql
GRANT CONNECT ON DATABASE poms TO poms;
GRANT USAGE, CREATE ON SCHEMA public TO poms;
-- For migrations that install extensions:
ALTER ROLE poms CREATEDB;  -- needed for test DB creation; can be revoked after
```

---

## 3. Migration Procedure

### 3.1 Initial Deployment

```bash
# 1. Apply migrations
python manage.py migrate --noinput

# 2. Collect static files
python manage.py collectstatic --noinput

# 3. Verify health endpoint
curl -f https://api.example.com/api/v1/health/
```

### 3.2 Subsequent Deployments (zero-downtime)

```bash
# 1. Apply migrations (additive only — no destructive ops in this project)
python manage.py migrate --noinput

# 2. Collect static files
python manage.py collectstatic --noinput

# 3. Restart application workers (gunicorn/uwsgi)
systemctl reload gunicorn-poms  # or your process manager
```

### 3.3 Migration Safety

- All migrations in this project are **additive** (constraints, indexes, columns).
- `makemigrations --check --dry-run` must pass before deploying.
- No data migrations that rewrite historical data.
- `CompletionCredit.target` uses `on_delete=PROTECT` — targets with credits cannot be deleted.

---

## 4. Static File Collection

```bash
# Collect to STATIC_ROOT (configured as BASE_DIR / "staticfiles")
python manage.py collectstatic --noinput
```

Serve `STATIC_ROOT` via your web server (nginx, CloudFront, etc.) at `/static/`.

**Example nginx snippet:**

```nginx
location /static/ {
    alias /path/to/project/staticfiles/;
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

---

## 5. Private Media Configuration

Order-card images (original + generated) are **never served publicly**. They are delivered through authenticated, object-scoped Django endpoints:

- `GET /api/v1/orders/{id}/original-image/`
- `GET /api/v1/orders/{id}/generated-image/`

### Storage

- `MEDIA_ROOT` = `BASE_DIR / "media"` (default)
- Subdirectories: `originals/`, `generated/`, `temp/`
- **Never** configure nginx/apache to serve `/media/` directly.

### Production Media Storage Options

| Option | Configuration |
|--------|---------------|
| Local disk (single server) | Default `FileSystemStorage` at `MEDIA_ROOT` |
| Network file system (multi-server) | Mount shared volume at `MEDIA_ROOT` |
| S3-compatible (recommended for scale) | Use `django-storages` with `S3Boto3Storage`; update `DEFAULT_FILE_STORAGE` |

**S3 example** (add to `production.py`):

```python
DEFAULT_FILE_STORAGE = "storages.backends.s3boto3.S3Boto3Storage"
AWS_STORAGE_BUCKET_NAME = env("AWS_MEDIA_BUCKET")
AWS_S3_REGION_NAME = env("AWS_REGION")
AWS_QUERYSTRING_AUTH = True  # signed URLs for private media
AWS_S3_OBJECT_PARAMETERS = {"CacheControl": "private, no-store"}
```

> The existing `_serve_order_image` view streams via Django storage API, so it works with any storage backend.

---

## 6. Database Backup

### 6.1 Logical Backup (pg_dump)

```bash
# Full backup (schema + data)
pg_dump -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER -d $POSTGRES_DB \
  --no-password --verbose --format=custom --compress=9 \
  --file=poms_backup_$(date +%F_%H-%M).dump

# Schema only (for review)
pg_dump -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER -d $POSTGRES_DB \
  --schema-only --file=poms_schema_$(date +%F).sql
```

### 6.2 Backup Verification

```bash
# Verify dump integrity
pg_restore --list poms_backup_2026-11-24_03-00.dump | head -20

# Test restore to a temporary database (non-production!)
createdb -h localhost -p 5432 -U postgres poms_restore_test
pg_restore -h localhost -p 5432 -U postgres -d poms_restore_test poms_backup_2026-11-24_03-00.dump
# Run Django checks against restored DB
DJANGO_SETTINGS_MODULE=config.settings.production \
  POSTGRES_DB=poms_restore_test \
  python manage.py check
dropdb poms_restore_test
```

### 6.3 Automated Backup Schedule

| Frequency | Retention | Tool |
|-----------|-----------|------|
| Daily | 30 days | `pg_dump` + cron / pgBackRest / WAL-G |
| Weekly | 12 weeks | |
| Monthly | 12 months | |

> **Recommendation**: Use **WAL-G** or **pgBackRest** for production. They support incremental backups, point-in-time recovery (PITR), and S3/GCS/Azure Blob storage.

---

## 7. Database Restore

### 7.1 Point-in-Time Recovery (Preferred)

If using WAL-G / pgBackRest with PITR:

```bash
# Restore to a specific timestamp
wal-g backup-fetch LATEST /var/lib/postgresql/16/main
# Configure recovery.signal + restore_command in postgresql.conf
# Start PostgreSQL; it will replay WAL to target time
```

### 7.2 Full Restore from pg_dump (Disaster Recovery)

```bash
# 1. Stop application
systemctl stop gunicorn-poms

# 2. Create fresh database
dropdb -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER $POSTGRES_DB
createdb -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER $POSTGRES_DB

# 3. Restore
pg_restore -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER -d $POSTGRES_DB \
  --verbose --jobs=4 --no-owner --no-privileges \
  poms_backup_2026-11-24_03-00.dump

# 4. Run migrations (in case schema drifted)
python manage.py migrate --noinput

# 5. Restart application
systemctl start gunicorn-poms

# 6. Verify
curl -f https://api.example.com/api/v1/health/
```

> **Do not run restore commands on production without a tested backup.** Always test restore in a staging environment first.

---

## 8. Restore Testing (Mandatory)

Test the restore procedure **at least quarterly**:

1. Provision a clean staging PostgreSQL instance.
2. Restore latest production backup.
3. Run `python manage.py check --settings=config.settings.production`.
4. Run a subset of integration tests (`pytest apps/production/test_api.py -v`).
5. Verify health endpoint returns `200`.
6. Document RTO (Recovery Time Objective) and RPO (Recovery Point Objective).

---

## 9. Deployment Checklist

| Step | Command | Verified |
|------|---------|----------|
| 1. Environment variables set | `cat .env` | ☐ |
| 2. `btree_gist` extension available | `psql -c "SELECT * FROM pg_extension WHERE extname='btree_gist';"` | ☐ |
| 3. Database user has `CREATE` privilege | `psql -c "\du poms"` | ☐ |
| 4. Migrations apply cleanly | `python manage.py migrate --plan` → `python manage.py migrate --noinput` | ☐ |
| 5. Static files collected | `python manage.py collectstatic --noinput` | ☐ |
| 6. Health endpoint returns 200 | `curl -f https://api.example.com/api/v1/health/` | ☐ |
| 7. Admin user exists | `python manage.py shell -c "from apps.accounts.models import User; print(User.objects.filter(role='ADMIN').exists())"` | ☐ |
| 8. Gunicorn workers running | `systemctl status gunicorn-poms` | ☐ |
| 9. HTTPS + HSTS active | `curl -I https://api.example.com` → `Strict-Transport-Security` header | ☐ |
| 10. CORS origins configured | Check `CORS_ALLOWED_ORIGINS` in `.env` | ☐ |
| 11. Media storage accessible | Upload test image via admin → verify generated image serves | ☐ |
| 12. Backup scheduled and verified | Check last pg_dump timestamp | ☐ |

---

## 10. Secret Rotation

| Secret | Rotation Frequency | Procedure |
|--------|-------------------|-----------|
| `DJANGO_SECRET_KEY` | Annual or on compromise | 1. Generate new key. 2. Update `.env`. 3. Restart app. **Invalidates all existing sessions/JWTs.** |
| `POSTGRES_PASSWORD` | Quarterly | 1. Update in DB: `ALTER ROLE poms WITH PASSWORD 'new';` 2. Update `.env`. 3. Rolling restart workers. |
| JWT signing key | Uses `DJANGO_SECRET_KEY` | Same as above. |
| TLS certificates | Per CA expiry (typically 90 days - 1 year) | Reload nginx/gunicorn after cert renewal. |

> **Note**: Rotating `DJANGO_SECRET_KEY` logs out all users. Schedule during maintenance window.

---

## 11. Recovery Considerations

| Scenario | RPO | RTO | Mitigation |
|----------|-----|-----|------------|
| Accidental data deletion | < 24h (daily backup) | ~30 min | PITR with WAL-G reduces RPO to seconds |
| Database corruption | < 24h | ~1 hr | Regular `pg_dump` verification |
| Application server failure | 0 | < 5 min | Stateless workers behind load balancer |
| Region outage | Depends on DR setup | | Multi-AZ PostgreSQL + cross-region backup |

### Data Integrity Safeguards (Code-Level)

- `on_delete=PROTECT` on all historical FKs (`CompletionCredit`, `ProductionStatusHistory`, `AssignmentHistory`)
- DB CHECK constraint `chk_order_overall_status_consistent` prevents stale `overall_status`
- Exclusion constraint `uniq_target_no_overlap` prevents target overlap at DB level
- `UNIQUE(employee, order, target)` prevents duplicate credits
- Admin UI blocks deletion of `CompletionCredit` and credit-bearing `EmployeeTarget`

---

## 12. Monitoring Essentials (Minimal)

| Check | Tool | Alert Threshold |
|-------|------|-----------------|
| Health endpoint (`/api/v1/health/`) | Load balancer / uptime monitor | 503 > 30s |
| PostgreSQL connections | `pg_stat_activity` | > 80% of `max_connections` |
| Disk space | `df -h /var/lib/postgresql` | > 80% used |
| Gunicorn workers | `systemctl status` / process manager | Any worker down |
| Error rate | Application logs / Sentry | > 1% 5xx in 5m |

---

## 13. Troubleshooting Quick Reference

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `500` on startup | `DJANGO_SECRET_KEY` missing or insecure default | Set strong key in `.env` |
| `permission denied to create extension` | `btree_gist` not pre-installed on managed PG | Pre-create as admin or grant `CREATE` on DB |
| `DisallowedHost` | `DJANGO_ALLOWED_HOSTS` missing/incorrect | Set comma-separated hosts in `.env` |
| `CORS` errors in browser | `CORS_ALLOWED_ORIGINS` not set | Set frontend origin in `.env` |
| Media 404 | Storage backend misconfigured / file missing | Check `MEDIA_ROOT` permissions; verify S3 credentials |
| Migration `IntegrityError` on `uniq_target_no_overlap` | Existing overlapping targets | Clean data before migrate; constraint is additive |

---

## 14. File Checklist for Deployment

Ensure these are in your deployment artifact / container:

```
backend/
├── manage.py
├── requirements.txt          # includes argon2-cffi
├── config/
│   ├── settings/
│   │   ├── base.py
│   │   ├── development.py
│   │   └── production.py
│   ├── wsgi.py
│   └── asgi.py
├── apps/                     # all Django apps
├── common/
│   ├── health.py             # health endpoint
│   └── ...
└── staticfiles/              # after collectstatic
```

Excluded (via `.gitignore` / `.dockerignore`):

```
.env
*.pyc
__pycache__/
.pytest_cache/
.coverage
htmlcov/
backend/media/                # user uploads — persistent volume
backend/.venv/
```

---

*Generated as part of POMS Phase 8.3 Deployment Readiness Remediation.*