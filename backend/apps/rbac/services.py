"""Service layer for RBAC lifecycle, assignment, and administrative safeguards.

All multi-step security changes run inside ``transaction.atomic`` and take row
locks on the affected user/role before validating, so concurrent requests cannot
both pass a safety check. Every mutation is audited.
"""
from __future__ import annotations

from django.apps import apps as django_apps
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from apps.audit.services import record

from .access import effective_permission_keys
from .constants import (
    MANAGEMENT_PERMISSION_KEYS,
    SYSTEM_DEPARTMENTS,
    SYSTEM_ROLE_CODES,
    SYSTEM_ROLES,
)
from .models import (
    Department,
    DepartmentMembership,
    Permission,
    Role,
    RolePermission,
    UserRole,
    UserScopeRestriction,
)


class PolicyConflict(APIException):
    """A safeguard refuses the change (HTTP 409)."""

    status_code = status.HTTP_409_CONFLICT
    default_detail = "This change would violate an administrative safeguard."
    default_code = "policy_conflict"


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _get_user_model():
    return django_apps.get_model("accounts", "User")


def get_user(user_id):
    try:
        return _get_user_model().objects.get(pk=user_id)
    except (_get_user_model().DoesNotExist, ValueError, TypeError):
        raise ValidationError({"user": "User not found."}) from None


def _role_snapshot(role: Role) -> dict:
    return {
        link.permission.key: {"scope": link.scope, "options": link.options or {}}
        for link in role.permission_links.select_related("permission")
    }


def _user_role_snapshot(user) -> list[dict]:
    return [
        {"role": assignment.role.code, "assigned_at": assignment.created_at}
        for assignment in UserRole.objects.filter(
            user=user, revoked_at__isnull=True
        ).select_related("role")
    ]


def _has_manager(*, exclude_user_id=None) -> bool:
    """True if some active account can still manage roles and permissions."""
    user_model = _get_user_model()
    superusers = user_model.objects.filter(is_superuser=True, is_active=True)
    if exclude_user_id:
        superusers = superusers.exclude(pk=exclude_user_id)
    if superusers.exists():
        return True

    holders = user_model.objects.filter(
        is_active=True,
        role_assignments__revoked_at__isnull=True,
        role_assignments__role__is_active=True,
        role_assignments__role__permission_links__permission__is_active=True,
        role_assignments__role__permission_links__permission__key__in=(
            MANAGEMENT_PERMISSION_KEYS
        ),
    )
    if exclude_user_id:
        holders = holders.exclude(pk=exclude_user_id)
    return holders.exists()


def _assert_actor_retains_management(actor, before_keys: frozenset[str]) -> None:
    """Refuse a self-change that strips the actor's last management permission."""
    if actor is None or getattr(actor, "is_superuser", False):
        return
    if not (before_keys & MANAGEMENT_PERMISSION_KEYS):
        return
    if not (effective_permission_keys(actor) & MANAGEMENT_PERMISSION_KEYS):
        raise PolicyConflict(
            "This change would remove your own last role-management permission. "
            "Grant the capability to another administrator first."
        )


def _assert_target_not_stranded(target) -> None:
    """Refuse a change that would leave another admin with no management ability."""
    if target is None or getattr(target, "is_superuser", False):
        return
    if effective_permission_keys(target) & MANAGEMENT_PERMISSION_KEYS:
        return
    if _has_manager(exclude_user_id=target.pk):
        return
    raise PolicyConflict(
        "This change would leave no active account able to manage roles and "
        "permissions."
    )


def _actor_is_superuser(actor) -> bool:
    return bool(actor is not None and getattr(actor, "is_superuser", False))


# --------------------------------------------------------------------------- #
# Legacy bridge (transitional)
# --------------------------------------------------------------------------- #
@transaction.atomic
def sync_legacy_role(user, legacy_role: str | None = None, *, actor=None) -> None:
    """Mirror the legacy ``User.role`` value onto system roles and departments.

    This is a *data bridge*, not an authorization rule: no permission check reads
    ``User.role``. It exists so that legacy accounts, fixtures and clients that
    still send ``role`` keep exactly the access they had, while authorization
    itself is permission-based.
    """
    legacy = legacy_role if legacy_role is not None else getattr(user, "role", None)
    if not legacy:
        return
    spec = SYSTEM_ROLES.get(legacy)
    if spec is None:
        return
    role = Role.objects.filter(code=legacy, is_system=True).first()
    if role is None:  # catalogue not seeded (e.g. during initial migrate)
        return

    now = timezone.now()

    live_system_roles = UserRole.objects.filter(
        user=user, revoked_at__isnull=True, role__is_system=True
    ).exclude(role=role)
    live_system_roles.update(revoked_at=now, revoked_by=actor)

    if not UserRole.objects.filter(
        user=user, role=role, revoked_at__isnull=True
    ).exists():
        UserRole.objects.create(user=user, role=role, assigned_by=actor)

    desired = set(spec.get("departments", ()))
    memberships = DepartmentMembership.objects.select_related("department").filter(
        user=user,
        ended_at__isnull=True,
        department__code__in=SYSTEM_DEPARTMENTS.keys(),
    )
    for membership in memberships:
        if membership.department.code not in desired:
            membership.ended_at = now
            membership.is_primary = False
            membership.save(update_fields=["ended_at", "is_primary", "updated_at"])

    for code in desired:
        department = Department.objects.filter(code=code).first()
        if department is None:
            continue
        membership = DepartmentMembership.objects.filter(
            user=user, department=department, ended_at__isnull=True
        ).first()
        if membership is None:
            DepartmentMembership.objects.filter(
                user=user, is_primary=True, ended_at__isnull=True
            ).update(is_primary=False)
            DepartmentMembership.objects.create(
                user=user,
                department=department,
                is_primary=True,
                assigned_by=actor,
            )
        elif not membership.is_primary:
            DepartmentMembership.objects.filter(
                user=user, is_primary=True, ended_at__isnull=True
            ).exclude(pk=membership.pk).update(is_primary=False)
            membership.is_primary = True
            membership.save(update_fields=["is_primary", "updated_at"])


# --------------------------------------------------------------------------- #
# Role lifecycle
# --------------------------------------------------------------------------- #
@transaction.atomic
def create_role(actor, *, code: str, name: str, description: str = "", request=None) -> Role:
    code = (code or "").strip().upper().replace(" ", "_")
    if not code:
        raise ValidationError({"code": "Role code is required."})
    if code in SYSTEM_ROLE_CODES:
        raise ValidationError({"code": "This role code is reserved for a system role."})
    if Role.objects.filter(code=code).exists():
        raise ValidationError({"code": "A role with this code already exists."})
    role = Role.objects.create(
        code=code, name=name, description=description, is_active=True, is_system=False
    )
    record(
        actor=actor,
        action="role.created",
        target=role,
        after={
            "code": role.code,
            "name": role.name,
            "description": role.description,
            "is_active": role.is_active,
        },
        request=request,
    )
    return role


@transaction.atomic
def update_role(actor, role: Role, *, data: dict, request=None) -> Role:
    role = Role.objects.select_for_update().get(pk=role.pk)
    before = {
        "code": role.code,
        "name": role.name,
        "description": role.description,
        "is_active": role.is_active,
    }
    new_code = data.get("code")
    if new_code is not None and new_code.strip().upper() != role.code:
        if role.is_system:
            raise ValidationError(
                {"code": "The code of a system role cannot be changed."}
            )
        candidate = new_code.strip().upper().replace(" ", "_")
        if candidate in SYSTEM_ROLE_CODES or Role.objects.filter(code=candidate).exists():
            raise ValidationError({"code": "A role with this code already exists."})
        role.code = candidate
    for field in ("name", "description"):
        if field in data:
            setattr(role, field, data[field])
    role.save()
    record(
        actor=actor,
        action="role.updated",
        target=role,
        before=before,
        after={
            "code": role.code,
            "name": role.name,
            "description": role.description,
            "is_active": role.is_active,
        },
        request=request,
    )
    return role


@transaction.atomic
def set_role_active(actor, role: Role, *, active: bool, request=None) -> Role:
    role = Role.objects.select_for_update().get(pk=role.pk)
    if role.is_active == active:
        return role
    before = {"is_active": role.is_active}
    role.is_active = active
    role.save(update_fields=["is_active", "updated_at"])
    if not active and not _has_manager():
        raise PolicyConflict(
            "Deactivating this role would leave no active account able to manage "
            "roles and permissions."
        )
    record(
        actor=actor,
        action="role.activated" if active else "role.deactivated",
        target=role,
        before=before,
        after={"is_active": role.is_active},
        request=request,
    )
    return role


@transaction.atomic
def delete_role(actor, role: Role, *, request=None) -> None:
    role = Role.objects.select_for_update().get(pk=role.pk)
    if role.is_system:
        raise ValidationError({"detail": "System roles cannot be deleted."})
    if UserRole.objects.filter(role=role, revoked_at__isnull=True).exists():
        raise PolicyConflict(
            "This role is still assigned to at least one user. Deactivate it or "
            "remove the assignment first."
        )
    before = {"code": role.code, "name": role.name, "is_active": role.is_active}
    role_id = role.pk
    role.delete()
    record(
        actor=actor,
        action="role.deleted",
        target_type="rbac.role",
        target_id=str(role_id),
        before=before,
        request=request,
    )


@transaction.atomic
def set_role_permissions(actor, role: Role, entries: list[dict], *, request=None) -> Role:
    """Replace the role's permission set with ``entries``.

    ``entries`` items: ``{"permission": "<key>", "scope": "<scope>", "options": {}}``.
    """
    role = Role.objects.select_for_update().get(pk=role.pk)
    resolved: dict[str, tuple[Permission, str, dict]] = {}
    for entry in entries:
        key = entry.get("permission")
        permission = Permission.objects.filter(key=key).first()
        if permission is None:
            raise ValidationError({"permissions": f"Unknown permission '{key}'."})
        if permission.is_system_level:
            raise ValidationError(
                {
                    "permissions": (
                        f"'{key}' is a system-level permission and cannot be "
                        "granted to a business role."
                    )
                }
            )
        if not permission.is_active:
            raise ValidationError({"permissions": f"Permission '{key}' is inactive."})
        scope = entry.get("scope")
        if scope not in (permission.supported_scopes or []):
            raise ValidationError(
                {
                    "permissions": (
                        f"Scope '{scope}' is not supported by '{key}'. "
                        f"Supported: {', '.join(permission.supported_scopes)}."
                    )
                }
            )
        options = entry.get("options") or {}
        if not isinstance(options, dict):
            raise ValidationError({"permissions": "Scope options must be an object."})
        resolved[permission.key] = (permission, scope, options)

    # If the actor holds this role, their own management capability is at stake.
    affects_actor = UserRole.objects.filter(
        user=actor, role=role, revoked_at__isnull=True
    ).exists()
    before_keys = effective_permission_keys(actor) if affects_actor else frozenset()

    before = _role_snapshot(role)
    RolePermission.objects.filter(role=role).exclude(
        permission__key__in=resolved.keys()
    ).delete()
    for permission, scope, options in resolved.values():
        RolePermission.objects.update_or_create(
            role=role,
            permission=permission,
            defaults={"scope": scope, "options": options, "created_by": actor},
        )
    after = _role_snapshot(role)

    if affects_actor:
        _assert_actor_retains_management(actor, before_keys)

    record(
        actor=actor,
        action="role.permissions_updated",
        target=role,
        before=before,
        after=after,
        request=request,
    )
    return role


# --------------------------------------------------------------------------- #
# User-role assignment
# --------------------------------------------------------------------------- #
@transaction.atomic
def assign_role(actor, user, role: Role, *, request=None) -> UserRole:
    if not role.is_active:
        raise ValidationError({"role": "This role is deactivated and cannot be assigned."})
    if getattr(user, "is_superuser", False) and not _actor_is_superuser(actor):
        raise PermissionDenied("Only a superuser can modify a superuser's roles.")

    user = _get_user_model().objects.select_for_update().get(pk=user.pk)
    if UserRole.objects.filter(user=user, role=role, revoked_at__isnull=True).exists():
        raise ValidationError({"role": "This role is already assigned to the user."})

    assignment = UserRole.objects.create(user=user, role=role, assigned_by=actor)
    record(
        actor=actor,
        action="user_role.assigned",
        target=user,
        after={"role": role.code},
        request=request,
    )
    return assignment


@transaction.atomic
def revoke_role(actor, assignment: UserRole, *, request=None) -> UserRole:
    assignment = UserRole.objects.select_for_update().select_related(
        "role", "user"
    ).get(pk=assignment.pk)
    if assignment.revoked_at is not None:
        raise ValidationError({"detail": "This role assignment is already revoked."})
    user = assignment.user
    if getattr(user, "is_superuser", False) and not _actor_is_superuser(actor):
        raise PermissionDenied("Only a superuser can modify a superuser's roles.")

    before_keys = effective_permission_keys(user)
    before = _user_role_snapshot(user)
    assignment.revoked_at = timezone.now()
    assignment.revoked_by = actor if getattr(actor, "pk", None) else None
    assignment.save(update_fields=["revoked_at", "revoked_by", "updated_at"])

    if user.pk == getattr(actor, "pk", None):
        _assert_actor_retains_management(actor, before_keys)
    else:
        _assert_target_not_stranded(user)

    record(
        actor=actor,
        action="user_role.revoked",
        target=user,
        before=before,
        after=_user_role_snapshot(user),
        request=request,
    )
    return assignment


# --------------------------------------------------------------------------- #
# Scope restrictions (restrict-only)
# --------------------------------------------------------------------------- #
@transaction.atomic
def set_user_scope_restriction(
    actor, user, permission: Permission, *, scope: str, options: dict | None = None,
    request=None,
) -> UserScopeRestriction:
    if permission.is_system_level:
        raise ValidationError(
            {"permission": "System-level permissions cannot be restricted per user."}
        )
    if scope not in (permission.supported_scopes or []):
        raise ValidationError(
            {
                "scope": (
                    f"Scope '{scope}' is not supported by '{permission.key}'."
                )
            }
        )
    options = options or {}
    if not isinstance(options, dict):
        raise ValidationError({"options": "Scope options must be an object."})

    restriction, _ = UserScopeRestriction.objects.update_or_create(
        user=user,
        permission=permission,
        defaults={"scope": scope, "options": options, "created_by": actor},
    )
    record(
        actor=actor,
        action="user_scope_restriction.set",
        target=user,
        after={"permission": permission.key, "scope": scope, "options": options},
        request=request,
    )
    return restriction


@transaction.atomic
def delete_user_scope_restriction(actor, restriction: UserScopeRestriction, *, request=None):
    before = {
        "permission": restriction.permission.key,
        "scope": restriction.scope,
        "options": restriction.options,
    }
    user = restriction.user
    restriction.delete()
    record(
        actor=actor,
        action="user_scope_restriction.removed",
        target=user,
        before=before,
        request=request,
    )


# --------------------------------------------------------------------------- #
# Departments
# --------------------------------------------------------------------------- #
@transaction.atomic
def create_department(actor, *, code: str, name: str, description: str = "",
                      is_production: bool = True, request=None) -> Department:
    code = (code or "").strip().upper()
    if not code:
        raise ValidationError({"code": "Department code is required."})
    if Department.objects.filter(code=code).exists():
        raise ValidationError({"code": "A department with this code already exists."})
    department = Department.objects.create(
        code=code,
        name=name,
        description=description,
        is_production=is_production,
        is_active=True,
    )
    record(
        actor=actor,
        action="department.created",
        target=department,
        after={"code": code, "name": name, "is_production": is_production},
        request=request,
    )
    return department


@transaction.atomic
def update_department(actor, department: Department, *, data: dict, request=None):
    department = Department.objects.select_for_update().get(pk=department.pk)
    before = {
        "code": department.code,
        "name": department.name,
        "description": department.description,
        "is_production": department.is_production,
        "is_active": department.is_active,
    }
    for field in ("name", "description", "is_production", "is_active"):
        if field in data:
            setattr(department, field, data[field])
    department.save()
    record(
        actor=actor,
        action="department.updated",
        target=department,
        before=before,
        after={
            "code": department.code,
            "name": department.name,
            "description": department.description,
            "is_production": department.is_production,
            "is_active": department.is_active,
        },
        request=request,
    )
    return department


@transaction.atomic
def delete_department(actor, department: Department, *, request=None) -> None:
    department = Department.objects.select_for_update().get(pk=department.pk)
    if DepartmentMembership.objects.filter(
        department=department, ended_at__isnull=True
    ).exists():
        raise PolicyConflict(
            "This department still has active members. Remove the memberships first."
        )
    before = {"code": department.code, "name": department.name}
    department_id = department.pk
    department.delete()
    record(
        actor=actor,
        action="department.deleted",
        target_type="rbac.department",
        target_id=str(department_id),
        before=before,
        request=request,
    )


@transaction.atomic
def add_department_member(
    actor, user, department: Department, *, is_primary: bool = False, request=None
) -> DepartmentMembership:
    if not department.is_active:
        raise ValidationError({"department": "This department is deactivated."})
    if DepartmentMembership.objects.filter(
        user=user, department=department, ended_at__isnull=True
    ).exists():
        raise ValidationError(
            {"department": "The user is already a member of this department."}
        )
    if is_primary:
        DepartmentMembership.objects.filter(
            user=user, is_primary=True, ended_at__isnull=True
        ).update(is_primary=False)
    membership = DepartmentMembership.objects.create(
        user=user,
        department=department,
        is_primary=is_primary,
        assigned_by=actor,
    )
    record(
        actor=actor,
        action="department.member_added",
        target=user,
        after={"department": department.code, "is_primary": is_primary},
        request=request,
    )
    return membership


@transaction.atomic
def end_department_membership(actor, membership: DepartmentMembership, *, request=None):
    membership = DepartmentMembership.objects.select_for_update().select_related(
        "department", "user"
    ).get(pk=membership.pk)
    if membership.ended_at is not None:
        raise ValidationError({"detail": "This membership has already ended."})
    before = {
        "department": membership.department.code,
        "is_primary": membership.is_primary,
    }
    user = membership.user
    membership.ended_at = timezone.now()
    membership.is_primary = False
    membership.save(update_fields=["ended_at", "is_primary", "updated_at"])
    record(
        actor=actor,
        action="department.member_removed",
        target=user,
        before=before,
        request=request,
    )


@transaction.atomic
def set_primary_department(actor, membership: DepartmentMembership, *, request=None):
    membership = DepartmentMembership.objects.select_for_update().select_related(
        "department", "user"
    ).get(pk=membership.pk)
    if membership.ended_at is not None:
        raise ValidationError({"detail": "This membership has ended."})
    DepartmentMembership.objects.filter(
        user=membership.user, is_primary=True, ended_at__isnull=True
    ).exclude(pk=membership.pk).update(is_primary=False)
    membership.is_primary = True
    membership.save(update_fields=["is_primary", "updated_at"])
    record(
        actor=actor,
        action="department.primary_set",
        target=membership.user,
        after={"department": membership.department.code},
        request=request,
    )
    return membership


# --------------------------------------------------------------------------- #
# Account lifecycle & superuser plane
# --------------------------------------------------------------------------- #
@transaction.atomic
def deactivate_user(actor, target, *, request=None) -> dict:
    target = _get_user_model().objects.select_for_update().get(pk=target.pk)
    if target.pk == getattr(actor, "pk", None):
        raise PolicyConflict("You cannot deactivate your own account.")
    if target.is_superuser and not _actor_is_superuser(actor):
        raise PermissionDenied("Only a superuser can deactivate a superuser.")
    if target.is_superuser and (
        _get_user_model()
        .objects.filter(is_superuser=True, is_active=True)
        .exclude(pk=target.pk)
        .count()
        == 0
    ):
        raise PolicyConflict(
            "The last active superuser cannot be deactivated. Promote a "
            "replacement first."
        )

    order_model = django_apps.get_model("orders", "Order")
    active_orders = (
        order_model.objects.filter(Q(cutting_man=target) | Q(operator=target))
        .exclude(overall_status="COMPLETED")
        .count()
    )

    before = {
        "is_active": target.is_active,
        "roles": [item["role"] for item in _user_role_snapshot(target)],
    }
    target.is_active = False
    target.save(update_fields=["is_active", "updated_at"])

    now = timezone.now()
    UserRole.objects.filter(user=target, revoked_at__isnull=True).update(
        revoked_at=now, revoked_by=actor if getattr(actor, "pk", None) else None
    )
    DepartmentMembership.objects.filter(user=target, ended_at__isnull=True).update(
        ended_at=now, is_primary=False
    )

    record(
        actor=actor,
        action="user.deactivated",
        target=target,
        before=before,
        after={"is_active": False, "roles": []},
        request=request,
        active_orders=active_orders,
    )
    return {"user": target, "active_orders": active_orders}


@transaction.atomic
def reactivate_user(actor, target, *, request=None):
    target = _get_user_model().objects.select_for_update().get(pk=target.pk)
    if target.is_superuser and not _actor_is_superuser(actor):
        raise PermissionDenied("Only a superuser can reactivate a superuser.")
    target.is_active = True
    target.save(update_fields=["is_active", "updated_at"])
    record(
        actor=actor,
        action="user.reactivated",
        target=target,
        before={"is_active": False},
        # Roles are deliberately NOT restored: an administrator must re-assign.
        after={"is_active": True, "roles": []},
        request=request,
    )
    return target


@transaction.atomic
def set_superuser(actor, target, *, enabled: bool, request=None):
    if not _actor_is_superuser(actor):
        raise PermissionDenied("Only a superuser can change superuser privileges.")

    # Lock every active superuser row so two concurrent demotions cannot both
    # observe another active superuser and both proceed.
    list(
        _get_user_model()
        .objects.select_for_update()
        .filter(is_superuser=True, is_active=True)
    )
    target = _get_user_model().objects.select_for_update().get(pk=target.pk)

    if not enabled and target.is_superuser:
        remaining = (
            _get_user_model()
            .objects.filter(is_superuser=True, is_active=True)
            .exclude(pk=target.pk)
            .count()
        )
        if remaining == 0:
            raise PolicyConflict(
                "There must always be at least one active superuser. Promote a "
                "replacement before demoting this account."
            )

    before = {"is_superuser": target.is_superuser, "is_staff": target.is_staff}
    target.is_superuser = enabled
    if enabled:
        target.is_staff = True
    target.save(update_fields=["is_superuser", "is_staff", "updated_at"])

    record(
        actor=actor,
        action="user.superuser_changed",
        target=target,
        before=before,
        after={"is_superuser": target.is_superuser, "is_staff": target.is_staff},
        request=request,
    )
    return target
