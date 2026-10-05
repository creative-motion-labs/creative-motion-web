"""One-off asset prep: resize approved PNGs to WebP for /demo welcome guides."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

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
    "Seated_PNF_D1_Flexion_with_Light_Trail_1_-f77d1b7f-97f8-45a3-8d0a-23b603ecb22a.png"
)


def save_webp(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rgb = img.convert("RGB")
    rgb.save(path, format="WEBP", quality=84, method=6)


def main() -> None:
    reach = Image.open(REACH_SRC)
    save_webp(reach, OUT / "reach-to-right-seated-guide.webp")

    pnf = Image.open(PNF_SRC)
    save_webp(pnf, OUT / "pnf-diagonal-1-demonstration-guide.webp")

    print("ok reach", reach.size)
    print("ok pnf", pnf.size)


if __name__ == "__main__":
    main()
