"""Model tests for the accounts app."""
import pytest

from apps.accounts.models import Role, User


@pytest.mark.django_db
class TestUserModel:
    def test_role_helpers(self):
        admin = User(employee_code="A1", full_name="A", role=Role.ADMIN)
        cutter = User(employee_code="C1", full_name="C", role=Role.CUTTING_MAN)
        operator = User(employee_code="O1", full_name="O", role=Role.OPERATOR)
        assert admin.is_admin and not admin.is_employee
        assert cutter.is_cutting_man and cutter.is_employee
        assert operator.is_operator and operator.is_employee

    def test_employee_code_is_uppercased(self, db):
        user = User.objects.create_user(
            username="mixed",
            password="x",
            employee_code=" cut-009 ",
            full_name="Mixed Case",
            role=Role.CUTTING_MAN,
        )
        assert user.employee_code == "CUT-009"

    def test_str(self, cutting_user):
        assert "Cutter One" in str(cutting_user)
        assert "CUT-001" in str(cutting_user)

    def test_employee_code_unique(self, db, cutting_user):
        from django.db import IntegrityError, transaction

        with pytest.raises(IntegrityError), transaction.atomic():
            User.objects.create_user(
                username="dup",
                password="x",
                employee_code="CUT-001",
                full_name="Dup",
                role=Role.CUTTING_MAN,
            )

    def test_inactive_flag(self, operator_user):
        operator_user.is_active = False
        operator_user.save()
        operator_user.refresh_from_db()
        assert operator_user.is_active is False