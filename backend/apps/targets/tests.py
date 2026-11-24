"""Model tests for the targets app."""
from datetime import date, timedelta

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from apps.targets.models import CompletionCredit, EmployeeTarget
from common.enums import Department, PeriodType


def _make_target(employee, created_by, **overrides):
    data = {
        "employee": employee,
        "department": Department.CUTTING,
        "period_type": PeriodType.DAILY,
        "start_date": date(2026, 11, 1),
        "end_date": date(2026, 11, 1),
        "target_count": 10,
        "created_by": created_by,
    }
    data.update(overrides)
    return EmployeeTarget(**data)


@pytest.mark.django_db
class TestEmployeeTarget:
    def test_valid_target(self, cutting_user, admin_user):
        target = _make_target(cutting_user, admin_user)
        target.full_clean()  # should not raise
        target.save()
        assert target.target_count == 10

    def test_end_before_start_rejected(self, cutting_user, admin_user):
        target = _make_target(
            cutting_user, admin_user, start_date=date(2026, 11, 10), end_date=date(2026, 11, 1)
        )
        with pytest.raises(ValidationError):
            target.full_clean()

    def test_non_positive_count_rejected(self, cutting_user, admin_user):
        target = _make_target(cutting_user, admin_user, target_count=0)
        with pytest.raises(ValidationError):
            target.full_clean()

    def test_weekly_bounds_helper(self, cutting_user, admin_user):
        # Monday -> Sunday for a known week
        monday = date(2026, 11, 16)  # a Monday
        sunday = monday + timedelta(days=6)
        target = _make_target(
            cutting_user,
            admin_user,
            period_type=PeriodType.WEEKLY,
            start_date=monday,
            end_date=sunday,
        )
        target.full_clean()
        assert target.end_date - target.start_date == timedelta(days=6)


@pytest.mark.django_db
class TestCompletionCredit:
    def test_create_credit(self, cutting_user, admin_user, order):
        target = _make_target(cutting_user, admin_user)
        target.save()
        credit = CompletionCredit.objects.create(
            employee=cutting_user,
            order=order,
            target=target,
            department=Department.CUTTING,
            credit_date=date(2026, 11, 1),
        )
        assert credit.pk is not None

    def test_duplicate_credit_rejected(self, cutting_user, admin_user, order):
        target = _make_target(cutting_user, admin_user)
        target.save()
        CompletionCredit.objects.create(
            employee=cutting_user,
            order=order,
            target=target,
            department=Department.CUTTING,
            credit_date=date(2026, 11, 1),
        )
        with pytest.raises(IntegrityError), transaction.atomic():
            CompletionCredit.objects.create(
                employee=cutting_user,
                order=order,
                target=target,
                department=Department.CUTTING,
                credit_date=date(2026, 11, 1),
            )