"""Accounts-layer permission classes.

The former fixed-role classes (``IsAdmin`` / ``IsEmployee`` / ``IsAdminOrReadOnly``)
have been removed: authorization is now permission-based and lives in
:mod:`apps.rbac.permissions`. Only the deactivation guard remains here because it
is about authentication state, not business permissions.
"""
from rest_framework.permissions import BasePermission


class IsActiveUser(BasePermission):
    """Reject tokens belonging to deactivated users (defence in depth)."""

    message = "This account is inactive."

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.is_active)
