import argparse
import shutil
from pathlib import Path

from scripts.common_py.log import guohub_logger, guohub_json_print, guohub_success_print, guohub_error_print

DEV_TEMP = Path(__file__).resolve().parent.parent.parent / "dev_temp"


def scan_temp(path):
    items = []
    if not path.exists():
        return items
    for p in sorted(path.rglob("*")):
        rel = p.relative_to(path)
        if p.is_dir():
            count = sum(1 for _ in p.rglob("*") if _.is_file())
            items.append(("dir", rel, f"{count} 个文件"))
        else:
            size = p.stat().st_size
            items.append(("file", rel, _fmt_size(size)))
    return items


def _fmt_size(n):
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n / 1024 / 1024:.1f} MB"


def main():
    parser = argparse.ArgumentParser(description="清理 dev_temp 临时文件")
    parser.add_argument("--force", action="store_true", help="跳过确认直接删除")
    args = parser.parse_args()

    if not DEV_TEMP.exists():
        guohub_logger.info("dev_temp/ 目录不存在，无需清理")
        guohub_json_print({"status": "empty", "count": 0, "size": 0})

    items = scan_temp(DEV_TEMP)
    if not items:
        guohub_logger.info("dev_temp/ 为空，无需清理")
        guohub_json_print({"status": "empty", "count": 0, "size": 0})

    total_size = sum(
        p.stat().st_size
        for p in DEV_TEMP.rglob("*")
        if p.is_file()
    )

    dirs = [i for i in items if i[0] == "dir"]
    files = [i for i in items if i[0] == "file"]

    guohub_logger.info(f"dev_temp/ 中共有 {len(files)} 个文件、{len(dirs)} 个子目录，共 {_fmt_size(total_size)}")
    for kind, rel, info in items:
        guohub_logger.info(f"  {rel}  ({info})")

    if not args.force:
        confirm = input("确认删除以上所有内容？(y/N)：").strip().lower()
        if confirm != "y":
            guohub_logger.info("已取消")
            guohub_json_print({"status": "cancelled"})

    for p in sorted(DEV_TEMP.iterdir()):
        if p.is_dir():
            shutil.rmtree(p)
        else:
            p.unlink()

    guohub_json_print({"status": "cleaned", "count": len(files), "size": total_size})


if __name__ == "__main__":
    main()
