"""Order and assignment-history models."""
from django.conf import settings
from django.db import models

from common.enums import Department, OverallStatus, ProductionStatus
from common.models import TimeStampedUUIDModel


def compute_overall_status(cutting_status: str, operator_status: str) -> str:
    """Derive overall order status from the two department statuses.

    | Cutting   | Operator  | Overall     |
    |-----------|-----------|-------------|
    | Pending   | Pending   | PENDING     |
    | Completed | Pending   | IN_PROGRESS |
    | Pending   | Completed | IN_PROGRESS |
    | Completed | Completed | COMPLETED   |
    """
    if (
        cutting_status == ProductionStatus.COMPLETED
        and operator_status == ProductionStatus.COMPLETED
    ):
        return OverallStatus.COMPLETED
    if (
        cutting_status == ProductionStatus.PENDING
        and operator_status == ProductionStatus.PENDING
    ):
        return OverallStatus.PENDING
    return OverallStatus.IN_PROGRESS


def original_image_upload_to(instance, filename: str) -> str:
    # Path is keyed on the order's immutable UUID, never the client-supplied
    # ``order_number`` — so upload paths cannot be influenced by untrusted input
    # even if a value slips past validation (POMS-AUDIT-004).
    return f"originals/{instance.pk}/{filename}"


def generated_image_upload_to(instance, filename: str) -> str:
    return f"generated/{instance.pk}/{filename}"


class Order(TimeStampedUUIDModel):
    """A production order.

    Holds the *current* assignment (one Cutting Man, one Operator) and the two
    department statuses. Overall status is derived and never set by clients.
    """

    order_number = models.CharField(max_length=64, unique=True, db_index=True)
    original_image = models.ImageField(upload_to=original_image_upload_to)
    generated_image = models.ImageField(
        upload_to=generated_image_upload_to, null=True, blank=True
    )

    cutting_man = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="cutting_orders",
        null=True,
        blank=True,
    )
    operator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="operator_orders",
        null=True,
        blank=True,
    )

    cutting_status = models.CharField(
        max_length=20, choices=ProductionStatus.choices, default=ProductionStatus.PENDING
    )
    operator_status = models.CharField(
        max_length=20, choices=ProductionStatus.choices, default=ProductionStatus.PENDING
    )
    overall_status = models.CharField(
        max_length=20,
        choices=OverallStatus.choices,
        default=OverallStatus.PENDING,
        editable=False,
        db_index=True,
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_orders",
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["cutting_status", "operator_status"]),
            models.Index(fields=["created_by", "created_at"]),
        ]
        constraints = [
            # DB-level safeguard (POMS-AUDIT-009): overall_status must always
            # equal the value derived from the two department statuses. This
            # makes a stale overall_status impossible even if a future code path
            # (e.g. a bulk ``QuerySet.update``) forgets to recompute it.
            models.CheckConstraint(
                condition=(
                    models.Q(
                        cutting_status=ProductionStatus.PENDING,
                        operator_status=ProductionStatus.PENDING,
                        overall_status=OverallStatus.PENDING,
                    )
                    | models.Q(
                        cutting_status=ProductionStatus.COMPLETED,
                        operator_status=ProductionStatus.PENDING,
                        overall_status=OverallStatus.IN_PROGRESS,
                    )
                    | models.Q(
                        cutting_status=ProductionStatus.PENDING,
                        operator_status=ProductionStatus.COMPLETED,
                        overall_status=OverallStatus.IN_PROGRESS,
                    )
                    | models.Q(
                        cutting_status=ProductionStatus.COMPLETED,
                        operator_status=ProductionStatus.COMPLETED,
                        overall_status=OverallStatus.COMPLETED,
                    )
                ),
                name="chk_order_overall_status_consistent",
            )
        ]

    def __str__(self) -> str:
        return f"Order {self.order_number}"

    def save(self, *args, **kwargs) -> None:
        # Overall status is always derived, never trusted from input.
        self.overall_status = compute_overall_status(
            self.cutting_status, self.operator_status
        )
        super().save(*args, **kwargs)

    @property
    def is_completed(self) -> bool:
        return self.overall_status == OverallStatus.COMPLETED


class AssignmentHistory(models.Model):
    """Immutable record of every assignment / reassignment event."""

    id = models.BigAutoField(primary_key=True)
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="assignments")
    department = models.CharField(max_length=20, choices=Department.choices)
    previous_employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="assignment_previously",
        null=True,
        blank=True,
    )
    new_employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="assignment_assigned",
    )
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="assignment_events",
    )
    assigned_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-assigned_at"]
        indexes = [
            models.Index(fields=["order", "department"]),
        ]

    def __str__(self) -> str:
        return (
            f"{self.order.order_number} {self.department} "
            f"-> {self.new_employee_id} @ {self.assigned_at:%Y-%m-%d %H:%M}"
        )