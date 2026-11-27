"""RBAC tests: roles, permissions, multi-role union, scopes, safeguards, audit."""
import pytest
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.audit.models import AuditLog
from apps.orders.models import Order
from apps.rbac.models import (
    Department,
    DepartmentMembership,
    Permission,
    Role,
    RolePermission,
    UserRole,
)

pytestmark = pytest.mark.django_db


def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def make_order(admin_user, cutting_user, operator_user, number="ORD-RBAC"):
    from django.core.files.uploadedfile import SimpleUploadedFile

    from conftest import make_image_bytes

    image = SimpleUploadedFile(
        "card.png", make_image_bytes(), content_type="image/png"
    )
    return Order.objects.create(
        order_number=number,
        original_image=image,
        cutting_man=cutting_user,
        operator=operator_user,
        created_by=admin_user,
    )


def make_role(code="CUSTOM", **kwargs):
    return Role.objects.create(code=code, name=kwargs.pop("name", code.title()), **kwargs)


def grant(role, key, scope="ALL", options=None):
    return RolePermission.objects.create(
        role=role,
        permission=Permission.objects.get(key=key),
        scope=scope,
        options=options or {},
    )


def assign(user, role):
    return UserRole.objects.create(user=user, role=role)


def strip_roles(user):
    """Remove the legacy-bridge assignments so a test controls access exactly."""
    UserRole.objects.filter(user=user, revoked_at__isnull=True).update(
        revoked_at=timezone.now()
    )


class TestRoleLifecycle:
    def test_admin_can_list_roles(self, admin_user):
        resp = auth_client(admin_user).get("/api/v1/rbac/roles/")
        assert resp.status_code == 200
        codes = {row["code"] for row in resp.data["results"]}
        assert {"ADMIN", "CUTTING_MAN", "OPERATOR"} <= codes

    def test_employee_cannot_list_roles(self, cutting_user):
        resp = auth_client(cutting_user).get("/api/v1/rbac/roles/")
        assert resp.status_code == 403

    def test_create_custom_role(self, admin_user):
        resp = auth_client(admin_user).post(
            "/api/v1/rbac/roles/",
            {"code": "QC", "name": "Quality Controller", "description": "QC team"},
            format="json",
        )
        assert resp.status_code == 201, resp.data
        assert Role.objects.filter(code="QC").exists()
        assert AuditLog.objects.filter(action="role.created").exists()

    def test_cannot_create_reserved_role_code(self, admin_user):
        resp = auth_client(admin_user).post(
            "/api/v1/rbac/roles/", {"code": "ADMIN", "name": "X"}, format="json"
        )
        assert resp.status_code == 400

    def test_system_role_cannot_be_deleted(self, admin_user):
        role = Role.objects.get(code="ADMIN")
        resp = auth_client(admin_user).delete(f"/api/v1/rbac/roles/{role.pk}/")
        assert resp.status_code == 400
        assert Role.objects.filter(pk=role.pk).exists()

    def test_role_with_assignments_cannot_be_deleted(self, admin_user, cutting_user):
        role = make_role("TEMP")
        assign(cutting_user, role)
        resp = auth_client(admin_user).delete(f"/api/v1/rbac/roles/{role.pk}/")
        assert resp.status_code == 409

    def test_role_deactivation_removes_access_immediately(self, admin_user, cutting_user, operator_user):
        order = make_order(admin_user, cutting_user, operator_user)
        strip_roles(operator_user)
        role = make_role("VIEWER")
        grant(role, "orders.view_order", "ALL")
        assign(operator_user, role)
        payload = {"permissions": [{"permission": "orders.view_order", "scope": "ALL"}]}
        auth_client(admin_user).put(
            f"/api/v1/rbac/roles/{role.pk}/permissions/", payload, format="json"
        )
        assert auth_client(operator_user).get("/api/v1/orders/").status_code == 200

        resp = auth_client(admin_user).post(f"/api/v1/rbac/roles/{role.pk}/deactivate/")
        assert resp.status_code == 200
        # Deactivated role contributes no permissions.
        assert auth_client(operator_user).get("/api/v1/orders/").status_code == 403
        assert order.pk  # order itself is untouched


class TestPermissionLifecycle:
    def test_permission_removal_takes_effect_immediately(self, admin_user, cutting_user):
        strip_roles(cutting_user)
        role = make_role("TEMPVIEW")
        grant(role, "orders.view_order", "ALL")
        assign(cutting_user, role)
        assert auth_client(cutting_user).get("/api/v1/orders/").status_code == 200

        resp = auth_client(admin_user).put(
            f"/api/v1/rbac/roles/{role.pk}/permissions/",
            {"permissions": []},
            format="json",
        )
        assert resp.status_code == 200
        assert auth_client(cutting_user).get("/api/v1/orders/").status_code == 403

    def test_permission_added_takes_effect_immediately(self, admin_user, cutting_user):
        strip_roles(cutting_user)
        role = make_role("LATE")
        assign(cutting_user, role)
        assert auth_client(cutting_user).get("/api/v1/orders/").status_code == 403

        auth_client(admin_user).put(
            f"/api/v1/rbac/roles/{role.pk}/permissions/",
            {"permissions": [{"permission": "orders.view_order", "scope": "ALL"}]},
            format="json",
        )
        assert auth_client(cutting_user).get("/api/v1/orders/").status_code == 200

    def test_unsupported_scope_rejected(self, admin_user):
        role = make_role("BADSCOPE")
        resp = auth_client(admin_user).put(
            f"/api/v1/rbac/roles/{role.pk}/permissions/",
            {"permissions": [{"permission": "roles.manage_roles", "scope": "ASSIGNED"}]},
            format="json",
        )
        assert resp.status_code == 400
        assert not RolePermission.objects.filter(role=role).exists()

    def test_system_permission_cannot_be_granted_to_role(self, admin_user):
        role = make_role("SNEAKY")
        resp = auth_client(admin_user).put(
            f"/api/v1/rbac/roles/{role.pk}/permissions/",
            {
                "permissions": [
                    {"permission": "system.manage_superusers", "scope": "ALL"}
                ]
            },
            format="json",
        )
        assert resp.status_code == 400
        assert not RolePermission.objects.filter(role=role).exists()

    def test_permission_keys_are_stable(self, admin_user):
        permission = Permission.objects.get(key="orders.view_order")
        resp = auth_client(admin_user).patch(
            f"/api/v1/rbac/permissions/{permission.pk}/",
            {"key": "orders.view_orders"},
            format="json",
        )
        assert resp.status_code == 400

    def test_custom_permission_creation_is_metadata_only(self, admin_user):
        resp = auth_client(admin_user).post(
            "/api/v1/rbac/permissions/",
            {
                "key": "orders.export_order",
                "name": "Export orders",
                "supported_scopes": ["ALL"],
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data
        assert Permission.objects.get(key="orders.export_order").is_system is False


class TestMultipleRolesAndScopes:
    def test_multiple_roles_union(self, admin_user, cutting_user, operator_user):
        order = make_order(admin_user, cutting_user, operator_user)
        viewer = make_role("VIEWER")
        grant(viewer, "orders.view_order", "ASSIGNED")
        reporter = make_role("REPORTER")
        grant(reporter, "reports.view_reports", "ALL")
        assign(cutting_user, viewer)
        assign(cutting_user, reporter)

        assert auth_client(cutting_user).get("/api/v1/orders/").status_code == 200
        assert auth_client(cutting_user).get("/api/v1/reports/dashboard/").status_code == 200
        assert order.cutting_man_id == cutting_user.pk

    def test_assigned_scope_only_returns_assigned_orders(self, admin_user, cutting_user, operator_user):
        mine = make_order(admin_user, cutting_user, operator_user, "ORD-MINE")
        other_cutter = User.objects.create_user(
            username="c2", password="x", employee_code="CUT-222", full_name="C2",
            role="CUTTING_MAN",
        )
        make_order(admin_user, other_cutter, operator_user, "ORD-OTHER")
        strip_roles(cutting_user)
        role = make_role("ASSIGNED_ONLY")
        grant(role, "orders.view_order", "ASSIGNED", {"assignment_types": ["CUTTING"]})
        assign(cutting_user, role)

        resp = auth_client(cutting_user).get("/api/v1/orders/")
        assert resp.status_code == 200
        ids = {row["id"] for row in resp.data["results"]}
        assert ids == {str(mine.pk)}

    def test_user_restriction_narrows_and_never_expands(self, admin_user, cutting_user, operator_user):
        make_order(admin_user, cutting_user, operator_user, "ORD-N1")
        other_cutter = User.objects.create_user(
            username="c3", password="x", employee_code="CUT-333", full_name="C3",
            role="CUTTING_MAN",
        )
        make_order(admin_user, other_cutter, operator_user, "ORD-N2")

        strip_roles(cutting_user)
        role = make_role("ALL_ORDERS")
        grant(role, "orders.view_order", "ALL")
        assign(cutting_user, role)
        assert auth_client(cutting_user).get("/api/v1/orders/").data["count"] == 2

        # Restriction narrows ALL -> ASSIGNED.
        resp = auth_client(admin_user).put(
            f"/api/v1/rbac/users/{cutting_user.pk}/scope-restrictions/",
            {"permission": "orders.view_order", "scope": "ASSIGNED"},
            format="json",
        )
        assert resp.status_code == 200, resp.data
        assert auth_client(cutting_user).get("/api/v1/orders/").data["count"] == 1

        # Attempting to widen back beyond the role grant is a no-op: the
        # restriction is only ever ANDed, but ASSIGNED cannot add rows.
        auth_client(admin_user).put(
            f"/api/v1/rbac/users/{cutting_user.pk}/scope-restrictions/",
            {"permission": "orders.view_order", "scope": "ALL"},
            format="json",
        )
        assert auth_client(cutting_user).get("/api/v1/orders/").data["count"] == 2

    def test_restriction_cannot_grant_missing_permission(self, admin_user, cutting_user):
        resp = auth_client(admin_user).put(
            f"/api/v1/rbac/users/{cutting_user.pk}/scope-restrictions/",
            {"permission": "orders.delete_order", "scope": "ALL"},
            format="json",
        )
        assert resp.status_code == 200  # a restriction can exist...
        # ...but it grants nothing without a role permission.
        assert auth_client(cutting_user).delete(
            "/api/v1/orders/00000000-0000-0000-0000-000000000000/"
        ).status_code == 405
        assert (
            auth_client(cutting_user).get("/api/v1/rbac/permissions/").status_code
            != 200
        )

    def test_department_scope_uses_memberships(self, admin_user, cutting_user, operator_user):
        make_order(admin_user, cutting_user, operator_user, "ORD-DEPT")
        outsider = User.objects.create_user(
            username="outs", password="x", employee_code="CUT-444", full_name="Out",
            role="CUTTING_MAN",
        )
        operator_dept = Department.objects.get(code="OPERATOR")
        strip_roles(operator_user)
        role = make_role("DEPT_VIEW")
        grant(role, "orders.view_order", "DEPARTMENT")
        assign(operator_user, role)
        DepartmentMembership.objects.get_or_create(
            user=operator_user,
            department=operator_dept,
            defaults={"is_primary": True},
        )

        resp = auth_client(operator_user).get("/api/v1/orders/")
        assert resp.status_code == 200
        assert resp.data["count"] == 1
        assert outsider.pk  # unrelated user unchanged

    def test_department_membership_change_updates_scope_immediately(self, admin_user, operator_user):
        strip_roles(operator_user)
        role = make_role("DEPT_ONLY")
        grant(role, "orders.view_order", "DEPARTMENT")
        assign(operator_user, role)
        cutting_dept = Department.objects.get(code="CUTTING")
        membership, _ = DepartmentMembership.objects.get_or_create(
            user=operator_user,
            department=cutting_dept,
            defaults={"is_primary": False},
        )
        client = auth_client(admin_user)
        # Remove membership -> the DEPARTMENT scope now matches nothing.
        resp = client.delete(
            f"/api/v1/rbac/departments/{cutting_dept.pk}/members/{membership.pk}/"
        )
        assert resp.status_code == 204
        assert auth_client(operator_user).get("/api/v1/orders/").data["count"] == 0


class TestAdministrativeSafeguards:
    def test_admin_cannot_strip_own_last_management_permission(self, admin_user):
        admin_role = Role.objects.get(code="ADMIN")
        payload = {
            "permissions": [
                {"permission": "orders.view_order", "scope": "ALL"},
            ]
        }
        resp = auth_client(admin_user).put(
            f"/api/v1/rbac/roles/{admin_role.pk}/permissions/", payload, format="json"
        )
        assert resp.status_code == 409
        # The role is unchanged (transaction rolled back).
        assert RolePermission.objects.filter(
            role=admin_role, permission__key="roles.manage_roles"
        ).exists()

    def test_admin_cannot_deactivate_own_account(self, admin_user):
        resp = auth_client(admin_user).post(
            f"/api/v1/employees/{admin_user.pk}/deactivate/"
        )
        assert resp.status_code == 409
        admin_user.refresh_from_db()
        assert admin_user.is_active is True

    def test_admin_cannot_toggle_superuser(self, admin_user, operator_user):
        resp = auth_client(admin_user).post(
            f"/api/v1/rbac/users/{operator_user.pk}/superuser/",
            {"enabled": True},
            format="json",
        )
        assert resp.status_code == 403
        operator_user.refresh_from_db()
        assert operator_user.is_superuser is False

    def test_admin_cannot_deactivate_superuser(self, admin_user):
        root = User.objects.create_superuser(
            username="root", email="root@example.com", password="R00t-Pass-9x!"
        )
        resp = auth_client(admin_user).post(f"/api/v1/employees/{root.pk}/deactivate/")
        assert resp.status_code == 403
        root.refresh_from_db()
        assert root.is_active is True

    def test_last_superuser_cannot_be_demoted(self):
        root = User.objects.create_superuser(
            username="root2", email="root2@example.com", password="R00t-Pass-9x!"
        )
        resp = auth_client(root).post(
            f"/api/v1/rbac/users/{root.pk}/superuser/",
            {"enabled": False},
            format="json",
        )
        assert resp.status_code == 409
        root.refresh_from_db()
        assert root.is_superuser is True

    def test_superuser_can_promote_then_demote(self):
        root = User.objects.create_superuser(
            username="root3", email="root3@example.com", password="R00t-Pass-9x!"
        )
        second = User.objects.create_user(
            username="second", password="Str0ng-Pass-9x!", employee_code="SU-2",
            full_name="Second",
        )
        client = auth_client(root)
        assert (
            client.post(
                f"/api/v1/rbac/users/{second.pk}/superuser/",
                {"enabled": True},
                format="json",
            ).status_code
            == 200
        )
        assert (
            client.post(
                f"/api/v1/rbac/users/{root.pk}/superuser/",
                {"enabled": False},
                format="json",
            ).status_code
            == 200
        )
        root.refresh_from_db()
        assert root.is_superuser is False

    def test_deactivated_user_access_token_is_rejected(self, admin_user):
        login = APIClient().post(
            "/api/v1/auth/login/",
            {"username": "admin1", "password": "Admin12345!"},
            format="json",
        )
        assert login.status_code == 200, login.data
        token = login.data["access"]

        admin_user.is_active = False
        admin_user.save(update_fields=["is_active"])

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        assert client.get("/api/v1/orders/").status_code == 401

    def test_reactivation_does_not_restore_roles(self, admin_user, cutting_user):
        client = auth_client(admin_user)
        assert client.post(f"/api/v1/employees/{cutting_user.pk}/deactivate/").status_code == 200
        cutting_user.refresh_from_db()
        assert cutting_user.is_active is False
        assert not UserRole.objects.filter(
            user=cutting_user, revoked_at__isnull=True
        ).exists()

        assert client.post(f"/api/v1/employees/{cutting_user.pk}/reactivate/").status_code == 200
        cutting_user.refresh_from_db()
        assert cutting_user.is_active is True
        assert not UserRole.objects.filter(
            user=cutting_user, revoked_at__isnull=True
        ).exists()
        assert auth_client(cutting_user).get("/api/v1/orders/").status_code == 403


class TestEffectivePermissionsAndAudit:
    def test_effective_permissions_endpoint(self, admin_user, cutting_user):
        resp = auth_client(admin_user).get(
            f"/api/v1/rbac/users/{cutting_user.pk}/effective-permissions/"
        )
        assert resp.status_code == 200
        permissions = resp.data["permissions"]
        assert "orders.view_order" in permissions
        assert permissions["orders.view_order"][0]["scope"] == "ASSIGNED"
        assert "system.manage_superusers" not in permissions

    def test_employee_cannot_view_other_effective_permissions(self, cutting_user, operator_user):
        resp = auth_client(cutting_user).get(
            f"/api/v1/rbac/users/{operator_user.pk}/effective-permissions/"
        )
        assert resp.status_code == 403

    def test_employee_can_view_own_effective_permissions(self, cutting_user):
        resp = auth_client(cutting_user).get(
            f"/api/v1/rbac/users/{cutting_user.pk}/effective-permissions/"
        )
        assert resp.status_code == 200

    def test_audit_log_records_and_is_read_only(self, admin_user):
        auth_client(admin_user).post(
            "/api/v1/rbac/roles/", {"code": "AUDITME", "name": "Audit Me"}, format="json"
        )
        resp = auth_client(admin_user).get("/api/v1/audit-logs/?action=role.created")
        assert resp.status_code == 200
        assert resp.data["count"] >= 1
        # No write routes exist.
        assert auth_client(admin_user).post(
            "/api/v1/audit-logs/", {}, format="json"
        ).status_code == 405

    def test_audit_log_rows_are_immutable(self, admin_user):
        auth_client(admin_user).post(
            "/api/v1/rbac/roles/", {"code": "IMMUT", "name": "Immutable"}, format="json"
        )
        entry = AuditLog.objects.first()
        entry.action = "tampered"
        with pytest.raises(DjangoValidationError):
            entry.save()
        with pytest.raises(DjangoValidationError):
            entry.delete()

    def test_role_history_endpoint(self, admin_user):
        role = make_role("HISTORY")
        client = auth_client(admin_user)
        client.patch(
            f"/api/v1/rbac/roles/{role.pk}/", {"name": "Renamed"}, format="json"
        )
        resp = client.get(f"/api/v1/rbac/roles/{role.pk}/history/")
        assert resp.status_code == 200
        assert any(event["action"] == "role.updated" for event in resp.data)

    def test_jwt_contains_no_authorization_claims(self, admin_user):
        import jwt

        login = APIClient().post(
            "/api/v1/auth/login/",
            {"username": "admin1", "password": "Admin12345!"},
            format="json",
        )
        payload = jwt.decode(login.data["access"], options={"verify_signature": False})
        assert "role" not in payload
        assert payload["user_id"] == str(admin_user.pk)
