from django.contrib import admin

from apps.targets.models import CompletionCredit, EmployeeTarget


@admin.register(EmployeeTarget)
class EmployeeTargetAdmin(admin.ModelAdmin):
    list_display = ("employee", "department", "period_type", "start_date", "end_date", "target_count")
    list_filter = ("period_type", "department")
    search_fields = ("employee__full_name", "employee__employee_code")

    def has_delete_permission(self, request, obj=None):
        # A target that has earned completion credits is historical attribution
        # data and must never be deleted (POMS-AUDIT-019). The DB/ORM PROTECT on
        # CompletionCredit.target is the hard guard; this is the admin UX guard.
        if obj is not None and obj.credits.exists():
            return False
        return super().has_delete_permission(request, obj)


@admin.register(CompletionCredit)
class CompletionCreditAdmin(admin.ModelAdmin):
    list_display = ("employee", "order", "department", "credit_date", "target")
    list_filter = ("department", "credit_date")
    readonly_fields = ("created_at", "updated_at")

    def has_change_permission(self, request, obj=None):
        return False

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        # CompletionCredit is immutable historical attribution — never deletable.
        return False