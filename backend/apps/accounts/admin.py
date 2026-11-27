"""Django Admin registration for accounts — hardened against API bypass.

Phase 1 finding H-03/H-04: the admin site previously allowed editing ``role``,
``is_superuser``, ``is_staff``, groups and permissions, and deleting accounts,
with no guards and no audit. All authorization-relevant fields are now
read-only, account creation/deletion is disabled, and the guard rails live in
the API (which is audited and transaction-guarded). Superusers are created with
``manage.py createsuperuser`` (now working — finding M-02).
"""
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.utils.translation import gettext_lazy as _

from apps.accounts.models import Invitation, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = (
        "employee_code",
        "full_name",
        "username",
        "email",
        "role",
        "is_active",
        "is_staff",
        "is_superuser",
    )
    list_filter = ("role", "is_active", "is_staff", "is_superuser", "email_verified_at")
    search_fields = ("employee_code", "full_name", "username", "email")
    ordering = ("employee_code",)
    fieldsets = (
        (None, {"fields": ("username", "password")}),
        (
            _("Personal info"),
            {"fields": ("full_name", "employee_code", "email", "email_verified_at")},
        ),
        (
            _("Read-only security state"),
            {
                "fields": ("role", "is_active", "is_staff", "is_superuser"),
                "description": (
                    "Managed through the API only, where changes are permission-"
                    "checked, audited, and guarded against administrative lockout."
                ),
            },
        ),
        (_("Important dates"), {"fields": ("last_login", "date_joined")}),
    )
    readonly_fields = (
        "id",
        "created_at",
        "updated_at",
        "date_joined",
        "last_login",
        "role",
        "is_active",
        "is_staff",
        "is_superuser",
        "email_verified_at",
    )

    def has_add_permission(self, request):
        # Account creation must go through the API (validation + audit).
        return False

    def has_delete_permission(self, request, obj=None):
        # Accounts are deactivated, never deleted (history preservation).
        return False


@admin.register(Invitation)
class InvitationAdmin(admin.ModelAdmin):
    list_display = ("email", "status", "expires_at", "send_count", "created_at")
    list_filter = ("status",)
    search_fields = ("email", "full_name", "employee_code")
    readonly_fields = (
        "id",
        "token_hash",
        "expires_at",
        "accepted_at",
        "cancelled_at",
        "last_sent_at",
        "send_count",
    )

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
