"""Root URL configuration for the POMS backend."""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)

urlpatterns = [
    path("admin/", admin.site.urls),
    # API v1
    path("api/v1/", include("config.api_urls")),
    # OpenAPI schema & docs
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
    path(
        "api/redoc/",
        SpectacularRedocView.as_view(url_name="schema"),
        name="redoc",
    ),
]

if settings.DEBUG:
    # Static files only. MEDIA (order-card images) is NEVER served statically:
    # it is delivered exclusively through the authenticated, permission-checked
    # endpoints on the orders resource (see OrderViewSet original-image /
    # generated-image actions). This prevents unauthenticated access to order
    # card images by guessing /media/... URLs.
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)