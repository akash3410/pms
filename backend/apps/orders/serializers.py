"""Serializers for orders, assignments, and assignment history."""
import re

from rest_framework import serializers
from rest_framework.reverse import reverse

from apps.accounts.models import User
from common.enums import Department
from common.utils.file_validation import validate_image_file

from .models import AssignmentHistory, Order
from .services import resolve_assignee

# ``order_number`` is the human-facing business identifier. The allowed format
# is intentionally strict and documented here (POMS-AUDIT-004):
#
#   * 1–64 characters, must start with an alphanumeric character;
#   * may then contain letters, digits, spaces, hyphens and underscores only;
#   * rejects path separators (``/`` ``\\``), traversal sequences (``.``),
#     control characters and any other unsafe filename characters.
#
# This rejects unsafe input with a 400 serializer error instead of letting it
# reach filesystem storage (which would raise ``SuspiciousFileOperation`` -> 500).
# Upload paths no longer depend on ``order_number`` (they key on the order UUID),
# so validation here is defence in depth, not the only safeguard.
_ORDER_NUMBER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _-]*$")
_ORDER_NUMBER_MAX_LEN = 64


def _validate_order_number_format(value: str) -> str:
    value = (value or "").strip()
    if not value:
        raise serializers.ValidationError("Order number is required.")
    if len(value) > _ORDER_NUMBER_MAX_LEN:
        raise serializers.ValidationError(
            f"Order number must be at most {_ORDER_NUMBER_MAX_LEN} characters."
        )
    if not _ORDER_NUMBER_RE.match(value):
        raise serializers.ValidationError(
            "Order number may contain only letters, digits, spaces, hyphens "
            "and underscores (no path separators)."
        )
    return value


class UserRefSerializer(serializers.ModelSerializer):
    """Compact user reference embedded in order payloads."""

    class Meta:
        model = User
        fields = ["id", "full_name", "employee_code", "role"]


class OrderSerializer(serializers.ModelSerializer):
    """Read representation of an order.

    ``original_image`` / ``generated_image`` are returned as URLs to the
    authenticated, object-scoped media endpoints — never as raw ``/media/``
    paths, which are not served publicly.
    """

    cutting_man = UserRefSerializer(read_only=True)
    operator = UserRefSerializer(read_only=True)
    created_by = UserRefSerializer(read_only=True)
    original_image = serializers.SerializerMethodField()
    generated_image = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            "id",
            "order_number",
            "original_image",
            "generated_image",
            "cutting_man",
            "operator",
            "cutting_status",
            "operator_status",
            "overall_status",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def _image_url(self, obj, url_name):
        return reverse(
            f"v1:order-{url_name}", args=[obj.pk], request=self.context.get("request")
        )

    def get_original_image(self, obj) -> str | None:
        return self._image_url(obj, "original-image") if obj.original_image else None

    def get_generated_image(self, obj) -> str | None:
        return self._image_url(obj, "generated-image") if obj.generated_image else None


class OrderCreateSerializer(serializers.Serializer):
    """Admin input for creating an order (multipart)."""

    order_number = serializers.CharField(max_length=64)
    original_image = serializers.ImageField()
    cutting_man = serializers.UUIDField()
    operator = serializers.UUIDField()

    def validate_original_image(self, value):
        validate_image_file(value)
        return value

    def validate_order_number(self, value: str) -> str:
        value = _validate_order_number_format(value)
        if Order.objects.filter(order_number=value).exists():
            raise serializers.ValidationError("An order with this number already exists.")
        return value

    def validate(self, attrs):
        cutting = self._resolve(attrs["cutting_man"], Department.CUTTING, "cutting_man")
        operator = self._resolve(attrs["operator"], Department.OPERATOR, "operator")
        attrs["cutting_man"] = cutting
        attrs["operator"] = operator
        return attrs

    @staticmethod
    def _resolve(value, department, field_name):
        from common.exceptions import BusinessRuleError

        try:
            return resolve_assignee(value, department)
        except BusinessRuleError as exc:
            # Re-key the service error onto the specific field.
            detail = exc.detail
            message = (
                detail.get("employee")
                or detail.get("department")
                or "Invalid assignment."
                if isinstance(detail, dict)
                else str(detail)
            )
            raise serializers.ValidationError({field_name: message}) from None


class OrderUpdateSerializer(serializers.ModelSerializer):
    """Admin partial update of non-status order fields."""

    original_image = serializers.ImageField(required=False)

    class Meta:
        model = Order
        fields = ["order_number", "original_image"]
        extra_kwargs = {field: {"required": False} for field in fields}

    def validate_original_image(self, value):
        validate_image_file(value)
        return value

    def validate_order_number(self, value: str) -> str:
        value = _validate_order_number_format(value)
        qs = Order.objects.filter(order_number=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("An order with this number already exists.")
        return value


class AssignmentSerializer(serializers.Serializer):
    """Admin input to (re)assign an employee to a department."""

    department = serializers.ChoiceField(choices=Department.choices)
    employee_id = serializers.UUIDField()

    def validate(self, attrs):
        user = self._resolve(attrs["employee_id"], attrs["department"], "employee_id")
        attrs["employee_id"] = user
        return attrs

    @staticmethod
    def _resolve(value, department, field_name):
        from common.exceptions import BusinessRuleError

        try:
            return resolve_assignee(value, department)
        except BusinessRuleError as exc:
            detail = exc.detail
            message = (
                (detail.get("employee") or detail.get("department"))
                if isinstance(detail, dict)
                else str(detail)
            )
            raise serializers.ValidationError({field_name: message}) from None


class AssignmentHistorySerializer(serializers.ModelSerializer):
    """Read representation of an assignment-history record."""

    previous_employee = UserRefSerializer(read_only=True)
    new_employee = UserRefSerializer(read_only=True)
    assigned_by = UserRefSerializer(read_only=True)

    class Meta:
        model = AssignmentHistory
        fields = [
            "id",
            "department",
            "previous_employee",
            "new_employee",
            "assigned_by",
            "assigned_at",
        ]