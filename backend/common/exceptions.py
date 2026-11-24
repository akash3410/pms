"""Consistent API error envelope and exception handling.

All API errors are returned in a stable JSON shape so clients (web / Flutter)
can rely on a single contract:

    {
        "detail": "Human readable message",
        "errors": { "field": ["message", ...] }   # optional, for validation
        "code": "error_code"                      # optional
    }
"""
from django.db.models.deletion import ProtectedError
from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.response import Response
from rest_framework.views import exception_handler


class BusinessRuleError(APIException):
    """Raised by the service layer when a business rule is violated."""

    status_code = 400
    default_detail = "A business rule was violated."
    default_code = "business_rule_error"


def poms_exception_handler(exc, context):
    """Wrap DRF's default handler output into the POMS error envelope."""
    # Deletion of a record still referenced by protected FKs must never surface
    # as an unhandled HTTP 500. Return a clean 409 Conflict instead.
    if isinstance(exc, ProtectedError):
        return Response(
            {
                "detail": (
                    "This record cannot be deleted because other records "
                    "reference it."
                )
            },
            status=status.HTTP_409_CONFLICT,
        )

    response = exception_handler(exc, context)
    if response is None:
        # Let Django/DRF handle non-API exceptions (500s etc.)
        return response

    detail = None
    errors = None

    data = response.data
    if isinstance(data, dict):
        if "detail" in data and len(data) == 1:
            detail = data["detail"]
        else:
            errors = data
            detail = "Request could not be processed."
    elif isinstance(data, list):
        errors = {"non_field_errors": data}
        detail = "Request could not be processed."
    else:
        detail = str(data)

    payload = {"detail": detail}
    if errors is not None:
        payload["errors"] = errors

    response.data = payload
    return response