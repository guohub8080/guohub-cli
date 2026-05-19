import argparse
import time
import zipfile
from pathlib import Path

from scripts.common_py.log import guohub_logger, guohub_json_print, guohub_error_print

DEFAULT_EXCLUDES = [".DS_Store", "__MACOSX", "Thumbs.db", "desktop.ini"]


def _should_include(path, excludes):
    name = path.name
    for pattern in excludes:
        if name == pattern or pattern in name:
            return False
    if name.startswith("._"):
        return False
    return True


def _collect_files(inputs, excludes):
    files = []
    for input_path in inputs:
        p = Path(input_path).expanduser().resolve()
        if not p.exists():
            guohub_logger.info(f"跳过（不存在）：{p}")
            continue
        if p.is_file():
            if _should_include(p, excludes):
                files.append((p, p.name))
        else:
            for file in sorted(p.rglob("*")):
                if file.is_file() and _should_include(file, excludes):
                    arcname = file.relative_to(p.parent)
                    files.append((file, arcname))
    return files


def _fmt_size(n):
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n / 1024 / 1024:.1f} MB"


def make_zip(inputs, output=None, excludes=None):
    excludes = DEFAULT_EXCLUDES + (excludes or [])

    if output:
        out = Path(output)
    else:
        out = Path(inputs[0])
        if out.is_file():
            out = out.with_suffix(".zip")
        else:
            out = out.with_name(out.name + ".zip")

    if out.exists():
        out.unlink()

    files = _collect_files(inputs, excludes)
    if not files:
        guohub_error_print("没有可打包的文件")

    total_count = len(files)
    total_size = sum(f.stat().st_size for f, _ in files)

    guohub_logger.info(f"开始打包 {total_count} 个文件（{_fmt_size(total_size)}）")

    count = 0
    done_size = 0
    last_report = time.monotonic()

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
        for path, arcname in files:
            zf.write(path, arcname)

            count += 1
            done_size += path.stat().st_size

            now = time.monotonic()
            if now - last_report >= 5:
                pct = done_size / total_size * 100 if total_size else 0
                guohub_logger.info(f"{pct:.1f}%（{count}/{total_count}）")
                last_report = now

    size = out.stat().st_size
    guohub_logger.info(f"完成 → {out.name}（{total_count} 个文件，{_fmt_size(size)}）")
    guohub_json_print({"file": str(out), "count": total_count, "size": size})


def main():
    parser = argparse.ArgumentParser(description="创建 zip 压缩包")
    parser.add_argument("input", nargs="+", help="要压缩的文件或文件夹（支持多个）")
    parser.add_argument("-o", "--output", help="输出 zip 路径")
    parser.add_argument("-e", "--exclude", nargs="*", default=[], help="额外排除的文件名（支持多个）")
    args = parser.parse_args()

    make_zip(args.input, output=args.output, excludes=args.exclude)


if __name__ == "__main__":
    main()
