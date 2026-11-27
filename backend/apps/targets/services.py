"""Business logic for employee targets and completion credits."""
from datetime import date

from django.db import transaction

from apps.accounts.models import User
from apps.orders.models import Order
from apps.rbac.models import DepartmentMembership
from common.enums import Department
from common.exceptions import BusinessRuleError

from .models import CompletionCredit, EmployeeTarget


def validate_target_department(employee, department: str) -> None:
    """A target's department must be one the employee actually belongs to."""
    if department not in Department.values:
        raise BusinessRuleError({"department": "Unknown department."})
    if not DepartmentMembership.objects.filter(
        user=employee,
        department__code=department,
        department__is_active=True,
        ended_at__isnull=True,
    ).exists():
        raise BusinessRuleError(
            {
                "department": (
                    "Targets can only be set for employees who belong to that "
                    "department."
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