from django.contrib import admin

from apps.orders.models import AssignmentHistory, Order


class AssignmentHistoryInline(admin.TabularInline):
    model = AssignmentHistory
    extra = 0
    readonly_fields = ("department", "previous_employee", "new_employee", "assigned_by", "assigned_at")
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ("order_number", "cutting_man", "operator", "overall_status", "created_at")
    list_filter = ("overall_status", "cutting_status", "operator_status")
    search_fields = ("order_number",)
    readonly_fields = ("overall_status", "created_at", "updated_at", "generated_image")
    inlines = [AssignmentHistoryInline]


@admin.register(AssignmentHistory)
class AssignmentHistoryAdmin(admin.ModelAdmin):
    list_display = ("order", "department", "previous_employee", "new_employee", "assigned_by", "assigned_at")
    list_filter = ("department",)
    readonly_fields = ("assigned_at",)

    def has_change_permission(self, request, obj=None):
        return False