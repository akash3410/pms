"""Authentication URL patterns (mounted under /api/v1/auth/)."""
from django.urls import path

from apps.accounts.views import (
    ChangePasswordView,
    ForgotPasswordView,
    LoginView,
    LogoutView,
    MeView,
    RefreshView,
    ResendVerificationView,
    ResetPasswordView,
    VerifyEmailView,
)

app_name = "accounts"

urlpatterns = [
    path("login/", LoginView.as_view(), name="login"),
    path("refresh/", RefreshView.as_view(), name="refresh"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("me/", MeView.as_view(), name="me"),
    path("change-password/", ChangePasswordView.as_view(), name="change-password"),
    path("password/forgot/", ForgotPasswordView.as_view(), name="password-forgot"),
    path("password/reset/", ResetPasswordView.as_view(), name="password-reset"),
    path("email/verify/", VerifyEmailView.as_view(), name="email-verify"),
    path(
        "email/resend-verification/",
        ResendVerificationView.as_view(),
        name="email-resend-verification",
    ),
]
