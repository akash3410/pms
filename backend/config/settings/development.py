"""Development settings for POMS."""
from .base import *  # noqa: F401,F403

DEBUG = True

ALLOWED_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0"]

# Local dev: allow all origins for convenience. Lock this down in production.
CORS_ALLOW_ALL_ORIGINS = True

# Use a fast, insecure password hasher for local development speed.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.MD5PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]

# Email backend for dev (prints to console)
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"