"""ViewSets for orders and assignments."""
import mimetypes
import os

from django.http import FileResponse, Http404
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.permissions import IsActiveUser
from apps.production.selectors import order_notes, order_status_history
from apps.production.serializers import (
    OrderNoteCreateSerializer,
    OrderNoteSerializer,
    ProductionStatusHistorySerializer,
    StatusUpdateSerializer,
)
from apps.production.services import (
    add_order_note,
    departments_for_user_on_order,
    update_department_status,
)
from apps.rbac.access import get_access
from apps.rbac.permissions import RBACPermission
from common.exceptions import BusinessRuleError

from .models import Order
from .selectors import order_assignments, orders_for_user
from .serializers import (
    AssignmentHistorySerializer,
    AssignmentSerializer,
    OrderCreateSerializer,
    OrderSerializer,
    OrderUpdateSerializer,
)
from .services import _generate_and_attach_image, assign_employee, create_order


class OrderViewSet(viewsets.ModelViewSet):
    """Order management.

    - List/retrieve: scoped by ``orders_for_user`` (admins: all; employees:
      currently assigned only).
    - Create/update/assign: admin only.
    """

    serializer_class = OrderSerializer
    permission_classes = [IsAuthenticated, IsActiveUser, RBACPermission]
    permission_map = {
        "list": "orders.view_order",
        "retrieve": "orders.view_order",
        "create": "orders.create_order",
        "update": "orders.edit_order",
        "partial_update": "orders.edit_order",
        "assign": "orders.assign_order",
        "assignments": "orders.view_assignments",
        "original_image": "orders.view_media",
        "generated_image": "orders.view_media",
        "order_status": "production.update_status",
        "history": "production.view_status_history",
        "notes": {"GET": "orders.view_notes", "POST": "orders.create_note"},
    }
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    http_method_names = ["get", "post", "patch", "head", "options"]
    filterset_fields = ["overall_status", "cutting_status", "operator_status"]
    search_fields = [
        "order_number",
        "cutting_man__full_name",
        "cutting_man__employee_code",
        "operator__full_name",
        "operator__employee_code",
    ]
    ordering_fields = ["created_at", "order_number", "overall_status"]
    ordering = ["-created_at"]

    def get_queryset(self):
        # During OpenAPI schema generation there is no real user.
        if getattr(self, "swagger_fake_view", False):
            return Order.objects.none()
        return orders_for_user(self.request.user)

    def get_serializer_class(self):
        if self.action == "create":
            return OrderCreateSerializer
        if self.action in {"update", "partial_update"}:
            return OrderUpdateSerializer
        return OrderSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            order = create_order(
                order_number=data["order_number"],
                original_image=data["original_image"],
                cutting_man=data["cutting_man"],
                operator=data["operator"],
                created_by=request.user,
            )
        except BusinessRuleError as exc:
            return Response({"detail": exc.detail}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            OrderSerializer(order, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    def partial_update(self, request, *args, **kwargs):
        order = self.get_object()
        serializer = self.get_serializer(order, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        original_changed = "original_image" in serializer.validated_data
        order = serializer.save()
        if original_changed:
            # A new original means the generated card must be rebuilt from it.
            _generate_and_attach_image(order)
            order.refresh_from_db()
        return Response(OrderSerializer(order, context={"request": request}).data)

    @extend_schema(request=AssignmentSerializer, responses={200: OrderSerializer})
    @action(
        detail=True,
        methods=["patch"],
        url_path="assign",
    )
    def assign(self, request, pk=None):
        order = self.get_object()
        serializer = AssignmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            order = assign_employee(
                order=order,
                department=data["department"],
                new_employee=data["employee_id"],
                assigned_by=request.user,
            )
        except BusinessRuleError as exc:
            return Response({"detail": exc.detail}, status=status.HTTP_400_BAD_REQUEST)
        order.refresh_from_db()
        return Response(OrderSerializer(order, context={"request": request}).data)

    @extend_schema(responses={200: AssignmentHistorySerializer(many=True)})
    @action(detail=True, methods=["get"], url_path="assignments")
    def assignments(self, request, pk=None):
        order = self.get_object()
        queryset = order_assignments(order)
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = AssignmentHistorySerializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = AssignmentHistorySerializer(queryset, many=True)
        return Response(serializer.data)

    # ------------------------------------------------------------------ #
    # Secure media delivery — authenticated + object-scoped (Batch 1)
    # ------------------------------------------------------------------ #
    @staticmethod
    def _serve_order_image(field_file, request):
        """Stream an order image from storage to an authorized requester.

        The file is read via the configured storage backend (never by building a
        filesystem path from client input), so path traversal is impossible and
        filesystem paths are never exposed. Access is already scoped by
        ``get_object()`` (admin or currently-assigned employee only).
        """
        if not field_file:
            raise Http404("Image not found.")
        try:
            field_file.open("rb")
        except (FileNotFoundError, OSError):
            raise Http404("Image file is missing.") from None

        filename = os.path.basename(field_file.name)
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        response = FileResponse(field_file, content_type=content_type)
        response["Content-Disposition"] = f'inline; filename="{filename}"'
        # Authenticated, order-scoped resource: never cache on shared caches.
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(responses={(200, "image/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"], url_path="original-image")
    def original_image(self, request, pk=None):
        order = self.get_object()
        return self._serve_order_image(order.original_image, request)

    @extend_schema(responses={(200, "image/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"], url_path="generated-image")
    def generated_image(self, request, pk=None):
        order = self.get_object()
        return self._serve_order_image(order.generated_image, request)

    # ------------------------------------------------------------------ #
    # Production (status / history / notes) — Phase 5
    # ------------------------------------------------------------------ #
    @extend_schema(request=StatusUpdateSerializer, responses={200: OrderSerializer})
    @action(detail=True, methods=["patch"], url_path="status")
    def order_status(self, request, pk=None):
        order = self.get_object()
        serializer = StatusUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = request.user
        access = get_access(request)
        department = data.get("department")

        if access.has_scope("production.update_status", "ALL"):
            # Administrators may act on either department but must say which.
            if not department:
                return Response(
                    {"detail": {"department": "Admin must specify a department."}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            # Employees act only on departments they are currently assigned to.
            owned = departments_for_user_on_order(order, user)
            if not owned:
                return Response(
                    {"detail": "Your role cannot update production status."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            department = department if department in owned else owned[0]

        try:
            order = update_department_status(
                order=order,
                employee=user,
                department=department,
                new_status=data["status"],
                note=data.get("note", ""),
            )
        except BusinessRuleError as exc:
            return Response({"detail": exc.detail}, status=status.HTTP_400_BAD_REQUEST)
        order.refresh_from_db()
        return Response(OrderSerializer(order, context={"request": request}).data)

    @extend_schema(responses={200: ProductionStatusHistorySerializer(many=True)})
    @action(detail=True, methods=["get"], url_path="history")
    def history(self, request, pk=None):
        order = self.get_object()
        queryset = order_status_history(order)
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = ProductionStatusHistorySerializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = ProductionStatusHistorySerializer(queryset, many=True)
        return Response(serializer.data)

    @extend_schema(
        request=OrderNoteCreateSerializer,
        responses={200: OrderNoteSerializer(many=True), 201: OrderNoteSerializer},
    )
    @action(detail=True, methods=["get", "post"], url_path="notes")
    def notes(self, request, pk=None):
        order = self.get_object()
        if request.method == "POST":
            serializer = OrderNoteCreateSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            data = serializer.validated_data
            try:
                note = add_order_note(
                    order=order,
                    author=request.user,
                    department=data["department"],
                    body=data["body"],
                )
            except BusinessRuleError as exc:
                return Response({"detail": exc.detail}, status=status.HTTP_400_BAD_REQUEST)
            return Response(OrderNoteSerializer(note).data, status=status.HTTP_201_CREATED)

        queryset = order_notes(order)
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = OrderNoteSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = OrderNoteSerializer(queryset, many=True)
        return Response(serializer.data)