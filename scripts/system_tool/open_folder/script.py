import argparse
import platform
import subprocess
from pathlib import Path

from scripts.common_py.log import guohub_logger, guohub_success_print, guohub_error_print


def open_folder(path):
    path = Path(path).expanduser().resolve()
    if not path.exists():
        guohub_error_print(f"路径不存在：{path}")

    if not path.is_dir():
        path = path.parent

    system = platform.system()
    if system == "Darwin":
        subprocess.run(["open", str(path)])
    elif system == "Windows":
        subprocess.run(["explorer", str(path)])
    else:
        subprocess.run(["xdg-open", str(path)])

    guohub_logger.info(f"已打开：{path}")
    guohub_success_print()


def main():
    parser = argparse.ArgumentParser(description="在系统文件管理器中打开文件夹")
    parser.add_argument("path", help="文件夹路径（如果传入文件则打开其所在目录）")
    args = parser.parse_args()
    open_folder(args.path)


if __name__ == "__main__":
    main()
