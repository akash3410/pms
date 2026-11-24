"""Model tests for the orders app."""
import pytest
from django.db import IntegrityError, transaction

from apps.orders.models import (
    AssignmentHistory,
    Order,
    compute_overall_status,
)
from common.enums import Department, OverallStatus, ProductionStatus


class TestComputeOverallStatus:
    @pytest.mark.parametrize(
        "cutting,operator,expected",
        [
            (ProductionStatus.PENDING, ProductionStatus.PENDING, OverallStatus.PENDING),
            (ProductionStatus.COMPLETED, ProductionStatus.PENDING, OverallStatus.IN_PROGRESS),
            (ProductionStatus.PENDING, ProductionStatus.COMPLETED, OverallStatus.IN_PROGRESS),
            (ProductionStatus.COMPLETED, ProductionStatus.COMPLETED, OverallStatus.COMPLETED),
        ],
    )
    def test_table(self, cutting, operator, expected):
        assert compute_overall_status(cutting, operator) == expected


@pytest.mark.django_db
class TestOrderModel:
    def test_save_derives_overall_status(self, order):
        assert order.overall_status == OverallStatus.PENDING
        order.cutting_status = ProductionStatus.COMPLETED
        order.save()
        order.refresh_from_db()
        assert order.overall_status == OverallStatus.IN_PROGRESS
        order.operator_status = ProductionStatus.COMPLETED
        order.save()
        order.refresh_from_db()
        assert order.overall_status == OverallStatus.COMPLETED

    def test_overall_status_not_settable_directly(self, order):
        # editable=False: direct assignment via constructor is ignored on save.
        order.overall_status = OverallStatus.COMPLETED  # should be recomputed
        order.save()
        order.refresh_from_db()
        assert order.overall_status == OverallStatus.PENDING

    def test_duplicate_order_number_rejected(self, order, admin_user, sample_image):
        with pytest.raises(IntegrityError), transaction.atomic():
            Order.objects.create(
                order_number="ORD-0001",
                original_image=sample_image,
                created_by=admin_user,
            )

    def test_str(self, order):
        assert "ORD-0001" in str(order)


@pytest.mark.django_db
class TestAssignmentHistory:
    def test_create_initial_assignment(self, order, admin_user, cutting_user):
        record = AssignmentHistory.objects.create(
            order=order,
            department=Department.CUTTING,
            previous_employee=None,
            new_employee=cutting_user,
            assigned_by=admin_user,
        )
        assert record.previous_employee is None
        assert record.new_employee == cutting_user
        assert record.assigned_at is not None

    def test_str(self, order, admin_user, cutting_user):
        record = AssignmentHistory.objects.create(
            order=order,
            department=Department.CUTTING,
            new_employee=cutting_user,
            assigned_by=admin_user,
        )
        assert "ORD-0001" in str(record) or str(order.order_number) in str(record)