"""Model tests for the production app."""
import pytest

from apps.production.models import OrderNote, ProductionStatusHistory
from common.enums import Department, NoteDepartment, ProductionStatus


@pytest.mark.django_db
class TestProductionStatusHistory:
    def test_create_transition(self, order, cutting_user):
        event = ProductionStatusHistory.objects.create(
            order=order,
            employee=cutting_user,
            department=Department.CUTTING,
            previous_status=ProductionStatus.PENDING,
            new_status=ProductionStatus.COMPLETED,
            note="Done cutting",
        )
        assert event.new_status == ProductionStatus.COMPLETED
        assert event.created_at is not None

    def test_str(self, order, cutting_user):
        event = ProductionStatusHistory.objects.create(
            order=order,
            employee=cutting_user,
            department=Department.CUTTING,
            previous_status=ProductionStatus.PENDING,
            new_status=ProductionStatus.COMPLETED,
        )
        assert "CUTTING" in str(event)


@pytest.mark.django_db
class TestOrderNote:
    def test_create_note(self, order, admin_user):
        note = OrderNote.objects.create(
            order=order,
            author=admin_user,
            department=NoteDepartment.GENERAL,
            body="Urgent order",
        )
        assert note.department == NoteDepartment.GENERAL

    def test_order_notes_relation(self, order, admin_user):
        OrderNote.objects.create(order=order, author=admin_user, body="a")
        OrderNote.objects.create(order=order, author=admin_user, body="b")
        assert order.notes.count() == 2