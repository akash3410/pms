"""Serializers for employee targets."""
from rest_framework import serializers

from apps.accounts.models import User
from apps.orders.serializers import UserRefSerializer
from common.enums import Department, PeriodType
from common.exceptions import BusinessRuleError

from .models import CompletionCredit, EmployeeTarget
from .services import validate_no_overlap, validate_target_department


class EmployeeTargetSerializer(serializers.ModelSerializer):
    """Read representation of a target, including achievement count."""

    employee = UserRefSerializer(read_only=True)
    created_by = UserRefSerializer(read_only=True)
    achieved_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = EmployeeTarget
        fields = [
            "id",
            "employee",
            "department",
            "period_type",
            "start_date",
            "end_date",
            "target_count",
            "created_by",
            "created_at",
            "achieved_count",
        ]
        read_only_fields = fields


class EmployeeTargetWriteSerializer(serializers.Serializer):
    """Create/update input for a target, with overlap + role validation."""

    employee = serializers.UUIDField()
    department = serializers.ChoiceField(choices=Department.choices)
    period_type = serializers.ChoiceField(choices=PeriodType.choices)
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    target_count = serializers.IntegerField(min_value=1)

    def validate(self, attrs):
        instance = self.instance
        # For partial updates, merge the provided fields onto the current values
        # so validation always has a complete, consistent target to check.
        if instance is not None:
            attrs = {
                "employee": instance.employee_id,
                "department": instance.department,
                "period_type": instance.period_type,
                "start_date": instance.start_date,
                "end_date": instance.end_date,
                "target_count": instance.target_count,
                **attrs,
            }

        try:
            employee = User.objects.get(pk=attrs["employee"])
        except (User.DoesNotExist, ValueError, TypeError):
            raise serializers.ValidationError({"employee": "Employee not found."}) from None

        if attrs["end_date"] < attrs["start_date"]:
            raise serializers.ValidationError(
                {"end_date": "End date must be on or after start date."}
            )

        # POMS-AUDIT-006: once a target has earned completion credits, the fields
        # that give those credits their meaning are immutable — the employee,
        # department, period type, and the date range (which selects the reporting
        # period). Changing any of them would misattribute or reclassify existing
        # credits in reports. ``target_count`` (a goal, not an attribution) stays
        # editable.
        if instance is not None and instance.credits.exists():
            if str(employee.pk) != str(instance.employee_id):
                raise serializers.ValidationError(
                    {"employee": "Cannot change the employee of a target that already has completion credits."}
                )
            if attrs["department"] != instance.department:
                raise serializers.ValidationError(
                    {"department": "Cannot change the department of a target that already has completion credits."}
                )
            if attrs["period_type"] != instance.period_type:
                raise serializers.ValidationError(
                    {"period_type": "Cannot change the period type of a target that already has completion credits."}
                )
            if (
                attrs["start_date"] != instance.start_date
                or attrs["end_date"] != instance.end_date
            ):
                raise serializers.ValidationError(
                    {"start_date": "Cannot change the date range of a target that already has completion credits."}
                )

        try:
            validate_target_department(employee, attrs["department"])
            exclude_pk = instance.pk if instance else None
            validate_no_overlap(
                employee,
                attrs["period_type"],
                attrs["start_date"],
                attrs["end_date"],
                exclude_pk=exclude_pk,
            )
        except BusinessRuleError as exc:
            detail = exc.detail
            if isinstance(detail, dict):
                field = "department" if "department" in detail else "period_type"
                message = detail.get(field) or detail.get("period") or "Invalid target."
                raise serializers.ValidationError({field: message}) from None
            raise serializers.ValidationError({"period_type": str(detail)}) from None

        attrs["employee"] = employee
        return attrs


class CompletionCreditSerializer(serializers.ModelSerializer):
    employee = UserRefSerializer(read_only=True)
    target = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = CompletionCredit
        fields = [
            "id",
            "employee",
            "order",
            "target",
            "department",
            "credit_date",
            "created_at",
        ]
        read_only_fields = fields