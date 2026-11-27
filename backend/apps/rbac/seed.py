"""Idempotent catalogue seeding.

Called by the initial data migration and by a ``post_migrate`` receiver. The
receiver matters because Django's ``flush`` (used by transactional tests and by
``flush`` in operations) deletes every row and then emits ``post_migrate`` —
without this the permission catalogue would disappear.
"""
from __future__ import annotations

from django.db import OperationalError, ProgrammingError

from .constants import PERMISSION_CATALOGUE, SYSTEM_DEPARTMENTS, SYSTEM_ROLES


def seed_catalogue() -> None:
    from .models import Department, Permission, Role, RolePermission

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
        permission, _ = Permission.objects.get_or_create(
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
        role, _ = Role.objects.get_or_create(
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


def seed_after_migrate(sender, app_config=None, using=None, **kwargs) -> None:
    """``post_migrate`` receiver: ensure the catalogue exists."""
    try:
        seed_catalogue()
    except (OperationalError, ProgrammingError):
        # Table not created yet (first migration pass) — the data migration
        # runs afterwards and seeds it.
        return
