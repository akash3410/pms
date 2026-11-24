"""API tests for production status updates, history, and notes (Phase 5)."""
import io
import threading

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.orders.models import Order
from apps.production.models import OrderNote, ProductionStatusHistory
from apps.targets.models import CompletionCredit, EmployeeTarget
from common.enums import Department, OverallStatus, PeriodType, ProductionStatus

pytestmark = pytest.mark.django_db


def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _img():
    buf = io.BytesIO()
    Image.new("RGB", (160, 100), (30, 30, 30)).save(buf, format="PNG")
    return SimpleUploadedFile("c.png", buf.getvalue(), content_type="image/png")


def _make_order(admin_user, cutting_user, operator_user, number="ORD-500"):
    client = auth_client(admin_user)
    resp = client.post(
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


class TestStatusUpdates:
    def test_cutting_completes(self, admin_user, cutting_user, operator_user):
        order_id = _make_order(admin_user, cutting_user, operator_user)
        resp = auth_client(cutting_user).patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": ProductionStatus.COMPLETED, "note": "cut done"},
            format="json",
        )
        assert resp.status_code == 200, resp.data
        order = Order.objects.get(pk=order_id)
        assert order.cutting_status == ProductionStatus.COMPLETED
        assert order.overall_status == OverallStatus.IN_PROGRESS
        assert ProductionStatusHistory.objects.filter(order_id=order_id).count() == 1

    def test_operator_completes_then_overall_completed(self, admin_user, cutting_user, operator_user):
        order_id = _make_order(admin_user, cutting_user, operator_user)
        auth_client(cutting_user).patch(
            f"/api/v1/orders/{order_id}/status/", {"status": ProductionStatus.COMPLETED}, format="json"
        )
        resp = auth_client(operator_user).patch(
            f"/api/v1/orders/{order_id}/status/", {"status": ProductionStatus.COMPLETED}, format="json"
        )
        assert resp.status_code == 200
        order = Order.objects.get(pk=order_id)
        assert order.overall_status == OverallStatus.COMPLETED

    def test_cutting_cannot_affect_operator_status(self, admin_user, cutting_user, operator_user):
        order_id = _make_order(admin_user, cutting_user, operator_user)
        # Department is derived from the employee's role; operator stays pending.
        auth_client(cutting_user).patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": ProductionStatus.COMPLETED, "department": Department.OPERATOR},
            format="json",
        )
        order = Order.objects.get(pk=order_id)
        assert order.cutting_status == ProductionStatus.COMPLETED
        assert order.operator_status == ProductionStatus.PENDING

    def test_admin_can_update_either_department(self, admin_user, cutting_user, operator_user):
        order_id = _make_order(admin_user, cutting_user, operator_user)
        resp = auth_client(admin_user).patch(
            f"/api/v1/orders/{order_id}/status/",
            {"department": Department.OPERATOR, "status": ProductionStatus.COMPLETED},
            format="json",
        )
        assert resp.status_code == 200
        order = Order.objects.get(pk=order_id)
        assert order.operator_status == ProductionStatus.COMPLETED

    def test_admin_must_specify_department(self, admin_user, cutting_user, operator_user):
        order_id = _make_order(admin_user, cutting_user, operator_user)
        resp = auth_client(admin_user).patch(
            f"/api/v1/orders/{order_id}/status/", {"status": ProductionStatus.COMPLETED}, format="json"
        )
        assert resp.status_code == 400

    def test_unassigned_employee_cannot_update(self, admin_user, cutting_user, operator_user):
        order_id = _make_order(admin_user, cutting_user, operator_user)
        intruder = User.objects.create_user(
            username="in2", password="x", employee_code="CUT-777",
            full_name="Intruder", role=Role.CUTTING_MAN,
        )
        resp = auth_client(intruder).patch(
            f"/api/v1/orders/{order_id}/status/", {"status": ProductionStatus.COMPLETED}, format="json"
        )
        assert resp.status_code == 404

    def test_reopen_completed(self, admin_user, cutting_user, operator_user):
        order_id = _make_order(admin_user, cutting_user, operator_user)
        auth_client(cutting_user).patch(
            f"/api/v1/orders/{order_id}/status/", {"status": ProductionStatus.COMPLETED}, format="json"
        )
        resp = auth_client(cutting_user).patch(
            f"/api/v1/orders/{order_id}/status/", {"status": ProductionStatus.PENDING}, format="json"
        )
        assert resp.status_code == 200
        order = Order.objects.get(pk=order_id)
        assert order.cutting_status == ProductionStatus.PENDING
        # Completed -> Pending recorded as a new history event.
        assert ProductionStatusHistory.objects.filter(order_id=order_id).count() == 2

    def test_repeated_completion_records_each_time(self, admin_user, cutting_user, operator_user):
        order_id = _make_order(admin_user, cutting_user, operator_user)
        client = auth_client(cutting_user)
        client.patch(f"/api/v1/orders/{order_id}/status/", {"status": ProductionStatus.COMPLETED}, format="json")
        client.patch(f"/api/v1/orders/{order_id}/status/", {"status": ProductionStatus.PENDING}, format="json")
        client.patch(f"/api/v1/orders/{order_id}/status/", {"status": ProductionStatus.COMPLETED}, format="json")
        assert ProductionStatusHistory.objects.filter(order_id=order_id).count() == 3


class TestHistory:
    def test_history_endpoint(self, admin_user, cutting_user, operator_user):
        order_id = _make_order(admin_user, cutting_user, operator_user)
        auth_client(cutting_user).patch(
            f"/api/v1/orders/{order_id}/status/", {"status": ProductionStatus.COMPLETED, "note": "n1"}, format="json"
        )
        resp = auth_client(admin_user).get(f"/api/v1/orders/{order_id}/history/")
        assert resp.status_code == 200
        results = resp.data["results"] if isinstance(resp.data, dict) else resp.data
        assert len(results) == 1
        assert results[0]["new_status"] == ProductionStatus.COMPLETED


class TestNotes:
    def test_admin_adds_general_note(self, admin_user, cutting_user, operator_user):
        order_id = _make_order(admin_user, cutting_user, operator_user)
        resp = auth_client(admin_user).post(
            f"/api/v1/orders/{order_id}/notes/", {"body": "Please prioritise"}, format="json"
        )
        assert resp.status_code == 201
        assert OrderNote.objects.filter(order_id=order_id).count() == 1

    def test_cutting_adds_cutting_note(self, cutting_user, operator_user, admin_user):
        order_id = _make_order(admin_user, cutting_user, operator_user)
        resp = auth_client(cutting_user).post(
            f"/api/v1/orders/{order_id}/notes/",
            {"body": "machine issue", "department": Department.CUTTING},
            format="json",
        )
        assert resp.status_code == 201

    def test_cutting_cannot_add_operator_note(self, cutting_user, operator_user, admin_user):
        order_id = _make_order(admin_user, cutting_user, operator_user)
        resp = auth_client(cutting_user).post(
            f"/api/v1/orders/{order_id}/notes/",
            {"body": "not mine", "department": Department.OPERATOR},
            format="json",
        )
        assert resp.status_code == 400

    def test_empty_note_rejected(self, admin_user, cutting_user, operator_user):
        order_id = _make_order(admin_user, cutting_user, operator_user)
        resp = auth_client(admin_user).post(
            f"/api/v1/orders/{order_id}/notes/", {"body": "   "}, format="json"
        )
        assert resp.status_code == 400

    def test_list_notes(self, admin_user, cutting_user, operator_user):
        order_id = _make_order(admin_user, cutting_user, operator_user)
        auth_client(admin_user).post(
            f"/api/v1/orders/{order_id}/notes/", {"body": "a"}, format="json"
        )
        resp = auth_client(cutting_user).get(f"/api/v1/orders/{order_id}/notes/")
        assert resp.status_code == 200
        results = resp.data["results"] if isinstance(resp.data, dict) else resp.data
        assert len(results) == 1


class TestNoopAndReassignment:
    """POMS-AUDIT-003 / 008: no-op transitions create no history/credit."""

    def _target_for(self, employee, admin_user):
        from django.utils import timezone

        from apps.targets.models import EmployeeTarget

        today = timezone.localdate()
        return EmployeeTarget.objects.create(
            employee=employee,
            department=Department.CUTTING,
            period_type="DAILY",
            start_date=today,
            end_date=today,
            target_count=10,
            created_by=admin_user,
        )

    def test_noop_completion_records_no_history(self, admin_user, cutting_user, operator_user):
        order_id = _make_order(admin_user, cutting_user, operator_user)
        client = auth_client(cutting_user)
        client.patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": ProductionStatus.COMPLETED},
            format="json",
        )
        # Re-confirming COMPLETED is a no-op: no second history row.
        resp = client.patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": ProductionStatus.COMPLETED},
            format="json",
        )
        assert resp.status_code == 200
        assert ProductionStatusHistory.objects.filter(order_id=order_id).count() == 1

    def test_reassignment_does_not_credit_new_assignee(
        self, admin_user, cutting_user, operator_user
    ):
        from apps.targets.models import CompletionCredit

        # Both the original and the replacement cutting man have a target today,
        # so without the guard the replacement would receive a (leaked) credit.
        self._target_for(cutting_user, admin_user)
        replacement = User.objects.create_user(
            username="cutting_b",
            password="x",
            employee_code="CUT-B",
            full_name="Cutting B",
            role=Role.CUTTING_MAN,
        )
        self._target_for(replacement, admin_user)

        order_id = _make_order(admin_user, cutting_user, operator_user)
        # Original assignee completes -> credited.
        auth_client(cutting_user).patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": ProductionStatus.COMPLETED},
            format="json",
        )
        assert (
            CompletionCredit.objects.filter(
                employee=cutting_user, order_id=order_id, department=Department.CUTTING
            ).count()
            == 1
        )

        # Reassign cutting to the replacement; the department stays COMPLETED.
        reassign = auth_client(admin_user).patch(
            f"/api/v1/orders/{order_id}/assign/",
            {"department": Department.CUTTING, "employee_id": str(replacement.pk)},
            format="json",
        )
        assert reassign.status_code == 200, reassign.data

        history_before = ProductionStatusHistory.objects.filter(order_id=order_id).count()

        # Replacement re-confirms COMPLETED -> no-op, no history, no credit.
        noop = auth_client(replacement).patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": ProductionStatus.COMPLETED},
            format="json",
        )
        assert noop.status_code == 200

        assert (
            CompletionCredit.objects.filter(
                employee=replacement, order_id=order_id
            ).count()
            == 0
        )
        assert (
            ProductionStatusHistory.objects.filter(order_id=order_id).count()
            == history_before
        )


# --------------------------------------------------------------------------- #
# Phase 8.1 — Batch 2: production status & credit attribution (Rules A/B/C)
# --------------------------------------------------------------------------- #
def _make_target(employee, created_by, period_type=PeriodType.DAILY):
    """Create a target for ``employee`` covering today (eligible for credit)."""
    dept = (
        Department.CUTTING
        if employee.role == Role.CUTTING_MAN
        else Department.OPERATOR
    )
    today = timezone.localdate()
    return EmployeeTarget.objects.create(
        employee=employee,
        department=dept,
        period_type=period_type,
        start_date=today,
        end_date=today,
        target_count=10,
        created_by=created_by,
    )


def _credits(employee, order_id):
    return CompletionCredit.objects.filter(employee=employee, order_id=order_id).count()


def _history(order_id):
    return ProductionStatusHistory.objects.filter(order_id=order_id).count()


def _reassign(client, order_id, department, employee):
    return client.patch(
        f"/api/v1/orders/{order_id}/assign/",
        {"department": department, "employee_id": str(employee.pk)},
        format="json",
    )


class TestRuleACompletionAttribution:
    """Rule A: the currently-assigned employee is credited, never the actor."""

    def test_admin_completion_credits_current_assignee(self, admin_user, cutting_user, operator_user):
        _make_target(cutting_user, admin_user)
        order_id = _make_order(admin_user, cutting_user, operator_user, number="ORD-A1")
        resp = auth_client(admin_user).patch(
            f"/api/v1/orders/{order_id}/status/",
            {"department": Department.CUTTING, "status": ProductionStatus.COMPLETED},
            format="json",
        )
        assert resp.status_code == 200
        assert _credits(cutting_user, order_id) == 1
        # Admin is the actor but not the assignee -> admin gets no credit.
        assert _credits(admin_user, order_id) == 0
        assert Order.objects.get(pk=order_id).cutting_status == ProductionStatus.COMPLETED

    def test_employee_completion_credits_self(self, admin_user, cutting_user, operator_user):
        _make_target(cutting_user, admin_user)
        order_id = _make_order(admin_user, cutting_user, operator_user, number="ORD-A2")
        resp = auth_client(cutting_user).patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": ProductionStatus.COMPLETED},
            format="json",
        )
        assert resp.status_code == 200
        assert _credits(cutting_user, order_id) == 1

    def test_admin_operator_completion_credits_current_operator(
        self, admin_user, cutting_user, operator_user
    ):
        # POMS-AUDIT-022 (decision A): admin completing a PENDING operator
        # department credits the current Operator, not the admin actor.
        _make_target(operator_user, admin_user)
        order_id = _make_order(admin_user, cutting_user, operator_user, number="ORD-A5")
        resp = auth_client(admin_user).patch(
            f"/api/v1/orders/{order_id}/status/",
            {"department": Department.OPERATOR, "status": ProductionStatus.COMPLETED},
            format="json",
        )
        assert resp.status_code == 200, resp.data
        assert _credits(operator_user, order_id) == 1
        assert _credits(admin_user, order_id) == 0
        assert Order.objects.get(pk=order_id).operator_status == ProductionStatus.COMPLETED

    def test_admin_completion_records_admin_as_actor_and_assignee_as_recipient(
        self, admin_user, cutting_user, operator_user
    ):
        # POMS-AUDIT-022 (decision A): the history actor is the admin; the credit
        # recipient is the currently assigned employee (never the actor).
        _make_target(cutting_user, admin_user)
        _make_target(operator_user, admin_user)
        order_id = _make_order(admin_user, cutting_user, operator_user, number="ORD-A6")

        auth_client(admin_user).patch(
            f"/api/v1/orders/{order_id}/status/",
            {"department": Department.CUTTING, "status": ProductionStatus.COMPLETED},
            format="json",
        )
        auth_client(admin_user).patch(
            f"/api/v1/orders/{order_id}/status/",
            {"department": Department.OPERATOR, "status": ProductionStatus.COMPLETED},
            format="json",
        )

        cutting_event = ProductionStatusHistory.objects.get(
            order_id=order_id, department=Department.CUTTING
        )
        assert cutting_event.employee_id == admin_user.pk
        operator_event = ProductionStatusHistory.objects.get(
            order_id=order_id, department=Department.OPERATOR
        )
        assert operator_event.employee_id == admin_user.pk

        assert _credits(cutting_user, order_id) == 1
        assert _credits(operator_user, order_id) == 1
        assert _credits(admin_user, order_id) == 0

    def test_admin_completion_without_target_no_credit(self, admin_user, cutting_user, operator_user):
        order_id = _make_order(admin_user, cutting_user, operator_user, number="ORD-A3")
        resp = auth_client(admin_user).patch(
            f"/api/v1/orders/{order_id}/status/",
            {"department": Department.CUTTING, "status": ProductionStatus.COMPLETED},
            format="json",
        )
        assert resp.status_code == 200
        assert _credits(cutting_user, order_id) == 0
        assert _history(order_id) == 1

    def test_employee_completion_without_target_no_credit(self, admin_user, cutting_user, operator_user):
        order_id = _make_order(admin_user, cutting_user, operator_user, number="ORD-A4")
        resp = auth_client(cutting_user).patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": ProductionStatus.COMPLETED},
            format="json",
        )
        assert resp.status_code == 200
        assert _credits(cutting_user, order_id) == 0


class TestRuleBReassignmentPreservesCompletion:
    """Rule B: reassignment preserves status; never re-credits the new assignee."""

    def _complete_and_reassign(self, admin_user, cutting_user, operator_user, replacement):
        _make_target(cutting_user, admin_user)
        _make_target(replacement, admin_user)
        order_id = _make_order(admin_user, cutting_user, operator_user, number="ORD-B1")
        auth_client(cutting_user).patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": ProductionStatus.COMPLETED},
            format="json",
        )
        assert _credits(cutting_user, order_id) == 1
        resp = _reassign(auth_client(admin_user), order_id, Department.CUTTING, replacement)
        assert resp.status_code == 200, resp.data
        return order_id

    def test_completed_department_preserved_and_not_recredited(self, admin_user, cutting_user, operator_user):
        replacement = User.objects.create_user(
            username="repl_b", password="x", employee_code="CUT-B",
            full_name="Replacement B", role=Role.CUTTING_MAN,
        )
        order_id = self._complete_and_reassign(
            admin_user, cutting_user, operator_user, replacement
        )
        # Status preserved as COMPLETED.
        assert Order.objects.get(pk=order_id).cutting_status == ProductionStatus.COMPLETED
        # New assignee received no credit; original credit stays with original.
        assert _credits(replacement, order_id) == 0
        assert _credits(cutting_user, order_id) == 1

    def test_reopen_then_new_assignee_completes_credits_new_assignee(self, admin_user, cutting_user, operator_user):
        replacement = User.objects.create_user(
            username="repl_b2", password="x", employee_code="CUT-B2",
            full_name="Replacement B2", role=Role.CUTTING_MAN,
        )
        order_id = self._complete_and_reassign(
            admin_user, cutting_user, operator_user, replacement
        )
        # Admin reopens -> PENDING, no new credit.
        credits_after_complete = _credits(cutting_user, order_id)
        reopen = auth_client(admin_user).patch(
            f"/api/v1/orders/{order_id}/status/",
            {"department": Department.CUTTING, "status": ProductionStatus.PENDING},
            format="json",
        )
        assert reopen.status_code == 200
        assert Order.objects.get(pk=order_id).cutting_status == ProductionStatus.PENDING
        assert _credits(cutting_user, order_id) == credits_after_complete
        assert _credits(replacement, order_id) == 0

        # New assignee completes the reopened department -> new credit to them.
        done = auth_client(replacement).patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": ProductionStatus.COMPLETED},
            format="json",
        )
        assert done.status_code == 200
        assert _credits(replacement, order_id) == 1
        # Original assignee's historical credit is preserved.
        assert _credits(cutting_user, order_id) == 1


class TestRuleCNoopRequests:
    """Rule C: identical-status requests create no history and no credit."""

    def test_repeated_completed_no_history_no_credit(self, admin_user, cutting_user, operator_user):
        _make_target(cutting_user, admin_user)
        order_id = _make_order(admin_user, cutting_user, operator_user, number="ORD-C1")
        client = auth_client(cutting_user)
        client.patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": ProductionStatus.COMPLETED}, format="json",
        )
        assert _history(order_id) == 1
        assert _credits(cutting_user, order_id) == 1

        again = client.patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": ProductionStatus.COMPLETED}, format="json",
        )
        assert again.status_code == 200
        assert _history(order_id) == 1
        assert _credits(cutting_user, order_id) == 1

    def test_repeated_pending_no_history(self, admin_user, cutting_user, operator_user):
        order_id = _make_order(admin_user, cutting_user, operator_user, number="ORD-C2")
        client = auth_client(cutting_user)
        first = client.patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": ProductionStatus.PENDING}, format="json",
        )
        second = client.patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": ProductionStatus.PENDING}, format="json",
        )
        assert first.status_code == 200
        assert second.status_code == 200
        assert _history(order_id) == 0
        assert _credits(cutting_user, order_id) == 0


class TestAuthorizationAndAtomicity:
    def test_unauthorized_department_transition_has_no_side_effects(self, admin_user, cutting_user, operator_user):
        from apps.production.services import update_department_status
        from common.exceptions import BusinessRuleError

        _make_target(operator_user, admin_user)
        order_id = _make_order(admin_user, cutting_user, operator_user, number="ORD-D1")
        order = Order.objects.get(pk=order_id)
        # A cutting man must not be able to drive the operator department's
        # status, even by calling the service directly (HTTP derives the
        # department from the role, so this guards the service layer itself).
        with pytest.raises(BusinessRuleError):
            update_department_status(
                order=order,
                employee=cutting_user,
                department=Department.OPERATOR,
                new_status=ProductionStatus.COMPLETED,
            )
        order.refresh_from_db()
        assert order.operator_status == ProductionStatus.PENDING
        assert _credits(operator_user, order_id) == 0
        assert _history(order_id) == 0

    @pytest.mark.django_db(transaction=True)
    def test_concurrent_completion_single_credit(self, admin_user, cutting_user, operator_user):
        from apps.production.services import update_department_status

        _make_target(cutting_user, admin_user)
        order_id = _make_order(admin_user, cutting_user, operator_user, number="ORD-D2")

        barrier = threading.Barrier(2)
        errors = []

        def worker():
            from django.db import connection

            try:
                barrier.wait(timeout=5)
                order = Order.objects.get(pk=order_id)
                update_department_status(
                    order=order,
                    employee=cutting_user,
                    department=Department.CUTTING,
                    new_status=ProductionStatus.COMPLETED,
                )
            except Exception as exc:  # noqa: BLE001 - surfaced via assertion below
                errors.append(exc)
            finally:
                # Each thread holds its own DB connection; close it so the test
                # database can be torn down cleanly afterwards.
                connection.close()

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=20)

        from django.db import connections

        connections.close_all()

        assert not errors, errors
        assert _credits(cutting_user, order_id) == 1
        assert _history(order_id) == 1

    def test_rollback_leaves_consistent_state(self, monkeypatch, admin_user, cutting_user, operator_user):
        import apps.production.services as svc

        _make_target(cutting_user, admin_user)
        order_id = _make_order(admin_user, cutting_user, operator_user, number="ORD-D3")

        def boom(*args, **kwargs):
            raise RuntimeError("forced failure after history write")

        monkeypatch.setattr(svc, "_record_completion", boom)

        order = Order.objects.get(pk=order_id)
        with pytest.raises(RuntimeError):
            svc.update_department_status(
                order=order,
                employee=admin_user,
                department=Department.CUTTING,
                new_status=ProductionStatus.COMPLETED,
            )

        order.refresh_from_db()
        assert order.cutting_status == ProductionStatus.PENDING
        assert _history(order_id) == 0
        assert _credits(cutting_user, order_id) == 0