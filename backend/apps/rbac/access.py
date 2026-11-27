"""Effective-access resolution: the single authority for authorization.

Everything is read from the database on every request (memoised per request
object only), so any change to a role, permission, assignment, restriction,
department membership or reassignment is effective on the next request. No
authorization data is cached across requests and none is embedded in the JWT.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from django.db.models import Q, QuerySet

from .models import RolePermission, UserScopeRestriction
from .scopes import build_scope_q


@dataclass(frozen=True)
class Grant:
    scope: str
    options: dict = field(default_factory=dict)


class EffectiveAccess:
    """Resolved authorization state for one user."""

    def __init__(self, user):
        self.user = user
        self._loaded = False
        self._superuser = False
        self._grants: dict[str, list[Grant]] = {}
        self._restrictions: dict[str, Grant] = {}

    # -- loading ---------------------------------------------------------
    def _load(self) -> None:
        if self._loaded:
            return
        self._loaded = True

        user = self.user
        if (
            user is None
            or not getattr(user, "is_authenticated", False)
            or not getattr(user, "is_active", False)
        ):
            return

        if getattr(user, "is_superuser", False):
            self._superuser = True
            return

        rows = RolePermission.objects.filter(
            role__user_assignments__user=user,
            role__user_assignments__revoked_at__isnull=True,
            role__is_active=True,
            permission__is_active=True,
        ).select_related("permission")

        for row in rows:
            self._grants.setdefault(row.permission.key, []).append(
                Grant(scope=row.scope, options=row.options or {})
            )

        for restriction in UserScopeRestriction.objects.filter(
            user=user, permission__is_active=True
        ).select_related("permission"):
            self._restrictions[restriction.permission.key] = Grant(
                scope=restriction.scope, options=restriction.options or {}
            )

    # -- queries ---------------------------------------------------------
    @property
    def is_superuser(self) -> bool:
        self._load()
        return self._superuser

    def permission_keys(self) -> frozenset[str]:
        self._load()
        return frozenset(self._grants)

    def grants(self) -> dict[str, list[Grant]]:
        self._load()
        return self._grants

    def restrictions(self) -> dict[str, Grant]:
        self._load()
        return self._restrictions

    def has_permission(self, permission_key: str) -> bool:
        self._load()
        if self._superuser:
            return True
        return permission_key in self._grants

    def has_scope(self, permission_key: str, scope: str) -> bool:
        """True if any granted role carries exactly ``scope`` for the key."""
        self._load()
        if self._superuser:
            return True
        return any(
            grant.scope == scope for grant in self._grants.get(permission_key, ())
        )

    def filter_queryset(self, permission_key: str, queryset: QuerySet) -> QuerySet:
        """Return only the rows the user may act on for ``permission_key``."""
        self._load()
        if self._superuser:
            return queryset

        module = permission_key.split(".", 1)[0]
        grants = self._grants.get(permission_key)
        if not grants:
            return queryset.none()

        # 1) Union of the role-derived scopes. ``None`` means "all rows".
        if all(grant.scope == "ALL" for grant in grants):
            scoped = queryset
        else:
            combined: Q | None = None
            for grant in grants:
                query = build_scope_q(module, grant.scope, grant.options, self.user)
                if query is None:  # ALL scope in the union -> no restriction
                    combined = None
                    break
                combined = query if combined is None else combined | query
            scoped = queryset if combined is None else queryset.filter(combined)

        # 2) User-level restrictions: extra AND filters, never OR -> cannot expand.
        restriction = self._restrictions.get(permission_key)
        if restriction is not None:
            query = build_scope_q(
                module, restriction.scope, restriction.options, self.user
            )
            if query is not None:
                scoped = scoped.filter(query)
        return scoped

    def has_object_permission(self, permission_key: str, obj) -> bool:
        if obj is None:
            return False
        self._load()
        if self._superuser:
            return True
        if not self.has_permission(permission_key):
            return False
        model = type(obj)
        return (
            self.filter_queryset(permission_key, model._default_manager.all())
            .filter(pk=obj.pk)
            .exists()
        )

    def snapshot(self) -> dict:
        """JSON-safe description of effective access (for API responses/audit)."""
        self._load()
        if self._superuser:
            return {"superuser": True, "permissions": {}, "restrictions": {}}
        return {
            "superuser": False,
            "permissions": {
                key: [
                    {"scope": grant.scope, "options": grant.options}
                    for grant in grants
                ]
                for key, grants in sorted(self._grants.items())
            },
            "restrictions": {
                key: {"scope": grant.scope, "options": grant.options}
                for key, grant in sorted(self._restrictions.items())
            },
        }


def get_access(request) -> EffectiveAccess:
    """Memoise :class:`EffectiveAccess` on the request object."""
    access = getattr(request, "_rbac_access", None)
    if access is None:
        access = EffectiveAccess(getattr(request, "user", None))
        request._rbac_access = access
    return access


def effective_permission_keys(user) -> frozenset[str]:
    return EffectiveAccess(user).permission_keys()
