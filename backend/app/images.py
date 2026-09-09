"""Reversible image transforms. White mask pixels mean editable clothing."""
from dataclasses import dataclass
from io import BytesIO
import warnings

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from .errors import TryOnError


def decode_image(data: bytes, *, max_bytes: int, max_pixels: int) -> Image.Image:
    if not data or len(data) > max_bytes:
        raise TryOnError("image_size", "Choose a non-empty image under 10 MB.", 413)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as source:
                if source.format not in {"PNG", "JPEG", "WEBP"}:
                    raise TryOnError("image_format", "Use a PNG, JPEG or WebP image.")
                if source.width * source.height > max_pixels:
                    raise TryOnError("image_dimensions", "Use an image under 16 megapixels.", 413)
                if min(source.size) < 128:
                    raise TryOnError("image_dimensions", "Both image dimensions must be at least 128 pixels.")
                source.load()
                # EXIF orientation is applied once; metadata is not copied into outputs.
                decoded = ImageOps.exif_transpose(source).convert("RGBA")
                decoded.info.clear()
                return decoded
    except (UnidentifiedImageError, OSError, ValueError,
            Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise TryOnError("invalid_image", "This file cannot be decoded as an image.") from error


def rgb_on_white(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    return Image.alpha_composite(Image.new("RGBA", rgba.size, "white"), rgba).convert("RGB")


@dataclass(frozen=True)
class Letterbox:
    original_size: tuple[int, int]
    canvas_size: tuple[int, int]
    box: tuple[int, int, int, int]

    @classmethod
    def for_image(cls, image: Image.Image, size: tuple[int, int]):
        scale = min(size[0] / image.width, size[1] / image.height)
        w, h = max(1, round(image.width * scale)), max(1, round(image.height * scale))
        x, y = (size[0] - w) // 2, (size[1] - h) // 2
        return cls(image.size, size, (x, y, x + w, y + h))

    def apply(self, image: Image.Image, *, mask: bool = False) -> Image.Image:
        if image.size != self.original_size:
            raise TryOnError("mask_dimensions", "A supplied mask must match its source image dimensions.")
        mode, fill = ("L", 0) if mask else ("RGB", "white")
        out = Image.new(mode, self.canvas_size, fill)
        x, y, x2, y2 = self.box
        out.paste(image.convert(mode).resize(
            (x2-x, y2-y), Image.Resampling.NEAREST if mask else Image.Resampling.LANCZOS), (x, y))
        return out

    def restore(self, image: Image.Image, *, mask: bool = False) -> Image.Image:
        if image.size != self.canvas_size:
            raise TryOnError("model_dimensions", "The model returned an unexpected image size.", 500)
        return image.crop(self.box).resize(
            self.original_size, Image.Resampling.NEAREST if mask else Image.Resampling.LANCZOS)


def prepare_garment(image: Image.Image, mode: str) -> tuple[Image.Image, Image.Image, str]:
    """Conservative plain-background removal; never describe this as learned segmentation."""
    rgba = image.convert("RGBA")
    alpha = np.asarray(rgba.getchannel("A"))
    rgb = np.asarray(rgba.convert("RGB"))
    if alpha.min() < 250:
        mask = alpha
        method = "provided_transparency"
    elif mode == "keep":
        mask = np.full(alpha.shape, 255, dtype=np.uint8)
        method = "background_kept"
    else:
        # Estimate a single studio background from the four image edges.
        border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]).astype(np.float32)
        colour = np.median(border, axis=0)
        if np.percentile(np.linalg.norm(border-colour, axis=1), 90) > 28:
            raise TryOnError("garment_background", "The garment needs a plain background or transparent PNG. Use background=keep only for an already clean product image.")
        candidate = (np.linalg.norm(rgb.astype(np.float32)-colour, axis=2) < 28).astype(np.uint8)
        _, labels = cv2.connectedComponents(candidate, connectivity=8)
        edge_labels = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
        edge_labels = edge_labels[edge_labels != 0]
        mask = (~np.isin(labels, edge_labels)).astype(np.uint8) * 255
        method = "edge_connected_plain_background"
    fraction = np.count_nonzero(mask > 127) / mask.size
    if fraction < .015 or (mode != "keep" and fraction > .98):
        raise TryOnError("garment_mask", "Could not separate the garment. Use a contrasting plain background or a transparent garment PNG.")
    clean = Image.composite(Image.fromarray(rgb), Image.new("RGB", image.size, "white"), Image.fromarray(mask))
    return clean, Image.fromarray(mask), method


def composite(original: Image.Image, generated: Image.Image, edit: Image.Image,
              protected: Image.Image, transform: Letterbox) -> tuple[Image.Image, Image.Image]:
    """Only resample generated pixels; original face/background pixels stay untouched."""
    restored = np.asarray(transform.restore(generated).convert("RGB"))
    editable = np.asarray(transform.restore(edit, mask=True)) > 127
    keep = np.asarray(transform.restore(protected, mask=True)) > 0
    editable &= ~keep
    # Feather inward, so blending never leaks into preserved pixels.
    distance = cv2.distanceTransform(editable.astype(np.uint8), cv2.DIST_L2, 3)
    radius = max(2, round(max(original.size) / 300))
    alpha = np.minimum(distance / radius, 1.0)
    alpha[~editable] = 0
    before = np.asarray(original.convert("RGB"))
    result = np.rint(before * (1-alpha[..., None]) + restored * alpha[..., None]).astype(np.uint8)
    result[~editable] = before[~editable]
    return Image.fromarray(result), Image.fromarray(np.rint(alpha * 255).astype(np.uint8))
