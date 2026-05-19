import sys
import zipfile
from pathlib import Path

from scripts.common_py.log import guohub_error_print, guohub_json_print, guohub_logger

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff", ".webp", ".svg", ".emf", ".wmf"}


def extract_images(pptx_path: str, output_dir: str | None = None) -> list[dict]:
    pptx_file = Path(pptx_path)
    if not pptx_file.exists():
        guohub_error_print(f"文件不存在: {pptx_path}")

    if not zipfile.is_zipfile(pptx_file):
        guohub_error_print(f"不是有效的 PPTX 文件: {pptx_path}")

    out = Path(output_dir) if output_dir else pptx_file.parent / f"{pptx_file.stem}_images"
    out.mkdir(parents=True, exist_ok=True)

    extracted = []
    with zipfile.ZipFile(pptx_file, "r") as zf:
        for name in zf.namelist():
            if not name.startswith("ppt/media/"):
                continue
            src = Path(name)
            if src.suffix.lower() not in IMAGE_EXTS:
                continue

            dest = out / src.name
            data = zf.read(name)
            dest.write_bytes(data)
            extracted.append({
                "source": name,
                "saved_to": str(dest),
                "size": len(data),
            })
            guohub_logger.info(f"提取: {src.name} ({len(data)} bytes)")

    return extracted


def main():
    args = sys.argv[1:]
    if not args:
        guohub_error_print("用法: extract-pptx-img <pptx文件路径> [输出目录]")

    pptx_path = args[0]
    output_dir = args[1] if len(args) > 1 else None

    images = extract_images(pptx_path, output_dir)

    guohub_json_print({
        "pptx": pptx_path,
        "output_dir": str(Path(output_dir) if output_dir else Path(pptx_path).parent / f"{Path(pptx_path).stem}_images"),
        "count": len(images),
        "images": images,
    })


if __name__ == "__main__":
    main()
