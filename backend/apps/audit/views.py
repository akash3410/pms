"""Read-only audit log API."""
from rest_framework import viewsets

from apps.rbac.permissions import RBACPermission

from .models import AuditLog
from .serializers import AuditLogSerializer


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """Filterable, read-only view of security events.

    There is no create/update/delete route: the trail can only be appended by
    services, and rows refuse modification at the model layer.
    """

    queryset = AuditLog.objects.select_related("actor").all()
    serializer_class = AuditLogSerializer
    permission_classes = [RBACPermission]
    permission_map = {
        "list": "audit_logs.view_logs",
        "retrieve": "audit_logs.view_logs",
    }
    filterset_fields = ["action", "target_type", "actor"]
    search_fields = ["action", "target_type", "target_id", "actor_label", "request_id"]
    ordering_fields = ["created_at", "action"]
    ordering = ["-created_at"]
