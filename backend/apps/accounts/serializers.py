"""Serializers for accounts, authentication, invitations and system settings."""
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts import auth as auth_services
from apps.accounts.models import (
    EmailConfiguration,
    Invitation,
    Role,
    User,
    UserManager,  # noqa: F401  (kept importable for backwards compatibility)
)
from apps.rbac.models import UserRole
from common.enums import OverallStatus


class UserSerializer(serializers.ModelSerializer):
    """Read representation of a user/employee."""

    role_display = serializers.CharField(source="get_role_display", read_only=True)
    roles = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "full_name",
            "employee_code",
            "role",
            "role_display",
            "roles",
            "email",
            "email_verified_at",
            "is_active",
            "date_joined",
        ]
        read_only_fields = fields

    def get_roles(self, obj) -> list[str]:
        return sorted(
            UserRole.objects.filter(user=obj, revoked_at__isnull=True)
            .values_list("role__code", flat=True)
        )


class EmployeeCreateSerializer(serializers.Serializer):
    """Admin input for creating an employee (validated in the service layer)."""

    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, min_length=8)
    full_name = serializers.CharField(max_length=150)
    employee_code = serializers.CharField(max_length=40)
    role = serializers.ChoiceField(
        choices=Role.choices, required=False, default=Role.OPERATOR
    )
    email = serializers.EmailField(required=False, allow_blank=True, default="")
    is_active = serializers.BooleanField(required=False, default=True)

    def validate_username(self, value: str) -> str:
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("A user with this username already exists.")
        return value

    def validate_employee_code(self, value: str) -> str:
        value = value.strip().upper()
        if User.objects.filter(employee_code__iexact=value).exists():
            raise serializers.ValidationError("An employee with this code already exists.")
        return value

    def validate_email(self, value: str) -> str:
        value = (value or "").strip()
        if value and User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value


class EmployeeUpdateSerializer(serializers.ModelSerializer):
    """Admin-only partial update of an employee (never the password)."""

    class Meta:
        model = User
        # ``is_active`` is deliberately excluded: deactivation/reactivation must go
        # through the guarded, audited actions (role revocation, last-superuser and
        # self-lockout checks), never a plain field write.
        fields = ["full_name", "employee_code", "role", "email"]
        extra_kwargs = {field: {"required": False} for field in fields}

    def validate_employee_code(self, value: str) -> str:
        value = value.strip().upper()
        qs = User.objects.filter(employee_code__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("An employee with this code already exists.")
        return value

    def validate_email(self, value: str) -> str:
        value = (value or "").strip()
        qs = User.objects.filter(email__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if value and qs.exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def update(self, instance, validated_data):
        email_changed = (
            "email" in validated_data
            and (validated_data["email"] or "").strip().lower()
            != (instance.email or "").strip().lower()
        )
        instance = super().update(instance, validated_data)
        if email_changed and instance.email:
            instance.email_verified_at = None
            instance.requires_email_verification = True
            instance.save(
                update_fields=[
                    "email_verified_at",
                    "requires_email_verification",
                    "updated_at",
                ]
            )
        return instance

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if self.instance and "role" in attrs and attrs["role"] != self.instance.role:
            # The legacy role is bridged into a system role, so changing it is a
            # role assignment in disguise and needs user-management authority.
            request = self.context.get("request")
            if request is not None:
                from apps.rbac.access import get_access

                if not get_access(request).has_scope("users.manage_users", "ALL"):
                    raise serializers.ValidationError(
                        {
                            "role": (
                                "Changing an employee's role requires user-management "
                                "permission."
                            )
                        }
                    )
            # A role change must not invalidate the employee's current (active)
            # department assignments. Reassigning their orders is an explicit Admin
            # action; we never silently reassign or delete history.
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
    roles = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "full_name",
            "employee_code",
            "role",
            "role_display",
            "roles",
            "email",
            "email_verified_at",
            "is_active",
            "date_joined",
        ]
        read_only_fields = [
            "id",
            "username",
            "employee_code",
            "role",
            "role_display",
            "roles",
            "email",
            "email_verified_at",
            "is_active",
            "date_joined",
        ]

    def get_roles(self, obj) -> list[str]:
        return UserSerializer().get_roles(obj)


class TokenPairSerializer(serializers.Serializer):
    """Email-or-username login.

    No authorization claims are embedded in the token: permissions are always
    resolved from the database per request, so a token cannot carry stale access.
    """

    email = serializers.CharField(required=False, allow_blank=True, write_only=True)
    username = serializers.CharField(required=False, allow_blank=True, write_only=True)
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        identifier = (attrs.get("email") or attrs.get("username") or "").strip()
        if not identifier:
            raise serializers.ValidationError(
                {"email": "Provide an email address (or username) and password."}
            )
        user = auth_services.authenticate_credentials(
            identifier,
            attrs["password"],
            request=self.context.get("request"),
        )
        refresh = RefreshToken.for_user(user)
        return {
            "refresh": str(refresh),
            "access": str(refresh.access_token),
            "user": UserSerializer(user).data,
        }


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField()


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate_new_password(self, value: str) -> str:
        try:
            validate_password(value, user=self.context.get("user"))
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from None
        return value


class ForgotPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField()


class ResetPasswordSerializer(serializers.Serializer):
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate_new_password(self, value: str) -> str:
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from None
        return value


class VerifyEmailSerializer(serializers.Serializer):
    token = serializers.CharField()


class InvitationSerializer(serializers.ModelSerializer):
    roles = serializers.SerializerMethodField()
    created_by_label = serializers.SerializerMethodField()

    class Meta:
        model = Invitation
        fields = [
            "id",
            "email",
            "full_name",
            "employee_code",
            "user",
            "roles",
            "status",
            "expires_at",
            "accepted_at",
            "cancelled_at",
            "last_sent_at",
            "send_count",
            "created_by_label",
            "created_at",
        ]
        read_only_fields = fields

    def get_roles(self, obj) -> list:
        return [
            {"id": str(role.pk), "code": role.code, "name": role.name}
            for role in obj.roles.all()
        ]

    def get_created_by_label(self, obj) -> str:
        actor = obj.created_by
        if actor is None:
            return ""
        return getattr(actor, "employee_code", "") or getattr(actor, "username", "")


class InvitationCreateSerializer(serializers.Serializer):
    email = serializers.EmailField()
    full_name = serializers.CharField(required=False, allow_blank=True, default="")
    employee_code = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=40
    )
    roles = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list
    )


class AcceptInvitationSerializer(serializers.Serializer):
    token = serializers.CharField()
    password = serializers.CharField(write_only=True, min_length=8)

    def validate_password(self, value: str) -> str:
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from None
        return value


class EmailConfigurationSerializer(serializers.ModelSerializer):
    has_password = serializers.SerializerMethodField()
    smtp_password = serializers.CharField(
        write_only=True, required=False, allow_blank=True
    )

    class Meta:
        model = EmailConfiguration
        fields = [
            "host",
            "port",
            "username",
            "from_email",
            "use_tls",
            "use_ssl",
            "timeout",
            "is_active",
            "password_env_var",
            "has_password",
            "smtp_password",
        ]

    def get_has_password(self, obj) -> bool:
        import os

        return bool(os.environ.get(obj.password_env_var))

    def validate(self, attrs):
        if attrs.get("smtp_password"):
            raise serializers.ValidationError(
                {
                    "smtp_password": (
                        "SMTP credentials are never stored by the application. "
                        "Set the environment variable named in password_env_var "
                        "through your secret manager."
                    )
                }
            )
        attrs.pop("smtp_password", None)
        return super().validate(attrs)


class SystemSettingsSerializer(serializers.Serializer):
    invitation_expiry_hours = serializers.IntegerField(min_value=1, max_value=168)
    require_email_verification = serializers.BooleanField(required=False)


class EmailTestSerializer(serializers.Serializer):
    email = serializers.EmailField(required=False)


class InvitationSettingsSerializer(serializers.Serializer):
    """Business-level invitation configuration (Admin-grantable)."""

    invitation_expiry_hours = serializers.IntegerField(min_value=1, max_value=168)
