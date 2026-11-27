"""Read-only reporting endpoints, gated by ``reports.view_reports``.

Reporting aggregates are derived from data (department memberships and role
assignments) rather than from a fixed role constant, so new roles and
departments appear automatically.
"""
from django.db.models import Count
from django.utils import timezone
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.permissions import IsActiveUser
from apps.orders.models import Order
from apps.orders.serializers import OrderSerializer
from apps.rbac.models import DepartmentMembership, UserRole
from apps.rbac.permissions import RBACPermission
from apps.targets.models import CompletionCredit, EmployeeTarget
from common.enums import OverallStatus, ProductionStatus

DEFAULT_REPORT_LIMIT = 100
MAX_REPORT_LIMIT = 500


def _apply_limit(queryset, request):
    try:
        limit = int(request.query_params.get("limit", DEFAULT_REPORT_LIMIT))
    except (TypeError, ValueError):
        limit = DEFAULT_REPORT_LIMIT
    try:
        offset = int(request.query_params.get("offset", 0))
    except (TypeError, ValueError):
        offset = 0
    limit = max(1, min(limit, MAX_REPORT_LIMIT))
    offset = max(0, offset)
    return queryset[offset : offset + limit]


def _production_employee_ids():
    """Users with a live membership in an active production department."""
    return DepartmentMembership.objects.filter(
        ended_at__isnull=True,
        department__is_active=True,
        department__is_production=True,
    ).values("user_id")


def _production_employees():
    return User.objects.filter(pk__in=_production_employee_ids())


def _role_counts() -> dict:
    rows = (
        UserRole.objects.filter(
            revoked_at__isnull=True,
            role__is_active=True,
            user__is_active=True,
        )
        .values("role__code")
        .annotate(count=Count("user_id", distinct=True))
    )
    return {row["role__code"]: row["count"] for row in rows}


class ReportBaseView(APIView):
    permission_classes = [IsAuthenticated, IsActiveUser, RBACPermission]
    required_permission = "reports.view_reports"


class DashboardView(ReportBaseView):
    """High-level dashboard statistics."""

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        by_status = {
            row["overall_status"]: row["count"]
            for row in Order.objects.values("overall_status").annotate(count=Count("id"))
        }
        today = timezone.localdate()
        orders_completed_today = (
            Order.objects.filter(
                overall_status=OverallStatus.COMPLETED,
                status_history__new_status=ProductionStatus.COMPLETED,
                status_history__created_at__date=today,
            )
            .distinct()
            .count()
        )
        employees_by_department = {
            row["department__code"]: row["count"]
            for row in DepartmentMembership.objects.filter(
                ended_at__isnull=True,
                department__is_active=True,
                user__is_active=True,
            )
            .values("department__code")
            .annotate(count=Count("user_id", distinct=True))
        }
        return Response(
            {
                "orders_total": Order.objects.count(),
                "orders_by_status": by_status,
                "orders_completed_today": orders_completed_today,
                "active_employees": _production_employees()
                .filter(is_active=True)
                .distinct()
                .count(),
                # Data-driven counts (key retained for API compatibility).
                "employees_by_role": _role_counts(),
                "employees_by_department": employees_by_department,
                "targets_total": EmployeeTarget.objects.count(),
                "completion_credits_total": CompletionCredit.objects.count(),
                "recent_orders": OrderSerializer(
                    Order.objects.select_related(
                        "cutting_man", "operator", "created_by"
                    )[:5],
                    many=True,
                    context={"request": request},
                ).data,
            }
        )


class EmployeePerformanceView(ReportBaseView):
    """Per-employee assignment load and completion credits."""

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        employees = _apply_limit(
            _production_employees()
            .annotate(
                cutting_assigned=Count("cutting_orders", distinct=True),
                operator_assigned=Count("operator_orders", distinct=True),
                credits=Count("completion_credits", distinct=True),
            )
            .order_by("full_name"),
            request,
        )
        data = [
            {
                "employee": {
                    "id": str(emp.id),
                    "full_name": emp.full_name,
                    "employee_code": emp.employee_code,
                    "role": emp.role,
                    "is_active": emp.is_active,
                },
                "cutting_assigned": emp.cutting_assigned,
                "operator_assigned": emp.operator_assigned,
                "completion_credits": emp.credits,
            }
            for emp in employees
        ]
        return Response(data)


class ProductionReportView(ReportBaseView):
    """Production status distribution and throughput."""

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        cutting_breakdown = {
            row["cutting_status"]: row["count"]
            for row in Order.objects.values("cutting_status").annotate(count=Count("id"))
        }
        operator_breakdown = {
            row["operator_status"]: row["count"]
            for row in Order.objects.values("operator_status").annotate(count=Count("id"))
        }
        total = Order.objects.count() or 1
        completed = Order.objects.filter(overall_status="COMPLETED").count()
        return Response(
            {
                "total_orders": Order.objects.count(),
                "cutting": cutting_breakdown,
                "operator": operator_breakdown,
                "completed_orders": completed,
                "completion_rate_percent": round(completed / total * 100, 2),
            }
        )


class TargetsReportView(ReportBaseView):
    """Target achievement across all configured targets."""

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        targets = _apply_limit(
            EmployeeTarget.objects.select_related("employee").annotate(
                achieved=Count("credits")
            ),
            request,
        )
        data = [
            {
                "target_id": str(t.id),
                "employee": {
                    "id": str(t.employee.id),
                    "full_name": t.employee.full_name,
                    "employee_code": t.employee.employee_code,
                },
                "department": t.department,
                "period_type": t.period_type,
                "start_date": t.start_date,
                "end_date": t.end_date,
                "target_count": t.target_count,
                "achieved": t.achieved,
                "achievement_percent": (
                    round(min(t.achieved, t.target_count) / t.target_count * 100, 2)
                    if t.target_count
                    else 0.0
                ),
            }
            for t in targets
        ]
        return Response(data)
