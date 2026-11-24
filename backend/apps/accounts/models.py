"""Accounts app: custom User model with system roles.

Roles
-----
- ADMIN        : full operational access.
- CUTTING_MAN  : manages the cutting department only.
- OPERATOR     : manages the operator department only.

The model extends ``AbstractUser`` (custom user model from the start, as
required). Employees are deactivated (``is_active=False``) rather than deleted
so their historical production data is preserved.
"""
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils.translation import gettext_lazy as _

from common.models import TimeStampedUUIDModel


class Role(models.TextChoices):
    ADMIN = "ADMIN", _("Admin")
    CUTTING_MAN = "CUTTING_MAN", _("Cutting Man")
    OPERATOR = "OPERATOR", _("Operator")


class User(AbstractUser, TimeStampedUUIDModel):
    """System user / employee.

    Inherits username, password, email, first/last name, is_active, is_staff,
    is_superuser, date_joined, last_login from ``AbstractUser``.
    """

    full_name = models.CharField(max_length=150)
    employee_code = models.CharField(
        max_length=40,
        unique=True,
        help_text="Unique human-readable employee identifier.",
    )
    role = models.CharField(
        max_length=20,
        choices=Role.choices,
        default=Role.OPERATOR,
        db_index=True,
    )

    class Meta:
        ordering = ["full_name", "username"]
        constraints = [
            models.UniqueConstraint(
                fields=["employee_code"],
                name="uniq_user_employee_code",
            ),
        ]
        indexes = [
            models.Index(fields=["role", "is_active"]),
        ]

    def __str__(self) -> str:
        return f"{self.full_name} ({self.employee_code})"

    # -- Role helpers -------------------------------------------------------
    @property
    def is_admin(self) -> bool:
        return self.role == Role.ADMIN

    @property
    def is_cutting_man(self) -> bool:
        return self.role == Role.CUTTING_MAN

    @property
    def is_operator(self) -> bool:
        return self.role == Role.OPERATOR

    @property
    def is_employee(self) -> bool:
        """True for non-admin staff roles that perform production work."""
        return self.role in {Role.CUTTING_MAN, Role.OPERATOR}

    def clean(self) -> None:
        super().clean()
        # Normalise employee code casing to keep lookups predictable.
        if self.employee_code:
            self.employee_code = self.employee_code.strip().upper()

    def save(self, *args, **kwargs) -> None:
        if self.employee_code:
            self.employee_code = self.employee_code.strip().upper()
        super().save(*args, **kwargs)