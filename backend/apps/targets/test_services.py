"""Service-level tests for target period math and completion credits (Phase 6)."""
from datetime import date, timedelta

import pytest
from django.utils import timezone

from apps.targets.models import CompletionCredit, EmployeeTarget
from apps.targets.services import record_completion_credits
from common.enums import Department, PeriodType
from common.utils.date_ranges import period_bounds

pytestmark = pytest.mark.django_db


class TestPeriodBounds:
    def test_daily(self):
        d = date(2026, 11, 18)
        assert period_bounds(PeriodType.DAILY, d) == (d, d)

    def test_weekly_is_monday_to_sunday(self):
        d = date(2026, 11, 18)
        start, end = period_bounds(PeriodType.WEEKLY, d)
        assert start.weekday() == 0  # Monday
        assert end.weekday() == 6  # Sunday
        assert (end - start).days == 6
        assert start <= d <= end

    def test_weekly_same_for_all_days_in_week(self):
        monday = date(2026, 11, 16)
        for offset in range(7):
            assert period_bounds(PeriodType.WEEKLY, monday + timedelta(days=offset)) == (
                monday,
                monday + timedelta(days=6),
            )

    def test_monthly(self):
        d = date(2026, 11, 18)
        start, end = period_bounds(PeriodType.MONTHLY, d)
        assert start == date(2026, 11, 1)
        assert end == date(2026, 11, 30)


def _daily_target(employee, created_by, day, count=5):
    return EmployeeTarget.objects.create(
        employee=employee,
        department=Department.CUTTING,
        period_type=PeriodType.DAILY,
        start_date=day,
        end_date=day,
        target_count=count,
        created_by=created_by,
    )


class TestCompletionCredits:
    def test_credits_once_per_target(self, cutting_user, admin_user, order):
        today = timezone.localdate()
        target = _daily_target(cutting_user, admin_user, today)

        created = record_completion_credits(
            order=order, employee=cutting_user, department=Department.CUTTING, credit_date=today
        )
        assert len(created) == 1

        # Reopen + re-complete simulation: same target, same date -> no duplicate.
        again = record_completion_credits(
            order=order, employee=cutting_user, department=Department.CUTTING, credit_date=today
        )
        assert again == []
        assert CompletionCredit.objects.filter(order=order, target=target).count() == 1

    def test_credit_uses_actual_completion_date(self, cutting_user, admin_user, order):
        # Target for "today" only; completing on another date yields no credit.
        today = timezone.localdate()
        other_day = today + timedelta(days=30)
        _daily_target(cutting_user, admin_user, today)
        created = record_completion_credits(
            order=order, employee=cutting_user, department=Department.CUTTING, credit_date=other_day
        )
        assert created == []

    def test_credits_across_periods(self, cutting_user, admin_user, order):
        today = timezone.localdate()
        _daily_target(cutting_user, admin_user, today)
        EmployeeTarget.objects.create(
            employee=cutting_user,
            department=Department.CUTTING,
            period_type=PeriodType.MONTHLY,
            start_date=today.replace(day=1),
            end_date=today,
            target_count=20,
            created_by=admin_user,
        )
        created = record_completion_credits(
            order=order, employee=cutting_user, department=Department.CUTTING, credit_date=today
        )
        # One credit for the daily target and one for the monthly target.
        assert len(created) == 2