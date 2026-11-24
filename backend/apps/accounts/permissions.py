"""Role-based and object-level permissions for the accounts/auth layer.

These are composed into view/viewset ``permission_classes``. Business rules
(e.g. "only the assigned employee may change a department") live in the
relevant app (orders/production) but rely on the role checks defined here.
"""
from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.accounts.models import Role


class IsAdmin(BasePermission):
    """Allow access only to authenticated ADMIN users."""

    message = "Administrator role required."

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.role == Role.ADMIN)


class IsEmployee(BasePermission):
    """Allow access only to authenticated non-admin employees."""

    message = "Employee role required."

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.is_employee)


class IsAdminOrReadOnly(BasePermission):
    """Admins get full access; everyone authenticated may read."""

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if request.method in SAFE_METHODS:
            return True
        return user.role == Role.ADMIN


class IsActiveUser(BasePermission):
    """Reject tokens belonging to deactivated users (defence in depth)."""

    message = "This account is inactive."

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.is_active)