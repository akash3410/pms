"""Business logic for employee targets and completion credits."""
from datetime import date

from django.db import transaction

from apps.accounts.models import Role, User
from apps.orders.models import Order
from common.enums import Department
from common.exceptions import BusinessRuleError

from .models import CompletionCredit, EmployeeTarget

_DEPARTMENT_FOR_ROLE = {
    Role.CUTTING_MAN: Department.CUTTING,
    Role.OPERATOR: Department.OPERATOR,
}


def validate_target_department(employee, department: str) -> None:
    """A target's department must match the employee's production role."""
    expected = _DEPARTMENT_FOR_ROLE.get(employee.role)
    if expected is None:
        raise BusinessRuleError(
            {"department": "Targets can only be set for production employees."}
        )
    if department != expected:
        raise BusinessRuleError(
            {
                "department": (
                    f"Department must match the employee's role "
                    f"({expected.replace('_', ' ').title()})."
                )
            }
        )


@transaction.atomic
def validate_no_overlap(employee, period_type: str, start: date, end: date, exclude_pk=None) -> None:
    """Reject overlapping targets for the same (employee, period_type).

    Concurrent creates/edits for the same employee are serialised by taking a
    row lock on the employee's ``User`` row before the existence check, so two
    requests cannot both pass the check and then insert overlapping ranges
    (POMS-AUDIT-006). The employee row always exists (unlike target rows, which
    may not yet exist for a first target), so it is a reliable mutex. The lock is
    held until the caller's surrounding transaction commits, so the view layer
    must wrap create/update in ``transaction.atomic`` (it does).
    """
    User.objects.select_for_update().get(pk=employee.pk)
    qs = EmployeeTarget.objects.filter(employee=employee, period_type=period_type)
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    overlapping = qs.filter(start_date__lte=end, end_date__gte=start).exists()
    if overlapping:
        raise BusinessRuleError(
            {
                "period": (
                    "An overlapping target already exists for this employee and "
                    "period type."
                )
            }
        )


def record_completion_credits(*, order: Order, employee, department: str, credit_date: date) -> list[CompletionCredit]:
    """Create deduplicated completion credits for an employee's completion.

    Finds every target for (employee, department) whose date range contains
    ``credit_date`` and records one credit per target (idempotent via the
    ``UNIQUE(employee, order, target)`` constraint). Reopen/re-complete in the
    same period does not create additional credits.
    """
    targets = EmployeeTarget.objects.filter(
        employee=employee,
        department=department,
        start_date__lte=credit_date,
        end_date__gte=credit_date,
    )

    created: list[CompletionCredit] = []
    for target in targets:
        _, was_created = CompletionCredit.objects.get_or_create(
            employee=employee,
            order=order,
            target=target,
            defaults={"department": department, "credit_date": credit_date},
        )
        if was_created:
            created.append(_)
    return created