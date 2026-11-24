"""Employee target configuration and completion-credit ledger."""
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from apps.orders.models import Order
from common.enums import Department, PeriodType
from common.models import TimeStampedUUIDModel


class EmployeeTarget(TimeStampedUUIDModel):
    """A production target for an employee over a period.

    ``department`` records the production role the target applies to and must
    match the employee's role (validated in the service layer).

    Overlap rule: for the same ``(employee, period_type)`` the inclusive
    ``[start_date, end_date]`` ranges must not overlap. This is enforced in the
    service layer under a transaction (see ``targets/services.py``).
    """

    employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="targets",
    )
    department = models.CharField(max_length=20, choices=Department.choices)
    period_type = models.CharField(max_length=10, choices=PeriodType.choices)
    start_date = models.DateField()
    end_date = models.DateField()
    target_count = models.PositiveIntegerField()
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_targets",
    )

    class Meta:
        ordering = ["-start_date"]
        indexes = [
            models.Index(fields=["employee", "period_type", "start_date"]),
        ]

    def __str__(self) -> str:
        return f"{self.employee_id} {self.period_type} {self.start_date}..{self.end_date}"

    def clean(self) -> None:
        super().clean()
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValidationError({"end_date": "End date must be on or after start date."})
        if self.target_count is not None and self.target_count <= 0:
            raise ValidationError({"target_count": "Target count must be positive."})

    @property
    def periods_overlap(self) -> bool:  # pragma: no cover - trivial helper
        return self.start_date <= self.end_date


class CompletionCredit(TimeStampedUUIDModel):
    """Immutable, deduplicated completion credit for target achievement.

    A row is created the first time an employee completes a department on an
    order within the target period. The ``UNIQUE(employee, order, target)``
    constraint guarantees a single order cannot be credited twice for the same
    target period, even after reopen/re-complete cycles.
    """

    employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="completion_credits",
    )
    order = models.ForeignKey(
        Order,
        on_delete=models.PROTECT,
        related_name="completion_credits",
    )
    target = models.ForeignKey(
        EmployeeTarget,
        on_delete=models.PROTECT,
        related_name="credits",
    )
    department = models.CharField(max_length=20, choices=Department.choices)
    credit_date = models.DateField(db_index=True)
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["employee", "order", "target"],
                name="uniq_completion_credit_employee_order_target",
            ),
        ]
        indexes = [
            models.Index(fields=["employee", "department", "credit_date"]),
            models.Index(fields=["target"]),
        ]

    def __str__(self) -> str:
        return f"Credit {self.employee_id}/{self.order_id} on {self.credit_date}"