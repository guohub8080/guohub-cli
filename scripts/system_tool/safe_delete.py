import argparse
import ctypes
import os
import platform
import sys
import time
from pathlib import Path

from scripts.common_py.log import guohub_error_print, guohub_success_print


def _count_items(paths: list[str]) -> int:
    """统计路径下的文件和文件夹总数"""
    total = 0
    for p in paths:
        path = Path(p)
        if not path.exists():
            continue
        if path.is_file():
            total += 1
        else:
            total += sum(1 for _ in path.rglob("*")) + 1
    return total


def _trash_windows(paths: list[str], silent: bool = False):
    """Windows: 使用 SHFileOperationW 移动到回收站"""
    from ctypes import wintypes

    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [
            ("hwnd", wintypes.HWND),
            ("wFunc", wintypes.UINT),
            ("pFrom", wintypes.LPCWSTR),
            ("pTo", wintypes.LPCWSTR),
            ("fFlags", wintypes.WORD),
            ("fAnyOperationsAborted", wintypes.BOOL),
            ("hNameMappings", wintypes.LPVOID),
            ("lpszProgressTitle", wintypes.LPCWSTR),
        ]

    FO_DELETE = 3
    FOF_ALLOWUNDO = 0x40
    FOF_NOCONFIRMATION = 0x10
    FOF_SILENT = 0x04

    shell32 = ctypes.windll.shell32
    SHFileOperationW = shell32.SHFileOperationW
    SHFileOperationW.argtypes = [ctypes.POINTER(SHFILEOPSTRUCTW)]
    SHFileOperationW.restype = wintypes.INT

    # pFrom 需要双 null 结尾，多文件之间用单个 null 分隔
    pfrom = "\0".join(str(Path(p).resolve()) for p in paths) + "\0\0"

    op = SHFILEOPSTRUCTW()
    op.wFunc = FO_DELETE
    op.pFrom = pfrom
    flags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION
    if silent:
        flags |= FOF_SILENT
    op.fFlags = flags

    result = SHFileOperationW(ctypes.byref(op))
    if result != 0:
        raise OSError(f"SHFileOperationW failed with code {result}")


def _trash_macos(paths: list[str]):
    """macOS: 使用 osascript 移动到废纸篓"""
    import subprocess

    for p in paths:
        abs_path = str(Path(p).resolve())
        script = f'tell application "Finder" to delete POSIX file "{abs_path}"'
        subprocess.run(["osascript", "-e", script], check=True)


def safe_delete(paths: list[str], silent: bool = False) -> tuple[int, list[str]]:
    """安全删除（移动到回收站/废纸篓），返回 (成功数, 失败列表)"""
    system = platform.system()

    # 过滤不存在的路径
    existing = [p for p in paths if Path(p).exists()]
    missing = [p for p in paths if not Path(p).exists()]

    if missing:
        for p in missing:
            print(f"跳过（不存在）: {p}")

    if not existing:
        return 0, []

    if system == "Windows":
        _trash_windows(existing, silent=silent)
    elif system == "Darwin":
        _trash_macos(existing)
    else:
        raise RuntimeError(f"不支持的操作系统: {system}")

    return len(existing), missing


def main(args):
    parser = argparse.ArgumentParser(description="安全删除文件/文件夹（移动到回收站/废纸篓）")
    parser.add_argument("paths", nargs="+", help="要删除的文件或文件夹路径")
    parser.add_argument("--silent", action="store_true", help="静默模式，不显示 Windows 进度对话框")
    parsed = parser.parse_args(args)

    # 统计文件数
    total = _count_items(parsed.paths)
    if total > 0:
        print(f"共 {total} 个文件/文件夹，正在移动到回收站...")

    try:
        success, missing = safe_delete(parsed.paths, silent=parsed.silent)
        if missing and not success:
            guohub_error_print("所有路径均不存在")
        else:
            guohub_success_print()
    except Exception as e:
        guohub_error_print(str(e))


if __name__ == "__main__":
    main(sys.argv[1:])
