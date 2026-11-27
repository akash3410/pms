"""Add the Admin-grantable ``invitations.manage_settings`` permission.

Invitation expiry is business configuration (brief §16), so a business Admin may
change it. The system-level security policy (email verification) stays under the
superuser-only ``system.manage_settings`` permission.
"""
from django.db import migrations


def add_permission(apps, schema_editor):
    Permission = apps.get_model("rbac", "Permission")
    Role = apps.get_model("rbac", "Role")
    RolePermission = apps.get_model("rbac", "RolePermission")

    permission, _ = Permission.objects.get_or_create(
        key="invitations.manage_settings",
        defaults={
            "module": "invitations",
            "action": "manage_settings",
            "name": "Configure invitation expiry",
            "supported_scopes": ["ALL"],
            "is_active": True,
            "is_system": True,
        },
    )
    admin = Role.objects.filter(code="ADMIN", is_system=True).first()
    if admin is not None:
        RolePermission.objects.get_or_create(
            role=admin,
            permission=permission,
            defaults={"scope": "ALL", "options": {}},
        )


def remove_permission(apps, schema_editor):
    Permission = apps.get_model("rbac", "Permission")
    Permission.objects.filter(key="invitations.manage_settings").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("rbac", "0003_backfill_legacy_roles"),
    ]

    operations = [
        migrations.RunPython(add_permission, remove_permission),
    ]
