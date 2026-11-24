"""Read-only reporting endpoints (admin only)."""
from django.db.models import Count
from django.utils import timezone
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Role, User
from apps.accounts.permissions import IsAdmin
from apps.orders.models import Order
from apps.orders.serializers import OrderSerializer
from apps.targets.models import CompletionCredit, EmployeeTarget
from common.enums import OverallStatus, ProductionStatus

# Reports can grow with the dataset; bound list-style reports so a single request
# never materialises an unbounded queryset (POMS-AUDIT-017). Clients page with
# ``?limit=`` (default 100, max 500) and ``?offset=``.
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


class DashboardView(APIView):
    """High-level dashboard statistics."""

    permission_classes = [IsAuthenticated, IsAdmin]

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        by_status = {
            row["overall_status"]: row["count"]
            for row in Order.objects.values("overall_status").annotate(count=Count("id"))
        }
        today = timezone.localdate()
        # "Completed today" = orders whose overall completion (the last department
        # reaching COMPLETED) happened today, derived from the actual status-history
        # timestamps rather than the generic updated_at (POMS-AUDIT-013).
        orders_completed_today = (
            Order.objects.filter(
                overall_status=OverallStatus.COMPLETED,
                status_history__new_status=ProductionStatus.COMPLETED,
                status_history__created_at__date=today,
            )
            .distinct()
            .count()
        )
        return Response(
            {
                "orders_total": Order.objects.count(),
                "orders_by_status": by_status,
                "orders_completed_today": orders_completed_today,
                "active_employees": User.objects.filter(
                    is_active=True, role__in=[Role.CUTTING_MAN, Role.OPERATOR]
                ).count(),
                "employees_by_role": {
                    role: User.objects.filter(role=role, is_active=True).count()
                    for role in [Role.ADMIN, Role.CUTTING_MAN, Role.OPERATOR]
                },
                "targets_total": EmployeeTarget.objects.count(),
                "completion_credits_total": CompletionCredit.objects.count(),
                "recent_orders": OrderSerializer(
                    Order.objects.select_related("cutting_man", "operator", "created_by")[:5],
                    many=True,
                    context={"request": request},
                ).data,
            }
        )


class EmployeePerformanceView(APIView):
    """Per-employee assignment load and completion credits."""

    permission_classes = [IsAuthenticated, IsAdmin]

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        employees = _apply_limit(
            User.objects.filter(
                role__in=[Role.CUTTING_MAN, Role.OPERATOR]
            )
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


class ProductionReportView(APIView):
    """Production status distribution and throughput."""

    permission_classes = [IsAuthenticated, IsAdmin]

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


class TargetsReportView(APIView):
    """Target achievement across all configured targets."""

    permission_classes = [IsAuthenticated, IsAdmin]

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