"""Optimised read queries for production history and notes."""


def order_status_history(order):
    return order.status_history.select_related("employee").order_by("-created_at")


def order_notes(order):
    return order.notes.select_related("author").order_by("-created_at")