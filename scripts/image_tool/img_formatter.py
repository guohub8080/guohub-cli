import argparse
from pathlib import Path

from PIL import Image

from scripts.common_py.log import guohub_logger, guohub_json_print, guohub_error_print

SUFFIX_MAP = {
    "JPEG": (".jpg", ".jpeg"),
    "PNG": (".png",),
    "WEBP": (".webp",),
    "BMP": (".bmp",),
    "TIFF": (".tiff", ".tif"),
    "ICO": (".ico",),
    "GIF": (".gif",),
}


def convert(input_path, output_path=None, fmt=None, quality=85):
    input_path = Path(input_path)
    if not input_path.exists():
        guohub_error_print(f"文件不存在：{input_path}")

    img = Image.open(input_path)
    src_fmt = img.format or Path(input_path).suffix.lstrip(".").upper()

    if not fmt:
        if output_path:
            ext = Path(output_path).suffix.lower()
            for f, suffixes in SUFFIX_MAP.items():
                if ext in suffixes:
                    fmt = f
                    break
        if not fmt:
            guohub_error_print("无法确定目标格式，请用 --format 指定")

    if fmt == "JPEG" and img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGB")

    if output_path:
        out = Path(output_path)
    else:
        ext = SUFFIX_MAP[fmt][0]
        out = input_path.with_suffix(ext)
        if out == input_path:
            out = input_path.with_name(input_path.stem + "-converted" + ext)

    out.parent.mkdir(parents=True, exist_ok=True)

    save_kwargs = {}
    if fmt == "JPEG":
        save_kwargs["quality"] = quality
    if fmt == "PNG" and img.mode in ("RGBA", "LA", "P"):
        save_kwargs["optimize"] = True

    img.save(out, format=fmt, **save_kwargs)
    guohub_logger.info(f"{input_path.name} → {out.name}（{src_fmt} → {fmt}）")
    return {"input": str(input_path), "output": str(out), "from": src_fmt, "to": fmt}


def main():
    parser = argparse.ArgumentParser(description="图片格式转换")
    parser.add_argument("input", nargs="+", help="输入图片路径（支持多个）")
    parser.add_argument("--output", help="输出路径（多文件时无效）")
    parser.add_argument("--format", choices=list(SUFFIX_MAP.keys()), default=None, help="目标格式")
    parser.add_argument("--quality", type=int, default=85, help="JPEG/WEBP 质量（默认 85）")
    args = parser.parse_args()

    results = []
    for path in args.input:
        p = Path(path).expanduser().resolve()
        if p.is_dir():
            for img_file in sorted(p.iterdir()):
                if img_file.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".gif"):
                    r = convert(img_file, fmt=args.format, quality=args.quality)
                    results.append(r)
        else:
            output = args.output if len(args.input) == 1 else None
            r = convert(p, output_path=output, fmt=args.format, quality=args.quality)
            results.append(r)

    guohub_json_print({"count": len(results), "results": results})


if __name__ == "__main__":
    main()
