# POMS Backend — Audit Remediation Report (POMS-AUDIT-001 … 007)

Scope: remediate findings **POMS-AUDIT-001 through POMS-AUDIT-007** from the
Phase 8 independent audit. Each item below records what was changed, the
regression tests added, and the verification result.

## Verification summary

- `python manage.py check` → **0 issues**
- `ruff check .` → **clean**
- `python -m pytest` → **125 passed** (was 112 before this remediation)
- `python manage.py spectacular` → **0 errors, 0 warnings**

All work is confined to the backend; no destructive migrations, no dependency
additions, no removal of existing tests.

---

## POMS-AUDIT-001 — HIGH — Permanent employee deletion + `ProtectedError` → 500

**Status: FIXED**

- `apps/accounts/views.py` — `EmployeeViewSet.http_method_names = ["get",
  "post", "patch", "head", "options"]`. `PUT`/`DELETE` now return `405`; the
  viewset is soft-delete only (deactivate).
- `common/exceptions.py` — `poms_exception_handler` maps `ProtectedError` to a
  clean **409** JSON envelope instead of an unhandled 500.

Tests (`apps/accounts/test_api.py`):
`TestEmployeeMethodRestrictions` (PUT→405, DELETE→405, PATCH works, POST works),
`TestEmployeePermissions` (non-admin retrieve/patch/deactivate → 403, anonymous
list → 401, admin retrieve → 200).

## POMS-AUDIT-002 — HIGH — Order-card images served with no access control

**Status: FIXED**

- `config/urls.py` — removed the public `static()` MEDIA handler; only STATIC is
  served by Django. Media is no longer reachable at `/media/...`.
- `apps/orders/views.py` — added `original-image` / `generated-image` detail
  actions streaming bytes through `default_storage` (no filesystem path built
  from client input), with `Cache-Control: private, no-store` and a safe
  `Content-Disposition`. Access is scoped by `get_object()` (admin or currently
  assigned employee only).
- `apps/orders/serializers.py` — `OrderSerializer` image fields are now
  `SerializerMethodField`s returning the authenticated endpoint URLs (or `None`).

Tests (`apps/orders/test_api.py::TestOrderImageAccess`): admin/assignee → 200,
unassigned employee → 404, anonymous → 401, missing generated image → 404,
`/media/...` not publicly served, serializer returns endpoint (not `/media/`).

## POMS-AUDIT-003 — HIGH — Reassignment credits the new assignee

**Status: FIXED**

- `apps/production/services.py` — `update_department_status` now treats a
  transition where `previous_status == new_status` as a **no-op**: it creates no
  `ProductionStatusHistory` row and calls no completion-credit logic. This closes
  the reassignment leak: after A completes and the order is reassigned to B, B
  re-confirming `COMPLETED` awards B nothing.

Tests (`apps/production/test_api.py::TestNoopAndReassignment`):
no-op completion records no history; reassignment to a replacement who *has* a
target still yields **0** credits for the replacement while the original
assignee keeps the single credit.

## POMS-AUDIT-004 — MEDIUM — `order_number` unsanitized → `SuspiciousFileOperation` → 500

**Status: FIXED**

- `apps/orders/serializers.py` — new `_validate_order_number_format` shared by
  create and update: rejects path separators / traversal sequences and enforces a
  64-char limit with a safe charset (`[A-Za-z0-9][A-Za-z0-9 _-]*`). Bad input is
  rejected with `400` at validation time rather than blowing up in storage.

Tests (`apps/orders/test_api.py::TestOrderNumberValidation`): traversal rejected,
slash rejected, over-length rejected, valid number still created.

## POMS-AUDIT-005 — MEDIUM — No image pixel/dimension cap (memory DoS)

**Status: FIXED**

- `config/settings/base.py` — added `MAX_ORDER_IMAGE_PIXELS` (default 40 MP) and
  `MAX_ORDER_IMAGE_DIMENSION` (default 10 000 px), env-overridable.
- `common/utils/file_validation.py` — `validate_image_file` now opens the image,
  rejects dimensions / pixel counts over the caps, and treats
  `DecompressionBombError` as invalid (all → `400`).
- `apps/orders/images.py` — `generate_order_card_image` re-checks the source
  dimensions before decoding (defence in depth).

Tests (`apps/orders/test_api.py::TestImageLimits`): dimension cap enforced,
pixel cap enforced, normal image accepted.

## POMS-AUDIT-006 — MEDIUM — Target overlap race + post-credit edits misattribute credit

**Status: FIXED**

- `apps/targets/services.py` — `validate_no_overlap` takes a `select_for_update`
  row lock on the employee's `User` row to serialise concurrent target
  mutations for that employee (a first target has no rows to lock, so the always
  present user row is the mutex).
- `apps/targets/views.py` — `create` and `partial_update` run inside
  `transaction.atomic()` so the lock spans both the check and the write.
- `apps/targets/serializers.py` — partial updates now merge onto the instance
  (fixes a latent `KeyError` on partial payloads) and, once a target has
  `CompletionCredit` rows, reject changes to `employee` / `department` /
  `period_type` with `400` (other fields remain editable).

Tests (`apps/targets/test_api.py::TestTargetImmutability`): cannot change
employee after credit, cannot change period type after credit, can still change
target count, partial count-only update does not crash.

## POMS-AUDIT-007 — MEDIUM — Employees expose undocumented `PUT`/`DELETE`

**Status: FIXED**

- Employee `PUT`/`DELETE` are no longer exposed (see POMS-AUDIT-001) and
  `docs/api-documentation.md` now documents the `405` behaviour and the
  admin-only requirement. The generated OpenAPI schema shows only
  `get`/`patch` on `/employees/{id}/`.

---

## Later batches & confirmed business decisions

Findings **008–019** were remediated in subsequent batches — see
`docs/audit-remediation-batch3.md`, `batch4.md`, `batch5.md`, and the
consolidated `docs/audit-remediation-final.md`. **All are resolved.**

The completion-credit behaviour (POMS-AUDIT-003/008/022) is governed by three
**confirmed** business decisions — they are implemented, not open questions:

- **Decision A — admin completion credits the current assignee.** When an Admin
  sets a department to `COMPLETED` (a real transition), the employee *currently
  assigned* to that department receives the eligible `CompletionCredit`; the Admin
  is recorded only as the status-history actor. Implemented in
  `apps/production/services.py` (`update_department_status` → `_record_completion`,
  which credits `order.cutting_man` / `order.operator`, never the actor).
- **Decision B — reassignment preserves completion.** Reassignment never transfers
  or re-credits; a genuine reopen (`COMPLETED → PENDING`) followed by a real
  completion credits the then-current assignee.
- **Decision C — no-op requests.** A request whose status equals the current status
  writes no history and no credit.

**POMS-AUDIT-022** (admin-initiated completion credit) is therefore
**RESOLVED / CONFIRMED** according to actual implementation evidence — it is **not**
an unresolved product ambiguity. Evidence: `apps/production/test_api.py`
(`TestRuleACompletionAttribution`, `TestRuleBReassignmentPreservesCompletion`,
`TestRuleCNoopRequests`) and `docs/business-rules.md` §"Status transitions &
completion credit (confirmed — Batch 2)".

> Note: the original audit listed the admin-completion credit as an open product
> decision. The business has since **confirmed decision A**; this report and the
> service/tests reflect that confirmation.