import subprocess
import sys
from pathlib import Path

from scripts.common_py.log import (
    guohub_error_print,
    guohub_json_print,
    guohub_logger,
    guohub_text_print,
)

HERE = Path(__file__).resolve().parent
LOCAL_DATA_DIR = HERE / "local_data"

_PROCESS_NAMES = ["chrome", "chromium", "msedge", "edge", "brave"]


def _find_managed_processes(project_name: str) -> list:
    import psutil

    if not LOCAL_DATA_DIR.exists():
        return []

    target_ud_dir = str((LOCAL_DATA_DIR / project_name).resolve()).lower()
    procs = []

    for proc in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            name = (proc.info.get("name") or "").lower()
            if not any(k in name for k in _PROCESS_NAMES):
                continue
            if "helper" in name:
                continue

            cmdlines = proc.info.get("cmdline") or []
            proc_ud_dir = None
            for arg in cmdlines:
                if arg.startswith("--user-data-dir="):
                    proc_ud_dir = str(Path(arg.split("=", 1)[1]).resolve()).lower()

            if proc_ud_dir and proc_ud_dir == target_ud_dir:
                procs.append(proc)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    return procs


def _find_daemon_processes(project_name: str) -> list:
    import psutil

    daemons = []
    for proc in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            dcmd = proc.info.get("cmdline") or []
            cmd_str = " ".join(dcmd)
            if "browser_daemon" in cmd_str and project_name in dcmd:
                daemons.append(proc)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return daemons


def main():
    args = sys.argv[1:]
    project_name = "default"

    i = 0
    while i < len(args):
        if args[i] == "--project" and i + 1 < len(args):
            project_name = args[i + 1]
            i += 2
        else:
            i += 1

    # 先停 daemon
    daemons = _find_daemon_processes(project_name)
    for d in daemons:
        try:
            d.terminate()
            guohub_logger.info(f"终止守护进程 PID={d.pid}")
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass

    # 找到该项目的主浏览器进程
    procs = _find_managed_processes(project_name)
    if not procs:
        guohub_error_print(f"项目 [{project_name}] 没有运行中的浏览器实例")

    main_proc = procs[0]
    try:
        main_proc.terminate()
        main_proc.wait(timeout=5)
        guohub_logger.info(f"终止浏览器主进程 PID={main_proc.pid}")
    except psutil.TimeoutExpired:
        main_proc.kill()
        guohub_logger.info(f"强制终止浏览器主进程 PID={main_proc.pid}")
    except psutil.NoSuchProcess:
        pass

    guohub_text_print(f"项目 [{project_name}] 已安全退出")


if __name__ == "__main__":
    main()
