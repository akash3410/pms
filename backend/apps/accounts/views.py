"""Authentication, employee management, invitations and system configuration."""
from django.core.exceptions import ValidationError as DjangoValidationError
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView

from apps.accounts import services
from apps.accounts.models import EmailConfiguration, Invitation, User
from apps.accounts.permissions import IsActiveUser
from apps.accounts.serializers import (
    AcceptInvitationSerializer,
    ChangePasswordSerializer,
    EmailConfigurationSerializer,
    EmailTestSerializer,
    EmployeeCreateSerializer,
    EmployeeUpdateSerializer,
    ForgotPasswordSerializer,
    InvitationCreateSerializer,
    InvitationSerializer,
    InvitationSettingsSerializer,
    LogoutSerializer,
    ProfileSerializer,
    ResetPasswordSerializer,
    SystemSettingsSerializer,
    TokenPairSerializer,
    UserSerializer,
    VerifyEmailSerializer,
)
from apps.rbac.access import get_access
from apps.rbac.permissions import RBACPermission


class LoginView(APIView):
    """Obtain an access + refresh token pair by email (or username)."""

    permission_classes = [AllowAny]
    serializer_class = TokenPairSerializer

    def post(self, request):
        serializer = TokenPairSerializer(
            data=request.data, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        return Response(serializer.validated_data, status=status.HTTP_200_OK)


class RefreshView(TokenRefreshView):
    """Exchange a refresh token for a new access token."""

    permission_classes = [AllowAny]


class LogoutView(APIView):
    """Blacklist a refresh token."""

    permission_classes = [IsAuthenticated, IsActiveUser]
    serializer_class = LogoutSerializer

    def post(self, request):
        serializer = LogoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            token = RefreshToken(serializer.validated_data["refresh"])
            token.blacklist()
        except TokenError:
            return Response(
                {"detail": "Invalid or expired refresh token."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    """Retrieve or update the authenticated user's own profile."""

    permission_classes = [IsAuthenticated, IsActiveUser, RBACPermission]
    permission_map = {
        "get": "employees.view_profile",
        "patch": "employees.edit_profile",
    }
    serializer_class = ProfileSerializer

    def get(self, request):
        return Response(ProfileSerializer(request.user).data)

    def patch(self, request):
        serializer = ProfileSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ChangePasswordView(APIView):
    """Change the authenticated user's own password."""

    permission_classes = [IsAuthenticated, IsActiveUser]
    serializer_class = ChangePasswordSerializer

    def post(self, request):
        serializer = ChangePasswordSerializer(
            data=request.data, context={"user": request.user}
        )
        serializer.is_valid(raise_exception=True)
        services.change_password(
            request.user,
            current_password=serializer.validated_data["current_password"],
            new_password=serializer.validated_data["new_password"],
            request=request,
        )
        return Response({"detail": "Password updated."})


class ForgotPasswordView(APIView):
    """Request a password-reset email. Always returns 204 (no enumeration)."""

    permission_classes = [AllowAny]
    serializer_class = ForgotPasswordSerializer

    def post(self, request):
        serializer = ForgotPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.request_password_reset(
            serializer.validated_data["email"], request=request
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class ResetPasswordView(APIView):
    """Set a new password from a single-use reset token."""

    permission_classes = [AllowAny]
    serializer_class = ResetPasswordSerializer

    def post(self, request):
        serializer = ResetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.reset_password(
            serializer.validated_data["token"],
            serializer.validated_data["new_password"],
            request=request,
        )
        return Response({"detail": "Password has been reset."})


class VerifyEmailView(APIView):
    """Confirm an email address from a single-use verification token."""

    permission_classes = [AllowAny]
    serializer_class = VerifyEmailSerializer

    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.verify_email(serializer.validated_data["token"], request=request)
        return Response({"detail": "Email address verified."})


class ResendVerificationView(APIView):
    """Re-send the verification email for the authenticated account."""

    permission_classes = [IsAuthenticated, IsActiveUser]
    serializer_class = VerifyEmailSerializer

    def post(self, request):
        if request.user.is_email_verified:
            return Response({"detail": "Email address is already verified."})
        services.send_email_verification(request.user, request=request)
        return Response({"detail": "Verification email sent."})


class EmployeeViewSet(viewsets.ModelViewSet):
    """Employee management, gated by explicit RBAC permissions.

    Supported methods: list, create, retrieve, partial update (PATCH), the
    ``deactivate`` and ``reactivate`` actions. ``PUT`` and ``DELETE`` are
    intentionally not exposed — accounts are deactivated, never deleted.
    """

    queryset = User.objects.all().order_by("employee_code")
    permission_classes = [IsAuthenticated, IsActiveUser, RBACPermission]
    permission_map = {
        "list": "employees.view_employee",
        "retrieve": "employees.view_employee",
        "create": "employees.create_employee",
        "partial_update": "employees.edit_employee",
        "update": "employees.edit_employee",
        "deactivate": "employees.deactivate_employee",
        "reactivate": "employees.deactivate_employee",
    }
    http_method_names = ["get", "post", "patch", "head", "options"]
    search_fields = ["full_name", "employee_code", "username", "email"]
    ordering_fields = ["employee_code", "full_name", "date_joined"]
    ordering = ["employee_code"]

    def get_queryset(self):
        queryset = super().get_queryset()
        if getattr(self, "swagger_fake_view", False):
            return queryset.none()
        if self.action in {"list", "retrieve"}:
            return get_access(self.request).filter_queryset(
                "employees.view_employee", queryset
            )
        return queryset

    def get_serializer_class(self):
        if self.action == "create":
            return EmployeeCreateSerializer
        if self.action in {"update", "partial_update"}:
            return EmployeeUpdateSerializer
        return UserSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            user = services.create_employee_account(
                request.user, data=dict(serializer.validated_data), request=request
            )
        except DjangoValidationError as exc:
            raise serializers_validation_error(exc) from None
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        user = self.get_object()
        previous_email = (user.email or "").lower()
        serializer = self.get_serializer(user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        if user.email and user.email.lower() != previous_email:
            services.send_email_verification(user, request=request)
        return Response(UserSerializer(user).data)

    @extend_schema(request=None, responses={200: UserSerializer})
    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        """Soft-deactivate an employee (preserves history, revokes roles)."""
        user = self.get_object()
        if not user.is_active:
            return Response(
                {"detail": "Employee is already inactive."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        result = services.rbac_services().deactivate_user(
            request.user, user, request=request
        )
        payload = UserSerializer(result["user"]).data
        if result["active_orders"]:
            payload["active_orders"] = result["active_orders"]
            payload["detail"] = (
                "Employee deactivated. Their current order assignments must be "
                "reassigned."
            )
        return Response(payload, status=status.HTTP_200_OK)

    @extend_schema(request=None, responses={200: UserSerializer})
    @action(detail=True, methods=["post"])
    def reactivate(self, request, pk=None):
        """Reactivate an employee. Roles are deliberately not restored."""
        user = self.get_object()
        if user.is_active:
            return Response(
                {"detail": "Employee is already active."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user = services.rbac_services().reactivate_user(
            request.user, user, request=request
        )
        return Response(UserSerializer(user).data, status=status.HTTP_200_OK)


def serializers_validation_error(exc: DjangoValidationError):
    from rest_framework.exceptions import ValidationError

    if hasattr(exc, "message_dict"):
        return ValidationError(exc.message_dict)
    return ValidationError({"detail": list(exc.messages)})


class InvitationViewSet(viewsets.ModelViewSet):
    """Invitation lifecycle (create, list, resend, cancel)."""

    queryset = Invitation.objects.select_related("created_by").prefetch_related(
        "roles"
    )
    serializer_class = InvitationSerializer
    permission_classes = [IsAuthenticated, IsActiveUser, RBACPermission]
    http_method_names = ["get", "post", "patch", "head", "options"]
    permission_map = {
        "list": "invitations.view_invitation",
        "retrieve": "invitations.view_invitation",
        "create": "invitations.create_invitation",
        "resend": "invitations.resend_invitation",
        "cancel": "invitations.cancel_invitation",
        "invitation_settings": "invitations.manage_settings",
    }
    filterset_fields = ["status", "email"]
    ordering = ["-created_at"]

    def get_serializer_class(self):
        if self.action == "create":
            return InvitationCreateSerializer
        return InvitationSerializer

    def partial_update(self, request, *args, **kwargs):
        # Invitations are immutable records; only the actions may change state.
        from rest_framework.exceptions import MethodNotAllowed

        raise MethodNotAllowed("PATCH")

    def create(self, request, *args, **kwargs):
        serializer = InvitationCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        invitation, _raw = services.create_invitation(
            request.user,
            email=data["email"],
            full_name=data.get("full_name", ""),
            employee_code=data.get("employee_code", ""),
            role_ids=[str(role) for role in data.get("roles", [])],
            request=request,
        )
        return Response(
            InvitationSerializer(invitation).data, status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=["post"])
    def resend(self, request, pk=None):
        invitation, _raw = services.resend_invitation(
            request.user, self.get_object(), request=request
        )
        return Response(InvitationSerializer(invitation).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        invitation = services.cancel_invitation(
            request.user, self.get_object(), request=request
        )
        return Response(InvitationSerializer(invitation).data)

    @extend_schema(
        request=InvitationSettingsSerializer,
        responses=InvitationSettingsSerializer,
    )
    @action(detail=False, methods=["get", "patch"], url_path="settings")
    def invitation_settings(self, request):
        """Read or change the invitation lifetime (applies to new invitations)."""
        if request.method == "PATCH":
            serializer = InvitationSettingsSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            services.set_setting(
                request.user,
                services.INVITATION_HOURS_KEY,
                serializer.validated_data["invitation_expiry_hours"],
                request=request,
            )
        return Response(
            {
                "invitation_expiry_hours": services.invitation_expiry_hours(),
                "max_invitation_expiry_hours": services.MAX_INVITATION_HOURS,
            }
        )


class AcceptInvitationView(APIView):
    """Public endpoint: accept an invitation and set the account password."""

    permission_classes = [AllowAny]
    serializer_class = AcceptInvitationSerializer

    def post(self, request):
        serializer = AcceptInvitationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = services.accept_invitation(
            serializer.validated_data["token"],
            serializer.validated_data["password"],
            request=request,
        )
        return Response(
            {"detail": "Invitation accepted. You can now sign in.",
             "user": str(user.pk)},
            status=status.HTTP_201_CREATED,
        )


class EmailConfigurationView(APIView):
    """Superuser-only email transport configuration (no secrets returned)."""

    permission_classes = [IsAuthenticated, IsActiveUser, RBACPermission]
    required_permission = "system.manage_email_config"
    serializer_class = EmailConfigurationSerializer

    def get(self, request):
        return Response(
            EmailConfigurationSerializer(EmailConfiguration.load()).data
        )

    def patch(self, request):
        config = EmailConfiguration.load()
        serializer = EmailConfigurationSerializer(
            config, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        before = {
            "host": config.host,
            "port": config.port,
            "username": config.username,
            "from_email": config.from_email,
            "is_active": config.is_active,
        }
        serializer.save(updated_by=request.user)
        from apps.audit.services import record

        config.refresh_from_db()
        record(
            actor=request.user,
            action="system.email_config_updated",
            target_type="accounts.emailconfiguration",
            target_id=str(config.pk),
            before=before,
            after={
                "host": config.host,
                "port": config.port,
                "username": config.username,
                "from_email": config.from_email,
                "is_active": config.is_active,
            },
            request=request,
        )
        return Response(EmailConfigurationSerializer(config).data)


class EmailTestView(APIView):
    """Superuser-only: send a test email and report the outcome."""

    permission_classes = [IsAuthenticated, IsActiveUser, RBACPermission]
    required_permission = "system.manage_email_config"
    serializer_class = EmailTestSerializer

    def post(self, request):
        recipient = request.data.get("email") or request.user.email
        if not recipient:
            return Response(
                {"detail": "Provide an email address to test delivery."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            services.send_email(
                "POMS email configuration test",
                "This is a test message from your POMS installation.",
                [recipient],
            )
        except Exception as exc:  # noqa: BLE001 - surface a safe message only
            return Response(
                {"detail": "Test email could not be sent.",
                 "reason": exc.__class__.__name__},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response({"detail": "Test email sent.", "recipient": recipient})


class SystemSettingsView(APIView):
    """Superuser-only system settings (invitation expiry, verification policy)."""

    permission_classes = [IsAuthenticated, IsActiveUser, RBACPermission]
    required_permission = "system.manage_settings"
    serializer_class = SystemSettingsSerializer

    def get(self, request):
        return Response(
            {
                "invitation_expiry_hours": services.invitation_expiry_hours(),
                "require_email_verification": services.require_email_verification(),
                "max_invitation_expiry_hours": services.MAX_INVITATION_HOURS,
            }
        )

    def patch(self, request):
        serializer = SystemSettingsSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if "invitation_expiry_hours" in data:
            services.set_setting(
                request.user,
                services.INVITATION_HOURS_KEY,
                data["invitation_expiry_hours"],
                request=request,
            )
        if "require_email_verification" in data:
            services.set_setting(
                request.user,
                "require_email_verification",
                data["require_email_verification"],
                request=request,
            )
        return self.get(request)

