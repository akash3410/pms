"""Business logic for department status changes and notes.

Authorization is permission-based (``production.update_status`` and
``orders.create_note``) with data scope resolved from the database. Status
updates are transactional: the order's department status, the immutable
status-history row, and the completion credit commit or roll back together. A
row lock serialises concurrent updates to the same order.
"""
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Role  # noqa: F401  (legacy enum, still exposed)
from apps.orders.models import Order
from apps.rbac.access import EffectiveAccess
from apps.rbac.constants import ALL, DEPARTMENT
from apps.rbac.models import DepartmentMembership
from common.enums import Department, NoteDepartment, ProductionStatus
from common.exceptions import BusinessRuleError

from .models import OrderNote, ProductionStatusHistory

#: Department → Order status field and current-assignee FK field.
_STATUS_FIELD = {
    Department.CUTTING: "cutting_status",
    Department.OPERATOR: "operator_status",
}
_ASSIGNEE_FIELD = {
    Department.CUTTING: "cutting_man",
    Department.OPERATOR: "operator",
}

UPDATE_STATUS_PERMISSION = "production.update_status"
CREATE_NOTE_PERMISSION = "orders.create_note"


def departments_for_user_on_order(order: Order, user) -> list[str]:
    """Departments of this order where ``user`` is the current assignee."""
    departments = []
    if order.cutting_man_id == getattr(user, "pk", None):
        departments.append(Department.CUTTING)
    if order.operator_id == getattr(user, "pk", None):
        departments.append(Department.OPERATOR)
    return departments


def _user_department_codes(user) -> set[str]:
    return set(
        DepartmentMembership.objects.filter(
            user=user, ended_at__isnull=True, department__is_active=True
        ).values_list("department__code", flat=True)
    )


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


def _authorize_department(employee, order: Order, department: str) -> bool:
    """Check permission + scope for acting on ``department``.

    Returns ``True`` when the actor has ``ALL`` scope (administrative bypass of
    the assignee rule), ``False`` when they are authorized as the assignee.
    Raises ``BusinessRuleError`` otherwise.
    """
    if department not in _ASSIGNEE_FIELD:
        raise BusinessRuleError({"department": "Unknown department."})

    access = EffectiveAccess(employee)
    if not access.has_permission(UPDATE_STATUS_PERMISSION):
        raise BusinessRuleError(
            {"department": "You do not have permission to update production status."}
        )
    if access.has_scope(UPDATE_STATUS_PERMISSION, ALL):
        return True

    if department not in departments_for_user_on_order(order, employee):
        raise BusinessRuleError(
            {"department": "You are not currently assigned to this department."}
        )
    if (
        access.has_scope(UPDATE_STATUS_PERMISSION, DEPARTMENT)
        and department not in _user_department_codes(employee)
    ):
        raise BusinessRuleError(
            {"department": "You are not a member of this department."}
        )
    return False


@transaction.atomic
def update_department_status(
    *, order: Order, employee, department: str, new_status: str, note: str = ""
) -> Order:
    """Update a single department's status on an order.

    Business rules:

    * Rule A — a genuine ``-> COMPLETED`` transition credits the employee who
      currently holds the department at that moment (never the actor).
    * Rule B — reassignment changes only the assignee, never the status.
    * Rule C — a request whose status equals the current status is a no-op.
    """
    _validate_status(new_status)
    admin_scope = _authorize_department(employee, order, department)

    field = _status_field(department)
    assignee_field = _assignee_field(department)

    with transaction.atomic():
        locked = Order.objects.select_for_update().get(pk=order.pk)

        if not admin_scope and getattr(locked, f"{assignee_field}_id") != employee.id:
            # Re-verify object-level authorization against the locked row so a
            # concurrent reassignment cannot invalidate the check above.
            raise BusinessRuleError(
                {"department": "You are not currently assigned to this department."}
            )

        previous = getattr(locked, field)

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

    access = EffectiveAccess(author)
    if not access.has_permission(CREATE_NOTE_PERMISSION):
        raise BusinessRuleError(
            {"detail": "You do not have permission to add notes."}
        )
    if not access.has_scope(CREATE_NOTE_PERMISSION, ALL):
        # Employees may only add notes to GENERAL or one of their departments.
        allowed = {NoteDepartment.GENERAL} | _user_department_codes(author)
        if department not in allowed:
            raise BusinessRuleError(
                {"department": "You cannot add notes for this department."}
            )

    return OrderNote.objects.create(
        order=order, author=author, department=department, body=body
    )
