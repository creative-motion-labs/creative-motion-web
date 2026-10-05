"""One-off asset prep: WebP export + PNF arrow correction. Not imported by the app."""
from __future__ import annotations

import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = Path(
    r"C:\Users\aisha\.cursor\projects\c-Users-aisha-OneDrive-creative-motion-web\assets"
)
OUT = ROOT / "public" / "images" / "rasq-demo"

REACH_SRC = ASSETS / (
    "c__Users_aisha_AppData_Roaming_Cursor_User_workspaceStorage_778b38f6b44bfd525089b968ff9763db_images_"
    "Seated_Right_Arm_Side_Reach-5c8640e5-8646-4aac-a73c-8d636cd9776e.png"
)
PNF_SRC = ASSETS / (
    "c__Users_aisha_AppData_Roaming_Cursor_User_workspaceStorage_778b38f6b44bfd525089b968ff9763db_images_"
    "Right_arm_diagonal_reach_exercise-b9b6f71f-fa96-43a6-aea0-bc9f1c5a04b5.png"
)

TEAL = (29, 158, 117)

PNF_ARROW_START = (388.0, 432.0)
PNF_ARROW_END = (684.0, 132.0)
PNF_ARROW_CONTROL = (528.0, 268.0)


def is_shirt_pixel(r: int, g: int, b: int) -> bool:
    return 28 <= r <= 52 and 98 <= g <= 128 and 112 <= b <= 148


def is_bright_teal_graphic(r: int, g: int, b: int) -> bool:
    total = r + g + b
    return (
        total >= 365
        and g >= 150
        and b >= 130
        and r <= 45
        and (g - r) >= 100
    )


def is_loose_teal_graphic(r: int, g: int, b: int) -> bool:
    if is_shirt_pixel(r, g, b):
        return False
    if r > 160 and g > 120:
        return False
    if r + g + b >= 500:
        return False
    if b < 95 and g < 100:
        return False
    return r <= 65 and g >= 108 and b >= 98


def is_cyan_ghost_graphic(r: int, g: int, b: int) -> bool:
    """Faint dashed / secondary arrow strokes from the source composite."""
    if is_shirt_pixel(r, g, b):
        return False
    if r + g + b >= 520:
        return False
    return 85 <= r <= 135 and g >= 145 and b >= 125 and g >= b


def is_core_shirt_region(x: int, y: int) -> bool:
    return (300 <= x <= 430 and 200 <= y <= 380) or (560 <= x <= 680 and 200 <= y <= 380)


def is_overlay_pixel(x: int, y: int, r: int, g: int, b: int) -> bool:
    if is_core_shirt_region(x, y):
        return is_bright_teal_graphic(r, g, b)
    return (
        is_bright_teal_graphic(r, g, b)
        or is_loose_teal_graphic(r, g, b)
        or is_cyan_ghost_graphic(r, g, b)
    )


def build_overlay_mask(orig: Image.Image) -> np.ndarray:
    width, height = orig.size
    orig_px = orig.load()
    mask = np.zeros((height, width), dtype=np.uint8)
    for y in range(height):
        for x in range(width):
            if is_overlay_pixel(x, y, *orig_px[x, y][:3]):
                mask[y, x] = 255
    # Close small gaps in dashed arrow strokes before inpainting.
    kernel = np.ones((3, 3), np.uint8)
    return cv2.dilate(mask, kernel, iterations=2)


def remove_graphic_overlays(orig: Image.Image) -> Image.Image:
    mask = build_overlay_mask(orig)
    bgr = cv2.cvtColor(np.array(orig), cv2.COLOR_RGB2BGR)
    cleaned = cv2.inpaint(bgr, mask, inpaintRadius=4, flags=cv2.INPAINT_TELEA)
    rgb = cv2.cvtColor(cleaned, cv2.COLOR_BGR2RGB)
    out = Image.fromarray(rgb)
    orig_px = orig.load()
    out_px = out.load()
    width, height = orig.size
    for y in range(height):
        for x in range(width):
            if mask[y, x] == 0:
                continue
            source = orig_px[x, y][:3]
            if is_shirt_pixel(*source):
                out_px[x, y] = source

    residual = np.zeros((height, width), dtype=np.uint8)
    for y in range(height):
        for x in range(width):
            r, g, b = out_px[x, y][:3]
            if is_bright_teal_graphic(r, g, b) or is_cyan_ghost_graphic(r, g, b):
                residual[y, x] = 255
    if np.any(residual):
        bgr = cv2.cvtColor(np.array(out), cv2.COLOR_RGB2BGR)
        cleaned = cv2.inpaint(bgr, cv2.dilate(residual, np.ones((3, 3), np.uint8), 1), 3, cv2.INPAINT_TELEA)
        out = Image.fromarray(cv2.cvtColor(cleaned, cv2.COLOR_BGR2RGB))
    return out


def bezier_point(t: float, p0, p1, p2) -> tuple[float, float]:
    u = 1 - t
    x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0]
    y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
    return x, y


def draw_curved_arrow(
    draw: ImageDraw.ImageDraw,
    start: tuple[float, float],
    control: tuple[float, float],
    end: tuple[float, float],
    *,
    color: tuple[int, int, int],
    width: int,
) -> None:
    points = [bezier_point(i / 56, start, control, end) for i in range(57)]
    draw.line(points, fill=color, width=width, joint="curve")

    angle = math.atan2(end[1] - points[-2][1], end[0] - points[-2][0])
    head_len = width * 2.4
    left = (
        end[0] - head_len * math.cos(angle - math.pi / 7),
        end[1] - head_len * math.sin(angle - math.pi / 7),
    )
    right = (
        end[0] - head_len * math.cos(angle + math.pi / 7),
        end[1] - head_len * math.sin(angle + math.pi / 7),
    )
    draw.polygon([end, left, right], fill=color)


def fix_pnf_arrow(img: Image.Image) -> Image.Image:
    orig = img.convert("RGB")
    out = remove_graphic_overlays(orig)
    draw = ImageDraw.Draw(out)
    draw_curved_arrow(
        draw,
        PNF_ARROW_START,
        PNF_ARROW_CONTROL,
        PNF_ARROW_END,
        color=TEAL,
        width=8,
    )
    return out


def save_webp(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="WEBP", quality=84, method=6)


def main() -> None:
    reach = Image.open(REACH_SRC).convert("RGB")
    save_webp(reach, OUT / "reach-to-right-seated-guide.webp")

    pnf = fix_pnf_arrow(Image.open(PNF_SRC))
    save_webp(pnf, OUT / "pnf-diagonal-1-demonstration-guide.webp")

    print("ok reach", reach.size)
    print("ok pnf", pnf.size)


if __name__ == "__main__":
    main()
