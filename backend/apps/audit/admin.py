"""Audit log is intentionally NOT registered in Django Admin.

The trail is append-only and must not be editable or deletable through the
admin site (Phase 1 finding H-03 / H-05). Read access is provided by the
permission-gated API at ``/api/v1/audit-logs/``.
"""
