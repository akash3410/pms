"""Authentication primitives: identifier resolution and login throttling.

Login accepts an **email address** (preferred) or a username. The user model's
``USERNAME_FIELD`` stays ``username`` for migration safety (Phase 2 decision
D-2), but every new account is identified by its email.

All credential failures return one generic message so the endpoint cannot be
used to enumerate accounts.
"""
from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import AuthenticationFailed, Throttled

from .models import LoginAttempt

GENERIC_AUTH_ERROR = "Invalid credentials."

LOGIN_MAX_ATTEMPTS = 5
LOGIN_WINDOW = timedelta(minutes=15)
LOGIN_LOCKOUT = timedelta(minutes=15)


def client_ip(request) -> str:
    if request is None:
        return ""
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return (request.META.get("REMOTE_ADDR") or "")[:64]


def resolve_identifier(identifier: str):
    """Return the user for an email address or username (case-insensitive)."""
    identifier = (identifier or "").strip()
    if not identifier:
        return None
    user_model = get_user_model()
    user = user_model.objects.filter(email__iexact=identifier).first()
    if user is not None:
        return user
    return user_model.objects.filter(username__iexact=identifier).first()


def _window_filter(identifier: str, ip: str) -> Q:
    query = Q(identifier__iexact=identifier)
    if ip:
        query |= Q(ip=ip)
    return query


def assert_login_allowed(identifier: str, ip: str = "") -> None:
    """Raise ``Throttled`` once the failure budget for the window is spent."""
    since = timezone.now() - LOGIN_WINDOW
    failures = LoginAttempt.objects.filter(
        _window_filter(identifier, ip), successful=False, created_at__gte=since
    ).count()
    if failures >= LOGIN_MAX_ATTEMPTS:
        raise Throttled(
            wait=int(LOGIN_LOCKOUT.total_seconds()),
            detail="Too many failed sign-in attempts. Please try again later.",
        )


def record_attempt(identifier: str, ip: str = "", *, successful: bool) -> None:
    LoginAttempt.objects.create(
        identifier=(identifier or "")[:255], ip=ip or "", successful=successful
    )


def authenticate_credentials(identifier: str, password: str, *, request=None):
    """Authenticate by email or username, with throttling and verification gate.

    Raises ``AuthenticationFailed`` with a single generic message for every
    failure mode (unknown account, wrong password, inactive account, unverified
    email) so the response cannot be used for account enumeration.
    """
    ip = client_ip(request)
    identifier = (identifier or "").strip()
    if not identifier or not password:
        raise AuthenticationFailed(GENERIC_AUTH_ERROR)

    assert_login_allowed(identifier, ip)

    user = resolve_identifier(identifier)
    valid_password = user is not None and user.check_password(password)
    if (
        user is None
        or not valid_password
        or not user.is_active
        or (user.requires_email_verification and not user.is_email_verified)
    ):
        record_attempt(identifier, ip, successful=False)
        raise AuthenticationFailed(GENERIC_AUTH_ERROR)

    record_attempt(identifier, ip, successful=True)
    user.last_login = timezone.now()
    user.save(update_fields=["last_login"])
    return user
