"""Upload validation for order-card images.

Validates size, declared content type, file extension, and — crucially — that the
bytes actually decode as a real image (via Pillow) so a renamed non-image cannot
slip through.

All limits (size, dimensions, pixels, allowed formats) are centralised in
``apps.orders.images.ImageLimits`` (POMS-AUDIT-005). Only the image header is
read for the dimension check; full pixel decoding is never performed here.
"""
import contextlib
import os
import warnings

from PIL import Image
from rest_framework.exceptions import ValidationError

from apps.orders.images import ImageLimits


def validate_image_file(uploaded_file) -> None:
    """Raise ``rest_framework.exceptions.ValidationError`` if invalid.

    On success the file pointer is reset to the start so it can be re-read.
    """
    limits = ImageLimits.from_settings()

    # 1) Size
    size = getattr(uploaded_file, "size", None)
    if size is None or size <= 0:
        raise ValidationError("Uploaded file is empty.")
    if size > limits.max_bytes:
        raise ValidationError(
            f"Image is too large ({size} bytes). Maximum allowed is {limits.max_bytes} bytes."
        )

    # 2) Declared content type
    content_type = getattr(uploaded_file, "content_type", "")
    if content_type and content_type not in limits.allowed_content_types:
        raise ValidationError(
            f"Unsupported content type '{content_type}'. "
            f"Allowed: {', '.join(limits.allowed_content_types)}."
        )

    # 3) Extension
    ext = os.path.splitext(getattr(uploaded_file, "name", ""))[1].lstrip(".").lower()
    if ext not in limits.allowed_extensions:
        raise ValidationError(
            f"Unsupported file extension '.{ext}'. "
            f"Allowed: {', '.join(limits.allowed_extensions)}."
        )

    # 4) Real image + dimension/pixel caps (POMS-AUDIT-005).
    # ``verify()`` checks integrity without decoding every pixel, and ``.size``
    # reads only the header, so an oversized-but-valid image is rejected before
    # any full decode. Pillow's decompression-bomb warning/error is treated as a
    # hard rejection rather than allowed through.
    try:
        uploaded_file.seek(0)
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(uploaded_file) as image:
                error = limits.check_dimensions(*image.size)
                if error:
                    raise ValidationError(error)
                image.verify()
    except ValidationError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ValidationError("Image is too large to process safely.") from exc
    except Exception as exc:  # noqa: BLE001 - any decode failure means invalid
        raise ValidationError("Uploaded file is not a valid image.") from exc
    finally:
        with contextlib.suppress(Exception):
            uploaded_file.seek(0)