"""Scope → queryset filter registry.

Every scope compiles to a ``Q`` object (or ``None`` meaning "no restriction"),
so filtering happens in SQL before pagination and before ``get_object()``.

Rule: a scope that is not applicable to a module — or is unknown — produces an
empty result set. It is **never** interpreted as ``ALL``.
"""
from __future__ import annotations

from django.db.models import Q

from .constants import ALL, ASSIGNED, CREATED_BY_ME, DEPARTMENT, OWN_PROFILE
from .models import DepartmentMembership


def _none() -> Q:
    return Q(pk__in=[])


def _department_ids(user) -> list:
    return list(
        DepartmentMembership.objects.filter(
            user=user, ended_at__isnull=True, department__is_active=True
        ).values_list("department_id", flat=True)
    )


def _department_member_ids(user) -> list:
    dept_ids = _department_ids(user)
    if not dept_ids:
        return []
    return list(
        DepartmentMembership.objects.filter(
            department_id__in=dept_ids, ended_at__isnull=True
        ).values_list("user_id", flat=True)
    )


# --------------------------------------------------------------------------- #
# orders module
# --------------------------------------------------------------------------- #
def orders_all(user, options) -> None:
    return None


def orders_assigned(user, options) -> Q:
    types = options.get("assignment_types") or ["CUTTING", "OPERATOR"]
    query = _none()
    if "CUTTING" in types:
        query |= Q(cutting_man_id=user.pk)
    if "OPERATOR" in types:
        query |= Q(operator_id=user.pk)
    return query


def orders_created_by_me(user, options) -> Q:
    return Q(created_by_id=user.pk)


def orders_department(user, options) -> Q:
    member_ids = _department_member_ids(user)
    if not member_ids:
        return _none()
    return Q(cutting_man_id__in=member_ids) | Q(operator_id__in=member_ids)


# --------------------------------------------------------------------------- #
# production module (status actions are evaluated against the order itself)
# --------------------------------------------------------------------------- #
def production_all(user, options) -> None:
    return None


def production_assigned(user, options) -> Q:
    return orders_assigned(user, options)


def production_department(user, options) -> Q:
    return orders_department(user, options)


# --------------------------------------------------------------------------- #
# employees module
# --------------------------------------------------------------------------- #
def employees_all(user, options) -> None:
    return None


def employees_department(user, options) -> Q:
    dept_ids = _department_ids(user)
    if not dept_ids:
        return _none()
    member_ids = DepartmentMembership.objects.filter(
        department_id__in=dept_ids, ended_at__isnull=True
    ).values("user_id")
    return Q(pk__in=member_ids)


def employees_own_profile(user, options) -> Q:
    return Q(pk=user.pk)


# --------------------------------------------------------------------------- #
# targets module
# --------------------------------------------------------------------------- #
def targets_all(user, options) -> None:
    return None


def targets_department(user, options) -> Q:
    dept_ids = _department_ids(user)
    if not dept_ids:
        return _none()
    member_ids = DepartmentMembership.objects.filter(
        department_id__in=dept_ids, ended_at__isnull=True
    ).values("user_id")
    return Q(employee_id__in=member_ids)


def targets_own_profile(user, options) -> Q:
    return Q(employee_id=user.pk)


# --------------------------------------------------------------------------- #
# departments module
# --------------------------------------------------------------------------- #
def departments_all(user, options) -> None:
    return None


def departments_department(user, options) -> Q:
    dept_ids = _department_ids(user)
    if not dept_ids:
        return _none()
    return Q(pk__in=dept_ids)


# --------------------------------------------------------------------------- #
# Registry
# --------------------------------------------------------------------------- #
#: ``module -> {scope: builder}``. A module absent from this mapping has no
#: scope support; permissions on it are only reachable at ``ALL``.
SCOPE_BUILDERS: dict[str, dict[str, object]] = {
    "orders": {
        ALL: orders_all,
        ASSIGNED: orders_assigned,
        CREATED_BY_ME: orders_created_by_me,
        DEPARTMENT: orders_department,
    },
    "production": {
        ALL: production_all,
        ASSIGNED: production_assigned,
        DEPARTMENT: production_department,
    },
    "employees": {
        ALL: employees_all,
        DEPARTMENT: employees_department,
        OWN_PROFILE: employees_own_profile,
    },
    # ``users.*`` permissions act on the same rows as the employees module.
    "users": {
        ALL: employees_all,
        DEPARTMENT: employees_department,
        OWN_PROFILE: employees_own_profile,
    },
    "targets": {
        ALL: targets_all,
        DEPARTMENT: targets_department,
        OWN_PROFILE: targets_own_profile,
    },
    "departments": {
        ALL: departments_all,
        DEPARTMENT: departments_department,
    },
    "reports": {ALL: orders_all},
    "rbac": {ALL: orders_all},
    "invitations": {ALL: orders_all},
    "audit": {ALL: orders_all},
    "system": {ALL: orders_all},
}

#: Modules that support data scoping at all (used for permission validation).
SCOPED_MODULES = frozenset(SCOPE_BUILDERS)


def build_scope_q(module: str, scope: str, options: dict | None, user) -> Q | None:
    """Compile ``(module, scope)`` to a ``Q``; ``None`` means "no restriction".

    Unknown module/scope or a failed builder yields an empty ``Q`` (fail closed).
    """
    builders = SCOPE_BUILDERS.get(module)
    if not builders:
        return _none()
    builder = builders.get(scope)
    if builder is None:
        return _none()
    try:
        return builder(user, options or {})
    except Exception:  # noqa: BLE001 - fail closed on any scope evaluation error
        return _none()
