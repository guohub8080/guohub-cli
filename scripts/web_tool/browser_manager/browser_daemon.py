import asyncio
import json
import os
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

try:
    import websockets
except ImportError:
    print(json.dumps({"error": "websockets not installed"}))
    sys.exit(1)


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def _is_chrome_alive(pid: int) -> bool:
    try:
        import psutil
        return psutil.Process(pid).is_running()
    except Exception:
        return False


def _is_resource_type(resource_type: str) -> bool:
    return resource_type in ("Image", "Font", "Media", "Stylesheet", "Script",
                             "image", "font", "media", "stylesheet", "script")


def _now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S") + f".{int(time.time() * 1000) % 1000:03d}"


def _get_browser_ws_url(cdp_port: int) -> str:
    import http.client
    conn = http.client.HTTPConnection("127.0.0.1", cdp_port, timeout=3)
    conn.request("GET", "/json/version")
    resp = conn.getresponse()
    data = json.loads(resp.read())
    conn.close()
    return data["webSocketDebuggerUrl"]


def _run_http_server(api_logs: list, resource_logs: list, console_logs: list,
                     capture_config: dict, save_dir: str, port: int, stop_event: threading.Event):
    class Handler(BaseHTTPRequestHandler):
        def _is_local(self):
            client_ip = self.client_address[0]
            return client_ip in ("127.0.0.1", "::1", "localhost")

        def _json_response(self, data, status=200):
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

        def do_GET(self):
            if not self._is_local():
                self.send_response(403)
                self.end_headers()
                return

            parsed = urlparse(self.path)
            path = parsed.path
            query = parse_qs(parsed.query)

            if path == "/api":
                limit = int(query.get("limit", ["10000"])[0])
                self._json_response(api_logs[-limit:])
            elif path == "/resources":
                limit = int(query.get("limit", ["10000"])[0])
                self._json_response(resource_logs[-limit:])
            elif path == "/console_log":
                limit = int(query.get("limit", ["10000"])[0])
                self._json_response(console_logs[-limit:])
            elif path == "/download-on":
                capture_config["download_resources"] = True
                self._json_response({"download_resources": True})
            elif path == "/download-off":
                capture_config["download_resources"] = False
                self._json_response({"download_resources": False})
            elif path == "/":
                self._json_response({
                    "endpoints": {
                        "/api": f"API 请求日志（最近 {len(api_logs)} 条）",
                        "/resources": f"资源请求元数据（最近 {len(resource_logs)} 条）",
                        "/console_log": f"Console 日志（最近 {len(console_logs)} 条）",
                        "/download-on": "开启资源下载（GET）",
                        "/download-off": "关闭资源下载（GET）",
                    },
                })
            else:
                self.send_response(404)
                self.end_headers()

        def do_POST(self):
            self.send_response(404)
            self.end_headers()

        def log_message(self, format, *args):
            pass

    server = HTTPServer(("", port), Handler)
    server.timeout = 1
    while not stop_event.is_set():
        server.handle_request()
    server.server_close()


async def _run_cdp_monitor(cdp_port: int, chrome_pid: int,
                           api_logs: list, resource_logs: list, console_logs: list,
                           capture_config: dict, save_dir: str, stop_event: threading.Event):
    browser_ws_url = _get_browser_ws_url(cdp_port)
    msg_id = 0
    frame_urls = {}
    pending_enables = []
    pending_resumes = []

    def _next_id():
        nonlocal msg_id
        msg_id += 1
        return msg_id

    async with websockets.connect(browser_ws_url, max_size=50 * 1024 * 1024) as ws:

        async def _send_cdp(method, params=None, session_id=None):
            msg = {"id": _next_id(), "method": method}
            if params:
                msg["params"] = params
            if session_id:
                msg["sessionId"] = session_id
            await ws.send(json.dumps(msg))

        # 1) setAutoAttach — 浏览器会在收到后发 Target.attachedToTarget 事件
        await _send_cdp("Target.setAutoAttach", {
            "autoAttach": True,
            "waitForDebuggerOnStart": True,
            "flatten": True,
        })

        # 2) 单一消息循环，处理所有 CDP 消息
        while not stop_event.is_set() and _is_chrome_alive(chrome_pid):
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=1)
            except asyncio.TimeoutError:
                # 处理 pending 的 enable/resume 任务
                while pending_enables:
                    sid = pending_enables.pop(0)
                    for domain in ["Network", "Runtime", "Log", "Page"]:
                        await _send_cdp(f"{domain}.enable", session_id=sid)
                while pending_resumes:
                    sid = pending_resumes.pop(0)
                    await _send_cdp("Runtime.runIfWaitingForDebugger", session_id=sid)
                continue
            except Exception:
                break

            try:
                data = json.loads(raw)
            except Exception:
                continue

            method = data.get("method", "")
            params = data.get("params", {})
            session_id = data.get("sessionId")

            if method == "Target.attachedToTarget":
                new_sid = params.get("sessionId", "")
                target_type = params.get("targetInfo", {}).get("type", "")
                if new_sid and target_type == "page":
                    pending_enables.append(new_sid)
                    pending_resumes.append(new_sid)
                    # 立即处理 enable
                    for domain in ["Network", "Runtime", "Log", "Page"]:
                        await _send_cdp(f"{domain}.enable", session_id=new_sid)
                    await _send_cdp("Runtime.runIfWaitingForDebugger", session_id=new_sid)
            else:
                _process_event(method, params, api_logs, resource_logs,
                               console_logs, capture_config, frame_urls)


def _process_event(method: str, params: dict,
                   api_logs: list, resource_logs: list, console_logs: list,
                   capture_config: dict, frame_urls: dict):
    if not method:
        return

    # ── Network.requestWillBeSent ──
    if method == "Network.requestWillBeSent":
        req = params.get("request", {})
        rt = params.get("type", "")
        frame_id = params.get("frameId", "")
        page_url = frame_urls.get(frame_id, "")

        if params.get("redirectResponse"):
            redir = params["redirectResponse"]
            entry = {
                "time": _now(),
                "page_url": page_url,
                "url": params.get("url", ""),
                "status": redir.get("status"),
                "resource_type": rt,
                "response_headers": redir.get("headers", {}),
            }
            if _is_resource_type(rt):
                resource_logs.append(entry)
                _trim(resource_logs, capture_config.get("resource_log_limit", 10000))
            else:
                api_logs.append(entry)
                _trim(api_logs, capture_config.get("api_log_limit", 10000))

        entry = {
            "time": _now(),
            "page_url": page_url,
            "url": req.get("url", ""),
            "method": req.get("method", ""),
            "resource_type": rt,
            "headers": req.get("headers", {}),
        }
        if req.get("postData"):
            entry["request_body"] = req["postData"]

        if _is_resource_type(rt):
            resource_logs.append(entry)
            _trim(resource_logs, capture_config.get("resource_log_limit", 10000))
        else:
            api_logs.append(entry)
            _trim(api_logs, capture_config.get("api_log_limit", 10000))

    # ── Network.responseReceived ──
    elif method == "Network.responseReceived":
        resp = params.get("response", {})
        rt = params.get("type", "")
        frame_id = params.get("frameId", "")
        page_url = frame_urls.get(frame_id, "")

        entry = {
            "time": _now(),
            "page_url": page_url,
            "url": resp.get("url", ""),
            "status": resp.get("status"),
            "resource_type": rt,
            "content_type": resp.get("headers", {}).get("content-type", ""),
            "content_length": resp.get("headers", {}).get("content-length"),
            "response_headers": resp.get("headers", {}),
        }

        if _is_resource_type(rt):
            resource_logs.append(entry)
            _trim(resource_logs, capture_config.get("resource_log_limit", 10000))
        else:
            api_logs.append(entry)
            _trim(api_logs, capture_config.get("api_log_limit", 10000))

    # ── Runtime.consoleAPICalled ──
    elif method == "Runtime.consoleAPICalled":
        args_list = params.get("args", [])
        text_parts = []
        for arg in args_list:
            if "value" in arg:
                text_parts.append(str(arg["value"]))
            elif "description" in arg:
                text_parts.append(arg["description"])
        console_logs.append({
            "time": _now(),
            "level": params.get("type", "log"),
            "text": " ".join(text_parts),
        })
        _trim(console_logs, capture_config.get("console_log_limit", 10000))

    # ── Runtime.exceptionThrown ──
    elif method == "Runtime.exceptionThrown":
        exc = params.get("exceptionDetails", {})
        text = exc.get("text", "")
        desc = exc.get("exception", {}).get("description", text)
        console_logs.append({
            "time": _now(),
            "level": "pageerror",
            "text": desc,
        })
        _trim(console_logs, capture_config.get("console_log_limit", 10000))

    # ── Page.frameNavigated ──
    elif method == "Page.frameNavigated":
        frame = params.get("frame", {})
        fid = frame.get("id", "")
        url = frame.get("url", "")
        if fid and url:
            frame_urls[fid] = url


def _trim(log_list: list, limit: int):
    while len(log_list) > limit:
        log_list.pop(0)


def main():
    args = sys.argv[1:]
    if len(args) < 3:
        print("用法: browser_daemon.py <cdp_port> <chrome_pid> <project_name>", file=sys.stderr)
        sys.exit(1)

    cdp_port = int(args[0])
    chrome_pid = int(args[1])
    project_name = args[2]

    api_logs = []
    resource_logs = []
    console_logs = []

    capture_config = {
        "download_resources": False,
        "body_limit": 1024 * 1024,
        "api_log_limit": 10000,
        "resource_log_limit": 10000,
        "console_log_limit": 10000,
    }

    stop_event = threading.Event()

    save_dir = os.path.join(os.path.dirname(__file__), "local_data", project_name)
    os.makedirs(save_dir, exist_ok=True)

    http_port = _find_free_port()
    http_thread = threading.Thread(
        target=_run_http_server,
        args=(api_logs, resource_logs, console_logs, capture_config, save_dir, http_port, stop_event),
        daemon=True,
    )
    http_thread.start()

    print(json.dumps({
        "api_url": f"http://127.0.0.1:{http_port}/api",
        "resources_url": f"http://127.0.0.1:{http_port}/resources",
        "console_log_url": f"http://127.0.0.1:{http_port}/console_log",
        "download_on_url": f"http://127.0.0.1:{http_port}/download-on",
        "download_off_url": f"http://127.0.0.1:{http_port}/download-off",
    }))
    sys.stdout.flush()

    asyncio.run(_run_cdp_monitor(cdp_port, chrome_pid, api_logs, resource_logs, console_logs,
                                 capture_config, save_dir, stop_event))


if __name__ == "__main__":
    main()
