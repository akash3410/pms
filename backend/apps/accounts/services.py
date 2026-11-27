"""Account security services: passwords, verification, invitations, settings.

Raw tokens are generated here, sent by email, and never persisted or logged —
only their SHA-256 hash is stored. Email configuration holds no secrets: the
SMTP password is read from the environment at send time.
"""
from __future__ import annotations

import hashlib
import os
import re
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import get_connection, send_mail
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import Throttled, ValidationError

from apps.audit.services import record

from .models import (
    EmailConfiguration,
    Invitation,
    InvitationStatus,
    OneTimeToken,
    SystemSetting,
    TokenPurpose,
)

#: Hard system maximum for invitation lifetime (7 days).
MAX_INVITATION_HOURS = 168
DEFAULT_INVITATION_HOURS = 72
INVITATION_HOURS_KEY = "invitation_expiry_hours"
RESET_TOKEN_TTL = timedelta(hours=1)
VERIFICATION_TOKEN_TTL = timedelta(days=3)
RESET_REQUESTS_PER_HOUR = 3


def rbac_services():
    """Late import of the RBAC service module (avoids an import cycle)."""
    from apps.rbac import services as rbac

    return rbac


# --------------------------------------------------------------------------- #
# Tokens
# --------------------------------------------------------------------------- #
def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def new_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(32)
    return raw, hash_token(raw)


def _issue_token(user, purpose: str, ttl: timedelta) -> str:
    raw, token_hash = new_token()
    # Invalidate previously issued, unused tokens of the same purpose.
    OneTimeToken.objects.filter(
        user=user, purpose=purpose, used_at__isnull=True
    ).update(used_at=timezone.now())
    OneTimeToken.objects.create(
        user=user, purpose=purpose, token_hash=token_hash,
        expires_at=timezone.now() + ttl,
    )
    return raw


def _consume_token(raw: str, purpose: str) -> OneTimeToken:
    if not raw:
        raise ValidationError({"token": "Invalid or expired token."})
    token = OneTimeToken.objects.filter(
        token_hash=hash_token(raw), purpose=purpose
    ).select_related("user").first()
    if token is None or token.used_at is not None:
        raise ValidationError({"token": "Invalid or expired token."})
    if token.expires_at <= timezone.now():
        raise ValidationError({"token": "Invalid or expired token."})
    return token


# --------------------------------------------------------------------------- #
# Settings
# --------------------------------------------------------------------------- #
def get_setting(key: str, default=None):
    row = SystemSetting.objects.filter(key=key).first()
    return default if row is None else row.value


def set_setting(actor, key: str, value, *, request=None) -> SystemSetting:
    before = get_setting(key)
    row, _ = SystemSetting.objects.update_or_create(
        key=key, defaults={"value": value, "updated_by": actor}
    )
    record(
        actor=actor,
        action="system_setting.updated",
        target_type="accounts.systemsetting",
        target_id=key,
        before={"value": before},
        after={"value": value},
        request=request,
    )
    return row


def invitation_expiry_hours() -> int:
    raw = get_setting(INVITATION_HOURS_KEY, DEFAULT_INVITATION_HOURS)
    try:
        hours = int(raw)
    except (TypeError, ValueError):
        hours = DEFAULT_INVITATION_HOURS
    if hours < 1:
        hours = DEFAULT_INVITATION_HOURS
    return min(hours, MAX_INVITATION_HOURS)


def require_email_verification() -> bool:
    return bool(get_setting("require_email_verification", False))


# --------------------------------------------------------------------------- #
# Email transport
# --------------------------------------------------------------------------- #
def email_connection():
    config = EmailConfiguration.load()
    if config.is_active and config.host:
        return get_connection(
            backend="django.core.mail.backends.smtp.EmailBackend",
            host=config.host,
            port=config.port,
            username=config.username,
            password=os.environ.get(config.password_env_var, ""),
            use_tls=config.use_tls,
            use_ssl=config.use_ssl,
            timeout=config.timeout,
        )
    return get_connection()


def send_email(subject: str, body: str, recipients: list[str]) -> None:
    config = EmailConfiguration.load()
    sender = config.from_email or getattr(
        settings, "DEFAULT_FROM_EMAIL", "no-reply@localhost"
    )
    send_mail(
        subject,
        body,
        sender,
        recipients,
        connection=email_connection(),
        fail_silently=False,
    )


def _action_url(path: str, token: str) -> str:
    base = getattr(settings, "FRONTEND_URL", "") or "http://localhost:3000"
    return f"{base.rstrip('/')}{path}?token={token}"


# --------------------------------------------------------------------------- #
# Password change / reset
# --------------------------------------------------------------------------- #
def _validate_password(password: str, user=None) -> None:
    try:
        validate_password(password, user=user)
    except DjangoValidationError as exc:
        raise ValidationError({"new_password": list(exc.messages)}) from None


@transaction.atomic
def change_password(user, *, current_password: str, new_password: str, request=None):
    if not user.check_password(current_password):
        raise ValidationError({"current_password": "Current password is incorrect."})
    if current_password == new_password:
        raise ValidationError(
            {"new_password": "The new password must differ from the current one."}
        )
    _validate_password(new_password, user)
    user.set_password(new_password)
    user.save(update_fields=["password", "updated_at"])
    record(
        actor=user, action="auth.password_changed", target=user, request=request
    )
    return user


def request_password_reset(email: str, *, request=None) -> None:
    """Send a reset link if the account exists; always silent otherwise."""
    email = (email or "").strip()
    if not email:
        return

    # Throttle per identifier; do not reveal whether the account exists.
    from .models import LoginAttempt

    since = timezone.now() - timedelta(hours=1)
    key = f"password-reset:{email.lower()}"
    if (
        LoginAttempt.objects.filter(
            identifier=key, created_at__gte=since, successful=True
        ).count()
        >= RESET_REQUESTS_PER_HOUR
    ):
        raise Throttled(detail="Too many password reset requests. Try again later.")
    LoginAttempt.objects.create(identifier=key, successful=True)

    user = get_user_model().objects.filter(email__iexact=email, is_active=True).first()
    if user is None:
        return
    raw = _issue_token(user, TokenPurpose.PASSWORD_RESET, RESET_TOKEN_TTL)
    send_email(
        "Reset your POMS password",
        "Use the link below to choose a new password. It expires in one hour "
        "and can be used once.\n\n"
        f"{_action_url('/reset-password', raw)}\n\n"
        "If you did not request this, no action is required.",
        [user.email],
    )
    record(
        actor=user,
        action="auth.password_reset_requested",
        target=user,
        request=request,
    )


@transaction.atomic
def reset_password(raw_token: str, new_password: str, *, request=None):
    token = _consume_token(raw_token, TokenPurpose.PASSWORD_RESET)
    user = token.user
    if not user.is_active:
        raise ValidationError({"token": "Invalid or expired token."})
    _validate_password(new_password, user)
    user.set_password(new_password)
    user.save(update_fields=["password", "updated_at"])
    token.used_at = timezone.now()
    token.save(update_fields=["used_at", "updated_at"])
    _blacklist_refresh_tokens(user)
    record(actor=user, action="auth.password_reset", target=user, request=request)
    return user


def _blacklist_refresh_tokens(user) -> None:
    from rest_framework_simplejwt.token_blacklist.models import (
        BlacklistedToken,
        OutstandingToken,
    )

    for outstanding in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=outstanding)


# --------------------------------------------------------------------------- #
# Email verification
# --------------------------------------------------------------------------- #
def send_email_verification(user, *, request=None) -> None:
    if not user.email:
        raise ValidationError({"email": "This account has no email address."})
    raw = _issue_token(user, TokenPurpose.EMAIL_VERIFICATION, VERIFICATION_TOKEN_TTL)
    send_email(
        "Verify your POMS email address",
        "Confirm your email address with the link below. It expires in three "
        "days and can be used once.\n\n"
        f"{_action_url('/verify-email', raw)}",
        [user.email],
    )
    record(
        actor=user, action="auth.email_verification_sent", target=user, request=request
    )


@transaction.atomic
def verify_email(raw_token: str, *, request=None):
    token = _consume_token(raw_token, TokenPurpose.EMAIL_VERIFICATION)
    user = token.user
    user.email_verified_at = timezone.now()
    user.requires_email_verification = False
    user.save(
        update_fields=["email_verified_at", "requires_email_verification", "updated_at"]
    )
    token.used_at = timezone.now()
    token.save(update_fields=["used_at", "updated_at"])
    record(actor=user, action="auth.email_verified", target=user, request=request)
    return user


# --------------------------------------------------------------------------- #
# Invitations
# --------------------------------------------------------------------------- #
def _username_for_email(email: str) -> str:
    user_model = get_user_model()
    base = re.sub(r"[^A-Za-z0-9._+-]", "", email.split("@")[0]) or "user"
    candidate, suffix = base, 1
    while user_model.objects.filter(username__iexact=candidate).exists():
        suffix += 1
        candidate = f"{base}{suffix}"
    return candidate


@transaction.atomic
def create_invitation(
    actor,
    *,
    email: str,
    full_name: str = "",
    employee_code: str = "",
    role_ids: list | None = None,
    request=None,
) -> tuple[Invitation, str]:
    email = (email or "").strip().lower()
    if not email:
        raise ValidationError({"email": "Email is required."})
    user_model = get_user_model()
    if user_model.objects.filter(email__iexact=email).exists():
        raise ValidationError({"email": "An account with this email already exists."})
    if Invitation.objects.filter(
        email__iexact=email, status=InvitationStatus.PENDING
    ).exists():
        raise ValidationError(
            {"email": "A pending invitation already exists for this email."}
        )

    from apps.rbac.models import Role

    raw, token_hash = new_token()
    invitation = Invitation.objects.create(
        email=email,
        full_name=full_name,
        employee_code=(employee_code or "").strip().upper(),
        token_hash=token_hash,
        expires_at=timezone.now() + timedelta(hours=invitation_expiry_hours()),
        created_by=actor,
        last_sent_at=timezone.now(),
        send_count=1,
    )
    if role_ids:
        roles = list(Role.objects.filter(pk__in=role_ids, is_active=True))
        invitation.roles.set(roles)

    send_email(
        "You are invited to POMS",
        "An account has been created for you. Set your password with the link "
        "below. It can be used once and expires on "
        f"{invitation.expires_at:%Y-%m-%d %H:%M} UTC.\n\n"
        f"{_action_url('/accept-invitation', raw)}",
        [invitation.email],
    )
    record(
        actor=actor,
        action="invitation.created",
        target=invitation,
        after={
            "email": invitation.email,
            "roles": [role.code for role in invitation.roles.all()],
            "expires_at": invitation.expires_at,
        },
        request=request,
    )
    return invitation, raw


@transaction.atomic
def resend_invitation(actor, invitation: Invitation, *, request=None) -> tuple[Invitation, str]:
    invitation = Invitation.objects.select_for_update().get(pk=invitation.pk)
    if invitation.status != InvitationStatus.PENDING:
        raise ValidationError({"detail": "Only pending invitations can be resent."})
    if invitation.expires_at <= timezone.now():
        invitation.status = InvitationStatus.EXPIRED
        invitation.save(update_fields=["status", "updated_at"])
        raise ValidationError({"detail": "This invitation has expired. Create a new one."})

    raw, token_hash = new_token()
    invitation.token_hash = token_hash
    invitation.last_sent_at = timezone.now()
    invitation.send_count += 1
    invitation.save(
        update_fields=["token_hash", "last_sent_at", "send_count", "updated_at"]
    )
    send_email(
        "Your POMS invitation",
        "Set your password with the link below. It can be used once and expires "
        f"on {invitation.expires_at:%Y-%m-%d %H:%M} UTC.\n\n"
        f"{_action_url('/accept-invitation', raw)}",
        [invitation.email],
    )
    record(
        actor=actor,
        action="invitation.resent",
        target=invitation,
        after={"send_count": invitation.send_count},
        request=request,
    )
    return invitation, raw


@transaction.atomic
def cancel_invitation(actor, invitation: Invitation, *, request=None) -> Invitation:
    invitation = Invitation.objects.select_for_update().get(pk=invitation.pk)
    if invitation.status != InvitationStatus.PENDING:
        raise ValidationError({"detail": "Only pending invitations can be cancelled."})
    invitation.status = InvitationStatus.CANCELLED
    invitation.cancelled_at = timezone.now()
    invitation.save(update_fields=["status", "cancelled_at", "updated_at"])
    record(actor=actor, action="invitation.cancelled", target=invitation, request=request)
    return invitation


def accept_invitation(raw_token: str, password: str, *, request=None):
    if not raw_token:
        raise ValidationError({"token": "Invalid or expired invitation."})
    invitation = Invitation.objects.filter(token_hash=hash_token(raw_token)).first()
    if invitation is None:
        raise ValidationError({"token": "Invalid or expired invitation."})
    if invitation.status != InvitationStatus.PENDING:
        raise ValidationError({"token": "This invitation can no longer be used."})
    if invitation.expires_at <= timezone.now():
        # Persist the expiry state; deliberately outside the transaction that
        # raises, so the status change is not rolled back.
        Invitation.objects.filter(pk=invitation.pk).update(
            status=InvitationStatus.EXPIRED, updated_at=timezone.now()
        )
        raise ValidationError({"token": "This invitation has expired."})

    with transaction.atomic():
        invitation = Invitation.objects.select_for_update().get(pk=invitation.pk)
        if invitation.status != InvitationStatus.PENDING:
            raise ValidationError({"token": "This invitation can no longer be used."})
        return _accept_locked(invitation, password, request=request)


def _accept_locked(invitation: Invitation, password: str, *, request=None):
    user_model = get_user_model()
    user = invitation.user
    if user is None:
        user = user_model(
            username=_username_for_email(invitation.email),
            email=invitation.email,
            full_name=invitation.full_name or invitation.email.split("@")[0],
            employee_code=invitation.employee_code,
            role="OPERATOR",
        )
        if not user.employee_code:
            user.employee_code = f"INV-{secrets.token_hex(3).upper()}"
    _validate_password(password, user)
    user.set_password(password)
    user.is_active = True
    user.email_verified_at = timezone.now()
    user.requires_email_verification = False
    user.save()

    from apps.rbac.models import UserRole

    for role in invitation.roles.filter(is_active=True):
        if not UserRole.objects.filter(
            user=user, role=role, revoked_at__isnull=True
        ).exists():
            UserRole.objects.create(
                user=user, role=role, assigned_by=invitation.created_by
            )

    invitation.user = user
    invitation.status = InvitationStatus.ACCEPTED
    invitation.accepted_at = timezone.now()
    invitation.save(update_fields=["user", "status", "accepted_at", "updated_at"])

    record(
        actor=user,
        action="invitation.accepted",
        target=invitation,
        after={"email": invitation.email, "user": str(user.pk)},
        request=request,
    )
    return user


# --------------------------------------------------------------------------- #
# Employee account creation
# --------------------------------------------------------------------------- #
@transaction.atomic
def create_employee_account(actor, *, data: dict, request=None):
    """Create an employee/user account with full password validation.

    Fixes Phase 1 finding H-02 (validators were bypassed).
    """
    user_model = get_user_model()
    password = data.pop("password")
    email = (data.get("email") or "").strip()
    role = data.get("role") or "OPERATOR"

    # Creating an account with an elevated legacy role is a role assignment in
    # disguise (the legacy value is bridged into a system role).
    if role != "OPERATOR" and actor is not None:
        from rest_framework.exceptions import PermissionDenied

        from apps.rbac.access import get_access

        access = get_access(actor)
        if not (
            access.has_permission("users.manage_users")
            and access.has_scope("users.manage_users", "ALL")
        ):
            raise PermissionDenied(
                "Creating an account with this role requires user-management "
                "permission."
            )

    candidate = user_model(
        username=data["username"],
        email=email,
        full_name=data["full_name"],
        employee_code=data["employee_code"],
        role=role,
        is_active=data.get("is_active", True),
    )
    _validate_password(password, candidate)

    # Accounts created with an email verify it before they can sign in
    # (Phase 2 PD-2). Accounts without an email are unaffected.
    candidate.requires_email_verification = bool(email)
    candidate.set_password(password)
    candidate.save()

    record(
        actor=actor,
        action="user.created",
        target=candidate,
        after={
            "username": candidate.username,
            "email": candidate.email,
            "employee_code": candidate.employee_code,
            "role": candidate.role,
            "is_active": candidate.is_active,
        },
        request=request,
    )

    if candidate.email and candidate.requires_email_verification:
        send_email_verification(candidate, request=request)

    return candidate
