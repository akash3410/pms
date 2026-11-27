"""Audit recording service.

Every security-sensitive mutation in the project funnels through
:func:`record`, so the trail has a single shape and a single place where
sensitive values must be redacted.
"""
from __future__ import annotations

import json
import uuid

from .models import AuditLog

# Keys that must never reach the audit trail in clear text.
_REDACTED_KEYS = {
    "password",
    "new_password",
    "current_password",
    "old_password",
    "token",
    "refresh",
    "access",
    "secret",
    "smtp_password",
    "password_env_value",
    "invitation_token",
    "reset_token",
}
_REDACTED = "***redacted***"


def _jsonable(value):
    """Return a JSON-serialisable copy of ``value`` (UUIDs/dates → strings)."""
    if value is None:
        return None
    return json.loads(json.dumps(value, default=str))


def _redact(value):
    if isinstance(value, dict):
        return {
            key: (_REDACTED if key.lower() in _REDACTED_KEYS else _redact(item))
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_redact(item) for item in value]
    return value


def client_ip(request) -> str:
    if request is None:
        return ""
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "") or ""


def record(
    *,
    actor,
    action: str,
    target=None,
    target_type: str = "",
    target_id: str = "",
    before=None,
    after=None,
    request=None,
    **metadata,
):
    """Create an immutable audit entry.

    ``target`` may be a model instance; its type label and primary key are
    derived automatically. Sensitive keys are redacted, never stored.
    """
    if target is not None:
        target_type = target_type or target._meta.label_lower
        target_id = target_id or str(target.pk)

    actor_label = ""
    if actor is not None and getattr(actor, "is_authenticated", False):
        actor_label = (
            getattr(actor, "employee_code", "")
            or getattr(actor, "username", "")
            or str(actor.pk)
        )
        user_id = actor.pk
    else:
        actor = None
        user_id = None

    if request is not None:
        metadata.setdefault("method", request.method)
        metadata.setdefault("path", request.path)
        ip = client_ip(request)
        if ip:
            metadata.setdefault("ip", ip)
        request_id = getattr(request, "request_id", "") or request.META.get(
            "HTTP_X_REQUEST_ID", ""
        )
    else:
        request_id = metadata.pop("request_id", "")

    if not request_id:
        request_id = uuid.uuid4().hex

    return AuditLog.objects.create(
        actor_id=user_id,
        actor_label=actor_label,
        action=action,
        target_type=target_type,
        target_id=str(target_id),
        before=_redact(_jsonable(before)),
        after=_redact(_jsonable(after)),
        metadata=_redact(_jsonable(metadata) or {}),
        request_id=request_id,
    )
