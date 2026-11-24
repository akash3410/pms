"""Calendar-period helpers for targets and reporting.

These implement the mandatory period boundaries:
- DAILY:   the calendar day (00:00–23:59:59).
- WEEKLY:  Monday 00:00:00 through Sunday 23:59:59 (calendar week, not rolling).
- MONTHLY: first through last day of the calendar month.
"""
import calendar
from datetime import date, timedelta

from common.enums import PeriodType


def period_bounds(period_type: str, on_date: date) -> tuple[date, date]:
    """Return the inclusive (start_date, end_date) of the period containing ``on_date``."""
    if period_type == PeriodType.DAILY:
        return on_date, on_date

    if period_type == PeriodType.WEEKLY:
        start = on_date - timedelta(days=on_date.weekday())  # Monday
        end = start + timedelta(days=6)  # Sunday
        return start, end

    if period_type == PeriodType.MONTHLY:
        start = on_date.replace(day=1)
        last_day = calendar.monthrange(on_date.year, on_date.month)[1]
        end = on_date.replace(day=last_day)
        return start, end

    raise ValueError(f"Unknown period type: {period_type}")