"""Backfill RBAC assignments from the legacy ``User.role`` column.

Preserves every existing user relationship: the only writes are new
``UserRole`` and ``DepartmentMembership`` rows. Existing rows are created
idempotently, and the migration never deletes or rewrites business data.
"""
from django.db import migrations

LEGACY_ROLE_MAP = {
    "ADMIN": "ADMIN",
    "CUTTING_MAN": "CUTTING_MAN",
    "OPERATOR": "OPERATOR",
}

LEGACY_DEPARTMENT_MAP = {
    "CUTTING_MAN": "CUTTING",
    "OPERATOR": "OPERATOR",
}


def backfill(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    Role = apps.get_model("rbac", "Role")
    UserRole = apps.get_model("rbac", "UserRole")
    Department = apps.get_model("rbac", "Department")
    DepartmentMembership = apps.get_model("rbac", "DepartmentMembership")

    roles = {role.code: role for role in Role.objects.filter(is_system=True)}
    departments = {dept.code: dept for dept in Department.objects.all()}

    for user in User.objects.all().iterator():
        code = LEGACY_ROLE_MAP.get(user.role)
        role = roles.get(code) if code else None
        if role is not None and not UserRole.objects.filter(
            user_id=user.pk, role=role, revoked_at__isnull=True
        ).exists():
            UserRole.objects.create(user_id=user.pk, role=role)

        department_code = LEGACY_DEPARTMENT_MAP.get(user.role)
        department = departments.get(department_code) if department_code else None
        if department is None:
            continue
        if DepartmentMembership.objects.filter(
            user_id=user.pk, department=department, ended_at__isnull=True
        ).exists():
            continue
        DepartmentMembership.objects.filter(
            user_id=user.pk, is_primary=True, ended_at__isnull=True
        ).update(is_primary=False)
        DepartmentMembership.objects.create(
            user_id=user.pk, department=department, is_primary=True
        )


class Migration(migrations.Migration):
    dependencies = [
        ("rbac", "0002_seed_catalogue"),
        ("accounts", "0002_rbac_auth_fields"),
    ]

    operations = [
        # Forward-only by design: idempotent and non-destructive. A reverse would
        # have to guess which assignments were created here versus in the app.
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
