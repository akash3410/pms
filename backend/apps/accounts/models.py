"""Accounts app: user model, invitation workflow, and system configuration.

Transitional note
-----------------
``User.role`` is retained as a **legacy compatibility field** for the existing
API contract and for the 164 pre-existing tests. Authorization never reads it:
every access decision goes through :mod:`apps.rbac`. A post-save signal mirrors
the legacy value onto the equivalent system role and department membership so
existing clients keep working during the transition (see
``docs/rbac/phase-2-architecture.md`` decision D-1).
"""
from __future__ import annotations

from django.contrib.auth.models import AbstractUser
from django.contrib.auth.models import UserManager as DjangoUserManager
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from common.models import TimeStampedUUIDModel


class Role(models.TextChoices):
    """Legacy fixed roles (transitional — not used for authorization)."""

    ADMIN = "ADMIN", _("Admin")
    CUTTING_MAN = "CUTTING_MAN", _("Cutting Man")
    OPERATOR = "OPERATOR", _("Operator")


class UserManager(DjangoUserManager):
    """User manager that keeps ``createsuperuser`` usable (finding M-02)."""

    def create_superuser(self, username, email=None, password=None, **extra_fields):
        extra_fields.setdefault("role", Role.ADMIN)
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("full_name", extra_fields.get("full_name") or username)
        if not extra_fields.get("employee_code"):
            candidate = f"SU-{username}"[:40].upper()
            base, suffix = candidate, 1
            while User.objects.filter(employee_code=candidate).exists():
                suffix += 1
                candidate = f"{base[:36]}-{suffix}"
            extra_fields["employee_code"] = candidate
        return super().create_superuser(username, email, password, **extra_fields)


class User(AbstractUser, TimeStampedUUIDModel):
    """System user / employee.

    Inherits username, password, email, first/last name, is_active, is_staff,
    is_superuser, date_joined, last_login from ``AbstractUser``.
    """

    # ``email`` is the only extra prompt; ``create_superuser`` derives
    # ``full_name``/``employee_code`` so the command works non-interactively
    # (fixes Phase 1 finding M-02).
    REQUIRED_FIELDS = ["email"]

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
        help_text="Legacy fixed role. Authorization uses RBAC permissions instead.",
    )
    email_verified_at = models.DateTimeField(null=True, blank=True)
    requires_email_verification = models.BooleanField(
        default=False,
        help_text="Set for accounts created with an email that must verify it before login.",
    )

    objects = UserManager()

    class Meta:
        ordering = ["full_name", "username"]
        constraints = [
            models.UniqueConstraint(
                fields=["employee_code"],
                name="uniq_user_employee_code",
            ),
            # Unique email (case-insensitive) for login-capable accounts only.
            models.UniqueConstraint(
                Lower("email"),
                condition=~models.Q(email=""),
                name="uniq_user_email_ci",
            ),
        ]
        indexes = [
            models.Index(fields=["role", "is_active"]),
            models.Index(fields=["email"]),
        ]

    def __str__(self) -> str:
        return f"{self.full_name} ({self.employee_code})"

    # -- Legacy role helpers (kept for backwards compatibility) -------------
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

    @property
    def is_email_verified(self) -> bool:
        return self.email_verified_at is not None

    def mark_email_verified(self) -> None:
        self.email_verified_at = timezone.now()
        self.requires_email_verification = False
        self.save(
            update_fields=[
                "email_verified_at",
                "requires_email_verification",
                "updated_at",
            ]
        )

    def clean(self) -> None:
        super().clean()
        # Normalise employee code casing to keep lookups predictable.
        if self.employee_code:
            self.employee_code = self.employee_code.strip().upper()

    def save(self, *args, **kwargs) -> None:
        if self.employee_code:
            self.employee_code = self.employee_code.strip().upper()
        super().save(*args, **kwargs)


class InvitationStatus(models.TextChoices):
    PENDING = "PENDING", _("Pending")
    ACCEPTED = "ACCEPTED", _("Accepted")
    CANCELLED = "CANCELLED", _("Cancelled")
    EXPIRED = "EXPIRED", _("Expired")


class Invitation(TimeStampedUUIDModel):
    """Email invitation for a new (or existing) account.

    Only a SHA-256 hash of the token is stored. Expiry is snapshotted at
    creation, so changing the system setting never alters a live invitation.
    """

    email = models.EmailField(db_index=True)
    full_name = models.CharField(max_length=150, blank=True, default="")
    employee_code = models.CharField(max_length=40, blank=True, default="")
    user = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="invitations",
    )
    roles = models.ManyToManyField(
        "rbac.Role", blank=True, related_name="invitations"
    )
    status = models.CharField(
        max_length=12,
        choices=InvitationStatus.choices,
        default=InvitationStatus.PENDING,
        db_index=True,
    )
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField(db_index=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    last_sent_at = models.DateTimeField(null=True, blank=True)
    send_count = models.PositiveSmallIntegerField(default=0)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sent_invitations",
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["status", "expires_at"])]

    def __str__(self) -> str:
        return f"{self.email} ({self.status})"

    @property
    def is_expired(self) -> bool:
        return self.status == InvitationStatus.EXPIRED or (
            self.status == InvitationStatus.PENDING and self.expires_at <= timezone.now()
        )


class TokenPurpose(models.TextChoices):
    PASSWORD_RESET = "PASSWORD_RESET", _("Password reset")
    EMAIL_VERIFICATION = "EMAIL_VERIFICATION", _("Email verification")


class OneTimeToken(TimeStampedUUIDModel):
    """Single-use, time-limited token (only its hash is stored)."""

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="one_time_tokens"
    )
    purpose = models.CharField(max_length=24, choices=TokenPurpose.choices)
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField(db_index=True)
    used_at = models.DateTimeField(null=True, blank=True)
    request_id = models.CharField(max_length=64, blank=True, default="")

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "purpose", "used_at"])]

    def __str__(self) -> str:
        return f"{self.purpose} for {self.user_id}"

    @property
    def is_usable(self) -> bool:
        return self.used_at is None and self.expires_at > timezone.now()


class LoginAttempt(models.Model):
    """One authentication attempt, for throttling and security review."""

    id = models.BigAutoField(primary_key=True)
    identifier = models.CharField(max_length=255, db_index=True)
    ip = models.CharField(max_length=64, blank=True, default="")
    successful = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["identifier", "created_at"])]

    def __str__(self) -> str:
        return f"{self.identifier} {'ok' if self.successful else 'fail'}"


class SystemSetting(models.Model):
    """Key/value system configuration (superuser-managed)."""

    key = models.CharField(max_length=80, unique=True)
    value = models.JSONField()
    updated_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["key"]

    def __str__(self) -> str:
        return self.key


class EmailConfiguration(TimeStampedUUIDModel):
    """Singleton email transport configuration (non-secret fields only).

    The SMTP password is **never** stored here. It is read from the environment
    variable named by ``password_env_var`` at send time (Phase 2 decision D-8 /
    PD-1).
    """

    SINGLETON_ID = "00000000-0000-0000-0000-00000000e001"

    host = models.CharField(max_length=255, blank=True, default="")
    port = models.PositiveIntegerField(default=587)
    username = models.CharField(max_length=255, blank=True, default="")
    from_email = models.EmailField(blank=True, default="")
    use_tls = models.BooleanField(default=True)
    use_ssl = models.BooleanField(default=False)
    timeout = models.PositiveSmallIntegerField(default=10)
    is_active = models.BooleanField(default=False)
    password_env_var = models.CharField(max_length=80, default="EMAIL_HOST_PASSWORD")
    updated_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        verbose_name = "Email configuration"
        verbose_name_plural = "Email configuration"

    def __str__(self) -> str:
        return f"Email config ({self.host or 'not configured'})"

    @classmethod
    def load(cls) -> EmailConfiguration:
        config, _ = cls.objects.get_or_create(pk=cls.SINGLETON_ID)
        return config
