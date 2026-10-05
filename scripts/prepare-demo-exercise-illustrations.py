"""One-off asset prep: WebP export + PNF arrow correction. Not imported by the app."""
from __future__ import annotations

import math
from pathlib import Path

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


def is_teal_overlay(r: int, g: int, b: int) -> bool:
    # Overlay arrows/balls are brighter than the subject's shirt fill.
    return g > 145 and b > 95 and r < 85 and (g - r) > 55 and (g - b) < 75


def scrub_teal_arrow(img: Image.Image, box: tuple[int, int, int, int]) -> None:
    pixels = img.load()
    x0, y0, x1, y1 = box
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = pixels[x, y][:3]
            if is_teal_overlay(r, g, b):
                pixels[x, y] = (255, 255, 255, 255)


def sample_bg(img: Image.Image, x: int, y: int) -> tuple[int, int, int]:
    r, g, b = img.getpixel((x, y))[:3]
    return (r, g, b)


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
    points = [bezier_point(i / 48, start, control, end) for i in range(49)]
    draw.line(points, fill=color, width=width, joint="curve")

    angle = math.atan2(end[1] - points[-2][1], end[0] - points[-2][0])
    head_len = width * 2.2
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
    out = img.convert("RGBA")
    # Remove only the original overlay arrow on the end-position figure (avoid the teal shirt).
    scrub_teal_arrow(out, (500, 170, 760, 520))
    draw = ImageDraw.Draw(out)
    w, h = out.size
    # Start at right hand on opposite (left) hip in the left pose; end at raised right hand.
    start = (0.352 * w, 0.552 * h)
    control = (0.505 * w, 0.42 * h)
    end = (0.665 * w, 0.272 * h)
    draw_curved_arrow(draw, start, control, end, color=TEAL, width=10)
    return out.convert("RGB")


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
