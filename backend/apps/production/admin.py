from django.contrib import admin

from apps.production.models import OrderNote, ProductionStatusHistory


@admin.register(ProductionStatusHistory)
class ProductionStatusHistoryAdmin(admin.ModelAdmin):
    list_display = ("order", "employee", "department", "previous_status", "new_status", "created_at")
    list_filter = ("department", "new_status")
    readonly_fields = ("created_at",)

    def has_change_permission(self, request, obj=None):
        return False

    def has_add_permission(self, request):
        return False


@admin.register(OrderNote)
class OrderNoteAdmin(admin.ModelAdmin):
    list_display = ("order", "author", "department", "created_at")
    list_filter = ("department",)
    search_fields = ("body",)