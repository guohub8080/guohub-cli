import sys
import tempfile
from pathlib import Path

from PIL import Image
from pypdf import PdfReader, PdfWriter

from scripts.common_py.log import guohub_error_print, guohub_json_print, guohub_logger

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".webp"}


def _img_to_pdf_bytes(img_path: Path) -> bytes:
    img = Image.open(img_path)
    if img.mode == "RGBA":
        # 透明背景转白色背景
        background = Image.new("RGB", img.size, (255, 255, 255))
        background.paste(img, mask=img.split()[3])
        img = background
    elif img.mode == "P":
        img = img.convert("RGB")
    import io
    buf = io.BytesIO()
    img.save(buf, "PDF", resolution=100.0)
    return buf.getvalue()


def merge_to_pdf(input_path: str, output_path: str | None = None) -> dict:
    src = Path(input_path)
    if not src.exists():
        guohub_error_print(f"路径不存在: {input_path}")

    writer = PdfWriter()
    page_count = 0

    def add_file(f: Path):
        nonlocal page_count
        if f.suffix.lower() in IMAGE_EXTS:
            pdf_bytes = _img_to_pdf_bytes(f)
            reader = PdfReader(io.BytesIO(pdf_bytes))
            for page in reader.pages:
                writer.add_page(page)
            page_count += len(reader.pages)
            guohub_logger.info(f"图片转 PDF: {f.name}")
        elif f.suffix.lower() == ".pdf":
            reader = PdfReader(str(f))
            for page in reader.pages:
                writer.add_page(page)
            page_count += len(reader.pages)
            guohub_logger.info(f"合并 PDF: {f.name} ({len(reader.pages)} 页)")
        else:
            guohub_logger.info(f"跳过: {f.name}")

    import io

    if src.is_dir():
        files = sorted([f for f in src.iterdir() if f.is_file()])
        if not files:
            guohub_error_print(f"文件夹为空: {input_path}")
        for f in files:
            add_file(f)
    else:
        add_file(src)

    if page_count == 0:
        guohub_error_print("无有效内容可合并")

    # 确定输出路径
    if output_path:
        dest = Path(output_path)
    else:
        if src.is_dir():
            dest = src.parent / f"{src.name}.pdf"
        else:
            dest = src.parent / f"{src.stem}.pdf"

    dest.parent.mkdir(parents=True, exist_ok=True)

    with open(dest, "wb") as f:
        writer.write(f)

    guohub_logger.info(f"生成 PDF: {dest.name} ({page_count} 页)")

    return {
        "input": str(src),
        "output": str(dest),
        "pages": page_count,
    }


def main():
    args = sys.argv[1:]
    if not args:
        guohub_error_print("用法: img-to-pdf <图片/文件夹/PDF路径> [输出PDF路径]")

    input_path = args[0]
    output_path = args[1] if len(args) > 1 else None

    result = merge_to_pdf(input_path, output_path)
    guohub_json_print(result)


if __name__ == "__main__":
    main()
