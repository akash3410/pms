from django.apps import AppConfig
from django.db.models.signals import post_migrate


class RBACConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.rbac"
    label = "rbac"
    verbose_name = "RBAC"

    def ready(self) -> None:
        # Re-seed after ``migrate`` and after ``flush`` (which emits post_migrate
        # and deletes every row, including the permission catalogue).
        from .seed import seed_after_migrate

        post_migrate.connect(
            seed_after_migrate, dispatch_uid="rbac.seed_after_migrate"
        )
