# POMS Backend — Audit Remediation Batch 3 (POMS-AUDIT-004, 005, 006, 009)

Scope: harden validation and database integrity for the four findings below. No
changes to the completion-credit decisions (Rules A/B/C), no unrelated endpoints,
no historical-data rewrites.

## Verification summary

- `manage.py check` → **0 issues**
- `makemigrations --check` → **no changes** (migrations committed)
- `ruff check .` → **clean**
- `manage.py spectacular` → **0 errors / 0 warnings**
- `pytest --cov=apps` → **146 passed**, **92%** coverage, on **PostgreSQL 16.15**

## Database changes (migrations reviewed before applying)

- `orders/0002_order_chk_order_overall_status_consistent.py` — adds `CHECK`
  constraint `chk_order_overall_status_consistent` (additive; verified no existing
  rows violate it before applying).
- `targets/0002_target_overlap_exclusion.py` — `CREATE EXTENSION IF NOT EXISTS
  btree_gist` + `EXCLUDE` constraint `uniq_target_no_overlap` using
  `employee_id =`, `period_type =`, `daterange(start_date,end_date,'[]') &&`
  (additive; verified no existing overlaps before applying).

Both migrations applied successfully; `makemigrations --check` reports no drift.

## POMS-AUDIT-004 — Order number validation

- `apps/orders/serializers.py` — `_validate_order_number_format` enforces a
  strict, documented format: 1–64 chars, must start alphanumeric, then only
  `[A-Za-z0-9 _-]`. Rejects path separators (`/`, `\`), traversal (`.`), control
  characters and other unsafe chars with a `400` (never a `500`). Uniqueness stays
  case-sensitive.
- `apps/orders/models.py` — `original_image_upload_to` / `generated_image_upload_to`
  now key on the order's immutable UUID (`instance.pk`) instead of the raw
  `order_number`, so upload paths cannot be influenced by client input.

Tests: `apps/orders/test_api.py::TestOrderNumberValidation`
(control char, dot/backslash/traversal, too-long, valid),
`TestUploadPathSafety` (path uses UUID, not order_number).

## POMS-AUDIT-005 — Image safety

- `apps/orders/images.py` — new `ImageLimits` dataclass centralises all limits
  (max bytes, max pixels, max dimension, allowed extensions/content types) and the
  dimension/pixel check, sourced from settings. `generate_order_card_image` uses it.
- `common/utils/file_validation.py` — uses `ImageLimits`; reads only the header
  (`.size`) + `verify()` (no full pixel decode); treats Pillow
  `DecompressionBombWarning`/`Error` as a hard rejection. Size/type/extension and
  dimension/pixel caps all return `400`.
- `config/settings/base.py` — unchanged env-backed knobs
  (`MAX_ORDER_IMAGE_PIXELS`, `MAX_ORDER_IMAGE_DIMENSION`,
  `MAX_ORDER_IMAGE_SIZE_BYTES`, allowed lists) now consumed centrally.

Tests: `apps/orders/test_api.py::TestImageLimits` (dimension cap, pixel cap,
malformed image, normal accepted).

## POMS-AUDIT-006 — Target overlap concurrency + credit integrity

- Concurrency-safe overlap: per-employee `SELECT ... FOR UPDATE` row lock in
  `apps/targets/services.py::validate_no_overlap` **plus** the PostgreSQL
  exclusion constraint above (ultimate backstop). `apps/targets/views.py` wraps
  create/update in `transaction.atomic()` and maps a constraint `IntegrityError`
  to a clean `400`.
- Credit-attribution immutability: `apps/targets/serializers.py` forbids changing
  `employee`, `department`, `period_type`, `start_date`, `end_date` once
  `CompletionCredit` rows exist (returns `400`); `target_count` stays editable.
  Credits are never modified.

Tests: `apps/targets/test_api.py::TestTargetImmutability`
(employee/period/date changes rejected, count still editable, partial update),
`TestTargetOverlapConcurrency` (direct ORM overlap → `IntegrityError`; two
concurrent HTTP creates on separate PostgreSQL connections → exactly one `201`,
one `400`).

## POMS-AUDIT-009 — Overall status consistency

- `apps/orders/models.py` — `Order.Meta.constraints` adds
  `chk_order_overall_status_consistent`, a `CHECK` that `overall_status` always
  equals the value derived from `cutting_status`/`operator_status`. `Order.save()`
  remains the derivation point; the constraint makes a stale value impossible even
  via a raw bulk `UPDATE`.
- No application code uses bulk `UPDATE` for status (audited); the service layer
  (`apps/production/services.py`) is authoritative.

Tests: `apps/orders/test_api.py::TestOverallStatusConsistency`
(overall follows department transitions; an inconsistent bulk `UPDATE` raises
`IntegrityError` and rolls back; a consistent bulk `UPDATE` is allowed).

## Database extension / deployment implications

- **`btree_gist`** is required for the target-overlap exclusion constraint. It is a
  trusted extension in PostgreSQL 13+, so a role with `CREATE` on the database can
  install it (migration uses `CREATE EXTENSION IF NOT EXISTS btree_gist`). On
  managed PostgreSQL (RDS / Cloud SQL / etc.) ensure it is allow-listed, or
  pre-create it with an administrative role before deploying.
- The two constraints are additive and were validated against existing data prior
  to applying; no destructive operations, no data rewrites.