import json
import sys
from pathlib import Path

from scripts.common_py.log import guohub_json_print, guohub_logger

HERE = Path(__file__).resolve().parent
LOCAL_DATA_DIR = HERE / "local_data"

_PROCESS_NAMES = ["chrome", "chromium", "msedge", "edge", "brave"]


def _is_browser_main_process(proc) -> bool:
    try:
        name = (proc.name() or "").lower()
        if not any(k in name for k in _PROCESS_NAMES):
            return False
        if "helper" in name:
            return False
        return True
    except Exception:
        return False


def _query_cdp_version(port, timeout=1):
    import http.client
    try:
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
        conn.request("GET", "/json/version")
        resp = conn.getresponse()
        if resp.status == 200:
            return json.loads(resp.read())
        conn.close()
    except Exception:
        pass
    return None


def find_all_managed_browsers():
    import psutil

    if not LOCAL_DATA_DIR.exists():
        return []

    local_data_resolved = str(LOCAL_DATA_DIR.resolve()).lower()
    instances = []
    seen_ports = set()

    for proc in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            if not _is_browser_main_process(proc):
                continue

            cmdlines = proc.info.get("cmdline") or []
            cdp_port = None
            user_data_dir = None

            for arg in cmdlines:
                if arg.startswith("--remote-debugging-port="):
                    cdp_port = int(arg.split("=")[1])
                if arg.startswith("--user-data-dir="):
                    user_data_dir = arg.split("=", 1)[1]

            if not cdp_port or not user_data_dir:
                continue

            if cdp_port in seen_ports:
                continue

            resolved = str(Path(user_data_dir).resolve()).lower()
            if not resolved.startswith(local_data_resolved):
                continue

            seen_ports.add(cdp_port)
            project_name = Path(user_data_dir).name

            cdp_info = _query_cdp_version(cdp_port)
            is_alive = cdp_info is not None
            browser_ver = cdp_info.get("Browser", "") if cdp_info else ""

            entry = {
                "project": project_name,
                "cdp_port": cdp_port,
                "cdp_url": f"http://127.0.0.1:{cdp_port}",
                "pid": proc.info["pid"],
                "browser": browser_ver,
                "is_alive": is_alive,
            }

            # 检查是否有 daemon 进程
            daemon_running = False
            for dp in psutil.process_iter(["pid", "name", "cmdline"]):
                try:
                    dcmd = dp.info.get("cmdline") or []
                    if str(dp.info.get("pid")) != str(proc.info["pid"]) and "browser_daemon" in " ".join(dcmd):
                        if str(cdp_port) in dcmd and project_name in dcmd:
                            daemon_running = True
                            break
                except Exception:
                    continue
            entry["daemon_running"] = daemon_running

            instances.append(entry)

        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    return instances


def main():
    instances = find_all_managed_browsers()
    guohub_logger.info(f"找到 {len(instances)} 个由 guohub-cli 管理的浏览器实例")
    guohub_json_print({"count": len(instances), "browsers": instances})


if __name__ == "__main__":
    main()
