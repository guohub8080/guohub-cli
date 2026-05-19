import argparse
from io import BytesIO
from pathlib import Path

from PIL import Image

from scripts.common_py.log import guohub_logger, guohub_json_print, guohub_error_print

ONE_MB = 1024 * 1024


def _fmt_size(n):
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n / 1024 / 1024:.1f} MB"


def compress(
    input_path,
    output_path=None,
    max_size=None,
    max_width=None,
    max_height=None,
    quality=85,
    format=None,
    suffix_tag=None,
):
    input_path = Path(input_path)
    if not input_path.exists():
        guohub_error_print(f"文件不存在：{input_path}")

    img = Image.open(input_path)
    fmt = format or img.format or ("JPEG" if input_path.suffix.lower() in (".jpg", ".jpeg") else "PNG")
    orig_size = input_path.stat().st_size
    orig_w, orig_h = img.size
    changed = False

    if max_width or max_height:
        w, h = orig_w, orig_h
        if max_width and w > max_width:
            ratio = max_width / w
            w = max_width
            h = int(h * ratio)
        if max_height and h > max_height:
            ratio = max_height / h
            h = max_height
            w = int(w * ratio)
        if (w, h) != (orig_w, orig_h):
            img = img.resize((w, h), Image.LANCZOS)
            changed = True

    if max_size:
        buf = BytesIO()
        save_kwargs = {"format": fmt}
        if fmt == "JPEG":
            save_kwargs["quality"] = quality
        if fmt == "PNG" and img.mode in ("RGBA", "LA", "P"):
            save_kwargs["optimize"] = True
        if img.mode == "RGBA" and fmt == "JPEG":
            img = img.convert("RGB")
            changed = True
        img.save(buf, **save_kwargs)

        if buf.tell() > max_size:
            changed = True
            scale = 0.9
            while scale >= 0.1 and buf.tell() > max_size:
                w = max(1, int(orig_w * scale))
                h = max(1, int(orig_h * scale))
                resized = img.resize((w, h), Image.LANCZOS)
                if resized.mode == "RGBA" and fmt == "JPEG":
                    resized = resized.convert("RGB")
                buf = BytesIO()
                save_kwargs = {"format": fmt, "quality": quality}
                resized.save(buf, **save_kwargs)
                if buf.tell() <= max_size:
                    img = resized
                    break
                scale -= 0.1

            if buf.tell() > max_size and fmt == "JPEG":
                for q in range(quality - 10, 20, -10):
                    buf = BytesIO()
                    resized.save(buf, format="JPEG", quality=q)
                    if buf.tell() <= max_size:
                        break

            if buf.tell() > max_size and fmt == "PNG":
                rgb = img.convert("RGB") if img.mode in ("RGBA", "LA", "P") else img
                for q in range(85, 20, -10):
                    buf = BytesIO()
                    rgb.save(buf, format="JPEG", quality=q)
                    if buf.tell() <= max_size:
                        fmt = "JPEG"
                        break

            final_data = buf.getvalue()
        else:
            final_data = buf.getvalue()
            if len(final_data) < orig_size:
                changed = True
            elif not changed:
                final_data = input_path.read_bytes()

    else:
        if not changed:
            guohub_logger.info(f"{input_path.name}: 无需压缩（{_fmt_size(orig_size)}，{orig_w}×{orig_h}）")
            return {"input": str(input_path), "output": str(input_path), "status": "skipped"}
        buf = BytesIO()
        save_kwargs = {"format": fmt}
        if fmt == "JPEG":
            save_kwargs["quality"] = quality
        if img.mode == "RGBA" and fmt == "JPEG":
            img = img.convert("RGB")
        img.save(buf, **save_kwargs)
        final_data = buf.getvalue()

    # 体积没变小且用户没强制指定输出 → 跳过
    if len(final_data) >= orig_size and not output_path and suffix_tag is None:
        guohub_logger.info(f"{input_path.name}: 压缩后体积未变小（{_fmt_size(orig_size)}），跳过")
        return {"input": str(input_path), "output": str(input_path), "status": "skipped", "reason": "体积未变小"}

    if output_path:
        out = Path(output_path)
    else:
        ext = ".jpg" if fmt == "JPEG" else input_path.suffix
        if suffix_tag is not None:
            tag = suffix_tag if suffix_tag else "tiny"
            out = input_path.parent / (input_path.stem + "-" + tag + ext)
        else:
            size_kb = len(final_data) / 1024
            if size_kb >= 1024:
                size_tag = f"{size_kb / 1024:.1f}M"
            else:
                size_tag = f"{size_kb:.0f}K"
            out = input_path.parent / (input_path.stem + "-" + size_tag + ext)

    if fmt == "JPEG" and out.suffix.lower() == ".png":
        out = out.with_suffix(".jpg")

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(final_data)
    new_w, new_h = img.size
    guohub_logger.info(f"{input_path.name} → {out.name}（{_fmt_size(orig_size)} → {_fmt_size(len(final_data))}，{orig_w}×{orig_h} → {new_w}×{new_h}）")
    return {"input": str(input_path), "output": str(out), "orig_size": orig_size, "new_size": len(final_data)}


def main():
    parser = argparse.ArgumentParser(description="压缩/缩小图片")
    parser.add_argument("input", nargs="+", help="输入图片路径（支持多个）")
    parser.add_argument("--output", help="输出路径（多文件时无效）")
    parser.add_argument("--max-size", type=int, default=None, help="最大体积，单位 KB")
    parser.add_argument("--max-width", type=int, default=None, help="最大宽度，单位 px")
    parser.add_argument("--max-height", type=int, default=None, help="最大高度，单位 px")
    parser.add_argument("--quality", type=int, default=85, help="JPEG 质量（默认 85）")
    parser.add_argument("--format", choices=["JPEG", "PNG", "WEBP"], default=None, help="输出格式")
    parser.add_argument("--suffix", default=None, help="输出文件名后缀（默认自动用体积数，如 672K / 1.2M）")
    args = parser.parse_args()

    max_size = args.max_size * 1024 if args.max_size else None

    results = []
    for path in args.input:
        p = Path(path).expanduser().resolve()
        if p.is_dir():
            for img_file in sorted(p.iterdir()):
                if img_file.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"):
                    r = compress(img_file, max_size=max_size, max_width=args.max_width, max_height=args.max_height, quality=args.quality, format=args.format, suffix_tag=args.suffix)
                    results.append(r)
        else:
            output = args.output if len(args.input) == 1 else None
            r = compress(p, output_path=output, max_size=max_size, max_width=args.max_width, max_height=args.max_height, quality=args.quality, format=args.format, suffix_tag=args.suffix)
            results.append(r)

    guohub_json_print({"count": len(results), "results": results})


if __name__ == "__main__":
    main()
