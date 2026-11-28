"""Authentication security tests: email login, passwords, invitations, limits."""
import re
from datetime import timedelta

import pytest
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import (
    EmailConfiguration,
    Invitation,
    InvitationStatus,
    LoginAttempt,
    SystemSetting,
    User,
)
from apps.audit.models import AuditLog

pytestmark = pytest.mark.django_db


def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture(autouse=True)
def locmem_email(settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    mail.outbox.clear()
    yield mail.outbox


def token_from(subject: str) -> str:
    for message in reversed(mail.outbox):
        if subject in message.subject:
            match = re.search(r"token=([A-Za-z0-9_\-%]+)", message.body)
            if match:
                return match.group(1)
    raise AssertionError(f"No '{subject}' email was sent")


def login(identifier, password):
    return APIClient().post(
        "/api/v1/auth/login/",
        {"email": identifier, "password": password},
        format="json",
    )


class TestEmailAuthentication:
    def test_login_with_email(self, admin_user):
        admin_user.email = "admin@example.com"
        admin_user.save(update_fields=["email"])
        resp = login("admin@example.com", "Admin12345!")
        assert resp.status_code == 200
        assert resp.data["user"]["role"] == "ADMIN"

    def test_login_with_username_still_works(self, admin_user):
        resp = APIClient().post(
            "/api/v1/auth/login/",
            {"username": "admin1", "password": "Admin12345!"},
            format="json",
        )
        assert resp.status_code == 200

    def test_unknown_account_and_wrong_password_are_indistinguishable(self, admin_user):
        unknown = login("nobody@example.com", "Whatever123!")
        wrong = login("admin1", "Whatever123!")
        assert unknown.status_code == wrong.status_code == 401
        assert unknown.data["detail"] == wrong.data["detail"]

    def test_inactive_user_cannot_login(self, operator_user):
        operator_user.is_active = False
        operator_user.save(update_fields=["is_active"])
        assert login("operator1", "Operator12345!").status_code == 401

    def test_login_is_rate_limited(self, admin_user):
        for _ in range(15):
            assert login("admin1", "wrong-password").status_code == 401
        resp = login("admin1", "wrong-password")
        assert resp.status_code == 429
        assert LoginAttempt.objects.filter(successful=False).count() >= 15


class TestPasswordLifecycle:
    def test_change_password_requires_current(self, admin_user):
        resp = auth_client(admin_user).post(
            "/api/v1/auth/change-password/",
            {"current_password": "nope", "new_password": "N3w-Str0ng-Pass!"},
            format="json",
        )
        assert resp.status_code == 400

    def test_change_password_validates_strength(self, admin_user):
        resp = auth_client(admin_user).post(
            "/api/v1/auth/change-password/",
            {"current_password": "Admin12345!", "new_password": "password12345"},
            format="json",
        )
        assert resp.status_code == 400

    def test_change_password_success(self, admin_user):
        resp = auth_client(admin_user).post(
            "/api/v1/auth/change-password/",
            {"current_password": "Admin12345!", "new_password": "N3w-Str0ng-Pass!"},
            format="json",
        )
        assert resp.status_code == 200
        assert login("admin1", "N3w-Str0ng-Pass!").status_code == 200
        assert AuditLog.objects.filter(action="auth.password_changed").exists()

    def test_forgot_password_does_not_enumerate(self):
        resp = APIClient().post(
            "/api/v1/auth/password/forgot/",
            {"email": "ghost@example.com"},
            format="json",
        )
        assert resp.status_code == 204
        assert len(mail.outbox) == 0

    def test_password_reset_flow_is_single_use(self, admin_user):
        admin_user.email = "admin@example.com"
        admin_user.save(update_fields=["email"])
        resp = APIClient().post(
            "/api/v1/auth/password/forgot/",
            {"email": "admin@example.com"},
            format="json",
        )
        assert resp.status_code == 204
        token = token_from("Reset your POMS password")

        reset = APIClient().post(
            "/api/v1/auth/password/reset/",
            {"token": token, "new_password": "R3set-Str0ng-Pass!"},
            format="json",
        )
        assert reset.status_code == 200, reset.data
        assert login("admin@example.com", "R3set-Str0ng-Pass!").status_code == 200

        reuse = APIClient().post(
            "/api/v1/auth/password/reset/",
            {"token": token, "new_password": "Another-Pass-9x!"},
            format="json",
        )
        assert reuse.status_code == 400

    def test_audit_never_contains_passwords(self, admin_user):
        auth_client(admin_user).post(
            "/api/v1/auth/change-password/",
            {"current_password": "Admin12345!", "new_password": "N3w-Str0ng-Pass!"},
            format="json",
        )
        for entry in AuditLog.objects.all():
            assert "N3w-Str0ng-Pass!" not in str(entry.after)
            assert "Admin12345!" not in str(entry.before)


class TestEmailVerification:
    def test_admin_created_account_with_email_must_verify(self, admin_user, locmem_email):
        resp = auth_client(admin_user).post(
            "/api/v1/employees/",
            {
                "username": "verify1",
                "password": "Str0ng-Prov1sion!",
                "full_name": "Verify One",
                "employee_code": "VER-001",
                "email": "verify1@example.com",
                "role": "OPERATOR",
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data
        assert login("verify1@example.com", "Str0ng-Prov1sion!").status_code == 401

        token = token_from("Verify your POMS email")
        verify = APIClient().post(
            "/api/v1/auth/email/verify/", {"token": token}, format="json"
        )
        assert verify.status_code == 200, verify.data
        assert login("verify1@example.com", "Str0ng-Prov1sion!").status_code == 200

    def test_verification_token_is_single_use(self, admin_user):
        admin_user.email = "admin@example.com"
        admin_user.requires_email_verification = True
        admin_user.save(update_fields=["email", "requires_email_verification"])
        auth_client(admin_user).post("/api/v1/auth/email/resend-verification/")
        token = token_from("Verify your POMS email")
        assert (
            APIClient().post(
                "/api/v1/auth/email/verify/", {"token": token}, format="json"
            ).status_code
            == 200
        )
        assert (
            APIClient().post(
                "/api/v1/auth/email/verify/", {"token": token}, format="json"
            ).status_code
            == 400
        )


class TestInvitations:
    def _invite(self, client, email="invitee@example.com"):
        return client.post(
            "/api/v1/invitations/",
            {"email": email, "full_name": "Invitee", "employee_code": "INV-001"},
            format="json",
        )

    def test_invitation_flow(self, admin_user):
        client = auth_client(admin_user)
        resp = self._invite(client)
        assert resp.status_code == 201, resp.data
        assert resp.data["status"] == InvitationStatus.PENDING
        assert "token" not in resp.data

        token = token_from("You are invited to POMS")
        accept = APIClient().post(
            "/api/v1/invitations/accept/",
            {"token": token, "password": "Inv1ted-Str0ng!"},
            format="json",
        )
        assert accept.status_code == 201, accept.data
        assert login("invitee@example.com", "Inv1ted-Str0ng!").status_code == 200

        # Single-use.
        replay = APIClient().post(
            "/api/v1/invitations/accept/",
            {"token": token, "password": "Inv1ted-Str0ng!"},
            format="json",
        )
        assert replay.status_code == 400

    def test_invitation_cannot_be_resent_after_acceptance(self, admin_user):
        client = auth_client(admin_user)
        invitation_id = self._invite(client).data["id"]
        token = token_from("You are invited to POMS")
        APIClient().post(
            "/api/v1/invitations/accept/",
            {"token": token, "password": "Inv1ted-Str0ng!"},
            format="json",
        )
        resp = client.post(f"/api/v1/invitations/{invitation_id}/resend/")
        assert resp.status_code == 400

    def test_invitation_expiry(self, admin_user):
        client = auth_client(admin_user)
        invitation_id = self._invite(client).data["id"]
        token = token_from("You are invited to POMS")
        Invitation.objects.filter(pk=invitation_id).update(
            expires_at=timezone.now() - timedelta(minutes=1)
        )
        resp = APIClient().post(
            "/api/v1/invitations/accept/",
            {"token": token, "password": "Inv1ted-Str0ng!"},
            format="json",
        )
        assert resp.status_code == 400
        assert Invitation.objects.get(pk=invitation_id).status == InvitationStatus.EXPIRED

    def test_invitation_cancel(self, admin_user):
        client = auth_client(admin_user)
        invitation_id = self._invite(client).data["id"]
        token = token_from("You are invited to POMS")
        assert client.post(f"/api/v1/invitations/{invitation_id}/cancel/").status_code == 200
        resp = APIClient().post(
            "/api/v1/invitations/accept/",
            {"token": token, "password": "Inv1ted-Str0ng!"},
            format="json",
        )
        assert resp.status_code == 400

    def test_resend_rotates_the_token(self, admin_user):
        client = auth_client(admin_user)
        invitation_id = self._invite(client).data["id"]
        first = token_from("You are invited to POMS")
        assert client.post(f"/api/v1/invitations/{invitation_id}/resend/").status_code == 200
        second = token_from("Your POMS invitation")
        assert first != second
        assert (
            APIClient().post(
                "/api/v1/invitations/accept/",
                {"token": first, "password": "Inv1ted-Str0ng!"},
                format="json",
            ).status_code
            == 400
        )

    def test_employee_cannot_create_invitation(self, cutting_user):
        resp = auth_client(cutting_user).post(
            "/api/v1/invitations/",
            {"email": "x@example.com"},
            format="json",
        )
        assert resp.status_code == 403

    def test_admin_can_configure_invitation_expiry(self, admin_user):
        client = auth_client(admin_user)
        resp = client.patch(
            "/api/v1/invitations/settings/",
            {"invitation_expiry_hours": 12},
            format="json",
        )
        assert resp.status_code == 200, resp.data
        assert resp.data["invitation_expiry_hours"] == 12

        created = client.post(
            "/api/v1/invitations/",
            {"email": "short@example.com"},
            format="json",
        )
        assert created.status_code == 201
        invitation = Invitation.objects.get(email="short@example.com")
        remaining = invitation.expires_at - timezone.now()
        assert timedelta(hours=11) < remaining <= timedelta(hours=12)

    def test_employee_cannot_configure_invitation_expiry(self, cutting_user):
        resp = auth_client(cutting_user).patch(
            "/api/v1/invitations/settings/",
            {"invitation_expiry_hours": 12},
            format="json",
        )
        assert resp.status_code == 403

    def test_invitation_expiry_setting_is_capped(self, admin_user):
        SystemSetting.objects.filter(key="invitation_expiry_hours").update(value=999)
        from apps.accounts.services import invitation_expiry_hours

        assert invitation_expiry_hours() == 168


class TestDjangoAdminSurface:
    """Phase 1 finding H-03: the admin site must not bypass API safeguards."""

    def test_security_fields_are_read_only_and_creation_is_disabled(self):
        from django.contrib.admin.sites import AdminSite

        from apps.accounts.admin import UserAdmin

        admin = UserAdmin(User, AdminSite())
        assert admin.has_add_permission(None) is False
        assert admin.has_delete_permission(None) is False
        for field in ("role", "is_active", "is_staff", "is_superuser"):
            assert field in admin.readonly_fields

    def test_audit_log_is_not_registered_in_admin(self):
        from django.contrib import admin as django_admin

        from apps.audit.models import AuditLog

        assert AuditLog not in django_admin.site._registry


class TestSystemEmailConfiguration:
    def test_superuser_only(self, admin_user):
        root = User.objects.create_superuser(
            username="root", email="root@example.com", password="R00t-Pass-9x!"
        )
        assert auth_client(admin_user).get("/api/v1/system/email/").status_code == 403
        resp = auth_client(root).get("/api/v1/system/email/")
        assert resp.status_code == 200
        assert "smtp_password" not in resp.data
        assert "has_password" in resp.data

    def test_secret_is_never_accepted_into_the_database(self):
        root = User.objects.create_superuser(
            username="root2", email="root2@example.com", password="R00t-Pass-9x!"
        )
        resp = auth_client(root).patch(
            "/api/v1/system/email/",
            {"smtp_password": "hunter2"},
            format="json",
        )
        assert resp.status_code == 400
        assert EmailConfiguration.load().password_env_var

    def test_system_settings_require_superuser(self, admin_user):
        root = User.objects.create_superuser(
            username="root3", email="root3@example.com", password="R00t-Pass-9x!"
        )
        assert auth_client(admin_user).get("/api/v1/system/settings/").status_code == 403
        resp = auth_client(root).patch(
            "/api/v1/system/settings/",
            {"invitation_expiry_hours": 24},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.data["invitation_expiry_hours"] == 24
