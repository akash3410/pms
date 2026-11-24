# Database Design

PostgreSQL is the primary database. The schema is normalized, UUID-keyed, and
designed to **preserve history** (soft deactivation, immutable history tables).

## ER Diagram

```mermaid
erDiagram
    USER ||--o{ ORDER : "creates"
    USER ||--o{ ASSIGNMENT_HISTORY : "assigned_by"
    USER ||--o{ PRODUCTION_STATUS_HISTORY : "performs"
    USER ||--o{ ORDER_NOTE : "authors"
    USER ||--o{ EMPLOYEE_TARGET : "owns"
    USER ||--o{ COMPLETION_CREDIT : "earns"
    ORDER ||--o{ ASSIGNMENT_HISTORY : "has"
    ORDER ||--o{ PRODUCTION_STATUS_HISTORY : "has"
    ORDER ||--o{ ORDER_NOTE : "has"
    ORDER ||--o{ COMPLETION_CREDIT : "generates"
    EMPLOYEE_TARGET ||--o{ COMPLETION_CREDIT : "counts"

    USER {
        uuid id PK
        string username UK
        string employee_code UK
        string full_name
        string role
        bool is_active
        bool is_staff
        datetime date_joined
    }
    ORDER {
        uuid id PK
        string order_number UK
        file original_image
        file generated_image
        uuid cutting_man FK
        uuid operator FK
        string cutting_status
        string operator_status
        string overall_status
        uuid created_by FK
        datetime created_at
    }
    ASSIGNMENT_HISTORY {
        uuid id PK
        uuid order FK
        string department
        uuid previous_employee FK
        uuid new_employee FK
        uuid assigned_by FK
        datetime assigned_at
    }
    PRODUCTION_STATUS_HISTORY {
        uuid id PK
        uuid order FK
        uuid employee FK
        string department
        string previous_status
        string new_status
        string note
        datetime created_at
    }
    ORDER_NOTE {
        uuid id PK
        uuid order FK
        uuid author FK
        string department
        text body
        datetime created_at
    }
    EMPLOYEE_TARGET {
        uuid id PK
        uuid employee FK
        string period_type
        date start_date
        date end_date
        int target_count
        uuid created_by FK
        datetime created_at
    }
    COMPLETION_CREDIT {
        uuid id PK
        uuid employee FK
        uuid order FK
        uuid target FK
        string department
        date credit_date
        datetime created_at
    }
```

## Model summary

### User (`accounts.User`)
Custom user extending `AbstractUser`, UUID PK. Fields: `full_name`,
`employee_code` (unique), `role` ∈ {ADMIN, CUTTING_MAN, OPERATOR}. Employees are
**deactivated** (`is_active=False`), never hard-deleted, to preserve history.

### Order (`orders.Order`)
- `order_number` — unique, admin-supplied.
- `original_image` — uploaded order card (never modified).
- `generated_image` — derived overlay image (null until generated).
- `cutting_man`, `operator` — current assignees (FK → User, role-validated).
- `cutting_status`, `operator_status` — PENDING / COMPLETED.
- `overall_status` — **derived**, never set by clients.
- `created_by` — FK → User.

### AssignmentHistory (`orders.AssignmentHistory`)
Immutable log of every assignment/reassignment: order, department,
previous/new employee, assigned_by, timestamp. Written only by the service layer.

### ProductionStatusHistory (`production.ProductionStatusHistory`)
Immutable log of every department status change: order, employee, department,
previous/new status, note, timestamp.

### OrderNote (`production.OrderNote`)
Free-form notes tied to an order and author, scoped to a department
(GENERAL / CUTTING / OPERATOR).

### EmployeeTarget (`targets.EmployeeTarget`)
A production target: employee, period_type (DAILY/WEEKLY/MONTHLY),
start/end date, target_count, created_by.

### CompletionCredit (`targets.CompletionCredit`)
Immutable, **deduplicated** credit row created when an employee completes a
department on an order within a target period. `UNIQUE(employee, order, target)`
guarantees an order is counted at most once per target period even across
reopen/re-complete cycles.

## Integrity & performance

- **Foreign keys** with `on_delete=PROTECT` for history/credit (prevent deleting
  referenced users/orders) and `CASCADE` only for owned child notes where safe.
- **Unique constraints:** `order_number`, `employee_code`, `UNIQUE(employee,
  order, target)` on completion credit.
- **Check constraints / validation:** role must match department on assignment;
  only PENDING/COMPLETED statuses.
- **Indexes:** on `order`, `employee`, `department`, `created_at`, statuses, and
  `(role, is_active)` for fast employee lookups.
- **Soft deletion:** employees deactivated; orders retained.
- **Concurrency:** writes to current assignment + history + credit happen inside
  `transaction.atomic()`; completion credit uniqueness prevents double counting
  under concurrent requests.
- **N+1 avoidance:** list endpoints use `select_related`/`prefetch_related` in
  selector functions.