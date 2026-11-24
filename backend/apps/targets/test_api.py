"""API tests for targets and reports (Phase 6)."""
import io
import threading

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from apps.targets.models import CompletionCredit, EmployeeTarget
from common.enums import Department, PeriodType, ProductionStatus

pytestmark = pytest.mark.django_db


def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _img():
    buf = io.BytesIO()
    Image.new("RGB", (120, 80), (1, 2, 3)).save(buf, format="PNG")
    return SimpleUploadedFile("c.png", buf.getvalue(), content_type="image/png")


def _base_payload(employee, **over):
    today = timezone.localdate()
    payload = {
        "employee": str(employee.pk),
        "department": Department.CUTTING,
        "period_type": PeriodType.DAILY,
        "start_date": today.isoformat(),
        "end_date": today.isoformat(),
        "target_count": 10,
    }
    payload.update(over)
    return payload


class TestTargetCRUD:
    def test_admin_creates_target(self, admin_user, cutting_user):
        resp = auth_client(admin_user).post(
            "/api/v1/targets/", _base_payload(cutting_user), format="json"
        )
        assert resp.status_code == 201, resp.data
        assert resp.data["target_count"] == 10
        assert resp.data["achieved_count"] == 0

    def test_employee_cannot_create_target(self, cutting_user):
        resp = auth_client(cutting_user).post(
            "/api/v1/targets/", _base_payload(cutting_user), format="json"
        )
        assert resp.status_code == 403

    def test_department_must_match_role(self, admin_user, operator_user):
        # operator_user is OPERATOR; requesting CUTTING department should fail.
        resp = auth_client(admin_user).post(
            "/api/v1/targets/", _base_payload(operator_user), format="json"
        )
        assert resp.status_code == 400

    def test_end_before_start_rejected(self, admin_user, cutting_user):
        payload = _base_payload(
            cutting_user, start_date="2026-12-10", end_date="2026-12-01"
        )
        resp = auth_client(admin_user).post("/api/v1/targets/", payload, format="json")
        assert resp.status_code == 400

    def test_overlap_rejected(self, admin_user, cutting_user):
        client = auth_client(admin_user)
        first = client.post("/api/v1/targets/", _base_payload(cutting_user), format="json")
        assert first.status_code == 201
        second = client.post("/api/v1/targets/", _base_payload(cutting_user), format="json")
        assert second.status_code == 400

    def test_non_overlapping_daily_ok(self, admin_user, cutting_user):
        client = auth_client(admin_user)
        today = timezone.localdate()
        a = client.post("/api/v1/targets/", _base_payload(cutting_user), format="json")
        b = client.post(
            "/api/v1/targets/",
            _base_payload(
                cutting_user,
                start_date=(today).isoformat(),
                end_date=(today).isoformat(),
            ),
            format="json",
        )
        assert a.status_code == 201
        assert b.status_code == 400  # same day overlaps

    def test_admin_can_list_targets(self, admin_user, cutting_user):
        auth_client(admin_user).post("/api/v1/targets/", _base_payload(cutting_user), format="json")
        resp = auth_client(admin_user).get("/api/v1/targets/")
        assert resp.status_code == 200
        assert resp.data["count"] == 1


class TestCompletionIntegration:
    def _create_order(self, admin_user, cutting_user, operator_user):
        client = auth_client(admin_user)
        resp = client.post(
            "/api/v1/orders/",
            {
                "order_number": "ORD-TGT-1",
                "original_image": _img(),
                "cutting_man": str(cutting_user.pk),
                "operator": str(operator_user.pk),
            },
            format="multipart",
        )
        assert resp.status_code == 201, resp.data
        return resp.data["id"]

    def test_completion_creates_credit(self, admin_user, cutting_user, operator_user):
        # Target for today
        auth_client(admin_user).post(
            "/api/v1/targets/", _base_payload(cutting_user), format="json"
        )
        order_id = self._create_order(admin_user, cutting_user, operator_user)
        resp = auth_client(cutting_user).patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": ProductionStatus.COMPLETED},
            format="json",
        )
        assert resp.status_code == 200
        assert CompletionCredit.objects.filter(
            employee=cutting_user, order_id=order_id, department=Department.CUTTING
        ).count() == 1

    def test_reopen_and_recomplete_no_double_credit(self, admin_user, cutting_user, operator_user):
        auth_client(admin_user).post(
            "/api/v1/targets/", _base_payload(cutting_user), format="json"
        )
        order_id = self._create_order(admin_user, cutting_user, operator_user)
        client = auth_client(cutting_user)
        client.patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": ProductionStatus.COMPLETED},
            format="json",
        )
        client.patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": ProductionStatus.PENDING},
            format="json",
        )
        client.patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": ProductionStatus.COMPLETED},
            format="json",
        )
        assert (
            CompletionCredit.objects.filter(
                employee=cutting_user, order_id=order_id
            ).count()
            == 1
        )


class TestTargetImmutability:
    """POMS-AUDIT-006: identity fields are immutable once credits exist."""

    def _create_order(self, admin_user, cutting_user, operator_user, number="ORD-TGT-2"):
        resp = auth_client(admin_user).post(
            "/api/v1/orders/",
            {
                "order_number": number,
                "original_image": _img(),
                "cutting_man": str(cutting_user.pk),
                "operator": str(operator_user.pk),
            },
            format="multipart",
        )
        assert resp.status_code == 201, resp.data
        return resp.data["id"]

    def _target_with_credit(self, admin_user, cutting_user, operator_user):
        auth_client(admin_user).post(
            "/api/v1/targets/", _base_payload(cutting_user), format="json"
        )
        order_id = self._create_order(admin_user, cutting_user, operator_user)
        auth_client(cutting_user).patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": ProductionStatus.COMPLETED},
            format="json",
        )

    def test_cannot_change_employee_after_credit(self, admin_user, cutting_user, operator_user):
        self._target_with_credit(admin_user, cutting_user, operator_user)
        target = EmployeeTarget.objects.get(employee=cutting_user)
        resp = auth_client(admin_user).patch(
            f"/api/v1/targets/{target.pk}/",
            {"employee": str(operator_user.pk)},
            format="json",
        )
        assert resp.status_code == 400

    def test_cannot_change_period_type_after_credit(self, admin_user, cutting_user, operator_user):
        self._target_with_credit(admin_user, cutting_user, operator_user)
        target = EmployeeTarget.objects.get(employee=cutting_user)
        resp = auth_client(admin_user).patch(
            f"/api/v1/targets/{target.pk}/",
            {"period_type": PeriodType.WEEKLY},
            format="json",
        )
        assert resp.status_code == 400

    def test_cannot_change_dates_after_credit(self, admin_user, cutting_user, operator_user):
        self._target_with_credit(admin_user, cutting_user, operator_user)
        target = EmployeeTarget.objects.get(employee=cutting_user)
        later = (target.start_date + timezone.timedelta(days=1)).isoformat()
        resp = auth_client(admin_user).patch(
            f"/api/v1/targets/{target.pk}/",
            {"start_date": later, "end_date": later},
            format="json",
        )
        assert resp.status_code == 400

    def test_can_still_change_target_count_after_credit(self, admin_user, cutting_user, operator_user):
        self._target_with_credit(admin_user, cutting_user, operator_user)
        target = EmployeeTarget.objects.get(employee=cutting_user)
        resp = auth_client(admin_user).patch(
            f"/api/v1/targets/{target.pk}/",
            {"target_count": 25},
            format="json",
        )
        assert resp.status_code == 200, resp.data
        target.refresh_from_db()
        assert target.target_count == 25

    def test_partial_update_only_count_does_not_crash(self, admin_user, cutting_user, operator_user):
        auth_client(admin_user).post(
            "/api/v1/targets/", _base_payload(cutting_user), format="json"
        )
        target = EmployeeTarget.objects.get(employee=cutting_user)
        resp = auth_client(admin_user).patch(
            f"/api/v1/targets/{target.pk}/", {"target_count": 7}, format="json"
        )
        assert resp.status_code == 200, resp.data


class TestTargetOverlapConcurrency:
    """POMS-AUDIT-006: overlap prevention is safe under concurrency."""

    def test_db_constraint_rejects_overlapping_targets(self, admin_user, cutting_user):
        auth_client(admin_user).post(
            "/api/v1/targets/", _base_payload(cutting_user), format="json"
        )
        # Bypass the service-layer check and insert an overlapping row directly;
        # the PostgreSQL exclusion constraint must reject it.
        with pytest.raises(IntegrityError), transaction.atomic():
            EmployeeTarget.objects.create(
                employee=cutting_user,
                department=Department.CUTTING,
                period_type=PeriodType.DAILY,
                start_date=timezone.localdate(),
                end_date=timezone.localdate(),
                target_count=5,
                created_by=admin_user,
            )

    @pytest.mark.django_db(transaction=True)
    def test_concurrent_overlapping_targets_only_one_wins(self, admin_user, cutting_user):
        barrier = threading.Barrier(2)
        results = []

        def worker():
            from django.db import connection

            try:
                barrier.wait(timeout=5)
                resp = auth_client(admin_user).post(
                    "/api/v1/targets/", _base_payload(cutting_user), format="json"
                )
                results.append(resp.status_code)
            except Exception as exc:  # noqa: BLE001
                results.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=20)

        from django.db import connections

        connections.close_all()

        assert not any(isinstance(r, Exception) for r in results), results
        # Exactly one create succeeds and one is rejected as overlapping.
        assert sorted(results) == [201, 400]
        assert EmployeeTarget.objects.filter(employee=cutting_user).count() == 1


class TestCompletionCreditProtection:
    """POMS-AUDIT-019: CompletionCredit is immutable historical attribution."""

    def _target_with_credit(self, admin_user, cutting_user, operator_user):
        auth_client(admin_user).post(
            "/api/v1/targets/", _base_payload(cutting_user), format="json"
        )
        resp = auth_client(admin_user).post(
            "/api/v1/orders/",
            {
                "order_number": "ORD-CR-19",
                "original_image": _img(),
                "cutting_man": str(cutting_user.pk),
                "operator": str(operator_user.pk),
            },
            format="multipart",
        )
        assert resp.status_code == 201, resp.data
        order_id = resp.data["id"]
        auth_client(cutting_user).patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": ProductionStatus.COMPLETED},
            format="json",
        )
        return EmployeeTarget.objects.get(employee=cutting_user)

    def test_target_with_credits_cannot_be_deleted(self, admin_user, cutting_user, operator_user):
        from django.db.models.deletion import ProtectedError

        target = self._target_with_credit(admin_user, cutting_user, operator_user)
        with pytest.raises(ProtectedError):
            target.delete()
        # The credit (and its target) survive the attempted delete.
        assert CompletionCredit.objects.filter(target=target).exists()
        assert EmployeeTarget.objects.filter(pk=target.pk).exists()

    def test_admin_blocks_deleting_target_with_credits(self, admin_user, cutting_user, operator_user):
        from django.contrib.admin.sites import AdminSite

        from apps.targets.admin import EmployeeTargetAdmin

        target = self._target_with_credit(admin_user, cutting_user, operator_user)
        admin = EmployeeTargetAdmin(EmployeeTarget, AdminSite())
        assert admin.has_delete_permission(None, target) is False

    def test_admin_blocks_deleting_completion_credit(self, admin_user, cutting_user, operator_user):
        from django.contrib.admin.sites import AdminSite

        from apps.targets.admin import CompletionCreditAdmin

        self._target_with_credit(admin_user, cutting_user, operator_user)
        admin = CompletionCreditAdmin(CompletionCredit, AdminSite())
        assert admin.has_delete_permission(None) is False
        assert admin.has_delete_permission(None, CompletionCredit.objects.first()) is False


class TestReports:
    def test_dashboard_admin(self, admin_user):
        resp = auth_client(admin_user).get("/api/v1/reports/dashboard/")
        assert resp.status_code == 200
        for key in ("orders_total", "orders_by_status", "active_employees", "recent_orders"):
            assert key in resp.data

    def test_dashboard_forbidden_for_employee(self, cutting_user):
        resp = auth_client(cutting_user).get("/api/v1/reports/dashboard/")
        assert resp.status_code == 403

    def test_employee_report(self, admin_user, cutting_user, operator_user):
        resp = auth_client(admin_user).get("/api/v1/reports/employees/")
        assert resp.status_code == 200
        assert isinstance(resp.data, list)

    def test_production_report(self, admin_user):
        resp = auth_client(admin_user).get("/api/v1/reports/production/")
        assert resp.status_code == 200
        assert "cutting" in resp.data and "operator" in resp.data

    def test_targets_report(self, admin_user, cutting_user):
        auth_client(admin_user).post(
            "/api/v1/targets/", _base_payload(cutting_user), format="json"
        )
        resp = auth_client(admin_user).get("/api/v1/reports/targets/")
        assert resp.status_code == 200
        assert isinstance(resp.data, list)
        assert resp.data[0]["target_count"] == 10


class TestReportsHardening:
    """POMS-AUDIT-013 / 017: real completion dates + bounded reports."""

    def _complete_order(self, admin_user, cutting_user, operator_user, number):
        resp = auth_client(admin_user).post(
            "/api/v1/orders/",
            {
                "order_number": number,
                "original_image": _img(),
                "cutting_man": str(cutting_user.pk),
                "operator": str(operator_user.pk),
            },
            format="multipart",
        )
        assert resp.status_code == 201, resp.data
        order_id = resp.data["id"]
        auth_client(cutting_user).patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": ProductionStatus.COMPLETED}, format="json",
        )
        auth_client(operator_user).patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": ProductionStatus.COMPLETED}, format="json",
        )
        return order_id

    def test_dashboard_counts_completed_today_from_history(
        self, admin_user, cutting_user, operator_user
    ):
        before = auth_client(admin_user).get(
            "/api/v1/reports/dashboard/"
        ).data["orders_completed_today"]
        self._complete_order(admin_user, cutting_user, operator_user, "ORD-TODAY")
        after = auth_client(admin_user).get(
            "/api/v1/reports/dashboard/"
        ).data["orders_completed_today"]
        assert after == before + 1

    def test_dashboard_ignores_updated_at_only_changes(
        self, admin_user, cutting_user, operator_user
    ):
        # A non-completion update (order_number edit) changes updated_at but is not
        # a completion; the count must not move.
        order_id = self._complete_order(admin_user, cutting_user, operator_user, "ORD-TODAY2")
        before = auth_client(admin_user).get(
            "/api/v1/reports/dashboard/"
        ).data["orders_completed_today"]
        auth_client(admin_user).patch(
            f"/api/v1/orders/{order_id}/",
            {"order_number": "ORD-TODAY2-RENAMED"},
            format="json",
        )
        after = auth_client(admin_user).get(
            "/api/v1/reports/dashboard/"
        ).data["orders_completed_today"]
        assert after == before

    def test_targets_report_respects_limit(self, admin_user, cutting_user, operator_user):
        auth_client(admin_user).post("/api/v1/targets/", _base_payload(cutting_user), format="json")
        auth_client(admin_user).post(
            "/api/v1/targets/",
            _base_payload(operator_user, department=Department.OPERATOR),
            format="json",
        )
        resp = auth_client(admin_user).get("/api/v1/reports/targets/?limit=1")
        assert resp.status_code == 200
        assert len(resp.data) == 1

    def test_employees_report_respects_limit(self, admin_user, cutting_user, operator_user):
        resp = auth_client(admin_user).get("/api/v1/reports/employees/?limit=1")
        assert resp.status_code == 200
        assert len(resp.data) == 1