"""ViewSet for employee targets (admin only)."""
from django.db import IntegrityError, transaction
from django.db.models import Count
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.permissions import IsActiveUser
from apps.rbac.access import get_access
from apps.rbac.permissions import RBACPermission

from .models import EmployeeTarget
from .serializers import EmployeeTargetSerializer, EmployeeTargetWriteSerializer

_OVERLAP_ERROR = {
    "detail": {
        "period": "An overlapping target already exists for this employee and period type."
    }
}


class EmployeeTargetViewSet(viewsets.ModelViewSet):
    """Admin-only target management."""

    queryset = (
        EmployeeTarget.objects.select_related("employee", "created_by")
        .annotate(achieved_count=Count("credits"))
        .order_by("-start_date")
    )
    permission_classes = [IsAuthenticated, IsActiveUser, RBACPermission]
    permission_map = {
        "list": "targets.view_targets",
        "retrieve": "targets.view_targets",
        "create": "targets.manage_targets",
        "update": "targets.manage_targets",
        "partial_update": "targets.manage_targets",
    }
    http_method_names = ["get", "post", "patch", "head", "options"]
    filterset_fields = ["employee", "department", "period_type"]
    ordering_fields = ["start_date", "end_date", "created_at"]
    ordering = ["-start_date"]

    def get_queryset(self):
        queryset = super().get_queryset()
        if getattr(self, "swagger_fake_view", False):
            return queryset.none()
        key = (
            "targets.view_targets"
            if self.action in {"list", "retrieve"}
            else "targets.manage_targets"
        )
        return get_access(self.request).filter_queryset(key, queryset)

    def get_serializer_class(self):
        if self.action in {"create", "update", "partial_update"}:
            return EmployeeTargetWriteSerializer
        return EmployeeTargetSerializer

    def create(self, request, *args, **kwargs):
        # Atomic so the per-employee overlap lock (taken during validation)
        # spans the insert, preventing a concurrent create from slipping in
        # between the check and the write (POMS-AUDIT-006). The DB exclusion
        # constraint is the ultimate backstop for any race the lock misses.
        try:
            with transaction.atomic():
                serializer = self.get_serializer(data=request.data)
                serializer.is_valid(raise_exception=True)
                data = serializer.validated_data
                target = EmployeeTarget.objects.create(
                    employee=data["employee"],
                    department=data["department"],
                    period_type=data["period_type"],
                    start_date=data["start_date"],
                    end_date=data["end_date"],
                    target_count=data["target_count"],
                    created_by=request.user,
                )
                target.achieved_count = 0  # newly created target has no credits yet
                return Response(
                    EmployeeTargetSerializer(target, context={"request": request}).data,
                    status=201,
                )
        except IntegrityError:
            # Concurrent insert violated the exclusion constraint.
            return Response(_OVERLAP_ERROR, status=400)

    def partial_update(self, request, *args, **kwargs):
        target = self.get_object()
        try:
            with transaction.atomic():
                serializer = self.get_serializer(target, data=request.data, partial=True)
                serializer.is_valid(raise_exception=True)
                data = serializer.validated_data
                for field in ("department", "period_type", "start_date", "end_date", "target_count"):
                    if field in data:
                        setattr(target, field, data[field])
                if "employee" in data:
                    target.employee = data["employee"]
                target.save()
                target = (
                    EmployeeTarget.objects.select_related("employee", "created_by")
                    .annotate(achieved_count=Count("credits"))
                    .get(pk=target.pk)
                )
                return Response(
                    EmployeeTargetSerializer(target, context={"request": request}).data
                )
        except IntegrityError:
            return Response(_OVERLAP_ERROR, status=400)