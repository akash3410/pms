"""Serializers for production status updates, history, and notes."""
from rest_framework import serializers

from apps.orders.serializers import UserRefSerializer
from common.enums import Department, NoteDepartment, ProductionStatus

from .models import OrderNote, ProductionStatusHistory


class StatusUpdateSerializer(serializers.Serializer):
    """Input for a department status change.

    ``department`` is only used for admins (who may act on either department).
    For employees the department is derived server-side from their role.
    """

    status = serializers.ChoiceField(choices=ProductionStatus.choices)
    department = serializers.ChoiceField(choices=Department.choices, required=False)
    note = serializers.CharField(required=False, allow_blank=True, default="")


class ProductionStatusHistorySerializer(serializers.ModelSerializer):
    employee = UserRefSerializer(read_only=True)

    class Meta:
        model = ProductionStatusHistory
        fields = [
            "id",
            "employee",
            "department",
            "previous_status",
            "new_status",
            "note",
            "created_at",
        ]
        read_only_fields = fields


class OrderNoteSerializer(serializers.ModelSerializer):
    author = UserRefSerializer(read_only=True)

    class Meta:
        model = OrderNote
        fields = ["id", "author", "department", "body", "created_at"]
        read_only_fields = fields


class OrderNoteCreateSerializer(serializers.Serializer):
    department = serializers.ChoiceField(
        choices=NoteDepartment.choices, required=False, default=NoteDepartment.GENERAL
    )
    body = serializers.CharField()