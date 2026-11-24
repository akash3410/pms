"""Reusable, optimised read queries for orders."""
from django.db.models import Q, QuerySet

from apps.accounts.models import Role

from .models import Order


def orders_for_user(user) -> QuerySet[Order]:
    """Orders visible to ``user``.

    - ADMIN: all orders.
    - Employee: only orders where they are the *current* Cutting Man or Operator.
    """
    base = Order.objects.select_related("cutting_man", "operator", "created_by")
    if user.role == Role.ADMIN:
        return base
    return base.filter(Q(cutting_man=user) | Q(operator=user))


def order_assignments(order: Order) -> QuerySet:
    """Assignment history for an order, newest first, with related users."""
    return order.assignments.select_related(
        "previous_employee", "new_employee", "assigned_by"
    ).order_by("-assigned_at")