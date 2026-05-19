import json
import os
import socket
import subprocess
import sys
import time
import tomllib
from pathlib import Path

from scripts.common_py.log import (
    guohub_error_print,
    guohub_json_print,
    guohub_logger,
)

HERE = Path(__file__).resolve().parent
PROFILES_TOML = HERE / "config.toml"
BROWSER_PROFILES_DIR = HERE / "local_data"

BROWSER_PATHS = {
    "chrome": {
        "darwin": [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ],
        "win32": [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            Path.home() / r"AppData\Local\Google\Chrome\Application\chrome.exe",
        ],
    },
    "chromium": {
        "darwin": [
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ],
        "win32": [
            Path.home() / r"AppData\Local\Chromium\Application\chrome.exe",
        ],
    },
    "edge": {
        "darwin": [
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ],
        "win32": [
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        ],
    },
}

CDP_POLL_TIMEOUT = 10
CDP_POLL_INTERVAL = 0.3

_PROCESS_NAMES = ["chrome", "chromium", "msedge", "edge", "brave"]


# ─── 配置读取 ───────────────────────────────────────────

def load_profiles():
    if not PROFILES_TOML.exists():
        PROFILES_TOML.parent.mkdir(parents=True, exist_ok=True)
        PROFILES_TOML.write_text("", encoding="utf-8")
        return {}
    with open(PROFILES_TOML, "rb") as f:
        return tomllib.load(f)


def get_project_config(project_name: str, profiles: dict) -> dict:
    if project_name in profiles:
        return dict(profiles[project_name])
    # 不在 TOML 里也允许，用默认值
    return {}


def resolve_user_data_dir(project_name: str) -> Path:
    BROWSER_PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    profile_dir = BROWSER_PROFILES_DIR / project_name
    profile_dir.mkdir(parents=True, exist_ok=True)
    return profile_dir


# ─── 浏览器发现 ──────────────────────────────────────────

def find_browser(browser_name: str) -> str:
    candidates = BROWSER_PATHS.get(browser_name, {}).get(sys.platform, [])
    for p in candidates:
        if Path(p).exists():
            return str(p)
    guohub_error_print(f"找不到 {browser_name}，请手动指定路径：--browser-path <路径>")


# ─── 网络 / CDP ──────────────────────────────────────────

def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def query_cdp_version(port, timeout=1):
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


def wait_for_cdp(port, timeout=CDP_POLL_TIMEOUT, interval=CDP_POLL_INTERVAL):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        info = query_cdp_version(port, timeout=interval)
        if info:
            return info
        time.sleep(interval)
    return None


# ─── PID 反查（三层 fallback）──────────────────────────────

def find_pid_listening_on_port(port):
    if sys.platform != "win32":
        try:
            result = subprocess.run(
                ["lsof", "-i", f":{port}", "-sTCP:LISTEN", "-t", "-n", "-P"],
                capture_output=True, text=True, timeout=3,
            )
            if result.returncode == 0:
                for line in result.stdout.strip().splitlines():
                    pid_str = line.strip()
                    if pid_str.isdigit():
                        return int(pid_str)
        except Exception:
            pass

    try:
        import psutil
        for conn in psutil.net_connections(kind="tcp"):
            if conn.laddr.port == port and conn.status == "LISTEN" and conn.pid:
                return conn.pid
    except Exception:
        pass

    return _find_pid_by_cmdline_port(port)


def _find_pid_by_cmdline_port(port):
    import psutil
    target = f"--remote-debugging-port={port}"
    for proc in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            name = (proc.info.get("name") or "").lower()
            if not any(k in name for k in _PROCESS_NAMES):
                continue
            if "helper" in name:
                continue
            if target in (proc.info.get("cmdline") or []):
                return proc.info["pid"]
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return None


# ─── 实例复用（按 user_data_dir 匹配）────────────────────────

def find_existing_instance(user_data_dir: str):
    """按 user_data_dir 匹配已有实例，同 profile 复用，不同 profile 不冲突。"""
    import psutil

    target_ud_dir = str(Path(user_data_dir).resolve()).lower()
    for proc in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            name = (proc.info.get("name") or "").lower()
            if not any(k in name for k in _PROCESS_NAMES):
                continue
            if "helper" in name:
                continue
            cmdlines = proc.info.get("cmdline") or []
            port = None
            proc_ud_dir = None
            for arg in cmdlines:
                if arg.startswith("--remote-debugging-port="):
                    port = int(arg.split("=")[1])
                if arg.startswith("--user-data-dir="):
                    proc_ud_dir = str(Path(arg.split("=", 1)[1]).resolve()).lower()
            if port and proc_ud_dir == target_ud_dir:
                info = query_cdp_version(port)
                if info:
                    return port, proc.info["pid"], info.get("Browser", "")
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return None


# ─── 清理锁文件 ──────────────────────────────────────────

def clean_lock_files(user_data_dir: Path):
    for lock_name in ["SingletonLock", "SingletonCookie", "SingletonSocket"]:
        lock_path = user_data_dir / lock_name
        if lock_path.exists():
            try:
                lock_path.unlink()
                guohub_logger.info(f"清理残留锁文件: {lock_path.name}")
            except OSError:
                pass


# ─── 守护进程检查与启动 ─────────────────────────────────────

def _is_daemon_running(cdp_port: int, project_name: str) -> bool:
    import psutil
    for proc in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            dcmd = proc.info.get("cmdline") or []
            cmd_str = " ".join(dcmd)
            if "browser_daemon" in cmd_str and project_name in dcmd:
                if str(cdp_port) in dcmd:
                    return True
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return False


def _start_daemon(cdp_port: int, chrome_pid: int, project_name: str) -> dict:
    daemon_script = HERE / "browser_daemon.ts"
    if not daemon_script.exists():
        return {}
    try:
        import shutil
        tsx = shutil.which("tsx")
        if not tsx:
            root = os.environ.get("GUOHUB_ROOT", "")
            tsx_candidate = os.path.join(root, "node_modules", ".bin", "tsx") if root else ""
            if tsx_candidate and os.path.isfile(tsx_candidate):
                tsx = tsx_candidate
            else:
                tsx = "npx"
        daemon_proc = subprocess.Popen(
            [tsx, str(daemon_script), str(cdp_port), str(chrome_pid), project_name],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        daemon_output = daemon_proc.stdout.readline()
        daemon_proc.stdout.close()
        return json.loads(daemon_output) if daemon_output.strip() else {}
    except Exception as e:
        guohub_logger.info(f"守护进程启动失败: {e}")
        return {}


# ─── 输出构建 ──────────────────────────────────────────────

def build_result(project: str, port: int, pid=None, browser="",
                 credential_keys=None, description="",
                 proxy="", chrome_args=None):
    pid = pid or find_pid_listening_on_port(port)
    result = {
        "project": project,
        "browser": browser,
        "pid": pid,
        "cdp_port": port,
        "cdp_url": f"http://127.0.0.1:{port}",
        "credential_keys": credential_keys or [],
    }
    if description:
        result["description"] = description
    if proxy:
        result["proxy"] = proxy
    if chrome_args:
        result["chrome_args"] = chrome_args
    return result


# ─── 在已有实例中通过 Playwright 打开 URL ─────────────────

def _open_url_in_existing(cdp_port: int, url: str, tab_index=None, replace=False):
    import asyncio
    import http.client

    def _get_targets():
        conn = http.client.HTTPConnection("127.0.0.1", cdp_port, timeout=3)
        conn.request("GET", "/json/list")
        resp = conn.getresponse()
        targets = json.loads(resp.read())
        conn.close()
        return [t for t in targets if t.get("type") == "page"]

    async def _navigate_via_cdp(ws_url, url):
        import websockets
        async with websockets.connect(ws_url, max_size=10 * 1024 * 1024) as ws:
            await ws.send(json.dumps({"id": 1, "method": "Page.navigate", "params": {"url": url}}))
            await ws.recv()

    async def _create_and_navigate():
        import websockets
        ws_endpoint = f"ws://127.0.0.1:{cdp_port}/devtools/browser"
        conn = http.client.HTTPConnection("127.0.0.1", cdp_port, timeout=3)
        conn.request("GET", "/json/version")
        version_info = json.loads(conn.getresponse().read())
        conn.close()
        ws_url = version_info.get("webSocketDebuggerUrl")
        if not ws_url:
            guohub_error_print("无法获取 CDP WebSocket 地址")

        async with websockets.connect(ws_url, max_size=10 * 1024 * 1024) as ws:
            await ws.send(json.dumps({"id": 1, "method": "Target.createTarget", "params": {"url": url}}))
            await ws.recv()

    async def _open():
        if tab_index is not None:
            targets = _get_targets()
            if 0 <= tab_index < len(targets):
                await _navigate_via_cdp(targets[tab_index]["webSocketDebuggerUrl"], url)
            else:
                guohub_error_print(f"标签页索引 {tab_index} 超出范围，当前共 {len(targets)} 个标签页")
        else:
            await _create_and_navigate()

    asyncio.run(_open())


# ─── main ──────────────────────────────────────────────────

def main():
    args = sys.argv[1:]
    project_name = "default"
    browser_name = None
    browser_path = None
    open_url = None
    tab_index = None
    replace = False

    i = 0
    while i < len(args):
        if args[i] == "--project" and i + 1 < len(args):
            project_name = args[i + 1]
            i += 2
        elif args[i] == "--browser" and i + 1 < len(args):
            browser_name = args[i + 1]
            i += 2
        elif args[i] == "--browser-path" and i + 1 < len(args):
            browser_path = args[i + 1]
            i += 2
        elif args[i] == "--open-url" and i + 1 < len(args):
            open_url = args[i + 1]
            i += 2
        elif args[i] == "--tab-index" and i + 1 < len(args):
            tab_index = int(args[i + 1])
            i += 2
        elif args[i] == "--replace":
            replace = True
            i += 1
        else:
            i += 1

    profiles = load_profiles()
    config = get_project_config(project_name, profiles)

    # 参数优先级: CLI > TOML 配置 > 默认值
    browser_path = browser_path or config.get("browser_path")
    browser_name = browser_name or config.get("browser", "chrome")
    # 合并全局和项目凭据，去重，项目优先
    _global_keys = profiles.get("browser_global_keys", [])
    _project_keys = config.get("browser_project_keys", [])
    credential_keys = list(dict.fromkeys(_project_keys + _global_keys))
    description = config.get("description", "")
    proxy = config.get("proxy", "")
    chrome_args = config.get("chrome_args", [])

    user_data_dir = resolve_user_data_dir(project_name)
    clean_lock_files(user_data_dir)

    # 检查同项目是否已有实例在运行
    existing = find_existing_instance(user_data_dir)
    if existing:
        port, pid, browser_ver = existing
        guohub_logger.info(f"项目 [{project_name}] 已有运行实例，复用")
        result = build_result(
            project_name, port, pid=pid, browser=browser_ver,
            credential_keys=credential_keys,
            description=description, proxy=proxy, chrome_args=chrome_args,
        )
        # 检查 daemon 是否存活，不存活则重新启动
        daemon_info = {}
        if not _is_daemon_running(port, project_name):
            guohub_logger.info("守护进程未运行，重新启动")
            daemon_info = _start_daemon(port, pid, project_name)
        if daemon_info.get("api_url"):
            result["api_url"] = daemon_info["api_url"]
        if daemon_info.get("resources_url"):
            result["resources_url"] = daemon_info["resources_url"]
        if daemon_info.get("console_log_url"):
            result["console_log_url"] = daemon_info["console_log_url"]
        if daemon_info.get("download_on_url"):
            result["download_on_url"] = daemon_info["download_on_url"]
        if daemon_info.get("download_off_url"):
            result["download_off_url"] = daemon_info["download_off_url"]
        if open_url:
            guohub_logger.info(f"在已有实例中打开 {open_url} (tab_index={tab_index}, replace={replace})")
            _open_url_in_existing(port, open_url, tab_index=tab_index, replace=replace)
            result["opened_url"] = open_url
        guohub_json_print(result)
        return

    if not browser_path:
        browser_path = find_browser(browser_name)

    port = find_free_port()
    cmd = [
        browser_path,
        f"--remote-debugging-port={port}",
        "--remote-allow-origins=*",
        f"--user-data-dir={user_data_dir}",
    ]
    if proxy:
        cmd.append(f"--proxy-server={proxy}")
    cmd.extend(chrome_args)
    if open_url:
        cmd.append(open_url)

    guohub_logger.info(f"项目 [{project_name}] 启动 {browser_name}: {browser_path}")
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    guohub_logger.info("等待 CDP 端口就绪...")
    info = wait_for_cdp(port)
    if not info:
        guohub_error_print(f"浏览器启动超时，CDP 端口 {port} 未就绪")

    pid = find_pid_listening_on_port(port)

    # 启动守护进程（后台监控）
    daemon_info = _start_daemon(port, pid, project_name)

    result = build_result(
        project_name, port, pid=pid,
        browser=info.get("Browser", "") if info else "",
        credential_keys=credential_keys,
        description=description, proxy=proxy, chrome_args=chrome_args,
    )
    # 守护进程暴露的监控端点
    if daemon_info.get("api_url"):
        result["api_url"] = daemon_info["api_url"]
    if daemon_info.get("resources_url"):
        result["resources_url"] = daemon_info["resources_url"]
    if daemon_info.get("console_log_url"):
        result["console_log_url"] = daemon_info["console_log_url"]
    if daemon_info.get("download_on_url"):
        result["download_on_url"] = daemon_info["download_on_url"]
    if daemon_info.get("download_off_url"):
        result["download_off_url"] = daemon_info["download_off_url"]

    # 给 LLM 的操作指引
    result["prompt"] = (
        "以下接口均为 GET 访问。"
        "当用户需要分析业务接口、查看 API 请求和响应时，访问 api_url；"
        "当用户需要查看页面加载了哪些图片、CSS、JS、字体、视频等静态资源时，访问 resources_url（仅元数据，因体积问题不保存文件内容，如需下载请访问 download_on_url 开启）；"
        "当用户需要查看 Console 日志或页面报错时，访问 console_log_url；"
        "当用户需要批量下载图片、视频等资源时，访问 download_on_url 开启下载，之后访问 download_off_url 关闭下载。"
        "默认只有 API 和 Console 日志，资源不自动下载。"
    )

    guohub_json_print(result)


if __name__ == "__main__":
    main()
