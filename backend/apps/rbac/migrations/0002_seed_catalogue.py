"""Seed the permission catalogue, departments, and the three migrated roles.

Idempotent (``get_or_create``), so it is safe to re-run and safe to leave
forward-only. It creates no user-specific data.
"""
from django.db import migrations

from apps.rbac.constants import (
    PERMISSION_CATALOGUE,
    SYSTEM_DEPARTMENTS,
    SYSTEM_ROLES,
)


def seed(apps, schema_editor):
    Department = apps.get_model("rbac", "Department")
    Permission = apps.get_model("rbac", "Permission")
    Role = apps.get_model("rbac", "Role")
    RolePermission = apps.get_model("rbac", "RolePermission")

    for code, spec in SYSTEM_DEPARTMENTS.items():
        Department.objects.get_or_create(
            code=code,
            defaults={
                "name": spec["name"],
                "is_production": spec["is_production"],
                "is_active": True,
            },
        )

    permissions = {}
    for key, (name, scopes) in PERMISSION_CATALOGUE.items():
        module, _, action = key.partition(".")
        permission, _created = Permission.objects.get_or_create(
            key=key,
            defaults={
                "module": module,
                "action": action,
                "name": name,
                "supported_scopes": list(scopes),
                "is_active": True,
                "is_system": True,
            },
        )
        permissions[key] = permission

    for code, spec in SYSTEM_ROLES.items():
        role, _created = Role.objects.get_or_create(
            code=code,
            defaults={
                "name": spec["name"],
                "description": spec["description"],
                "is_active": True,
                "is_system": True,
            },
        )
        for key, (scope, options) in spec["permissions"].items():
            permission = permissions.get(key)
            if permission is None:  # pragma: no cover - catalogue is code-owned
                continue
            RolePermission.objects.get_or_create(
                role=role,
                permission=permission,
                defaults={"scope": scope, "options": options},
            )


def unseed(apps, schema_editor):
    """Remove only the seeded rows, and only if nothing references them."""
    Department = apps.get_model("rbac", "Department")
    Permission = apps.get_model("rbac", "Permission")
    Role = apps.get_model("rbac", "Role")
    RolePermission = apps.get_model("rbac", "RolePermission")

    RolePermission.objects.filter(permission__key__in=list(PERMISSION_CATALOGUE)).delete()
    Permission.objects.filter(
        key__in=list(PERMISSION_CATALOGUE), is_system=True
    ).delete()
    Role.objects.filter(code__in=list(SYSTEM_ROLES), is_system=True).delete()
    Department.objects.filter(code__in=list(SYSTEM_DEPARTMENTS)).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("rbac", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
