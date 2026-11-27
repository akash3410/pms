"""Seed system settings and the email-configuration singleton."""
from django.conf import settings
from django.db import migrations

DEFAULTS = {
    "invitation_expiry_hours": 72,
    "require_email_verification": False,
}


def seed(apps, schema_editor):
    SystemSetting = apps.get_model("accounts", "SystemSetting")
    EmailConfiguration = apps.get_model("accounts", "EmailConfiguration")

    for key, value in DEFAULTS.items():
        SystemSetting.objects.get_or_create(key=key, defaults={"value": value})

    EmailConfiguration.objects.get_or_create(
        pk="00000000-0000-0000-0000-00000000e001",
        defaults={
            "host": getattr(settings, "EMAIL_HOST", ""),
            "port": getattr(settings, "EMAIL_PORT", 587),
            "username": getattr(settings, "EMAIL_HOST_USER", ""),
            "from_email": getattr(settings, "DEFAULT_FROM_EMAIL", ""),
            "use_tls": getattr(settings, "EMAIL_USE_TLS", True),
            "is_active": False,
        },
    )


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0002_rbac_auth_fields"),
    ]

    operations = [
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
