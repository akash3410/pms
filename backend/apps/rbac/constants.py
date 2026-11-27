"""Code-owned RBAC vocabulary: scope types, permission catalogue, system roles.

Nothing in this module contains *authorization decisions*. It declares which
permission keys exist, which scope types each supports, and what the three
migrated system roles are granted. Enforcement always happens in view/service
code through :class:`apps.rbac.permissions.RBACPermission`.
"""
from __future__ import annotations

ALL = "ALL"
ASSIGNED = "ASSIGNED"
CREATED_BY_ME = "CREATED_BY_ME"
DEPARTMENT = "DEPARTMENT"
OWN_PROFILE = "OWN_PROFILE"

SCOPE_TYPES = (ALL, ASSIGNED, CREATED_BY_ME, DEPARTMENT, OWN_PROFILE)

#: ``key -> (human name, supported scopes)``. Keys are stable and unique.
PERMISSION_CATALOGUE: dict[str, tuple[str, tuple[str, ...]]] = {
    # -- Orders ------------------------------------------------------------
    "orders.view_order": ("View orders", (ALL, ASSIGNED, DEPARTMENT, CREATED_BY_ME)),
    "orders.create_order": ("Create order", (ALL,)),
    "orders.edit_order": ("Edit order", (ALL, ASSIGNED, DEPARTMENT)),
    "orders.delete_order": ("Delete order", (ALL,)),
    "orders.assign_order": ("Assign or reassign order", (ALL, DEPARTMENT)),
    "orders.view_notes": ("View order notes", (ALL, ASSIGNED, DEPARTMENT)),
    "orders.create_note": ("Add order note", (ALL, ASSIGNED, DEPARTMENT)),
    "orders.view_history": ("View production history", (ALL, ASSIGNED, DEPARTMENT)),
    "orders.view_assignments": ("View assignment history", (ALL, ASSIGNED, DEPARTMENT)),
    "orders.view_media": ("View order images", (ALL, ASSIGNED, DEPARTMENT)),
    # -- Production --------------------------------------------------------
    "production.update_status": ("Update production status", (ALL, ASSIGNED, DEPARTMENT)),
    "production.view_status_history": (
        "View status history",
        (ALL, ASSIGNED, DEPARTMENT),
    ),
    # -- Employees ---------------------------------------------------------
    "employees.view_employee": ("View employees", (ALL, DEPARTMENT, OWN_PROFILE)),
    "employees.create_employee": ("Create employee", (ALL,)),
    "employees.edit_employee": ("Edit employee", (ALL, DEPARTMENT)),
    "employees.deactivate_employee": ("Deactivate or reactivate employee", (ALL,)),
    "employees.view_profile": ("View own profile", (OWN_PROFILE, ALL)),
    "employees.edit_profile": ("Edit own profile", (OWN_PROFILE, ALL)),
    "users.manage_users": ("Manage user accounts and roles", (ALL,)),
    "users.view_role_history": ("View user role history", (ALL, OWN_PROFILE)),
    "users.view_effective_permissions": (
        "View effective permissions",
        (ALL, OWN_PROFILE),
    ),
    # -- Targets -----------------------------------------------------------
    "targets.view_targets": ("View targets", (ALL, DEPARTMENT, OWN_PROFILE)),
    "targets.manage_targets": ("Manage targets", (ALL, DEPARTMENT)),
    # -- Reports -----------------------------------------------------------
    "reports.view_reports": ("View reports", (ALL, DEPARTMENT)),
    # -- RBAC --------------------------------------------------------------
    "roles.view_roles": ("View roles", (ALL,)),
    "roles.manage_roles": ("Manage roles", (ALL,)),
    "permissions.view_permissions": ("View permissions", (ALL,)),
    "permissions.manage_permissions": ("Manage permissions", (ALL,)),
    "permissions.view_change_history": ("View permission change history", (ALL,)),
    "scopes.manage_user_restrictions": ("Manage user scope restrictions", (ALL,)),
    # -- Departments -------------------------------------------------------
    "departments.view_departments": ("View departments", (ALL, DEPARTMENT)),
    "departments.manage_departments": ("Manage departments", (ALL,)),
    "departments.manage_members": ("Manage department members", (ALL, DEPARTMENT)),
    # -- Invitations -------------------------------------------------------
    "invitations.create_invitation": ("Create invitation", (ALL,)),
    "invitations.resend_invitation": ("Resend invitation", (ALL,)),
    "invitations.cancel_invitation": ("Cancel invitation", (ALL,)),
    "invitations.view_invitation": ("View invitations", (ALL,)),
    "invitations.manage_settings": ("Configure invitation expiry", (ALL,)),
    # -- Audit -------------------------------------------------------------
    "audit_logs.view_logs": ("View audit logs", (ALL,)),
    # -- System plane (never assignable to a business role) -----------------
    "system.manage_email_config": ("Manage system email configuration", (ALL,)),
    "system.manage_settings": ("Manage system settings", (ALL,)),
    "system.manage_superusers": ("Manage superuser privileges", (ALL,)),
}

SYSTEM_PERMISSION_PREFIX = "system."

#: Modules that have a queryset scope registry and may receive custom keys.
SCOPE_MODULES = (
    "orders",
    "production",
    "employees",
    "targets",
    "reports",
    "rbac",
    "departments",
    "invitations",
    "audit",
    "system",
)

SYSTEM_ROLE_CODES = ("ADMIN", "CUTTING_MAN", "OPERATOR")

#: Default permission sets for the three roles migrated from the legacy enum.
#: ``code -> (name, {permission_key: (scope, options)})``.
ADMIN_PERMISSIONS = {
    key: (ALL, {})
    for key in PERMISSION_CATALOGUE
    if not key.startswith(SYSTEM_PERMISSION_PREFIX)
}


def _production_permissions(department: str) -> dict[str, tuple[str, dict]]:
    assigned = {"assignment_types": [department]}
    return {
        "orders.view_order": (ASSIGNED, assigned),
        "orders.view_notes": (ASSIGNED, assigned),
        "orders.create_note": (ASSIGNED, assigned),
        "orders.view_history": (ASSIGNED, assigned),
        "orders.view_assignments": (ASSIGNED, assigned),
        "orders.view_media": (ASSIGNED, assigned),
        "production.update_status": (ASSIGNED, assigned),
        "production.view_status_history": (ASSIGNED, assigned),
        "targets.view_targets": (OWN_PROFILE, {}),
        "employees.view_profile": (OWN_PROFILE, {}),
        "employees.edit_profile": (OWN_PROFILE, {}),
        "users.view_role_history": (OWN_PROFILE, {}),
        "users.view_effective_permissions": (OWN_PROFILE, {}),
    }


SYSTEM_ROLES: dict[str, dict] = {
    "ADMIN": {
        "name": "Admin",
        "description": "Business administrator: full operational and management access.",
        "permissions": ADMIN_PERMISSIONS,
        "departments": (),
    },
    "CUTTING_MAN": {
        "name": "Cutting Man",
        "description": "Production employee working in the Cutting department.",
        "permissions": _production_permissions("CUTTING"),
        "departments": ("CUTTING",),
    },
    "OPERATOR": {
        "name": "Operator",
        "description": "Production employee working in the Operator department.",
        "permissions": _production_permissions("OPERATOR"),
        "departments": ("OPERATOR",),
    },
}

#: Departments created by the migration seed.
SYSTEM_DEPARTMENTS = {
    "CUTTING": {"name": "Cutting", "is_production": True},
    "OPERATOR": {"name": "Operator", "is_production": True},
}

#: Permission keys whose loss would strip an account of management ability.
MANAGEMENT_PERMISSION_KEYS = frozenset(
    {"roles.manage_roles", "permissions.manage_permissions"}
)
