"""API + service tests for orders, assignments, and image generation (Phase 4)."""
import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.orders.images import generate_order_card_image
from apps.orders.models import Order
from common.enums import Department, OverallStatus

pytestmark = pytest.mark.django_db


def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _multipart_image():
    buffer = io.BytesIO()
    Image.new("RGB", (200, 120), (10, 120, 200)).save(buffer, format="PNG")
    return SimpleUploadedFile("card.png", buffer.getvalue(), content_type="image/png")


def _create_order(client, number="ORD-100", cutting=None, operator=None, image=None):
    return client.post(
        "/api/v1/orders/",
        {
            "order_number": number,
            "original_image": image or _multipart_image(),
            "cutting_man": str(cutting.pk),
            "operator": str(operator.pk),
        },
        format="multipart",
    )


class TestImageGeneration:
    def test_generates_png_from_original(self, sample_image):
        data = generate_order_card_image(sample_image, "Cutting Person", "Operator Person")
        img = Image.open(io.BytesIO(data))
        assert img.format == "PNG"
        assert img.size == (120, 80)

    def test_handles_long_names(self, sample_image):
        long_name = "A Very Long Employee Name That Should Wrap Nicely"
        data = generate_order_card_image(sample_image, long_name, long_name)
        img = Image.open(io.BytesIO(data))
        assert img.size == (120, 80)


class TestOrderCreation:
    def test_admin_creates_order(self, admin_user, cutting_user, operator_user):
        resp = _create_order(auth_client(admin_user), cutting=cutting_user, operator=operator_user)
        assert resp.status_code == 201, resp.data
        assert resp.data["overall_status"] == OverallStatus.PENDING
        order = Order.objects.get(order_number="ORD-100")
        assert order.generated_image  # generated
        assert order.assignments.count() == 2  # one per department

    def test_duplicate_order_number_rejected(self, admin_user, cutting_user, operator_user):
        client = auth_client(admin_user)
        first = _create_order(client, cutting=cutting_user, operator=operator_user)
        assert first.status_code == 201
        second = _create_order(client, cutting=cutting_user, operator=operator_user)
        assert second.status_code == 400

    def test_order_number_uniqueness_is_case_sensitive(
        self, admin_user, cutting_user, operator_user
    ):
        # POMS-AUDIT-010/020: the unique constraint is case-sensitive, so a
        # differently-cased number is a distinct order (documented behaviour).
        client = auth_client(admin_user)
        first = _create_order(
            client, number="ORD-CASE", cutting=cutting_user, operator=operator_user
        )
        assert first.status_code == 201, first.data
        second = _create_order(
            client, number="ord-case", cutting=cutting_user, operator=operator_user
        )
        assert second.status_code == 201, second.data
        assert second.data["order_number"] == "ord-case"

    def test_invalid_image_rejected(self, admin_user, cutting_user, operator_user):
        bad = SimpleUploadedFile("card.txt", b"not an image", content_type="text/plain")
        resp = _create_order(
            auth_client(admin_user), cutting=cutting_user, operator=operator_user, image=bad
        )
        assert resp.status_code == 400

    def test_wrong_role_assignee_rejected(self, admin_user, cutting_user, operator_user):
        # operator_user has OPERATOR role but is passed as cutting_man
        resp = _create_order(
            auth_client(admin_user), cutting=operator_user, operator=operator_user
        )
        assert resp.status_code == 400

    def test_employee_cannot_create_order(self, cutting_user, operator_user):
        resp = _create_order(
            auth_client(cutting_user), cutting=cutting_user, operator=operator_user
        )
        assert resp.status_code == 403


class TestOrderVisibility:
    def test_admin_sees_all(self, admin_user, order):
        resp = auth_client(admin_user).get("/api/v1/orders/")
        assert resp.status_code == 200
        assert resp.data["count"] >= 1

    def test_assignees_see_assigned(self, admin_user, cutting_user, operator_user):
        _create_order(auth_client(admin_user), cutting=cutting_user, operator=operator_user)
        for user in (cutting_user, operator_user):
            resp = auth_client(user).get("/api/v1/orders/")
            assert resp.status_code == 200
            assert resp.data["count"] == 1

    def test_unrelated_employee_sees_none(self, admin_user, cutting_user, operator_user):
        _create_order(auth_client(admin_user), cutting=cutting_user, operator=operator_user)
        other = User.objects.create_user(
            username="other", password="x", employee_code="OPR-999",
            full_name="Other Op", role=Role.OPERATOR,
        )
        resp = auth_client(other).get("/api/v1/orders/")
        assert resp.status_code == 200
        assert resp.data["count"] == 0

    def test_employee_cannot_retrieve_unassigned_order(self, admin_user, cutting_user, operator_user):
        resp = _create_order(auth_client(admin_user), cutting=cutting_user, operator=operator_user)
        order_id = resp.data["id"]
        other = User.objects.create_user(
            username="intruder", password="x", employee_code="CUT-999",
            full_name="Intruder", role=Role.CUTTING_MAN,
        )
        resp2 = auth_client(other).get(f"/api/v1/orders/{order_id}/")
        assert resp2.status_code == 404


class TestAssignment:
    def test_reassign_cutting(self, admin_user, cutting_user, operator_user):
        client = auth_client(admin_user)
        created = _create_order(client, cutting=cutting_user, operator=operator_user)
        order_id = created.data["id"]
        new_cutter = User.objects.create_user(
            username="cutter2", password="x", employee_code="CUT-002",
            full_name="Cutter Two", role=Role.CUTTING_MAN,
        )
        resp = client.patch(
            f"/api/v1/orders/{order_id}/assign/",
            {"department": Department.CUTTING, "employee_id": str(new_cutter.pk)},
            format="json",
        )
        assert resp.status_code == 200, resp.data
        order = Order.objects.get(pk=order_id)
        assert order.cutting_man_id == new_cutter.pk
        assert order.overall_status == OverallStatus.PENDING
        # History: 2 initial + 1 reassign = 3
        assert order.assignments.count() == 3
        latest = order.assignments.first()
        assert latest.previous_employee_id == cutting_user.pk
        assert latest.new_employee_id == new_cutter.pk

    def test_reassign_inactive_employee_rejected(self, admin_user, cutting_user, operator_user):
        client = auth_client(admin_user)
        created = _create_order(client, cutting=cutting_user, operator=operator_user)
        order_id = created.data["id"]
        inactive = User.objects.create_user(
            username="cutter3", password="x", employee_code="CUT-003",
            full_name="Cutter Three", role=Role.CUTTING_MAN, is_active=False,
        )
        resp = client.patch(
            f"/api/v1/orders/{order_id}/assign/",
            {"department": Department.CUTTING, "employee_id": str(inactive.pk)},
            format="json",
        )
        assert resp.status_code == 400

    def test_reassign_wrong_role_rejected(self, admin_user, cutting_user, operator_user):
        client = auth_client(admin_user)
        created = _create_order(client, cutting=cutting_user, operator=operator_user)
        order_id = created.data["id"]
        resp = client.patch(
            f"/api/v1/orders/{order_id}/assign/",
            {"department": Department.CUTTING, "employee_id": str(operator_user.pk)},
            format="json",
        )
        assert resp.status_code == 400

    def test_employee_cannot_assign(self, cutting_user, operator_user):
        resp = auth_client(cutting_user).patch(
            "/api/v1/orders/00000000-0000-0000-0000-000000000000/assign/",
            {"department": Department.CUTTING, "employee_id": str(operator_user.pk)},
            format="json",
        )
        assert resp.status_code in (403, 404)

    def test_assignments_history_endpoint(self, admin_user, cutting_user, operator_user):
        client = auth_client(admin_user)
        created = _create_order(client, cutting=cutting_user, operator=operator_user)
        order_id = created.data["id"]
        resp = client.get(f"/api/v1/orders/{order_id}/assignments/")
        assert resp.status_code == 200
        # paginated response
        results = resp.data["results"] if isinstance(resp.data, dict) else resp.data
        assert len(results) == 2

    def test_assignment_regenerates_image(self, admin_user, cutting_user, operator_user):
        from django.core.files.storage import default_storage

        client = auth_client(admin_user)
        created = _create_order(client, cutting=cutting_user, operator=operator_user)
        order_id = created.data["id"]
        before = Order.objects.get(pk=order_id).generated_image.name
        new_cutter = User.objects.create_user(
            username="cutter9", password="x", employee_code="CUT-009",
            full_name="Cutter Nine", role=Role.CUTTING_MAN,
        )
        client.patch(
            f"/api/v1/orders/{order_id}/assign/",
            {"department": Department.CUTTING, "employee_id": str(new_cutter.pk)},
            format="json",
        )
        after = Order.objects.get(pk=order_id).generated_image.name
        assert before != after  # a new generated file was produced
        assert default_storage.exists(after)


class TestOrderUpdate:
    def test_admin_updates_order_number(self, admin_user, cutting_user, operator_user):
        client = auth_client(admin_user)
        created = _create_order(client, cutting=cutting_user, operator=operator_user)
        order_id = created.data["id"]
        resp = client.patch(
            f"/api/v1/orders/{order_id}/", {"order_number": "ORD-UPDATED"}, format="json"
        )
        assert resp.status_code == 200
        assert resp.data["order_number"] == "ORD-UPDATED"

    def test_employee_cannot_update_order(self, admin_user, cutting_user, operator_user):
        client = auth_client(admin_user)
        created = _create_order(client, cutting=cutting_user, operator=operator_user)
        order_id = created.data["id"]
        resp = auth_client(cutting_user).patch(
            f"/api/v1/orders/{order_id}/", {"order_number": "HACKED"}, format="json"
        )
        assert resp.status_code == 403


class TestOrderImageAccess:
    """Batch 1 / POMS-AUDIT-002: order images are access-controlled."""

    def _new_order(self, admin_user, cutting_user, operator_user, number="ORD-IMG"):
        created = _create_order(
            auth_client(admin_user),
            number=number,
            cutting=cutting_user,
            operator=operator_user,
        )
        assert created.status_code == 201, created.data
        return created.data["id"]

    def test_serializer_returns_endpoint_url_not_media_path(self, admin_user, cutting_user, operator_user):
        order_id = self._new_order(admin_user, cutting_user, operator_user)
        resp = auth_client(admin_user).get(f"/api/v1/orders/{order_id}/")
        assert "original-image" in resp.data["original_image"]
        assert "generated-image" in resp.data["generated_image"]
        assert "/media/" not in resp.data["original_image"]

    def test_admin_can_access_original_image(self, admin_user, cutting_user, operator_user):
        order_id = self._new_order(admin_user, cutting_user, operator_user)
        resp = auth_client(admin_user).get(f"/api/v1/orders/{order_id}/original-image/")
        assert resp.status_code == 200
        assert resp["Content-Type"].startswith("image/")

    def test_assignees_can_access_original_image(self, admin_user, cutting_user, operator_user):
        order_id = self._new_order(admin_user, cutting_user, operator_user)
        for user in (cutting_user, operator_user):
            resp = auth_client(user).get(f"/api/v1/orders/{order_id}/original-image/")
            assert resp.status_code == 200

    def test_admin_can_access_generated_image(self, admin_user, cutting_user, operator_user):
        order_id = self._new_order(admin_user, cutting_user, operator_user)
        resp = auth_client(admin_user).get(f"/api/v1/orders/{order_id}/generated-image/")
        assert resp.status_code == 200
        assert resp["Content-Type"].startswith("image/")

    def test_unassigned_employee_cannot_access_images(self, admin_user, cutting_user, operator_user):
        order_id = self._new_order(admin_user, cutting_user, operator_user)
        outsider = User.objects.create_user(
            username="outsider", password="x", employee_code="CUT-800",
            full_name="Outsider", role=Role.CUTTING_MAN,
        )
        for path in ("original-image", "generated-image"):
            resp = auth_client(outsider).get(f"/api/v1/orders/{order_id}/{path}/")
            assert resp.status_code == 404

    def test_unauthenticated_cannot_access_images(self, admin_user, cutting_user, operator_user):
        order_id = self._new_order(admin_user, cutting_user, operator_user)
        resp = APIClient().get(f"/api/v1/orders/{order_id}/original-image/")
        assert resp.status_code == 401

    def test_missing_generated_image_returns_404(self, admin_user, cutting_user, operator_user, sample_image):
        order = Order.objects.create(
            order_number="ORD-NOGEN",
            original_image=sample_image,
            cutting_man=cutting_user,
            operator=operator_user,
            created_by=admin_user,
        )
        resp = auth_client(admin_user).get(f"/api/v1/orders/{order.pk}/generated-image/")
        assert resp.status_code == 404

    def test_media_url_not_publicly_served(self, admin_user, cutting_user, operator_user, sample_image):
        order = Order.objects.create(
            order_number="ORD-PUB",
            original_image=sample_image,
            cutting_man=cutting_user,
            operator=operator_user,
            created_by=admin_user,
        )
        # The raw /media/... path must not be served (no public static handler).
        resp = APIClient().get(f"/media/{order.original_image.name}")
        assert resp.status_code == 404


def _img_of_size(width, height):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (200, 100, 50)).save(buffer, format="PNG")
    return SimpleUploadedFile("card.png", buffer.getvalue(), content_type="image/png")


class TestOrderNumberValidation:
    """POMS-AUDIT-004: order_number is path-embedded, so reject unsafe input."""

    def test_path_traversal_rejected(self, admin_user, cutting_user, operator_user):
        client = auth_client(admin_user)
        resp = _create_order(
            client,
            number="../../../../etc/passwd",
            cutting=cutting_user,
            operator=operator_user,
        )
        assert resp.status_code == 400

    def test_slash_rejected(self, admin_user, cutting_user, operator_user):
        client = auth_client(admin_user)
        resp = _create_order(
            client, number="BAD/NUMBER", cutting=cutting_user, operator=operator_user
        )
        assert resp.status_code == 400

    def test_too_long_rejected(self, admin_user, cutting_user, operator_user):
        client = auth_client(admin_user)
        resp = _create_order(
            client,
            number="A" * 65,
            cutting=cutting_user,
            operator=operator_user,
        )
        assert resp.status_code == 400

    def test_valid_number_still_created(self, admin_user, cutting_user, operator_user):
        client = auth_client(admin_user)
        resp = _create_order(
            client,
            number="ORD-9001",
            cutting=cutting_user,
            operator=operator_user,
        )
        assert resp.status_code == 201, resp.data

    def test_control_character_rejected(self, admin_user, cutting_user, operator_user):
        client = auth_client(admin_user)
        resp = _create_order(
            client, number="ORD\u0001X", cutting=cutting_user, operator=operator_user
        )
        assert resp.status_code == 400

    def test_dot_and_backslash_rejected(self, admin_user, cutting_user, operator_user):
        client = auth_client(admin_user)
        for bad in ("ORD.1", "ORD\\1", "../etc"):
            resp = _create_order(
                client, number=bad, cutting=cutting_user, operator=operator_user
            )
            assert resp.status_code == 400, bad


class TestUploadPathSafety:
    """POMS-AUDIT-004: upload paths must not depend on raw order_number."""

    def test_upload_path_uses_uuid_not_order_number(self, admin_user, cutting_user, operator_user):
        client = auth_client(admin_user)
        resp = _create_order(
            client, number="ORD-PATH-1", cutting=cutting_user, operator=operator_user
        )
        assert resp.status_code == 201, resp.data
        order = Order.objects.get(order_number="ORD-PATH-1")
        assert "ORD-PATH-1" not in order.original_image.name
        assert order.original_image.name.startswith("originals/")


class TestImageLimits:
    """POMS-AUDIT-005: reject oversized dimensions / pixel counts."""

    def test_dimension_cap_enforced(self, settings, admin_user, cutting_user, operator_user):
        settings.MAX_ORDER_IMAGE_DIMENSION = 100
        client = auth_client(admin_user)
        resp = _create_order(
            client,
            number="ORD-DIM",
            cutting=cutting_user,
            operator=operator_user,
            image=_img_of_size(200, 120),
        )
        assert resp.status_code == 400
        assert not Order.objects.filter(order_number="ORD-DIM").exists()

    def test_pixel_cap_enforced(self, settings, admin_user, cutting_user, operator_user):
        settings.MAX_ORDER_IMAGE_PIXELS = 1_000
        client = auth_client(admin_user)
        resp = _create_order(
            client,
            number="ORD-PX",
            cutting=cutting_user,
            operator=operator_user,
            image=_img_of_size(200, 120),
        )
        assert resp.status_code == 400

    def test_normal_image_accepted(self, admin_user, cutting_user, operator_user):
        client = auth_client(admin_user)
        resp = _create_order(
            client,
            number="ORD-OK",
            cutting=cutting_user,
            operator=operator_user,
            image=_img_of_size(200, 120),
        )
        assert resp.status_code == 201, resp.data

    def test_malformed_image_rejected(self, admin_user, cutting_user, operator_user):
        bad = SimpleUploadedFile("x.png", b"this is not an image", content_type="image/png")
        client = auth_client(admin_user)
        resp = _create_order(
            client,
            number="ORD-MALFORMED",
            cutting=cutting_user,
            operator=operator_user,
            image=bad,
        )
        assert resp.status_code == 400


class TestOverallStatusConsistency:
    """POMS-AUDIT-009: overall_status must track the two department statuses."""

    def test_overall_status_follows_departments(self, admin_user, cutting_user, operator_user):
        client = auth_client(admin_user)
        created = _create_order(
            client, number="ORD-STATUS", cutting=cutting_user, operator=operator_user
        )
        order_id = created.data["id"]
        assert Order.objects.get(pk=order_id).overall_status == OverallStatus.PENDING

        auth_client(cutting_user).patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": "COMPLETED"},
            format="json",
        )
        assert Order.objects.get(pk=order_id).overall_status == OverallStatus.IN_PROGRESS

        auth_client(operator_user).patch(
            f"/api/v1/orders/{order_id}/status/",
            {"status": "COMPLETED"},
            format="json",
        )
        assert Order.objects.get(pk=order_id).overall_status == OverallStatus.COMPLETED

    def test_bulk_update_cannot_leave_stale_overall_status(
        self, admin_user, cutting_user, operator_user
    ):
        client = auth_client(admin_user)
        created = _create_order(
            client, number="ORD-BULK", cutting=cutting_user, operator=operator_user
        )
        order_id = created.data["id"]
        assert Order.objects.get(pk=order_id).overall_status == OverallStatus.PENDING

        # A raw bulk update that changes only cutting_status (leaving overall
        # PENDING) must be rejected by the DB check constraint, not silently
        # persist a stale overall_status.
        with pytest.raises(IntegrityError), transaction.atomic():
            Order.objects.filter(pk=order_id).update(cutting_status="COMPLETED")

        order = Order.objects.get(pk=order_id)
        assert order.cutting_status == "PENDING"  # rolled back
        assert order.overall_status == OverallStatus.PENDING

    def test_consistent_bulk_update_is_allowed(self, admin_user, cutting_user, operator_user):
        client = auth_client(admin_user)
        created = _create_order(
            client, number="ORD-BULK2", cutting=cutting_user, operator=operator_user
        )
        order_id = created.data["id"]
        # A bulk update that keeps overall_status consistent is permitted.
        Order.objects.filter(pk=order_id).update(
            cutting_status="COMPLETED", overall_status=OverallStatus.IN_PROGRESS
        )
        order = Order.objects.get(pk=order_id)
        assert order.cutting_status == "COMPLETED"
        assert order.overall_status == OverallStatus.IN_PROGRESS