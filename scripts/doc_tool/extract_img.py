import argparse
import struct
import zipfile
from io import BytesIO
from pathlib import Path

from PIL import Image

from scripts.common_py.log import guohub_logger, guohub_json_print, guohub_error_print

MAX_SIZE = 1 * 1024 * 1024  # 1 MB


def _fmt_size(n):
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n / 1024 / 1024:.1f} MB"


def try_tinify(filepath):
    if filepath.stat().st_size <= MAX_SIZE:
        return

    name = filepath.stem + "-min"
    ext = filepath.suffix.lower()
    min_path = filepath.parent / (name + ext)

    img = Image.open(filepath)
    fmt = img.format or ("JPEG" if ext in (".jpg", ".jpeg") else "PNG")

    scale = 0.8
    while scale >= 0.2:
        w = int(img.width * scale)
        h = int(img.height * scale)
        resized = img.resize((w, h), Image.LANCZOS)
        buf = BytesIO()
        save_kwargs = {"format": fmt}
        if fmt == "JPEG":
            save_kwargs["quality"] = 95
        if fmt == "PNG" and img.mode in ("RGBA", "LA", "P"):
            save_kwargs["optimize"] = True
        resized.save(buf, **save_kwargs)
        if buf.tell() <= MAX_SIZE:
            min_path.write_bytes(buf.getvalue())
            guohub_logger.info(f"  → {min_path.name} ({w}×{h}, {_fmt_size(min_path.stat().st_size)})")
            return
        scale -= 0.2

    if fmt == "JPEG":
        for q in range(85, 20, -10):
            buf = BytesIO()
            resized.save(buf, format="JPEG", quality=q)
            if buf.tell() <= MAX_SIZE:
                min_path.write_bytes(buf.getvalue())
                guohub_logger.info(f"  → {min_path.name} (quality={q}, {_fmt_size(min_path.stat().st_size)})")
                return

    if fmt == "PNG":
        buf = BytesIO()
        if img.mode in ("RGBA", "LA"):
            img = img.convert("RGB")
        img.save(buf, format="JPEG", quality=85)
        min_path = filepath.parent / (name + ".jpg")
        if buf.tell() <= MAX_SIZE:
            min_path.write_bytes(buf.getvalue())
            guohub_logger.info(f"  → {min_path.name} (PNG→JPEG, {_fmt_size(min_path.stat().st_size)})")
            return

    resized = img
    for q in range(85, 20, -15):
        for s in [0.15, 0.1, 0.05]:
            w = max(1, int(img.width * s))
            h = max(1, int(img.height * s))
            resized = img.resize((w, h), Image.LANCZOS)
            if resized.mode in ("RGBA", "LA", "P"):
                resized = resized.convert("RGB")
            buf = BytesIO()
            resized.save(buf, format="JPEG", quality=q)
            if buf.tell() <= MAX_SIZE:
                min_path = filepath.parent / (name + ".jpg")
                min_path.write_bytes(buf.getvalue())
                guohub_logger.info(f"  → {min_path.name} ({w}×{h}, q={q}, {_fmt_size(min_path.stat().st_size)})")
                return
    guohub_logger.info(f"  ⚠ {filepath.name} 无法压缩到 1MB 以内")


def _guess_ext(data: bytes) -> str:
    if data.startswith(b"\x89PNG"):
        return ".png"
    if data.startswith(b"\xff\xd8"):
        return ".jpg"
    if data.startswith(b"GIF89a") or data.startswith(b"GIF87a"):
        return ".gif"
    if data.startswith(b"BM"):
        return ".bmp"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return ".webp"
    return ".bin"


def extract_from_docx(docx_path, output_dir):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    count = 0
    with zipfile.ZipFile(docx_path, "r") as zf:
        for name in zf.namelist():
            if name.startswith("word/media/") and not name.endswith("/"):
                data = zf.read(name)
                ext = Path(name).suffix
                if not ext:
                    ext = _guess_ext(data)
                if ext == ".bin":
                    continue
                filename = f"img{count + 1}{ext}"
                out = output_dir / filename
                i = 1
                while out.exists():
                    out = output_dir / f"img{count + 1}_{i}{ext}"
                    i += 1
                out.write_bytes(data)
                count += 1
                guohub_logger.info(f"{out.name} ({_fmt_size(len(data))})")
                try_tinify(out)
    return count


def extract_from_doc(doc_path, output_dir):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    data = Path(doc_path).read_bytes()
    count = 0

    count += _extract_jpeg_from_doc(data, output_dir)
    count += _extract_png_from_doc(data, output_dir)

    return count


def _extract_jpeg_from_doc(data, output_dir):
    candidates = []
    seen_fingerprints = set()
    pos = 0

    while True:
        idx = data.find(b"\xff\xc0", pos)
        if idx == -1:
            break

        if idx + 9 > len(data):
            pos = idx + 2
            continue
        height = struct.unpack(">H", data[idx + 5:idx + 7])[0]
        width = struct.unpack(">H", data[idx + 7:idx + 9])[0]

        if width < 100 or height < 100:
            pos = idx + 2
            continue

        sos_pos = data.find(b"\xff\xda", idx)
        if sos_pos == -1 or sos_pos > idx + 500:
            pos = idx + 2
            continue
        if sos_pos + 4 > len(data):
            pos = idx + 2
            continue
        sos_length = struct.unpack(">H", data[sos_pos + 2:sos_pos + 4])[0]
        scan_data_start = sos_pos + 2 + sos_length

        scan_end = scan_data_start
        while scan_end < len(data) - 1:
            if data[scan_end] == 0xFF and data[scan_end + 1] != 0x00 and data[scan_end + 1] != 0xFF:
                break
            scan_end += 1

        frame_start = None
        for offset in range(0, min(2000, idx)):
            start = idx - offset
            jpeg = b"\xff\xd8" + data[start:scan_end] + b"\xff\xd9"
            try:
                img = Image.open(BytesIO(jpeg))
                img.load()
                if img.size == (width, height):
                    frame_start = start
                    break
            except Exception:
                pass

        if frame_start is None:
            pos = idx + 2
            continue

        fingerprint = data[frame_start:frame_start + 64]
        if fingerprint in seen_fingerprints:
            pos = idx + 2
            continue
        seen_fingerprints.add(fingerprint)

        candidates.append((frame_start, scan_end, width * height, width, height))
        pos = scan_end

    PROXIMITY = 4096
    candidates.sort(key=lambda c: c[2], reverse=True)
    keep = []
    for fs, se, area, w, h in candidates:
        dominated = False
        for kfs, kse, _, _, _ in keep:
            if fs >= kfs - PROXIMITY and fs <= kse + PROXIMITY:
                dominated = True
                break
        if not dominated:
            keep.append((fs, se, w, h))

    count = 0
    for frame_start, scan_end, width, height in keep:
        jpeg = b"\xff\xd8" + data[frame_start:scan_end] + b"\xff\xd9"
        name = _unique_name(output_dir, "jpg", ".jpg", count + 1)
        out_path = output_dir / name
        out_path.write_bytes(jpeg)
        count += 1
        guohub_logger.info(f"{name} ({_fmt_size(len(jpeg))}, {width}×{height})")
        try_tinify(out_path)

    return count


def _extract_png_from_doc(data, output_dir):
    count = 0
    seen = set()
    pos = 0

    while True:
        idx = data.find(b"\x89PNG\r\n\x1a\n", pos)
        if idx == -1:
            break

        end_idx = data.find(b"IEND\xaeB`\x82", idx + 8)
        if end_idx == -1:
            pos = idx + 1
            continue

        chunk = data[idx:end_idx + 8]
        if len(chunk) < 1024:
            pos = end_idx + 8
            continue

        fingerprint = chunk[:64]
        if fingerprint in seen:
            pos = end_idx + 8
            continue
        seen.add(fingerprint)

        try:
            img = Image.open(BytesIO(chunk))
            img.load()
        except Exception:
            pos = end_idx + 8
            continue

        name = _unique_name(output_dir, "png", ".png", count + 1)
        out_path = output_dir / name
        out_path.write_bytes(chunk)
        count += 1
        guohub_logger.info(f"{name} ({_fmt_size(len(chunk))}, {img.size[0]}×{img.size[1]})")
        try_tinify(out_path)
        pos = end_idx + 8

    return count


def _unique_name(output_dir, base, ext, start):
    name = f"{base}{start}{ext}"
    if not (output_dir / name).exists():
        return name
    i = start + 1
    while True:
        name = f"{base}{i}{ext}"
        if not (output_dir / name).exists():
            return name
        i += 1


def main():
    parser = argparse.ArgumentParser(description="从 Word 文档中提取图片")
    parser.add_argument("file", help="Word 文档路径（.docx 或 .doc）")
    parser.add_argument("--output", default=None, help="输出目录（默认：文档所在目录）")
    args = parser.parse_args()

    path = Path(args.file).expanduser().resolve()
    if not path.exists():
        guohub_error_print(f"文件不存在：{path}")

    suffix = path.suffix.lower()
    if suffix not in (".docx", ".doc"):
        guohub_error_print(f"不支持的格式：{suffix}（仅支持 .docx 和 .doc）")

    if args.output:
        output_dir = Path(args.output).expanduser().resolve()
    else:
        output_dir = path.parent

    guohub_logger.info(f"正在从 {path.name} 提取图片 → {output_dir}/")

    if suffix == ".docx":
        count = extract_from_docx(path, output_dir)
    else:
        count = extract_from_doc(path, output_dir)

    guohub_json_print({"file": str(path), "output_dir": str(output_dir), "count": count})


if __name__ == "__main__":
    main()
