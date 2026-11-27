"""Aggregated API v1 routes."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.accounts.views import (
    AcceptInvitationView,
    EmailConfigurationView,
    EmailTestView,
    EmployeeViewSet,
    InvitationViewSet,
    SystemSettingsView,
)
from apps.common.health import HealthCheckView
from apps.orders.views import OrderViewSet
from apps.targets.views import EmployeeTargetViewSet

router = DefaultRouter()
router.register("employees", EmployeeViewSet, basename="employee")
router.register("orders", OrderViewSet, basename="order")
router.register("targets", EmployeeTargetViewSet, basename="target")
router.register("invitations", InvitationViewSet, basename="invitation")

api_v1_patterns = [
    path("auth/", include("apps.accounts.urls")),
    path("reports/", include("apps.reports.urls")),
    path("rbac/", include("apps.rbac.urls")),
    path("audit-logs/", include("apps.audit.urls")),
    # Must precede the router include so "accept" is not parsed as a detail pk.
    path(
        "invitations/accept/",
        AcceptInvitationView.as_view(),
        name="invitation-accept",
    ),
    path("system/email/", EmailConfigurationView.as_view(), name="system-email"),
    path(
        "system/email/test/",
        EmailTestView.as_view(),
        name="system-email-test",
    ),
    path("system/settings/", SystemSettingsView.as_view(), name="system-settings"),
    path("health/", HealthCheckView.as_view(), name="health"),
    path("", include(router.urls)),
]

urlpatterns = [
    path("", include((api_v1_patterns, "v1"), namespace="v1")),
]
