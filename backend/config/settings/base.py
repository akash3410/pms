"""
Base settings shared across all environments for the POMS backend.

Environment-specific modules (development.py / production.py) import from
this file and override what they need. All secrets and environment-specific
values are read from environment variables (optionally loaded from a local
``.env`` file via python-dotenv). No secret is ever hardcoded here.
"""
from datetime import timedelta
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

# backend/ directory (contains manage.py)
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Load .env if present (never committed). Existing real env vars win.
load_dotenv(BASE_DIR / ".env")


def env(key: str, default: str | None = None, *, required: bool = False) -> str:
    """Read an environment variable with an optional default / required check."""
    value = os_env(key)
    if value is None or value == "":
        if required:
            raise ImproperlyConfigured(f"Missing required environment variable: {key}")
        return default  # type: ignore[return-value]
    return value


def os_env(key: str) -> str | None:
    import os

    return os.environ.get(key)


def env_bool(key: str, default: bool = False) -> bool:
    raw = os_env(key)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_int(key: str, default: int) -> int:
    raw = os_env(key)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ImproperlyConfigured(f"Environment variable {key} must be an integer") from exc


def env_list(key: str, default: list[str] | None = None) -> list[str]:
    raw = os_env(key)
    if raw is None or raw == "":
        return default or []
    return [item.strip() for item in raw.split(",") if item.strip()]


# --------------------------------------------------------------------------- #
# Core
# --------------------------------------------------------------------------- #
# SECURITY: default to development-safe values; production.py enforces strictness.
SECRET_KEY = env(
    "DJANGO_SECRET_KEY",
    default="django-insecure-change-me-in-production-0000000000000000",
)
DEBUG = env_bool("DJANGO_DEBUG", default=False)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third-party
    "rest_framework",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
    "rest_framework_simplejwt.token_blacklist",
    # Local apps
    "apps.accounts",
    "apps.rbac",
    "apps.audit",
    "apps.orders",
    "apps.production",
    "apps.targets",
    "apps.reports",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# --------------------------------------------------------------------------- #
# Database (PostgreSQL)
# --------------------------------------------------------------------------- #
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("POSTGRES_DB", default="poms"),
        "USER": env("POSTGRES_USER", default="poms"),
        "PASSWORD": env("POSTGRES_PASSWORD", default="poms"),
        "HOST": env("POSTGRES_HOST", default="127.0.0.1"),
        "PORT": env("POSTGRES_PORT", default="5432"),
        "CONN_MAX_AGE": env_int("CONN_MAX_AGE", default=60),
        "OPTIONS": {
            "connect_timeout": env_int("POSTGRES_CONNECT_TIMEOUT", default=10),
        },
    }
}

# --------------------------------------------------------------------------- #
# Custom user model
# --------------------------------------------------------------------------- #
# NOTE: Wired to the accounts.User model in Phase 2 (Database & Core Models).
# It is set there once the model exists so migrations are authored against it
# from the very first migration.
AUTH_USER_MODEL = "accounts.User"

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# --------------------------------------------------------------------------- #
# Internationalization
# --------------------------------------------------------------------------- #
LANGUAGE_CODE = "en-us"
TIME_ZONE = env("TIME_ZONE", default="Asia/Dhaka")
USE_I18N = True
USE_TZ = True

# --------------------------------------------------------------------------- #
# Static & media
# --------------------------------------------------------------------------- #
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

# Upload limits (validated again at the application layer)
DATA_UPLOAD_MAX_MEMORY_SIZE = env_int("DATA_UPLOAD_MAX_MEMORY_SIZE", default=10 * 1024 * 1024)  # 10 MB
FILE_UPLOAD_MAX_MEMORY_SIZE = env_int("FILE_UPLOAD_MAX_MEMORY_SIZE", default=5 * 1024 * 1024)  # 5 MB

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --------------------------------------------------------------------------- #
# Django REST Framework
# --------------------------------------------------------------------------- #
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    # Every endpoint requires an authenticated, active account unless it opts
    # out explicitly (login, refresh, password reset, invitation acceptance).
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
        "apps.accounts.permissions.IsActiveUser",
    ),
    "DEFAULT_PAGINATION_CLASS": "common.pagination.StandardResultsSetPagination",
    "PAGE_SIZE": env_int("PAGE_SIZE", default=20),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_RENDERER_CLASSES": (
        "rest_framework.renderers.JSONRenderer",
        "rest_framework.renderers.BrowsableAPIRenderer",
    ),
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
    "EXCEPTION_HANDLER": "common.exceptions.poms_exception_handler",
}

# --------------------------------------------------------------------------- #
# Simple JWT
# --------------------------------------------------------------------------- #
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env_int("ACCESS_TOKEN_MINUTES", default=60)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env_int("REFRESH_TOKEN_DAYS", default=7)),
    "ROTATE_REFRESH_TOKENS": env_bool("ROTATE_REFRESH_TOKENS", default=True),
    "BLACKLIST_AFTER_ROTATION": env_bool("BLACKLIST_AFTER_ROTATION", default=True),
    "UPDATE_LAST_LOGIN": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
    "TOKEN_TYPE_CLAIM": "token_type",
    "AUTH_TOKEN_CLASSES": ("rest_framework_simplejwt.tokens.AccessToken",),
}

# --------------------------------------------------------------------------- #
# Email / links
# --------------------------------------------------------------------------- #
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="no-reply@poms.local")
# Base URL used in invitation / password-reset links.
FRONTEND_URL = env("FRONTEND_URL", default="http://localhost:3000")
# Invitation lifetime is configurable by a superuser through the API, bounded
# by a hard maximum of 7 days in apps.accounts.services.
INVITATION_EXPIRY_HOURS = env_int("INVITATION_EXPIRY_HOURS", default=72)


def _dev_email_backend() -> str:
    """Console backend in development, SMTP (DB-configurable) otherwise."""
    return env(
        "EMAIL_BACKEND",
        default="django.core.mail.backends.console.EmailBackend"
        if DEBUG
        else "django.core.mail.backends.smtp.EmailBackend",
    )


EMAIL_BACKEND = _dev_email_backend()
EMAIL_HOST = env("EMAIL_HOST", default="localhost")
EMAIL_PORT = env_int("EMAIL_PORT", default=25)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", default=False)
EMAIL_TIMEOUT = env_int("EMAIL_TIMEOUT", default=10)

# --------------------------------------------------------------------------- #
# drf-spectacular (OpenAPI / Swagger)
SPECTACULAR_SETTINGS = {
    "TITLE": "Production Order Management System (POMS) API",
    "DESCRIPTION": "Backend REST API for managing production orders, employee assignments, "
    "production progress, targets and reports.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "SCHEMA_PATH_PREFIX": "/api/v1",
    # Deterministic enum component names (avoids auto-collisions).
    "ENUM_NAME_OVERRIDES": {
        # ``*Enum`` suffix avoids colliding with the RBAC ``Department`` model
        # serializer component names.
        "DepartmentEnum": "common.enums.Department.choices",
        "NoteDepartmentEnum": "common.enums.NoteDepartment.choices",
        "ProductionStatusEnum": "common.enums.ProductionStatus.choices",
        "OverallStatusEnum": "common.enums.OverallStatus.choices",
        "PeriodTypeEnum": "common.enums.PeriodType.choices",
    },
}

# --------------------------------------------------------------------------- #
# CORS
# --------------------------------------------------------------------------- #
CORS_ALLOW_ALL_ORIGINS = env_bool("CORS_ALLOW_ALL_ORIGINS", default=True)
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", default=[])
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", default=[])

# --------------------------------------------------------------------------- #
# Application-specific configuration
# --------------------------------------------------------------------------- #
# Order-card image processing
ORIGINAL_IMAGE_DIR = "originals"
GENERATED_IMAGE_DIR = "generated"
MAX_ORDER_IMAGE_SIZE_BYTES = env_int("MAX_ORDER_IMAGE_SIZE_MB", default=10) * 1024 * 1024
# Pixel / dimension caps to prevent decompression-bomb memory exhaustion
# (POMS-AUDIT-005). A highly-compressed image can declare enormous dimensions and
# expand to hundreds of MB of RAM on decode; reject it before any decode.
MAX_ORDER_IMAGE_PIXELS = env_int("MAX_ORDER_IMAGE_PIXELS", default=40_000_000)
MAX_ORDER_IMAGE_DIMENSION = env_int("MAX_ORDER_IMAGE_DIMENSION", default=10_000)
ALLOWED_IMAGE_EXTENSIONS = env_list(
    "ALLOWED_IMAGE_EXTENSIONS", default=["jpg", "jpeg", "png", "webp"]
)
ALLOWED_IMAGE_CONTENT_TYPES = env_list(
    "ALLOWED_IMAGE_CONTENT_TYPES",
    default=["image/jpeg", "image/png", "image/webp"],
)

# Logging (structured, console-friendly)
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{asctime} [{levelname}] {name}: {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": env("DJANGO_LOG_LEVEL", default="INFO"),
    },
    "loggers": {
        "django.db.backends": {
            "level": "WARNING",
            "handlers": ["console"],
            "propagate": False,
        },
        "poms": {
            "level": env("POMS_LOG_LEVEL", default="INFO"),
            "handlers": ["console"],
            "propagate": False,
        },
    },
}