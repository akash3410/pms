"""Standard pagination configuration for list endpoints."""
from rest_framework.pagination import PageNumberPagination


class StandardResultsSetPagination(PageNumberPagination):
    """Page-number pagination with a client-tunable page size.

    Accepts ``?page_size=`` to override the default (capped for safety).
    """

    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 200