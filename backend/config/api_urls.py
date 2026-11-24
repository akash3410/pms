"""Aggregated API v1 routes."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.accounts.views import EmployeeViewSet
from apps.orders.views import OrderViewSet
from apps.targets.views import EmployeeTargetViewSet

router = DefaultRouter()
router.register("employees", EmployeeViewSet, basename="employee")
router.register("orders", OrderViewSet, basename="order")
router.register("targets", EmployeeTargetViewSet, basename="target")

api_v1_patterns = [
    path("auth/", include("apps.accounts.urls")),
    path("reports/", include("apps.reports.urls")),
    path("", include(router.urls)),
]

urlpatterns = [
    path("", include((api_v1_patterns, "v1"), namespace="v1")),
]