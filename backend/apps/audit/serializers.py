"""Read serializers for the audit trail."""
from rest_framework import serializers

from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    actor_id = serializers.UUIDField(source="actor.pk", read_only=True, default=None)

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "actor_id",
            "actor_label",
            "action",
            "target_type",
            "target_id",
            "before",
            "after",
            "metadata",
            "request_id",
            "created_at",
        ]
        read_only_fields = fields
