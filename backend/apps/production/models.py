"""Production status history and order notes."""
from django.conf import settings
from django.db import models

from apps.orders.models import Order
from common.enums import Department, NoteDepartment, ProductionStatus
from common.models import TimeStampedUUIDModel


class ProductionStatusHistory(models.Model):
    """Immutable log of every department status change on an order."""

    id = models.BigAutoField(primary_key=True)
    order = models.ForeignKey(
        Order, on_delete=models.CASCADE, related_name="status_history"
    )
    employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="status_events",
    )
    department = models.CharField(max_length=20, choices=Department.choices)
    previous_status = models.CharField(max_length=20, choices=ProductionStatus.choices)
    new_status = models.CharField(max_length=20, choices=ProductionStatus.choices)
    note = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["order", "department", "created_at"]),
            models.Index(fields=["employee", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.order_id} {self.department} {self.previous_status}->{self.new_status}"


class OrderNote(TimeStampedUUIDModel):
    """Free-form note attached to an order, scoped to a department."""

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="notes")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="order_notes",
    )
    department = models.CharField(
        max_length=20, choices=NoteDepartment.choices, default=NoteDepartment.GENERAL
    )
    body = models.TextField()

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Note on {self.order_id} by {self.author_id}"