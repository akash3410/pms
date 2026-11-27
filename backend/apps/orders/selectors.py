"""Reusable, optimised read queries for orders."""
from django.db.models import QuerySet

from apps.rbac.access import EffectiveAccess

from .models import Order


def orders_for_user(user) -> QuerySet[Order]:
    """Orders visible to ``user``, according to their ``orders.view_order`` scope.

    - ``ALL``            : every order.
    - ``ASSIGNED``       : orders where the user is the *current* assignee.
    - ``CREATED_BY_ME``  : orders the user created.
    - ``DEPARTMENT``     : orders assigned to members of the user's departments.

    Filtering happens in SQL (never in Python) so pagination and ``get_object()``
    are both safe. A user-level restriction is applied as an additional ``AND``
    filter and can therefore only narrow the result.
    """
    base = Order.objects.select_related("cutting_man", "operator", "created_by")
    return EffectiveAccess(user).filter_queryset("orders.view_order", base)


def order_assignments(order: Order) -> QuerySet:
    """Assignment history for an order, newest first, with related users."""
    return order.assignments.select_related(
        "previous_employee", "new_employee", "assigned_by"
    ).order_by("-assigned_at")
