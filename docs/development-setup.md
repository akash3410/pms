# Development Setup

This guide covers setting up the POMS backend on **Ubuntu Linux** with limited
resources (~4 GB RAM). It emphasises command-line tooling and an isolated
PostgreSQL instance so no `sudo` is required.

## 1. System packages

Confirm the toolchain:
```bash
python3 --version          # 3.12+
git --version
/usr/lib/postgresql/<ver>/bin/psql --version   # e.g. 16
```
If `python3 -m venv` fails with "ensurepip is not available", install
`virtualenv` (used here) or `python3-venv`:
```bash
sudo apt install python3-venv      # optional
```

## 2. Python environment
```bash
cd backend
virtualenv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
```

## 3. PostgreSQL — isolated private cluster (no sudo)

The system PostgreSQL cluster uses **peer** auth and may not allow creating
roles without root. A private, user-space cluster avoids that entirely.

```bash
PGBIN=/usr/lib/postgresql/16/bin        # adjust to your version
export PGDATA=$HOME/.poms_pgdata
export PGPORT=55432
mkdir -p /tmp/poms_pgsock

"$PGBIN/initdb" -D "$PGDATA" -U postgres \
  --auth-local=trust --auth-host=scram-sha-256 -E UTF8

"$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/server.log" \
  -o "-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp/poms_pgsock" start

# Create role + database (connect over the local socket = trust auth)
export PGHOST=/tmp/poms_pgsock PGPORT=$PGPORT PGUSER=postgres
"$PGBIN/createdb" -O postgres poms
"$PGBIN/psql" -d postgres -c "CREATE ROLE poms LOGIN PASSWORD 'poms';"
"$PGBIN/psql" -d postgres -c "ALTER ROLE poms CREATEDB;"   # needed for the test DB
"$PGBIN/psql" -d postgres -c "GRANT ALL ON DATABASE poms TO poms;"
```

Stop the cluster when done:
```bash
"$PGBIN/pg_ctl" -D "$PGDATA" stop
```

> If you already have a system PostgreSQL you can use it instead — just create a
> role/database and set the matching `POSTGRES_*` values in `.env`.

## 4. Configure environment
```bash
cd backend
cp .env.example .env
# Edit POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_HOST / POSTGRES_PORT to match.
```

## 5. Migrate & run
```bash
python manage.py migrate
python manage.py runserver
```

## 6. Quality checks
```bash
ruff check .
ruff format --check .
pytest
```

## Resource notes (≤4 GB RAM)
- Use `CONN_MAX_AGE` (default 60s) to reuse connections.
- Avoid running the dev server and a heavy IDE simultaneously.
- PostgreSQL default settings are fine for this workload; no tuning required.