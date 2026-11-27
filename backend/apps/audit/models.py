"""Append-only audit trail for security-sensitive operations.

Rows are created only through :func:`apps.audit.services.record`. The model
refuses updates and deletes at the ORM layer, which makes accidental
modification through application code (including Django Admin, where this model
is deliberately not registered) impossible. It is *not* a substitute for
database-level append-only grants: a database superuser can still alter rows.
This limitation is documented in the Phase 10 security report.
"""
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


class AuditLog(models.Model):
    """One immutable security event."""

    id = models.BigAutoField(primary_key=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_events",
    )
    # Snapshot of the actor identity so the trail survives account removal.
    actor_label = models.CharField(max_length=200, blank=True, default="")
    action = models.CharField(max_length=80, db_index=True)
    target_type = models.CharField(max_length=60, blank=True, default="")
    target_id = models.CharField(max_length=64, blank=True, default="")
    before = models.JSONField(null=True, blank=True)
    after = models.JSONField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    request_id = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["action", "created_at"]),
            models.Index(fields=["target_type", "target_id"]),
        ]

    def __str__(self) -> str:
        return f"{self.created_at:%Y-%m-%d %H:%M:%S} {self.action} by {self.actor_label}"

    def save(self, *args, **kwargs) -> None:
        if not self._state.adding:
            raise ValidationError("Audit log entries are immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):  # noqa: DJ012 - intentional override
        raise ValidationError("Audit log entries cannot be deleted.")
