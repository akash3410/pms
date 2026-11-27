"""Tests for health check endpoint."""
import pytest
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


class TestHealthCheck:
    def test_healthy(self):
        client = APIClient()
        resp = client.get("/api/v1/health/")
        assert resp.status_code == 200
        assert resp.json() == {"status": "healthy"}

    def test_unhealthy_when_db_down(self, monkeypatch):
        from django.db import connections

        def failing_cursor(*args, **kwargs):
            from django.db.utils import OperationalError
            raise OperationalError("connection failed")

        monkeypatch.setattr(connections["default"], "cursor", failing_cursor)

        client = APIClient()
        resp = client.get("/api/v1/health/")
        assert resp.status_code == 503
        data = resp.json()
        assert data["status"] == "unhealthy"
        assert data["database"] == "unavailable"