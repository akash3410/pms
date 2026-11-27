"""RBAC URL patterns (mounted under /api/v1/rbac/)."""
from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    DepartmentViewSet,
    PermissionViewSet,
    RoleViewSet,
    UserEffectivePermissionsView,
    UserRoleDetailView,
    UserRolesView,
    UserScopeRestrictionsView,
    UserSuperuserView,
)

router = DefaultRouter()
router.register("roles", RoleViewSet, basename="role")
router.register("permissions", PermissionViewSet, basename="permission")
router.register("departments", DepartmentViewSet, basename="department")

urlpatterns = router.urls + [
    path(
        "users/<uuid:user_id>/roles/",
        UserRolesView.as_view(),
        name="user-roles",
    ),
    path(
        "users/<uuid:user_id>/roles/<uuid:assignment_id>/",
        UserRoleDetailView.as_view(),
        name="user-role-detail",
    ),
    path(
        "users/<uuid:user_id>/effective-permissions/",
        UserEffectivePermissionsView.as_view(),
        name="user-effective-permissions",
    ),
    path(
        "users/<uuid:user_id>/scope-restrictions/",
        UserScopeRestrictionsView.as_view(),
        name="user-scope-restrictions",
    ),
    path(
        "users/<uuid:user_id>/superuser/",
        UserSuperuserView.as_view(),
        name="user-superuser",
    ),
]
