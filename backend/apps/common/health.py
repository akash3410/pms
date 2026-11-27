"""Health check endpoint for load balancer and monitoring probes."""
from django.db import connections
from django.db.utils import OperationalError
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthCheckView(APIView):
    """
    Application health check endpoint.

    Public endpoint (no authentication) for load balancer / orchestration probes.
    Verifies database connectivity without exposing sensitive information.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(
        responses={200: OpenApiTypes.OBJECT, 503: OpenApiTypes.OBJECT},
        description="Liveness/readiness probe. Verifies database connectivity.",
    )
    def get(self, request):
        db_ok = self._check_database()
        if db_ok:
            return Response({"status": "healthy"}, status=status.HTTP_200_OK)
        return Response(
            {"status": "unhealthy", "database": "unavailable"},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    def _check_database(self) -> bool:
        """Check if the default database connection is usable."""
        try:
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT 1")
                return cursor.fetchone() == (1,)
        except OperationalError:
            return False
        except Exception:
            return False