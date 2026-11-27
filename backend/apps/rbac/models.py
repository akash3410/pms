"""Dynamic RBAC models: permissions, roles, assignments, scopes, departments.

Design invariants (see ``docs/rbac/phase-2-architecture.md``):

* Permissions are never granted to a user directly — only through roles.
* A user may hold many roles; effective permissions are the union across active
  role assignments.
* Scope is configured per ``(role, permission)``; a user-level restriction can
  only narrow the result.
* History is preserved: role assignments are revoked, department memberships
  are ended, and rows are never hard-deleted while they carry history.
"""
from __future__ import annotations

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from common.models import TimeStampedUUIDModel

from .constants import SCOPE_MODULES, SCOPE_TYPES, SYSTEM_PERMISSION_PREFIX


class ScopeType(models.TextChoices):
    ALL = "ALL", "All"
    ASSIGNED = "ASSIGNED", "Assigned"
    CREATED_BY_ME = "CREATED_BY_ME", "Created by me"
    DEPARTMENT = "DEPARTMENT", "Department"
    OWN_PROFILE = "OWN_PROFILE", "Own profile"


class Department(TimeStampedUUIDModel):
    """A business department used for relational data scoping."""

    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=80)
    description = models.TextField(blank=True, default="")
    is_production = models.BooleanField(
        default=True,
        help_text="Production departments can be used for order assignments.",
    )
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "Department"
        verbose_name_plural = "Departments"

    def __str__(self) -> str:
        return f"{self.name} ({self.code})"

    def save(self, *args, **kwargs) -> None:
        self.code = (self.code or "").strip().upper()
        super().save(*args, **kwargs)


class Permission(models.Model):
    """A catalogue entry describing one enforceable capability."""

    key = models.CharField(max_length=120, unique=True)
    module = models.CharField(max_length=40, db_index=True)
    action = models.CharField(max_length=60)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True, default="")
    supported_scopes = models.JSONField(default=list, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    is_system = models.BooleanField(
        default=True,
        help_text="Seeded from code; its key cannot be changed.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["module", "action"]
        indexes = [models.Index(fields=["module", "is_active"])]

    def __str__(self) -> str:
        return self.key

    def save(self, *args, **kwargs) -> None:
        if "." in self.key:
            module, _, action = self.key.partition(".")
            self.module = module
            self.action = action
        super().save(*args, **kwargs)

    @property
    def is_system_level(self) -> bool:
        return self.key.startswith(SYSTEM_PERMISSION_PREFIX)

    def clean(self) -> None:
        super().clean()
        if "." not in self.key:
            raise ValidationError({"key": "Permission key must be 'module.action'."})
        module, _, action = self.key.partition(".")
        if module not in SCOPE_MODULES:
            raise ValidationError({"key": f"Unknown permission module '{module}'."})
        invalid = [s for s in self.supported_scopes if s not in SCOPE_TYPES]
        if invalid:
            raise ValidationError(
                {"supported_scopes": f"Unsupported scope types: {', '.join(invalid)}."}
            )
        if not self.supported_scopes:
            raise ValidationError(
                {"supported_scopes": "At least one supported scope type is required."}
            )


class Role(TimeStampedUUIDModel):
    """A business role. Names, descriptions and status are data."""

    code = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=80)
    description = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True, db_index=True)
    is_system = models.BooleanField(
        default=False,
        help_text="Seeded from code; cannot be deleted or re-coded.",
    )

    class Meta:
        ordering = ["name"]
        indexes = [models.Index(fields=["is_active"])]

    def __str__(self) -> str:
        return self.name

    def save(self, *args, **kwargs) -> None:
        self.code = (self.code or "").strip().upper()
        super().save(*args, **kwargs)

    def permission_keys(self) -> set[str]:
        return set(
            self.permission_links.filter(permission__is_active=True).values_list(
                "permission__key", flat=True
            )
        )


class RolePermission(TimeStampedUUIDModel):
    """Grants one permission to one role with a single data scope."""

    role = models.ForeignKey(
        Role, on_delete=models.CASCADE, related_name="permission_links"
    )
    permission = models.ForeignKey(
        Permission, on_delete=models.CASCADE, related_name="role_links"
    )
    scope = models.CharField(max_length=20, choices=ScopeType.choices)
    options = models.JSONField(
        default=dict,
        blank=True,
        help_text='Scope options, e.g. {"assignment_types": ["CUTTING"]}.',
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    class Meta:
        ordering = ["permission__module", "permission__action"]
        constraints = [
            models.UniqueConstraint(
                fields=["role", "permission"], name="uniq_role_permission"
            )
        ]

    def __str__(self) -> str:
        return f"{self.role.code}:{self.permission.key}={self.scope}"

    def clean(self) -> None:
        super().clean()
        if self.permission_id and self.permission.is_system_level:
            raise ValidationError(
                {
                    "permission": (
                        "System-level permissions cannot be granted to a business "
                        "role. They are reserved for superusers."
                    )
                }
            )
        if self.permission_id and self.scope not in (
            self.permission.supported_scopes or []
        ):
            raise ValidationError(
                {
                    "scope": (
                        f"Scope '{self.scope}' is not supported by "
                        f"'{self.permission.key}'."
                    )
                }
            )
        if not isinstance(self.options, dict):
            raise ValidationError({"options": "Options must be an object."})


class UserRole(TimeStampedUUIDModel):
    """Assignment of a role to a user. Revoked, never deleted."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="role_assignments",
    )
    role = models.ForeignKey(
        Role, on_delete=models.PROTECT, related_name="user_assignments"
    )
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    revoked_at = models.DateTimeField(null=True, blank=True, db_index=True)
    revoked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "role"],
                condition=models.Q(revoked_at__isnull=True),
                name="uniq_live_user_role",
            )
        ]
        indexes = [models.Index(fields=["user", "revoked_at"])]

    def __str__(self) -> str:
        return f"{self.user_id} -> {self.role_id}"

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None


class UserScopeRestriction(TimeStampedUUIDModel):
    """Restrict-only, per-permission scope override for one user.

    Applied as an additional ``AND`` filter on top of the role-derived scope
    union, so it can never expand access.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="scope_restrictions",
    )
    permission = models.ForeignKey(
        Permission, on_delete=models.CASCADE, related_name="user_restrictions"
    )
    scope = models.CharField(max_length=20, choices=ScopeType.choices)
    options = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    class Meta:
        ordering = ["permission__module", "permission__action"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "permission"], name="uniq_user_scope_restriction"
            )
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.permission.key}={self.scope}"

    def clean(self) -> None:
        super().clean()
        if self.permission_id and self.scope not in (
            self.permission.supported_scopes or []
        ):
            raise ValidationError(
                {
                    "scope": (
                        f"Scope '{self.scope}' is not supported by "
                        f"'{self.permission.key}'."
                    )
                }
            )


class DepartmentMembership(TimeStampedUUIDModel):
    """Historical membership of a user in a department."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="department_memberships",
    )
    department = models.ForeignKey(
        Department, on_delete=models.PROTECT, related_name="memberships"
    )
    is_primary = models.BooleanField(default=False)
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    ended_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ["-is_primary", "department__name"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "department"],
                condition=models.Q(ended_at__isnull=True),
                name="uniq_live_department_membership",
            ),
            models.UniqueConstraint(
                fields=["user"],
                condition=models.Q(is_primary=True, ended_at__isnull=True),
                name="uniq_primary_department_per_user",
            ),
        ]
        indexes = [models.Index(fields=["department", "ended_at"])]

    def __str__(self) -> str:
        return f"{self.user_id}@{self.department_id}"

    @property
    def is_active(self) -> bool:
        return self.ended_at is None
