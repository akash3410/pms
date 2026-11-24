# Business Rules

This document is the single source of truth for business logic. Where the
original specification left a business-critical detail open, the **resolved
decision** is recorded in [Ambiguities & Resolutions](#ambiguities--resolutions).

## Roles

| Role        | Capabilities |
|-------------|--------------|
| **ADMIN**   | Full access: orders, images, employees, assignments, reassignment, targets, reports, notes, deactivation. |
| **CUTTING_MAN** | View only currently-assigned orders; update only cutting status; add cutting problem notes; view history of accessible orders. |
| **OPERATOR** | View only currently-assigned orders; update only operator status; add operator problem notes; view history of accessible orders. |

An ADMIN cannot be assigned as Cutting Man or Operator.

## Order lifecycle

1. **Create** (ADMIN): unique `order_number`, original order-card image,
   Cutting Man, Operator, created_by, timestamp. Image is a normal multipart
   upload; type and size are validated server-side.
2. **Assign** (ADMIN): exactly one Cutting Man and one Operator, both validated
   (correct role, active). Initial assignment at creation writes the first
   `AssignmentHistory` rows.
3. **Image processing**: a generated order-card image is produced from the
   **original** only, overlaying the Cutting Man's name and the Operator's name
   at configurable positions. Rules:
   - Never modify the original image.
   - Always generate from the original, never from a generated image.
   - Regenerate on any assignment/reassignment change.
   - Preserve proportions/quality; handle long names; configuration (font,
     size, color, alignment, coordinates) lives in one central place
     (`apps/orders/images.py`).
4. **Work** (employees): each department updates only its own status
   (PENDING ↔ COMPLETED), may add a problem note, and may reopen work.

## Overall status (derived, server-side only)

| Cutting   | Operator  | Overall     |
|-----------|-----------|-------------|
| Pending   | Pending   | PENDING     |
| Completed | Pending   | IN_PROGRESS |
| Pending   | Completed | IN_PROGRESS |
| Completed | Completed | COMPLETED   |

Clients cannot set `overall_status` directly.

## Assignment / reassignment

- Validates new employee's role matches the department and the employee is active.
- Updates the **current** assignment on `Order`.
- Appends an immutable `AssignmentHistory` row (previous, new, assigned_by, time).
- Regenerates the generated image.
- Runs atomically (`transaction.atomic()`).
- Reassignment **never** transfers prior completion credit; history stays with
  the employee who actually performed the work. Reassignment also preserves the
  department's current status (see Rule B above).

## Production status history

Every **real** transition is appended to immutable `ProductionStatusHistory`
(Pending→Completed, Completed→Pending, Pending→Completed again). Only the
currently assigned employee for that department may change it (enforced
server-side; an employee's department is always derived from their role, never
taken from the client). Status update + history creation (+ eligible credit) are
atomic.

### Status transitions & completion credit (confirmed — Batch 2)

- **Rule A — admin completion.** When an **Admin** sets a department to
  `COMPLETED` (a real transition), the employee **currently assigned** to that
  department receives the `CompletionCredit`, subject to the normal target
  eligibility rules. The actor never redirects the credit: an Admin who is not
  the assignee earns nothing (an Admin cannot be an assignee in the first place).
- **Rule B — reassignment after completion (preserve).** Reassignment changes
  only the assignee, never the status. If a department is already `COMPLETED`
  and its assignee changes: it stays `COMPLETED`, no new completion event is
  created, the new assignee receives **no** credit, and the previous assignee's
  historical credit is **not** transferred or deleted. To repeat the work, an
  Admin explicitly sets the department back to `PENDING`; a subsequent genuine
  `PENDING → COMPLETED` transition is a **new** completion event and may credit
  the then-current assignee under the normal target rules.
- **Rule C — no-op request.** If the requested status equals the current status
  (for **any** status, not just `COMPLETED`), the request succeeds but is a
  **no-op**: no `ProductionStatusHistory` row, no `CompletionCredit`, and no
  completion metadata/timestamp changes.

Completion credit is only ever created on a real transition **into** `COMPLETED`;
merely being `COMPLETED` (or re-requesting `COMPLETED`) never creates credit.

## Employee targets

Period types: **DAILY**, **WEEKLY**, **MONTHLY**.

- **Daily** — calendar day Mon–Sun days, 00:00–23:59:59.
- **Weekly** — Monday 00:00:00 through Sunday 23:59:59 (calendar week, not a
  rolling 7 days).
- **Monthly** — first through last day of the calendar month.

**Completion-date rule:** credit is based on the **actual completion date**
(the day the employee marked their department Completed), **not** the assignment
date or order creation date.

**Duplicate prevention:** a single order cannot earn more than one credit for
the same employee + department + target period, even after reopen/re-complete.
Enforced by `CompletionCredit UNIQUE(employee, order, target)`.

**Reassignment:** prior credits remain with the original employee. A
reassignment does not award past completions to the new employee, nor does it
create credits retroactively. A genuine new completion **after** an Admin reopens
(`COMPLETED → PENDING`) is a new completion event and credits the then-current
assignee (Rule B).

**Target integrity:** overlapping target configurations for the same
`(employee, period_type)` are rejected (date ranges must not overlap).
Different period types may coexist. Overlap prevention is concurrency-safe: it is
serialised per employee (row lock) **and** enforced by a PostgreSQL exclusion
constraint (`daterange && ` with `btree_gist`), so no two concurrent requests can
create overlapping ranges.

**Credit-attribution immutability:** once a target has earned any
`CompletionCredit`, the fields that give those credits meaning — `employee`,
`department`, `period_type`, `start_date`, `end_date` — become immutable
(attempts return `400`). `target_count` (a goal, not an attribution) stays
editable. Existing credits are never modified.

## Data integrity safeguards

- **Overall status consistency:** `overall_status` is always derived from the two
  department statuses and is additionally enforced by a database `CHECK`
  constraint (`chk_order_overall_status_consistent`). Application code never uses
  bulk `UPDATE` for status; the production service layer is authoritative.
- **Order number format:** admin-supplied, required, case-sensitive unique, 1–64
  chars, must start with an alphanumeric and then allow only letters, digits,
  spaces, `-` and `_`. Path separators, traversal sequences, control characters
  and other unsafe filename characters are rejected with a `400`. Upload storage
  paths are keyed on the order's immutable UUID, not `order_number`.
- **Image limits** (size, dimensions, pixels, allowed formats) are centralised in
  `apps/orders/images.py` (`ImageLimits`) and applied to both upload validation
  and generation; decompression-bomb warnings/errors are rejected safely.

## Deployment prerequisite

The target-overlap exclusion constraint requires the PostgreSQL `btree_gist`
extension (trusted in PostgreSQL 13+). The migration installs it with
`CREATE EXTENSION IF NOT EXISTS btree_gist`; on managed PostgreSQL ensure the
extension is permitted/allow-listed or pre-create it with an administrative role.

## Deactivation

`is_active=False` blocks login and new assignments. Existing assignments and all
history are retained.

## Role changes

An employee's `role` (`ADMIN` / `CUTTING_MAN` / `OPERATOR`) may be changed by an
Admin, but **not** while it would invalidate a current assignment:

- An employee with an **active** (not-yet-completed) Cutting assignment cannot be
  changed to any role other than `CUTTING_MAN`.
- An employee with an **active** Operator assignment cannot be changed to any role
  other than `OPERATOR`.
- Attempts return a `400` validation error; the system never silently reassigns
  orders and never deletes `AssignmentHistory`. Reassign the employee's orders
  first, then change the role. Non-role fields (`full_name`, `employee_code`,
  `email`, `is_active`) remain freely editable.

## Completion-credit protection

`CompletionCredit` is immutable historical attribution and must never be deleted
or rewritten:

- `CompletionCredit.target` uses `on_delete=PROTECT`, so deleting an
  `EmployeeTarget` that has credits raises `ProtectedError` (the credits are
  preserved).
- The Django admin blocks deletion of both `CompletionCredit` records and any
  `EmployeeTarget` that has earned credits.
- Existing credit rows are never modified by any endpoint.

## Ambiguities & Resolutions

| # | Ambiguity | Resolution |
|---|-----------|------------|
| 1 | Order number source | Admin-supplied, required, case-sensitive unique. |
| 2 | Target scope | An employee may hold multiple targets; for the same `(employee, period_type)` date ranges must not overlap. |
| 3 | Credit when no target exists in period | Completion still recorded in status history; no `CompletionCredit` (no target to attach). |
| 4 | Note visibility | Admin: all notes. Employee: notes on currently-assigned orders only. |
| 5 | Deactivation effect on assignments | Existing assignments/history kept; login & new assignment blocked. |

> If a future business decision changes any rule above, update this file and
> the corresponding service + tests together.