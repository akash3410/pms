# Production Order Management System (POMS) — Backend

A production-grade Django + Django REST Framework backend for managing
production orders, employee assignments, department-level production progress,
employee targets, and operational reports.

> **Scope:** This repository currently contains **only the backend & REST API**.
> No web/mobile frontend is included. The API is designed to be consumed by any
> client (Web, Flutter/Android, etc.) without backend changes.

---

## Tech Stack

| Component        | Technology                         |
|------------------|------------------------------------|
| Language         | Python 3.12                        |
| Framework        | Django 5.2                         |
| API              | Django REST Framework 3.16         |
| Auth             | JWT (SimpleJWT)                    |
| Database         | PostgreSQL 16                      |
| Image processing | Pillow                             |
| API docs         | drf-spectacular (OpenAPI / Swagger)|
| Tests            | pytest + pytest-django             |
| Lint/format      | Ruff                               |
| Config           | Environment variables (`.env`)     |

---

## Quick Start

### 1. Prerequisites
- Python 3.12+
- PostgreSQL 14+ (server binaries: `initdb`, `pg_ctl`, `psql`)
- `virtualenv` (or `python3 -m venv` if `python3-venv` is installed)

### 2. Create a virtual environment & install dependencies
```bash
cd backend
virtualenv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
```

### 3. Configure environment
```bash
cp .env.example .env
# edit .env with your PostgreSQL credentials
```

### 4. Prepare PostgreSQL
Create a role and database (example):
```sql
CREATE ROLE poms LOGIN PASSWORD 'your-password' CREATEDB;
CREATE DATABASE poms OWNER poms;
```

### 5. Apply migrations & run
```bash
python manage.py migrate
python manage.py createsuperuser        # optional
python manage.py runserver
```

- Admin site: <http://127.0.0.1:8000/admin/>
- Swagger UI: <http://127.0.0.1:8000/api/docs/>
- OpenAPI schema: <http://127.0.0.1:8000/api/schema/>
- API base: <http://127.0.0.1:8000/api/v1/>

> **Note on the isolated dev database:** the reference environment used a
> private, user-space PostgreSQL cluster on port `55432` (no `sudo` needed).
> See [`docs/development-setup.md`](docs/development-setup.md).

---

## Common Commands
```bash
python manage.py makemigrations       # create migrations
python manage.py migrate              # apply migrations
python manage.py test                 # run Django tests
pytest                                # run pytest suite
ruff check .                          # lint
ruff format .                         # format
```

---

## Project Layout
```
pms/
├── backend/
│   ├── config/            # settings (base/dev/prod), urls, wsgi, asgi
│   ├── apps/
│   │   ├── accounts/      # custom User + roles + auth
│   │   ├── orders/        # orders, assignments, images
│   │   ├── production/    # status history, notes, completion
│   │   ├── targets/       # employee targets + completion credit
│   │   └── reports/       # dashboard & reports
│   ├── common/            # shared base models, pagination, exceptions
│   ├── media/             # originals / generated / temp images
│   ├── manage.py
│   ├── requirements.txt
│   └── requirements-dev.txt
├── docs/                  # architecture, DB, API, rules, roadmap
├── .gitignore
└── README.md
```

---

## Documentation
- [Architecture](docs/architecture.md)
- [Database Design](docs/database-design.md)
- [Business Rules](docs/business-rules.md)
- [API Documentation](docs/api-documentation.md)
- [Testing Strategy](docs/testing-strategy.md)
- [Development Roadmap](docs/development-roadmap.md)
- [Development Setup](docs/development-setup.md)
- [Final Technical Report](docs/final-report.md)

---

## Security Notes
- Secrets live in `.env` (git-ignored). `.env` is never committed.
- Production settings (`config.settings.production`) enforce strong security
  headers, SSL, HSTS, and refuse to start with insecure defaults.
- All authorization is enforced **server-side** (role + object-level).# pms
