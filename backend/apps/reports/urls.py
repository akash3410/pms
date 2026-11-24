"""Reporting URLs (mounted under /api/v1/reports/)."""
from django.urls import path

from apps.reports.views import (
    DashboardView,
    EmployeePerformanceView,
    ProductionReportView,
    TargetsReportView,
)

app_name = "reports"

urlpatterns = [
    path("dashboard/", DashboardView.as_view(), name="dashboard"),
    path("employees/", EmployeePerformanceView.as_view(), name="employees"),
    path("production/", ProductionReportView.as_view(), name="production"),
    path("targets/", TargetsReportView.as_view(), name="targets"),
]