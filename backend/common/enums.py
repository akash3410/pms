"""Shared enumerations used across apps.

Keeping these in one place avoids duplicated string literals and keeps the
status/role vocabulary consistent between models, services and serializers.
"""
from django.db import models


class Department(models.TextChoices):
    CUTTING = "CUTTING", "Cutting"
    OPERATOR = "OPERATOR", "Operator"


class ProductionStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    COMPLETED = "COMPLETED", "Completed"


class OverallStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    IN_PROGRESS = "IN_PROGRESS", "In Progress"
    COMPLETED = "COMPLETED", "Completed"


class PeriodType(models.TextChoices):
    DAILY = "DAILY", "Daily"
    WEEKLY = "WEEKLY", "Weekly"
    MONTHLY = "MONTHLY", "Monthly"


class NoteDepartment(models.TextChoices):
    GENERAL = "GENERAL", "General"
    CUTTING = "CUTTING", "Cutting"
    OPERATOR = "OPERATOR", "Operator"