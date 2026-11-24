"""Production settings for POMS.

Fails fast if critical security-relevant environment variables are missing or
set to insecure defaults.
"""
from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F401,F403
from .base import SECRET_KEY, env, env_bool

DEBUG = False

# SECRET_KEY must be explicitly set to a strong value in production.
_insecure_default = "django-insecure-change-me-in-production-0000000000000000"
if _insecure_default == SECRET_KEY:
    raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set to a strong value in production.")

ALLOWED_HOSTS = env("DJANGO_ALLOWED_HOSTS", required=True).split(",") if env("DJANGO_ALLOWED_HOSTS") else []
ALLOWED_HOSTS = [h.strip() for h in ALLOWED_HOSTS if h.strip()]
if not ALLOWED_HOSTS:
    raise ImproperlyConfigured("DJANGO_ALLOWED_HOSTS must be set in production.")

# Security headers / transport security
SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", default=True)
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_HSTS_SECONDS = env_int("SECURE_HSTS_SECONDS", default=31536000)  # noqa: F405
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
CSRF_COOKIE_HTTPONLY = True
X_FRAME_OPTIONS = "DENY"

# Strong password hashing
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.Argon2PasswordHasher",
]

# Production should NOT allow arbitrary CORS origins.
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS", default="").split(",") if env("CORS_ALLOWED_ORIGINS") else []
CORS_ALLOWED_ORIGINS = [o.strip() for o in CORS_ALLOWED_ORIGINS if o.strip()]
CSRF_TRUSTED_ORIGINS = env("CSRF_TRUSTED_ORIGINS", default="").split(",") if env("CSRF_TRUSTED_ORIGINS") else []
CSRF_TRUSTED_ORIGINS = [o.strip() for o in CSRF_TRUSTED_ORIGINS if o.strip()]