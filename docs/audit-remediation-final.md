# POMS Backend — Audit Remediation Final Report (POMS-AUDIT-001 … 019)

Consolidated status of the Phase 8 independent audit findings **001–019** (the
agreed remediation scope). INFO items **020–021** are documented but out of
scope; **022** is now **confirmed and implemented** (see below).

## Verification (final, on PostgreSQL 16.15)

- `python manage.py check` → **0 issues** (development **and** production settings)
- `python manage.py makemigrations --check --dry-run` → **no changes**
- `ruff check .` → **clean**
- `python manage.py spectacular` → **0 errors / 0 warnings**
- `python -m pytest --create-db --cov=apps` → **160 passed**, **93%** coverage
- Production settings load cleanly (`Argon2PasswordHasher` now has its dependency).

No destructive migrations, no test removal, no unnecessary dependencies. The only
added dependency is `argon2-cffi` (required by the already-configured Argon2
hasher — finding 012). The three completion-credit decisions (admin completion
credits the current assignee; reassignment preserves completion; no-op requests
create nothing) are **confirmed and implemented**.

## Status by finding

| ID | Severity | Title | Status | Batch |
|----|----------|-------|--------|-------|
| 001 | HIGH | Permanent employee delete + `ProtectedError`→500 | FIXED | 1 |
| 002 | HIGH | Order-card images served without access control | FIXED | 1 |
| 003 | HIGH | Reassignment credits new assignee | FIXED | 0 (pre-batch) |
| 004 | MED | `order_number` unsanitized → 500 | FIXED | 3 |
| 005 | MED | No image pixel/dimension cap (memory DoS) | FIXED | 3 |
| 006 | MED | Target overlap race + post-credit edits | FIXED | 3 |
| 007 | MED | Employees expose undocumented `PUT`/`DELETE` | FIXED | 4 |
| 008 | MED | No-op status transitions recorded as history | FIXED (by 003 no-op guard) | 0 |
| 009 | MED | `QuerySet.update()` bypasses `overall_status` | FIXED | 3 |
| 010 | MED | Missing tests (delete/perms/case/image/concurrency) | FIXED | 6 |
| 011 | LOW | Unused permission classes | FIXED | 5 |
| 012 | LOW | Argon2 hasher without `argon2-cffi` | FIXED | 5 |
| 013 | LOW | Dashboard uses `updated_at` not completion date | FIXED | 5 |
| 014 | LOW | Misleading `TokenPairSerializer` docstring | FIXED | 5 |
| 015 | LOW | Logout returns `205` | FIXED (→ 204) | 5 |
| 016 | LOW | Role change of assigned employee unguarded | FIXED | 4 |
| 017 | LOW | Unbounded reports | FIXED | 5 |
| 018 | LOW | Test media files not cleaned up | FIXED | 5 |
| 019 | LOW | `CompletionCredit.target` `on_delete=CASCADE` | FIXED (→ PROTECT) | 4 |

All 19 in-scope findings are resolved.

## Batch detail

- **Batch 0 / Report** (`docs/audit-remediation-report.md`): 001–007 (+008 via 003).
- **Batch 1** (001/002): employee method restriction + 409 handler; protected media
  actions; removed public `/media/` serving.
- **Batch 2** (004/005/006/009 tests): 26 order API tests.
- **Batch 3** (`docs/audit-remediation-batch3.md`): 004/005/006/009.
- **Batch 4** (`docs/audit-remediation-batch4.md`): 007/016/019.
- **Batch 5** (`docs/audit-remediation-batch5.md`): 011/012/013/014/015/017/018.
- **Batch 6** (this report): 010 — added `test_order_number_uniqueness_is_case_sensitive`
  (`apps/orders/test_api.py`); the other four 010 areas were already covered
  (delete: `TestEmployeeMethodRestrictions`, `TestCompletionCreditProtection`;
  perms: `TestEmployeePermissions`, `TestAuthorizationAndAtomicity`;
  image limits: `TestImageLimits`; concurrency: `TestTargetOverlapConcurrency`).

## Out of scope (INFO — documented, no action)

- **020** `order_number` uniqueness is case-sensitive — now covered by a regression
  test (documents the behaviour; no code change).
- **021** DB FK backstop (`NO ACTION`) is correct, not a defect.

## POMS-AUDIT-022 — CONFIRMED & IMPLEMENTED (not an ambiguity)

The user has confirmed **Decision A: admin completion = actual.** Implemented and
tested:

- Admin sets a department to `COMPLETED` → the **current assignee** receives the
  eligible `CompletionCredit`; the **Admin is recorded as the actor** (history
  `employee`), never as the credit recipient.
- Applies to both `CUTTING` (credits the current Cutting Man) and `OPERATOR`
  (credits the current Operator).
- No eligible target → no credit. Repeated completion → no extra history/credit.
  Reassignment after completion does not transfer credit; reopen + genuine
  completion credits the then-current assignee.
- Evidence: `apps/production/services.py` (`update_department_status`,
  `_record_completion`, `record_completion_credits`) and
  `apps/production/test_api.py` (`TestRuleACompletionAttribution`,
  `TestRuleBReassignmentPreservesCompletion`, `TestRuleCNoopRequests`).

POMS-AUDIT-022 is therefore **RESOLVED**, not an open product ambiguity.

## Git note

The repository has **no commits** (fresh working tree), so `git diff` has no
baseline; the full tree is untracked. All changes are confined to the backend and
`docs/`.