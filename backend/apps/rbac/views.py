"""RBAC API: roles, permissions, assignments, scopes, departments."""
from __future__ import annotations

from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditLog
from apps.audit.serializers import AuditLogSerializer
from apps.audit.services import record

from . import services
from .access import get_access
from .models import (
    Department,
    DepartmentMembership,
    Permission,
    Role,
    RolePermission,
    UserRole,
    UserScopeRestriction,
)
from .permissions import RBACPermission
from .serializers import (
    AddMemberSerializer,
    AssignRoleSerializer,
    DepartmentMembershipSerializer,
    DepartmentSerializer,
    EffectivePermissionsSerializer,
    PermissionSerializer,
    RolePermissionReadSerializer,
    RolePermissionSetSerializer,
    RoleSerializer,
    RoleWriteSerializer,
    SetScopeRestrictionSerializer,
    SuperuserToggleSerializer,
    UserRoleSerializer,
    UserScopeRestrictionSerializer,
)


class RoleViewSet(viewsets.ModelViewSet):
    queryset = Role.objects.prefetch_related("permission_links__permission").all()
    serializer_class = RoleSerializer
    permission_classes = [RBACPermission]
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]
    permission_map = {
        "list": "roles.view_roles",
        "retrieve": "roles.view_roles",
        "create": "roles.manage_roles",
        "partial_update": "roles.manage_roles",
        "update": "roles.manage_roles",
        "destroy": "roles.manage_roles",
        "activate": "roles.manage_roles",
        "deactivate": "roles.manage_roles",
        "permissions": {"GET": "roles.view_roles", "PUT": "roles.manage_roles"},
        "history": "permissions.view_change_history",
    }
    filterset_fields = ["is_active", "is_system"]
    search_fields = ["code", "name", "description"]
    ordering_fields = ["code", "name", "created_at"]
    ordering = ["name"]

    def get_serializer_class(self):
        if self.action in {"create", "partial_update", "update"}:
            return RoleWriteSerializer
        return RoleSerializer

    def create(self, request, *args, **kwargs):
        serializer = RoleWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        role = services.create_role(
            request.user,
            code=data.get("code") or data["name"],
            name=data["name"],
            description=data.get("description", ""),
            request=request,
        )
        return Response(RoleSerializer(role).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        role = self.get_object()
        serializer = RoleWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        role = services.update_role(
            request.user, role, data=serializer.validated_data, request=request
        )
        return Response(RoleSerializer(role).data)

    def destroy(self, request, *args, **kwargs):
        services.delete_role(request.user, self.get_object(), request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        role = services.set_role_active(
            request.user, self.get_object(), active=True, request=request
        )
        return Response(RoleSerializer(role).data)

    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        role = services.set_role_active(
            request.user, self.get_object(), active=False, request=request
        )
        return Response(RoleSerializer(role).data)

    @action(detail=True, methods=["get", "put"], url_path="permissions")
    def permissions(self, request, pk=None):
        role = self.get_object()
        if request.method == "PUT":
            serializer = RolePermissionSetSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            services.set_role_permissions(
                request.user,
                role,
                serializer.validated_data["permissions"],
                request=request,
            )
        links = RolePermission.objects.filter(role=role).select_related("permission")
        return Response(RolePermissionReadSerializer(links, many=True).data)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        role = self.get_object()
        events = AuditLog.objects.filter(
            target_type="rbac.role", target_id=str(role.pk)
        ).order_by("-created_at")[:200]
        return Response(AuditLogSerializer(events, many=True).data)


class PermissionViewSet(viewsets.ModelViewSet):
    queryset = Permission.objects.all()
    serializer_class = PermissionSerializer
    permission_classes = [RBACPermission]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    permission_map = {
        "list": "permissions.view_permissions",
        "retrieve": "permissions.view_permissions",
        "create": "permissions.manage_permissions",
        "partial_update": "permissions.manage_permissions",
        "update": "permissions.manage_permissions",
        "destroy": "permissions.manage_permissions",
        "activate": "permissions.manage_permissions",
        "deactivate": "permissions.manage_permissions",
        "history": "permissions.view_change_history",
    }
    filterset_fields = ["module", "is_active", "is_system"]
    search_fields = ["key", "name", "description"]
    ordering_fields = ["module", "action", "created_at"]
    ordering = ["module", "action"]

    def create(self, request, *args, **kwargs):
        serializer = PermissionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        permission = serializer.save()
        record(
            actor=request.user,
            action="permission.created",
            target=permission,
            after={
                "key": permission.key,
                "name": permission.name,
                "supported_scopes": permission.supported_scopes,
            },
            request=request,
        )
        return Response(PermissionSerializer(permission).data, status=201)

    def partial_update(self, request, *args, **kwargs):
        permission = self.get_object()
        before = {
            "name": permission.name,
            "description": permission.description,
            "supported_scopes": permission.supported_scopes,
            "is_active": permission.is_active,
        }
        serializer = PermissionSerializer(
            permission, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        permission = serializer.save()
        record(
            actor=request.user,
            action="permission.updated",
            target=permission,
            before=before,
            after={
                "name": permission.name,
                "description": permission.description,
                "supported_scopes": permission.supported_scopes,
                "is_active": permission.is_active,
            },
            request=request,
        )
        return Response(PermissionSerializer(permission).data)

    def destroy(self, request, *args, **kwargs):
        permission = self.get_object()
        if permission.is_system:
            raise ValidationError(
                {"detail": "System permissions cannot be deleted; deactivate instead."}
            )
        if permission.role_links.exists() or permission.user_restrictions.exists():
            raise services.PolicyConflict(
                "This permission is still referenced by a role or a user "
                "restriction. Remove those references first."
            )
        before = {"key": permission.key, "name": permission.name}
        permission_id = permission.pk
        permission.delete()
        record(
            actor=request.user,
            action="permission.deleted",
            target_type="rbac.permission",
            target_id=str(permission_id),
            before=before,
            request=request,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        return self._set_active(request, True)

    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        return self._set_active(request, False)

    def _set_active(self, request, active: bool):
        permission = self.get_object()
        before = {"is_active": permission.is_active}
        permission.is_active = active
        permission.save(update_fields=["is_active", "updated_at"])
        record(
            actor=request.user,
            action="permission.activated" if active else "permission.deactivated",
            target=permission,
            before=before,
            after={"is_active": active},
            request=request,
        )
        return Response(PermissionSerializer(permission).data)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        permission = self.get_object()
        events = AuditLog.objects.filter(
            target_type="rbac.permission", target_id=str(permission.pk)
        ).order_by("-created_at")[:200]
        return Response(AuditLogSerializer(events, many=True).data)


class DepartmentViewSet(viewsets.ModelViewSet):
    queryset = Department.objects.all()
    serializer_class = DepartmentSerializer
    permission_classes = [RBACPermission]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    permission_map = {
        "list": "departments.view_departments",
        "retrieve": "departments.view_departments",
        "create": "departments.manage_departments",
        "partial_update": "departments.manage_departments",
        "update": "departments.manage_departments",
        "destroy": "departments.manage_departments",
        "members": {
            "GET": "departments.view_departments",
            "POST": "departments.manage_members",
        },
        "member": "departments.manage_members",
        "set_primary": "departments.manage_members",
    }
    filterset_fields = ["is_active", "is_production"]
    search_fields = ["code", "name"]
    ordering = ["name"]

    def get_queryset(self):
        queryset = super().get_queryset()
        if getattr(self, "swagger_fake_view", False):
            return queryset.none()
        if self.action in {"list", "retrieve"}:
            access = get_access(self.request)
            return access.filter_queryset(
                "departments.view_departments", queryset
            )
        return queryset

    def create(self, request, *args, **kwargs):
        serializer = DepartmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        department = services.create_department(
            request.user,
            code=data["code"],
            name=data["name"],
            description=data.get("description", ""),
            is_production=data.get("is_production", True),
            request=request,
        )
        return Response(DepartmentSerializer(department).data, status=201)

    def partial_update(self, request, *args, **kwargs):
        department = self.get_object()
        serializer = DepartmentSerializer(
            department, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        department = services.update_department(
            request.user, department, data=serializer.validated_data, request=request
        )
        return Response(DepartmentSerializer(department).data)

    def destroy(self, request, *args, **kwargs):
        services.delete_department(
            request.user, self.get_object(), request=request
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get", "post"], url_path="members")
    def members(self, request, pk=None):
        department = self.get_object()
        if request.method == "POST":
            serializer = AddMemberSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            user = services.get_user(serializer.validated_data["user"])
            membership = services.add_department_member(
                request.user,
                user,
                department,
                is_primary=serializer.validated_data.get("is_primary", False),
                request=request,
            )
            return Response(
                DepartmentMembershipSerializer(membership).data,
                status=status.HTTP_201_CREATED,
            )
        queryset = DepartmentMembership.objects.filter(
            department=department
        ).select_related("department", "user")
        if request.query_params.get("include_ended") != "true":
            queryset = queryset.filter(ended_at__isnull=True)
        return Response(DepartmentMembershipSerializer(queryset, many=True).data)

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "membership_id", OpenApiTypes.UUID, OpenApiParameter.PATH
            )
        ],
        responses={204: None},
    )
    @action(
        detail=True,
        methods=["delete"],
        url_path=r"members/(?P<membership_id>[^/.]+)",
    )
    def member(self, request, pk=None, membership_id=None):
        department = self.get_object()
        membership = get_object_or_404(
            DepartmentMembership, pk=membership_id, department=department
        )
        services.end_department_membership(
            request.user, membership, request=request
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "membership_id", OpenApiTypes.UUID, OpenApiParameter.PATH
            )
        ],
        request=None,
        responses={200: DepartmentMembershipSerializer},
    )
    @action(
        detail=True,
        methods=["post"],
        url_path=r"members/(?P<membership_id>[^/.]+)/primary",
    )
    def set_primary(self, request, pk=None, membership_id=None):
        department = self.get_object()
        membership = get_object_or_404(
            DepartmentMembership, pk=membership_id, department=department
        )
        membership = services.set_primary_department(
            request.user, membership, request=request
        )
        return Response(DepartmentMembershipSerializer(membership).data)


# --------------------------------------------------------------------------- #
# User-scoped RBAC endpoints
# --------------------------------------------------------------------------- #
class UserRolesView(APIView):
    permission_classes = [RBACPermission]
    required_permission = "users.manage_users"
    serializer_class = UserRoleSerializer

    @extend_schema(responses=UserRoleSerializer(many=True))
    def get(self, request, user_id):
        user = services.get_user(user_id)
        queryset = UserRole.objects.filter(user=user).select_related(
            "role", "assigned_by"
        )
        if request.query_params.get("include_revoked") != "true":
            queryset = queryset.filter(revoked_at__isnull=True)
        return Response(UserRoleSerializer(queryset, many=True).data)

    @extend_schema(
        request=AssignRoleSerializer, responses={201: UserRoleSerializer}
    )
    def post(self, request, user_id):
        user = services.get_user(user_id)
        serializer = AssignRoleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        role = get_object_or_404(Role, pk=serializer.validated_data["role"])
        assignment = services.assign_role(
            request.user, user, role, request=request
        )
        return Response(
            UserRoleSerializer(assignment).data, status=status.HTTP_201_CREATED
        )


class UserRoleDetailView(APIView):
    permission_classes = [RBACPermission]
    required_permission = "users.manage_users"
    serializer_class = UserRoleSerializer

    @extend_schema(responses={204: None})
    def delete(self, request, user_id, assignment_id):
        assignment = get_object_or_404(
            UserRole, pk=assignment_id, user_id=user_id
        )
        services.revoke_role(request.user, assignment, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class UserEffectivePermissionsView(APIView):
    permission_classes = [RBACPermission]
    required_permission = "users.view_effective_permissions"
    serializer_class = EffectivePermissionsSerializer

    @extend_schema(responses=EffectivePermissionsSerializer)
    def get(self, request, user_id):
        user = services.get_user(user_id)
        access = get_access(request)
        if not access.has_object_permission(
            "users.view_effective_permissions", user
        ):
            raise services.PermissionDenied(
                "You may only view your own effective permissions."
            )
        return Response(
            {
                "user": str(user.pk),
                "is_superuser": user.is_superuser,
                **get_access_for(user).snapshot(),
            }
        )


def get_access_for(user):
    from .access import EffectiveAccess

    return EffectiveAccess(user)


class UserScopeRestrictionsView(APIView):
    permission_classes = [RBACPermission]
    required_permission = "scopes.manage_user_restrictions"
    serializer_class = UserScopeRestrictionSerializer

    @extend_schema(responses=UserScopeRestrictionSerializer(many=True))
    def get(self, request, user_id):
        user = services.get_user(user_id)
        queryset = UserScopeRestriction.objects.filter(user=user).select_related(
            "permission"
        )
        return Response(UserScopeRestrictionSerializer(queryset, many=True).data)

    @extend_schema(
        request=SetScopeRestrictionSerializer,
        responses=UserScopeRestrictionSerializer,
    )
    def put(self, request, user_id):
        user = services.get_user(user_id)
        serializer = SetScopeRestrictionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        permission = get_object_or_404(
            Permission, key=serializer.validated_data["permission"]
        )
        restriction = services.set_user_scope_restriction(
            request.user,
            user,
            permission,
            scope=serializer.validated_data["scope"],
            options=serializer.validated_data.get("options") or {},
            request=request,
        )
        return Response(UserScopeRestrictionSerializer(restriction).data)

    def delete(self, request, user_id):
        user = services.get_user(user_id)
        permission_key = request.data.get("permission")
        if not permission_key:
            raise ValidationError({"permission": "This field is required."})
        restriction = get_object_or_404(
            UserScopeRestriction, user=user, permission__key=permission_key
        )
        services.delete_user_scope_restriction(
            request.user, restriction, request=request
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class UserSuperuserView(APIView):
    permission_classes = [RBACPermission]
    required_permission = "system.manage_superusers"
    serializer_class = SuperuserToggleSerializer

    @extend_schema(request=SuperuserToggleSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request, user_id):
        user = services.get_user(user_id)
        serializer = SuperuserToggleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = services.set_superuser(
            request.user,
            user,
            enabled=serializer.validated_data["enabled"],
            request=request,
        )
        return Response(
            {"id": str(user.pk), "is_superuser": user.is_superuser,
             "is_staff": user.is_staff}
        )
