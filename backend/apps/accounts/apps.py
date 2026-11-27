from django.apps import AppConfig
from django.db import OperationalError, ProgrammingError
from django.db.models.signals import post_save, pre_save


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.accounts"
    label = "accounts"
    verbose_name = "Accounts"

    def ready(self) -> None:
        from .models import User

        pre_save.connect(_remember_previous_role, sender=User, dispatch_uid="accounts.role.pre")
        post_save.connect(_bridge_legacy_role, sender=User, dispatch_uid="accounts.role.post")


def _remember_previous_role(sender, instance, **kwargs):
    if instance.pk:
        instance._previous_role = (
            sender.objects.filter(pk=instance.pk)
            .values_list("role", flat=True)
            .first()
        )


def _bridge_legacy_role(sender, instance, created, raw=False, **kwargs):
    """Mirror the legacy ``role`` value onto RBAC data (transitional bridge)."""
    if raw:
        return
    previous = getattr(instance, "_previous_role", None)
    if not created and previous == instance.role:
        return
    try:
        from apps.rbac.services import sync_legacy_role

        sync_legacy_role(instance, instance.role)
    except (OperationalError, ProgrammingError):
        # Schema is mid-migration (e.g. the rbac tables do not exist yet).
        # The data migration backfills these rows afterwards.
        return
