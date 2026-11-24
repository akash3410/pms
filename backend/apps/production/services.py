"""Business logic for department status changes and notes.

Status updates are transactional: the order's department status, the immutable
status-history row, and (in Phase 6) the completion-credit row all commit or
roll back together. A row lock (``select_for_update``) serialises concurrent
updates to the same order.
"""
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Role
from apps.orders.models import Order
from common.enums import Department, NoteDepartment, ProductionStatus
from common.exceptions import BusinessRuleError

from .models import OrderNote, ProductionStatusHistory

_DEPARTMENT_FOR_ROLE = {
    Role.CUTTING_MAN: Department.CUTTING,
    Role.OPERATOR: Department.OPERATOR,
}

# Department -> Order status field and current-assignee FK field.
_STATUS_FIELD = {
    Department.CUTTING: "cutting_status",
    Department.OPERATOR: "operator_status",
}
_ASSIGNEE_FIELD = {
    Department.CUTTING: "cutting_man",
    Department.OPERATOR: "operator",
}


def department_for_role(role: str):
    """Map a user role to the department they may act on (employees only)."""
    return _DEPARTMENT_FOR_ROLE.get(role)


def _status_field(department: str) -> str:
    if department == Department.CUTTING:
        return "cutting_status"
    if department == Department.OPERATOR:
        return "operator_status"
    raise BusinessRuleError({"department": "Unknown department."})


def _assignee_field(department: str) -> str:
    if department not in _ASSIGNEE_FIELD:
        raise BusinessRuleError({"department": "Unknown department."})
    return _ASSIGNEE_FIELD[department]


def _validate_status(value: str) -> None:
    if value not in ProductionStatus.values:
        raise BusinessRuleError(
            {"status": f"Invalid status. Allowed: {', '.join(ProductionStatus.values)}."}
        )


def update_department_status(*, order: Order, employee, department: str, new_status: str, note: str = "") -> Order:
    """Update a single department's status on an order.

    Authorization: admins may update either department; an employee may only
    update the department matching their role *and* only while they are the
    currently assigned employee for that department (re-verified under the row
    lock so a concurrent reassignment cannot invalidate the check).

    Business rules (Phase 8.1, Batch 2):

    * Rule A — a genuine ``-> COMPLETED`` transition credits the employee who
      currently holds the department at that moment (the actor only if they are
      the assignee). The actor's identity never redirects the credit.
    * Rule B — reassignment changes only the assignee, never the status; a
      COMPLETED department therefore stays COMPLETED and is never re-credited.
    * Rule C — a request whose status equals the current status is a no-op: it
      writes no history and no credit and leaves completion metadata untouched.

    Status update, immutable history creation and eligible credit creation are
    committed or rolled back together inside a single transaction.
    """
    _validate_status(new_status)

    if employee.role != Role.ADMIN and department != department_for_role(employee.role):
        raise BusinessRuleError({"department": "You cannot update this department."})

    field = _status_field(department)
    assignee_field = _assignee_field(department)

    with transaction.atomic():
        # Serialise concurrent updates to this order; the locked row is the
        # source of truth for the previous status, the current assignee and the
        # overall-status recomputation.
        locked = Order.objects.select_for_update().get(pk=order.pk)

        if employee.role != Role.ADMIN and getattr(locked, f"{assignee_field}_id") != employee.id:
            # Re-verify object-level authorization against the locked row.
            raise BusinessRuleError(
                {"department": "You are not currently assigned to this department."}
            )

        previous = getattr(locked, field)

        # Rule C: identical status -> no history, no credit, no metadata change.
        if previous == new_status:
            return locked

        setattr(locked, field, new_status)
        locked.save()  # recomputes overall_status

        ProductionStatusHistory.objects.create(
            order=locked,
            employee=employee,
            department=department,
            previous_status=previous,
            new_status=new_status,
            note=note,
        )

        # Rule A: credit the current department assignee on a real completion.
        if new_status == ProductionStatus.COMPLETED:
            _record_completion(locked, department)

    return locked


def _record_completion(order: Order, department: str) -> None:
    from apps.targets.services import record_completion_credits

    assignee = order.cutting_man if department == Department.CUTTING else order.operator
    if assignee is not None:
        record_completion_credits(
            order=order,
            employee=assignee,
            department=department,
            credit_date=timezone.localdate(),
        )


def add_order_note(*, order: Order, author, department: str, body: str) -> OrderNote:
    """Create an order note (scoped to a department)."""
    body = (body or "").strip()
    if not body:
        raise BusinessRuleError({"body": "Note body cannot be empty."})

    if author.role != Role.ADMIN:
        # Employees may only add notes to GENERAL or their own department.
        allowed = {NoteDepartment.GENERAL, department_for_role(author.role)}
        if department not in allowed:
            raise BusinessRuleError(
                {"department": "You cannot add notes for this department."}
            )

    return OrderNote.objects.create(
        order=order, author=author, department=department, body=body
    )