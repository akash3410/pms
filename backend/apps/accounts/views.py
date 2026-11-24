"""Authentication views and employee management."""
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from apps.accounts.models import User
from apps.accounts.permissions import IsActiveUser, IsAdmin
from apps.accounts.serializers import (
    EmployeeCreateSerializer,
    EmployeeUpdateSerializer,
    LogoutSerializer,
    ProfileSerializer,
    TokenPairSerializer,
    UserSerializer,
)


class LoginView(TokenObtainPairView):
    """Obtain an access + refresh token pair."""

    serializer_class = TokenPairSerializer
    permission_classes = [AllowAny]


class RefreshView(TokenRefreshView):
    """Exchange a refresh token for a new access token."""

    permission_classes = [AllowAny]


class LogoutView(APIView):
    """Blacklist a refresh token."""

    permission_classes = [IsAuthenticated]
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
        # 204 No Content: the refresh token is blacklisted and there is no
        # response body to return (POMS-AUDIT-015). 205 Reset Content is a poor
        # fit for a stateless token-blacklist endpoint.
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    """Retrieve or update the authenticated user's profile."""

    permission_classes = [IsAuthenticated, IsActiveUser]
    serializer_class = ProfileSerializer

    def get(self, request):
        return Response(ProfileSerializer(request.user).data)

    def patch(self, request):
        serializer = ProfileSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class EmployeeViewSet(viewsets.ModelViewSet):
    """Admin-only employee management.

    Supported methods: list, create, retrieve, partial update (PATCH) and the
    custom ``deactivate`` action. ``PUT`` and ``DELETE`` are intentionally not
    exposed — employees are deactivated, never permanently deleted.
    """

    queryset = User.objects.all().order_by("employee_code")
    permission_classes = [IsAuthenticated, IsAdmin]
    http_method_names = ["get", "post", "patch", "head", "options"]
    search_fields = ["full_name", "employee_code", "username", "email"]
    ordering_fields = ["employee_code", "full_name", "date_joined"]
    ordering = ["employee_code"]

    def get_serializer_class(self):
        if self.action == "create":
            return EmployeeCreateSerializer
        if self.action in {"update", "partial_update"}:
            return EmployeeUpdateSerializer
        return UserSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=None, responses={200: UserSerializer})
    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        """Soft-deactivate an employee (preserves history)."""
        user = self.get_object()
        if not user.is_active:
            return Response(
                {"detail": "Employee is already inactive."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.is_active = False
        user.save(update_fields=["is_active", "updated_at"])
        return Response(UserSerializer(user).data, status=status.HTTP_200_OK)