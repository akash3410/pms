"""API tests for authentication, employees, and role permissions (Phase 3)."""
import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import Role, User

pytestmark = pytest.mark.django_db


def auth_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _img():
    buf = io.BytesIO()
    Image.new("RGB", (120, 80), (1, 2, 3)).save(buf, format="PNG")
    return SimpleUploadedFile("c.png", buf.getvalue(), content_type="image/png")


def _make_order(admin_user, cutting, operator, number):
    resp = auth_client(admin_user).post(
        "/api/v1/orders/",
        {
            "order_number": number,
            "original_image": _img(),
            "cutting_man": str(cutting.pk),
            "operator": str(operator.pk),
        },
        format="multipart",
    )
    assert resp.status_code == 201, resp.data
    return resp.data["id"]


class TestLogin:
    def test_valid_login(self, admin_user):
        client = APIClient()
        resp = client.post(
            "/api/v1/auth/login/",
            {"username": "admin1", "password": "Admin12345!"},
            format="json",
        )
        assert resp.status_code == 200
        assert "access" in resp.data and "refresh" in resp.data
        assert resp.data["user"]["role"] == Role.ADMIN

    def test_invalid_login(self, admin_user):
        client = APIClient()
        resp = client.post(
            "/api/v1/auth/login/",
            {"username": "admin1", "password": "wrong"},
            format="json",
        )
        assert resp.status_code == 401

    def test_inactive_user_cannot_login(self, operator_user):
        operator_user.is_active = False
        operator_user.save(update_fields=["is_active"])
        client = APIClient()
        resp = client.post(
            "/api/v1/auth/login/",
            {"username": "operator1", "password": "Operator12345!"},
            format="json",
        )
        assert resp.status_code == 401


class TestRefreshAndLogout:
    def test_refresh_returns_access(self, admin_user):
        client = APIClient()
        login = client.post(
            "/api/v1/auth/login/",
            {"username": "admin1", "password": "Admin12345!"},
            format="json",
        )
        refresh = login.data["refresh"]
        resp = client.post("/api/v1/auth/refresh/", {"refresh": refresh}, format="json")
        assert resp.status_code == 200
        assert "access" in resp.data

    def test_invalid_refresh(self):
        client = APIClient()
        resp = client.post("/api/v1/auth/refresh/", {"refresh": "garbage"}, format="json")
        assert resp.status_code == 401

    def test_logout_blacklists_refresh(self, admin_user):
        client = auth_client(admin_user)
        login = APIClient().post(
            "/api/v1/auth/login/",
            {"username": "admin1", "password": "Admin12345!"},
            format="json",
        )
        refresh = login.data["refresh"]
        resp = client.post("/api/v1/auth/logout/", {"refresh": refresh}, format="json")
        assert resp.status_code == 204
        # Refresh should now be rejected.
        again = APIClient().post("/api/v1/auth/refresh/", {"refresh": refresh}, format="json")
        assert again.status_code == 401


class TestMe:
    def test_me_requires_auth(self):
        resp = APIClient().get("/api/v1/auth/me/")
        assert resp.status_code == 401

    def test_me_returns_profile(self, cutting_user):
        resp = auth_client(cutting_user).get("/api/v1/auth/me/")
        assert resp.status_code == 200
        assert resp.data["employee_code"] == "CUT-001"

    def test_me_patch_allows_self_fields(self, cutting_user):
        resp = auth_client(cutting_user).patch(
            "/api/v1/auth/me/", {"full_name": "Updated Name"}, format="json"
        )
        assert resp.status_code == 200
        assert resp.data["full_name"] == "Updated Name"

    def test_me_cannot_change_role(self, cutting_user):
        resp = auth_client(cutting_user).patch(
            "/api/v1/auth/me/", {"role": Role.ADMIN}, format="json"
        )
        assert resp.status_code == 200
        cutting_user.refresh_from_db()
        assert cutting_user.role == Role.CUTTING_MAN


class TestEmployeeManagementRBAC:
    def test_admin_can_list_employees(self, admin_user):
        resp = auth_client(admin_user).get("/api/v1/employees/")
        assert resp.status_code == 200
        assert resp.data["count"] >= 1

    def test_employee_cannot_list_employees(self, cutting_user):
        resp = auth_client(cutting_user).get("/api/v1/employees/")
        assert resp.status_code == 403

    def test_admin_can_create_employee(self, admin_user):
        resp = auth_client(admin_user).post(
            "/api/v1/employees/",
            {
                "username": "newop",
                "password": "Str0ng-Prov1sion!",
                "full_name": "New Operator",
                "employee_code": "OPR-100",
                "role": Role.OPERATOR,
            },
            format="json",
        )
        assert resp.status_code == 201
        assert User.objects.filter(employee_code="OPR-100").exists()

    def test_employee_cannot_create_employee(self, cutting_user):
        resp = auth_client(cutting_user).post(
            "/api/v1/employees/",
            {"username": "x", "password": "Str0ng-Prov1sion!", "full_name": "X", "employee_code": "X1"},
            format="json",
        )
        assert resp.status_code == 403

    def test_admin_can_deactivate_employee(self, admin_user, operator_user):
        resp = auth_client(admin_user).post(
            f"/api/v1/employees/{operator_user.pk}/deactivate/"
        )
        assert resp.status_code == 200
        operator_user.refresh_from_db()
        assert operator_user.is_active is False

    def test_duplicate_employee_code_rejected(self, admin_user, operator_user):
        resp = auth_client(admin_user).post(
            "/api/v1/employees/",
            {
                "username": "dup2",
                "password": "Str0ng-Prov1sion!",
                "full_name": "Dup",
                "employee_code": "OPR-001",
                "role": Role.OPERATOR,
            },
            format="json",
        )
        assert resp.status_code == 400


class TestEmployeeMethodRestrictions:
    """Batch 1 / POMS-AUDIT-001 & 007: PUT/DELETE must not be exposed."""

    def test_employee_put_returns_405(self, admin_user, operator_user):
        resp = auth_client(admin_user).put(
            f"/api/v1/employees/{operator_user.pk}/",
            {"full_name": "X", "employee_code": "OPR-001", "role": "OPERATOR"},
            format="json",
        )
        assert resp.status_code == 405

    def test_employee_delete_returns_405(self, admin_user, operator_user):
        resp = auth_client(admin_user).delete(f"/api/v1/employees/{operator_user.pk}/")
        assert resp.status_code == 405
        operator_user.refresh_from_db()
        assert User.objects.filter(pk=operator_user.pk).exists()

    def test_employee_patch_still_works(self, admin_user, operator_user):
        resp = auth_client(admin_user).patch(
            f"/api/v1/employees/{operator_user.pk}/",
            {"full_name": "Renamed Operator"},
            format="json",
        )
        assert resp.status_code == 200
        operator_user.refresh_from_db()
        assert operator_user.full_name == "Renamed Operator"

    def test_employee_post_still_works(self, admin_user):
        resp = auth_client(admin_user).post(
            "/api/v1/employees/",
            {
                "username": "stillworks",
                "password": "Str0ng-Prov1sion!",
                "full_name": "Still Works",
                "employee_code": "OPR-777",
                "role": Role.OPERATOR,
            },
            format="json",
        )
        assert resp.status_code == 201


class TestEmployeePermissions:
    """Batch 1 / POMS-AUDIT-001: administrative endpoints are admin-only."""

    def test_employee_cannot_retrieve_employee(self, cutting_user, operator_user):
        resp = auth_client(cutting_user).get(f"/api/v1/employees/{operator_user.pk}/")
        assert resp.status_code == 403

    def test_employee_cannot_patch_employee(self, cutting_user, operator_user):
        resp = auth_client(cutting_user).patch(
            f"/api/v1/employees/{operator_user.pk}/",
            {"full_name": "Hacked"},
            format="json",
        )
        assert resp.status_code == 403

    def test_employee_cannot_deactivate_employee(self, cutting_user, operator_user):
        resp = auth_client(cutting_user).post(
            f"/api/v1/employees/{operator_user.pk}/deactivate/"
        )
        assert resp.status_code == 403
        operator_user.refresh_from_db()
        assert operator_user.is_active is True

    def test_unauthenticated_cannot_list_employees(self):
        resp = APIClient().get("/api/v1/employees/")
        assert resp.status_code == 401

    def test_admin_can_retrieve_employee(self, admin_user, operator_user):
        resp = auth_client(admin_user).get(f"/api/v1/employees/{operator_user.pk}/")
        assert resp.status_code == 200


class TestEmployeeRoleChange:
    """POMS-AUDIT-016: role changes must not invalidate active assignments."""

    def test_cannot_change_role_with_active_cutting_assignment(
        self, admin_user, cutting_user, operator_user
    ):
        _make_order(admin_user, cutting_user, operator_user, "ORD-ROLE1")
        resp = auth_client(admin_user).patch(
            f"/api/v1/employees/{cutting_user.pk}/",
            {"role": Role.OPERATOR},
            format="json",
        )
        assert resp.status_code == 400
        assert "role" in resp.data.get("errors", {})
        cutting_user.refresh_from_db()
        assert cutting_user.role == Role.CUTTING_MAN

    def test_cannot_change_role_with_active_operator_assignment(
        self, admin_user, cutting_user, operator_user
    ):
        _make_order(admin_user, cutting_user, operator_user, "ORD-ROLE2")
        resp = auth_client(admin_user).patch(
            f"/api/v1/employees/{operator_user.pk}/",
            {"role": Role.CUTTING_MAN},
            format="json",
        )
        assert resp.status_code == 400
        operator_user.refresh_from_db()
        assert operator_user.role == Role.OPERATOR

    def test_non_role_update_allowed_with_active_assignment(
        self, admin_user, cutting_user, operator_user
    ):
        _make_order(admin_user, cutting_user, operator_user, "ORD-ROLE3")
        resp = auth_client(admin_user).patch(
            f"/api/v1/employees/{cutting_user.pk}/",
            {"full_name": "Renamed Cutter"},
            format="json",
        )
        assert resp.status_code == 200, resp.data
        cutting_user.refresh_from_db()
        assert cutting_user.full_name == "Renamed Cutter"

    def test_role_change_allowed_without_assignments(self, admin_user, cutting_user):
        resp = auth_client(admin_user).patch(
            f"/api/v1/employees/{cutting_user.pk}/",
            {"role": Role.OPERATOR},
            format="json",
        )
        assert resp.status_code == 200, resp.data
        cutting_user.refresh_from_db()
        assert cutting_user.role == Role.OPERATOR


class TestEmployeeAPIContract:
    """POMS-AUDIT-007: the Employee API exposes only documented methods."""

    def test_viewset_excludes_put_and_delete(self):
        from apps.accounts.views import EmployeeViewSet

        assert set(EmployeeViewSet.http_method_names) == {
            "get",
            "post",
            "patch",
            "head",
            "options",
        }

    def test_openapi_employee_paths_expose_only_documented_methods(self):
        from drf_spectacular.generators import SchemaGenerator

        schema = SchemaGenerator().get_schema(request=None, public=True)
        paths = schema["paths"]
        detail = paths["/api/v1/employees/{id}/"]
        listing = paths["/api/v1/employees/"]
        assert set(detail) == {"get", "patch"}
        assert set(listing) == {"get", "post"}
        assert "put" not in detail and "delete" not in detail
        assert "put" not in listing and "delete" not in listing
        assert "post" in paths["/api/v1/employees/{id}/deactivate/"]