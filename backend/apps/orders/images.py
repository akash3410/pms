"""Order-card image processing (Pillow).

Centralised configuration & generation for the *generated* order card.

Critical rules honoured here:
- The ORIGINAL uploaded image is never modified.
- Generation always starts from the original image file.
- Overlay text = Cutting Man's name + Operator's name, at configurable
  positions (relative to image dimensions, so they scale with image size).

All tunable values (font, size, colour, alignment, coordinates) live in
``DEFAULT_IMAGE_OVERLAY_CONFIG`` below — the single place to change them.
"""
from __future__ import annotations

import io
import os
from dataclasses import dataclass

from django.conf import settings
from PIL import Image, ImageDraw, ImageFont

# --------------------------------------------------------------------------- #
# Font discovery (first existing wins; falls back to Pillow default)
# --------------------------------------------------------------------------- #
_FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
]


@dataclass(frozen=True)
class TextOverlay:
    """Configuration for one text overlay (one department's name)."""

    # Anchor point as a fraction of (width, height). (0.5, 0.1) = top-center.
    relative_x: float
    relative_y: float
    # Font size as a fraction of image height.
    font_size_fraction: float = 0.05
    # Max text width as a fraction of image width before wrapping.
    max_width_fraction: float = 0.8
    # RGBA fill / stroke colours (0-255).
    fill: tuple[int, int, int, int] = (255, 255, 255, 255)
    stroke_fill: tuple[int, int, int, int] = (0, 0, 0, 255)
    stroke_width: int = 2
    max_lines: int = 2


@dataclass(frozen=True)
class ImageOverlayConfig:
    """Full image overlay configuration."""

    cutting: TextOverlay
    operator: TextOverlay
    output_format: str = "PNG"


@dataclass(frozen=True)
class ImageLimits:
    """Centralised, deployment-configurable image safety limits (POMS-AUDIT-005).

    All image size/dimension/pixel limits and the allowed-format lists live here
    (and only here); upload validation and generation both read from this one
    object. Values are sourced from Django settings so they stay environment
    driven, but this module is the single point of access.
    """

    max_bytes: int
    max_pixels: int
    max_dimension: int
    allowed_extensions: tuple[str, ...]
    allowed_content_types: tuple[str, ...]

    @classmethod
    def from_settings(cls) -> ImageLimits:
        return cls(
            max_bytes=settings.MAX_ORDER_IMAGE_SIZE_BYTES,
            max_pixels=settings.MAX_ORDER_IMAGE_PIXELS,
            max_dimension=settings.MAX_ORDER_IMAGE_DIMENSION,
            allowed_extensions=tuple(settings.ALLOWED_IMAGE_EXTENSIONS),
            allowed_content_types=tuple(settings.ALLOWED_IMAGE_CONTENT_TYPES),
        )

    def check_dimensions(self, width: int, height: int) -> str | None:
        """Return an error message if the dimensions exceed the caps, else None.

        Kept message-only so callers can surface it through their own error
        channel (DRF ``ValidationError`` for uploads, ``ValueError`` for the
        generation pipeline).
        """
        if width > self.max_dimension or height > self.max_dimension:
            return (
                f"Image dimensions {width}x{height} exceed the maximum of "
                f"{self.max_dimension}px per side."
            )
        if width * height > self.max_pixels:
            return (
                f"Image has too many pixels ({width}x{height}); the maximum is "
                f"{self.max_pixels} pixels."
            )
        return None


# --------------------------------------------------------------------------- #
# PLACEHOLDER COORDINATES
# --------------------------------------------------------------------------- #
# No real sample order-card image was provided, so these coordinates are
# reasonable placeholders. Adjust once a real sample is available.
#   - Cutting Man: near the top of the card.
#   - Operator:    near the bottom of the card.
DEFAULT_IMAGE_OVERLAY_CONFIG = ImageOverlayConfig(
    cutting=TextOverlay(relative_x=0.5, relative_y=0.12),
    operator=TextOverlay(relative_x=0.5, relative_y=0.88),
)


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in _FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    try:
        return ImageFont.truetype("DejaVuSans.ttf", size)
    except OSError:
        return ImageFont.load_default()


def _fit_font(draw, text, max_width, base_size, min_size=10):
    """Shrink font size until ``text`` fits within ``max_width``."""
    size = base_size
    font = _load_font(size)
    while size > min_size and draw.textlength(text, font=font) > max_width:
        size -= 2
        font = _load_font(size)
    return font


def _wrap_text(draw, text, font, max_width, max_lines):
    """Wrap text into at most ``max_lines`` lines, ellipsising any overflow."""
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if not current or draw.textlength(candidate, font=font) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)

    if len(lines) > max_lines:
        lines = lines[:max_lines]
        last = lines[-1]
        while last and draw.textlength(last + "…", font=font) > max_width:
            last = last[:-1]
        lines[-1] = last + "…"
    return lines or [text[:1]]


def _draw_overlay(draw, text, spec: TextOverlay, width: int, height: int) -> None:
    if not text:
        return
    max_width = max(1, int(width * spec.max_width_fraction))
    base_size = max(10, int(height * spec.font_size_fraction))
    font = _fit_font(draw, text, max_width, base_size)
    lines = _wrap_text(draw, text, font, max_width, spec.max_lines)

    center_x = width * spec.relative_x
    center_y = height * spec.relative_y
    line_height = int(base_size * 1.25)
    total_height = line_height * len(lines)
    start_y = center_y - total_height / 2

    for index, line in enumerate(lines):
        y = start_y + index * line_height + line_height / 2
        draw.text(
            (center_x, y),
            line,
            font=font,
            fill=spec.fill,
            stroke_width=spec.stroke_width,
            stroke_fill=spec.stroke_fill,
            anchor="mm",
        )


def generate_order_card_image(
    original_image,
    cutting_name: str,
    operator_name: str,
    config: ImageOverlayConfig | None = None,
) -> bytes:
    """Return PNG/JPEG bytes of the generated order card.

    Reads from ``original_image`` (a file-like object / Django FieldFile), draws
    the two names per ``config``, and returns encoded image bytes. The original
    file is not modified.
    """
    config = config or DEFAULT_IMAGE_OVERLAY_CONFIG

    limits = ImageLimits.from_settings()
    original_image.seek(0)
    with Image.open(original_image) as src:
        # Defensive cap (POMS-AUDIT-005): uploads are already bounded by
        # ``validate_image_file``, but never decode an oversized source here.
        # ``.size`` reads only the header — no full pixel decode yet.
        error = limits.check_dimensions(*src.size)
        if error:
            raise ValueError(f"Source image exceeds the allowed size: {error}")
        base = src.convert("RGBA")

    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    width, height = base.size
    _draw_overlay(draw, cutting_name, config.cutting, width, height)
    _draw_overlay(draw, operator_name, config.operator, width, height)

    combined = Image.alpha_composite(base, overlay).convert("RGB")
    buffer = io.BytesIO()
    combined.save(buffer, format=config.output_format, optimize=True)
    return buffer.getvalue()