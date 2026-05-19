import argparse
import ctypes
import ctypes.util
import os
import platform
from datetime import datetime
from pathlib import Path

from scripts.common_py.log import guohub_logger, guohub_json_print, guohub_error_print


TIMESTAMPS = ("atime", "mtime", "birthtime")


def _parse_time(val):
    if val == "now":
        return datetime.now().timestamp()
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(val, fmt).timestamp()
        except ValueError:
            continue
    raise ValueError(f"无法解析时间：{val}（支持格式：YYYY-MM-DD [HH:MM[:SS]] 或 now）")


def _read_times(path):
    st = os.stat(path)
    result = {"mtime": st.st_mtime, "atime": st.st_atime}
    if platform.system() == "Darwin":
        result["birthtime"] = st.st_birthtime
    elif platform.system() == "Windows":
        result["birthtime"] = st.st_ctime
    return result


def _fmt_ts(ts):
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")


def _set_birthtime_macos(path, ts):
    libc = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)

    ATTR_CMN_CRTIME = 0x00000200
    FSOPT_NOFOLLOW = 0x00000001

    class AttrList(ctypes.Structure):
        _fields_ = [
            ("bitmapcount", ctypes.c_uint16),
            ("reserved", ctypes.c_uint16),
            ("commonattr", ctypes.c_uint32),
            ("volattr", ctypes.c_uint32),
            ("dirattr", ctypes.c_uint32),
            ("fileattr", ctypes.c_uint32),
            ("forkattr", ctypes.c_uint32),
        ]

    class Timespec(ctypes.Structure):
        _fields_ = [
            ("tv_sec", ctypes.c_long),
            ("tv_nsec", ctypes.c_long),
        ]

    attrlist = AttrList()
    attrlist.bitmapcount = 5
    attrlist.commonattr = ATTR_CMN_CRTIME

    tv = Timespec()
    tv.tv_sec = int(ts)
    tv.tv_nsec = int((ts - int(ts)) * 1_000_000_000)

    ret = libc.setattrlist(
        path.encode("utf-8"),
        ctypes.byref(attrlist),
        ctypes.byref(tv),
        ctypes.sizeof(tv),
        FSOPT_NOFOLLOW,
    )
    if ret != 0:
        errno = ctypes.get_errno()
        raise OSError(errno, os.strerror(errno))


def _set_birthtime_windows(path, ts):
    import msvcrt

    kernel32 = ctypes.windll.kernel32

    class FILETIME(ctypes.Structure):
        _fields_ = [("dwLowDateTime", ctypes.c_uint32), ("dwHighDateTime", ctypes.c_uint32)]

    epoch_diff = 116444736000000000
    ft_val = int(ts * 10_000_000) + epoch_diff
    ft = FILETIME()
    ft.dwLowDateTime = ft_val & 0xFFFFFFFF
    ft.dwHighDateTime = ft_val >> 32

    handle = msvcrt.get_osfhandle(os.open(path, os.O_RDWR))
    try:
        if not kernel32.SetFileTime(handle, ctypes.byref(ft), None, None):
            raise OSError(ctypes.get_last_error(), "SetFileTime failed")
    finally:
        os.close(handle)


def modify_time(path, atime=None, mtime=None, birthtime=None):
    path = Path(path).expanduser().resolve()
    if not path.exists():
        guohub_error_print(f"文件不存在：{path}")

    old = _read_times(path)

    if birthtime is not None:
        system = platform.system()
        if system == "Darwin":
            try:
                _set_birthtime_macos(str(path), birthtime)
            except OSError as e:
                guohub_error_print(f"修改创建时间失败：{e}")
        elif system == "Windows":
            try:
                _set_birthtime_windows(str(path), birthtime)
            except OSError as e:
                guohub_error_print(f"修改创建时间失败：{e}")
        else:
            guohub_error_print("Linux 不支持修改创建时间")

    if atime is not None or mtime is not None:
        os.utime(str(path), (atime or old["atime"], mtime or old["mtime"]))

    new = _read_times(path)
    changes = {}
    for key in ("birthtime", "mtime", "atime"):
        if abs(old.get(key, 0) - new.get(key, 0)) > 0.001:
            changes[key] = {"from": _fmt_ts(old[key]), "to": _fmt_ts(new[key])}

    if changes:
        guohub_logger.info(f"{path.name}: {list(changes.keys())} 已变更")
    else:
        guohub_logger.info(f"{path.name}: 无变化")

    return changes


def main():
    parser = argparse.ArgumentParser(description="修改文件时间元数据")
    parser.add_argument("input", nargs="+", help="文件路径（支持多个）")
    parser.add_argument("--birthtime", "-b", help="创建时间（YYYY-MM-DD [HH:MM[:SS]] 或 now）")
    parser.add_argument("--mtime", "-m", help="修改时间")
    parser.add_argument("--atime", "-a", help="访问时间")
    parser.add_argument("--set-all", help="同时设置所有时间为同一值")
    parser.add_argument("--show", "-s", action="store_true", help="只显示当前时间，不修改")
    args = parser.parse_args()

    if args.show:
        result = {}
        for path in args.input:
            p = Path(path).expanduser().resolve()
            if not p.exists():
                guohub_error_print(f"文件不存在：{p}")
            times = _read_times(p)
            result[p.name] = {k: _fmt_ts(v) for k, v in times.items()}
        guohub_json_print(result)
        return

    if args.set_all:
        val = _parse_time(args.set_all)
        atime = mtime = birthtime = val
    else:
        atime = _parse_time(args.atime) if args.atime else None
        mtime = _parse_time(args.mtime) if args.mtime else None
        birthtime = _parse_time(args.birthtime) if args.birthtime else None

    if not atime and not mtime and not birthtime:
        guohub_error_print("未指定要修改的时间，用 --birthtime / --mtime / --atime / --set-all")

    result = {}
    for path in args.input:
        p = Path(path).expanduser().resolve()
        changes = modify_time(p, atime=atime, mtime=mtime, birthtime=birthtime)
        result[p.name] = changes if changes else "无变化"

    guohub_json_print(result)


if __name__ == "__main__":
    main()
