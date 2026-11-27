"""Serializers for RBAC resources."""
from __future__ import annotations

from rest_framework import serializers

from .constants import SCOPE_MODULES, SCOPE_TYPES, SYSTEM_PERMISSION_PREFIX
from .models import (
    Department,
    DepartmentMembership,
    Permission,
    Role,
    UserRole,
    UserScopeRestriction,
)


class PermissionRefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ["id", "key", "name", "module", "action", "supported_scopes"]
        read_only_fields = fields


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = [
            "id",
            "key",
            "module",
            "action",
            "name",
            "description",
            "supported_scopes",
            "is_active",
            "is_system",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "module", "action", "is_system", "created_at", "updated_at"]

    def validate_key(self, value: str) -> str:
        value = (value or "").strip()
        if self.instance is not None and value != self.instance.key:
            raise serializers.ValidationError(
                "Permission keys are stable and cannot be changed."
            )
        if "." not in value:
            raise serializers.ValidationError("Key must be in 'module.action' form.")
        module = value.split(".", 1)[0]
        if module not in SCOPE_MODULES:
            raise serializers.ValidationError(f"Unknown module '{module}'.")
        if value.startswith(SYSTEM_PERMISSION_PREFIX):
            raise serializers.ValidationError(
                "System-level permission keys are reserved and cannot be created."
            )
        if Permission.objects.filter(key=value).exists():
            raise serializers.ValidationError("A permission with this key already exists.")
        return value

    def validate_supported_scopes(self, value):
        if not isinstance(value, list) or not value:
            raise serializers.ValidationError(
                "At least one supported scope type is required."
            )
        invalid = [item for item in value if item not in SCOPE_TYPES]
        if invalid:
            raise serializers.ValidationError(
                f"Unsupported scope types: {', '.join(map(str, invalid))}."
            )
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if self.instance is not None and "supported_scopes" in attrs:
            in_use = set(
                self.instance.role_links.values_list("scope", flat=True)
            ) | set(self.instance.user_restrictions.values_list("scope", flat=True))
            removed = in_use - set(attrs["supported_scopes"])
            if removed:
                raise serializers.ValidationError(
                    {
                        "supported_scopes": (
                            "Cannot remove scope types that are in use: "
                            f"{', '.join(sorted(removed))}."
                        )
                    }
                )
        return attrs

    def create(self, validated_data):
        validated_data["is_system"] = False
        return super().create(validated_data)


class RolePermissionEntrySerializer(serializers.Serializer):
    permission = serializers.CharField()
    scope = serializers.ChoiceField(choices=[(s, s) for s in SCOPE_TYPES])
    options = serializers.JSONField(required=False, default=dict)


class RolePermissionSetSerializer(serializers.Serializer):
    permissions = RolePermissionEntrySerializer(many=True, allow_empty=True)


class RolePermissionReadSerializer(serializers.Serializer):
    permission = PermissionRefSerializer(read_only=True)
    scope = serializers.CharField(read_only=True)
    options = serializers.JSONField(read_only=True)


class RoleSerializer(serializers.ModelSerializer):
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Role
        fields = [
            "id",
            "code",
            "name",
            "description",
            "is_active",
            "is_system",
            "permissions",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "is_active", "is_system", "created_at", "updated_at"]

    def get_permissions(self, obj) -> list:
        links = obj.permission_links.select_related("permission").all()
        return RolePermissionReadSerializer(links, many=True).data


class RoleWriteSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=64, required=False)
    name = serializers.CharField(max_length=80)
    description = serializers.CharField(required=False, allow_blank=True, default="")


class RoleRefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ["id", "code", "name", "is_active", "is_system"]
        read_only_fields = fields


class UserRoleSerializer(serializers.ModelSerializer):
    role = RoleRefSerializer(read_only=True)
    assigned_by_label = serializers.SerializerMethodField()

    class Meta:
        model = UserRole
        fields = [
            "id",
            "role",
            "assigned_by_label",
            "created_at",
            "revoked_at",
        ]
        read_only_fields = fields

    def get_assigned_by_label(self, obj) -> str:
        actor = obj.assigned_by
        if actor is None:
            return ""
        return getattr(actor, "employee_code", "") or getattr(actor, "username", "")


class AssignRoleSerializer(serializers.Serializer):
    role = serializers.UUIDField()


class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = [
            "id",
            "code",
            "name",
            "description",
            "is_production",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_code(self, value: str) -> str:
        value = (value or "").strip().upper()
        if self.instance is not None and value != self.instance.code:
            raise serializers.ValidationError(
                "Department codes are stable and cannot be changed."
            )
        if Department.objects.filter(code=value).exists():
            raise serializers.ValidationError(
                "A department with this code already exists."
            )
        return value


class DepartmentMembershipSerializer(serializers.ModelSerializer):
    department = DepartmentSerializer(read_only=True)
    user_label = serializers.SerializerMethodField()
    user_id = serializers.UUIDField(source="user.id", read_only=True)

    class Meta:
        model = DepartmentMembership
        fields = [
            "id",
            "user_id",
            "user_label",
            "department",
            "is_primary",
            "created_at",
            "ended_at",
        ]
        read_only_fields = fields

    def get_user_label(self, obj) -> str:
        return getattr(obj.user, "employee_code", "") or str(obj.user_id)


class AddMemberSerializer(serializers.Serializer):
    user = serializers.UUIDField()
    is_primary = serializers.BooleanField(required=False, default=False)


class UserScopeRestrictionSerializer(serializers.ModelSerializer):
    permission = PermissionRefSerializer(read_only=True)
    permission_key = serializers.CharField(source="permission.key", read_only=True)

    class Meta:
        model = UserScopeRestriction
        fields = [
            "id",
            "permission",
            "permission_key",
            "scope",
            "options",
            "created_at",
        ]
        read_only_fields = ["id", "permission", "permission_key", "created_at"]


class SetScopeRestrictionSerializer(serializers.Serializer):
    permission = serializers.CharField()
    scope = serializers.ChoiceField(choices=[(s, s) for s in SCOPE_TYPES])
    options = serializers.JSONField(required=False, default=dict)


class SuperuserToggleSerializer(serializers.Serializer):
    enabled = serializers.BooleanField()


class EffectivePermissionsSerializer(serializers.Serializer):
    """Response shape for a user's resolved access."""

    user = serializers.UUIDField(read_only=True)
    is_superuser = serializers.BooleanField(read_only=True)
    permissions = serializers.DictField(read_only=True)
    restrictions = serializers.DictField(read_only=True)

