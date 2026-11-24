"""Serializers for accounts / authentication."""
from django.contrib.auth import authenticate
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from apps.accounts.models import Role, User
from common.enums import OverallStatus


class UserSerializer(serializers.ModelSerializer):
    """Read representation of a user/employee."""

    role_display = serializers.CharField(source="get_role_display", read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "full_name",
            "employee_code",
            "role",
            "role_display",
            "email",
            "is_active",
            "date_joined",
        ]
        read_only_fields = fields


class EmployeeCreateSerializer(serializers.ModelSerializer):
    """Admin-only creation of an employee."""

    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = [
            "username",
            "password",
            "full_name",
            "employee_code",
            "role",
            "email",
            "is_active",
        ]
        extra_kwargs = {
            "role": {"default": Role.OPERATOR},
            "is_active": {"default": True},
        }

    def validate_username(self, value: str) -> str:
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("A user with this username already exists.")
        return value

    def validate_employee_code(self, value: str) -> str:
        value = value.strip().upper()
        if User.objects.filter(employee_code__iexact=value).exists():
            raise serializers.ValidationError("An employee with this code already exists.")
        return value

    def create(self, validated_data):
        password = validated_data.pop("password")
        return User.objects.create_user(password=password, **validated_data)


class EmployeeUpdateSerializer(serializers.ModelSerializer):
    """Admin-only partial update of an employee (not the password)."""

    class Meta:
        model = User
        fields = ["full_name", "employee_code", "role", "email", "is_active"]
        extra_kwargs = {field: {"required": False} for field in fields}

    def validate_employee_code(self, value: str) -> str:
        value = value.strip().upper()
        qs = User.objects.filter(employee_code__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("An employee with this code already exists.")
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        # POMS-AUDIT-016: a role change must not invalidate the employee's
        # current (active) department assignments. Reassigning their orders is an
        # explicit Admin action; we never silently reassign or delete history.
        if self.instance and "role" in attrs and attrs["role"] != self.instance.role:
            self._validate_role_compatible_with_assignments(attrs["role"])
        return attrs

    def _validate_role_compatible_with_assignments(self, new_role: str) -> None:
        user = self.instance
        active_cutting = user.cutting_orders.exclude(
            overall_status=OverallStatus.COMPLETED
        ).exists()
        active_operator = user.operator_orders.exclude(
            overall_status=OverallStatus.COMPLETED
        ).exists()

        if active_cutting and new_role != Role.CUTTING_MAN:
            raise serializers.ValidationError(
                {
                    "role": (
                        "This employee has active Cutting assignments and cannot "
                        "be changed to this role. Reassign their orders first."
                    )
                }
            )
        if active_operator and new_role != Role.OPERATOR:
            raise serializers.ValidationError(
                {
                    "role": (
                        "This employee has active Operator assignments and cannot "
                        "be changed to this role. Reassign their orders first."
                    )
                }
            )


class ProfileSerializer(serializers.ModelSerializer):
    """Self-service profile read/update for the authenticated user."""

    role_display = serializers.CharField(source="get_role_display", read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "full_name",
            "employee_code",
            "role",
            "role_display",
            "email",
            "is_active",
            "date_joined",
        ]
        read_only_fields = [
            "id",
            "username",
            "employee_code",
            "role",
            "role_display",
            "is_active",
            "date_joined",
        ]


class TokenPairSerializer(TokenObtainPairSerializer):
    """JWT obtain serializer: adds custom claims and embeds the user payload.

    Extends ``TokenObtainPairSerializer`` to add ``role`` / ``employee_code`` /
    ``full_name`` claims to the access token and include the user object in the
    response. Inactive users are still rejected by the underlying authenticator
    (this serializer does not bypass that check).
    """

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = user.role
        token["employee_code"] = user.employee_code
        token["full_name"] = user.full_name
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField()


class LoginSerializer(serializers.Serializer):
    """Documents the login request shape (actual auth handled by TokenPairSerializer)."""

    username = serializers.CharField()
    password = serializers.CharField(write_only=True)


__all__ = [
    "UserSerializer",
    "EmployeeCreateSerializer",
    "EmployeeUpdateSerializer",
    "ProfileSerializer",
    "TokenPairSerializer",
    "LogoutSerializer",
    "LoginSerializer",
    "authenticate",
]