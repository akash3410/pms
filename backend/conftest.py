"""Shared pytest fixtures for the POMS test suite."""
import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from apps.accounts.models import Role, User
from apps.orders.models import Order


def make_image_bytes(color=(200, 50, 50), size=(120, 80), fmt="PNG") -> bytes:
    """Return raw bytes of a small solid-colour test image."""
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format=fmt)
    return buffer.getvalue()


@pytest.fixture
def sample_image() -> SimpleUploadedFile:
    return SimpleUploadedFile(
        "order_card.png", make_image_bytes(), content_type="image/png"
    )


@pytest.fixture
def admin_user(db) -> User:
    return User.objects.create_user(
        username="admin1",
        password="Admin12345!",
        employee_code="ADM-001",
        full_name="Admin One",
        role=Role.ADMIN,
        is_staff=True,
    )


@pytest.fixture
def cutting_user(db) -> User:
    return User.objects.create_user(
        username="cutter1",
        password="Cutter12345!",
        employee_code="CUT-001",
        full_name="Cutter One",
        role=Role.CUTTING_MAN,
    )


@pytest.fixture
def operator_user(db) -> User:
    return User.objects.create_user(
        username="operator1",
        password="Operator12345!",
        employee_code="OPR-001",
        full_name="Operator One",
        role=Role.OPERATOR,
    )


@pytest.fixture
def order(db, admin_user, cutting_user, operator_user, sample_image) -> Order:
    return Order.objects.create(
        order_number="ORD-0001",
        original_image=sample_image,
        cutting_man=cutting_user,
        operator=operator_user,
        created_by=admin_user,
    )


@pytest.fixture(autouse=True)
def _isolated_media_root(settings, tmp_path):
    """Redirect MEDIA_ROOT to a per-test temp dir (POMS-AUDIT-018).

    Tests generate order-card images; without isolation they accumulate under
    the real ``MEDIA_ROOT``. Using a temp dir per test guarantees cleanup and
    never touches real user-uploaded media. The cached storage location is
    cleared so the override takes effect immediately.
    """
    media_dir = tmp_path / "media"
    media_dir.mkdir(parents=True, exist_ok=True)
    settings.MEDIA_ROOT = str(media_dir)

    from django.core.files.storage import default_storage
    from django.utils.functional import empty

    if getattr(default_storage, "_wrapped", empty) is empty:
        default_storage._setup()
    wrapped = default_storage._wrapped
    for attr in ("location", "base_location"):
        wrapped.__dict__.pop(attr, None)
    yield