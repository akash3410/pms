"""DRF permission classes driven by the RBAC catalogue."""
from __future__ import annotations

from rest_framework.permissions import BasePermission

from .access import get_access


def required_permission_for(view, request=None) -> str | None:
    """Resolve the permission key a view/action requires.

    A view may declare ``required_permission = "module.action"`` or a
    ``permission_map`` keyed by action, whose values are either a key or a dict
    keyed by HTTP method (for actions that expose several methods).
    """
    action = getattr(view, "action", None)
    mapping = getattr(view, "permission_map", None) or {}
    value = mapping.get(action) if action else None
    if value is None:
        return getattr(view, "required_permission", None)
    if isinstance(value, str):
        return value
    method = getattr(request, "method", "") if request is not None else ""
    if isinstance(value, dict):
        return value.get(method.upper()) or value.get("*")
    return None


class RBACPermission(BasePermission):
    """Require the declared permission, and enforce it for object access too."""

    message = "You do not have permission to perform this action."

    def has_permission(self, request, view) -> bool:
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated or not user.is_active:
            return False
        key = required_permission_for(view, request)
        if key is None:
            return True
        return get_access(request).has_permission(key)

    def has_object_permission(self, request, view, obj) -> bool:
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated or not user.is_active:
            return False
        key = required_permission_for(view, request)
        if key is None:
            return True
        return get_access(request).has_object_permission(key, obj)
