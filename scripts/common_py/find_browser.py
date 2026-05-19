"""浏览器路径探测工具函数（跨平台：macOS + Windows）"""

import os
import platform
import shutil
import subprocess
from pathlib import Path


def _query_registry(key: str, value: str) -> str | None:
    if platform.system() != "Windows":
        return None
    try:
        result = subprocess.run(
            ["reg", "query", key, "/v", value],
            capture_output=True, text=True, timeout=3,
        )
        for line in result.stdout.splitlines():
            if "REG_SZ" in line:
                return line.split("REG_SZ")[-1].strip()
    except Exception:
        pass
    return None


def find_browser(browser_name: str) -> str:
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    program_files_x86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")

    paths: dict[str, dict[str, list[str]]] = {
        "chrome": {
            "darwin": ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
            "win32": [
                rf"{program_files}\Google\Chrome\Application\chrome.exe",
                rf"{program_files_x86}\Google\Chrome\Application\chrome.exe",
                rf"{local_app_data}\Google\Chrome\Application\chrome.exe",
            ],
        },
        "chromium": {
            "darwin": ["/Applications/Chromium.app/Contents/MacOS/Chromium"],
            "win32": [
                rf"{local_app_data}\Chromium\Application\chrome.exe",
                rf"{program_files}\Chromium\Application\chrome.exe",
            ],
        },
        "edge": {
            "darwin": ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
            "win32": [
                rf"{program_files}\Microsoft\Edge\Application\msedge.exe",
                rf"{program_files_x86}\Microsoft\Edge\Application\msedge.exe",
            ],
        },
        "brave": {
            "darwin": ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
            "win32": [
                rf"{program_files}\BraveSoftware\Brave-Browser\Application\brave.exe",
                rf"{program_files_x86}\BraveSoftware\Brave-Browser\Application\brave.exe",
                rf"{local_app_data}\BraveSoftware\Brave-Browser\Application\brave.exe",
            ],
        },
    }

    plat = "darwin" if platform.system() == "Darwin" else "win32"
    candidates = paths.get(browser_name, {}).get(plat, [])

    # 1. Standard installation paths
    for p in candidates:
        if Path(p).exists():
            return p

    # 2. Windows: registry fallback
    if platform.system() == "Windows":
        reg_keys: dict[str, list[tuple[str, str]]] = {
            "chrome": [
                (r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe", "Path"),
                (r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Google Chrome", "InstallLocation"),
            ],
            "edge": [
                (r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe", "Path"),
                (r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft Edge", "InstallLocation"),
            ],
            "brave": [
                (r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\brave.exe", "Path"),
                (r"HKCU\SOFTWARE\BraveSoftware\Brave-Browser", "InstallPath"),
            ],
        }
        exe_names = {"chrome": "chrome.exe", "edge": "msedge.exe", "brave": "brave.exe"}
        exe = exe_names.get(browser_name, "")
        for key, value in reg_keys.get(browser_name, []):
            reg_path = _query_registry(key, value)
            if reg_path:
                full = os.path.join(reg_path, exe)
                if Path(full).exists():
                    return full

    # 3. macOS: Homebrew cask
    if platform.system() == "Darwin":
        homebrew: dict[str, tuple[str, str]] = {
            "chrome": ("/opt/homebrew/Caskroom/google-chrome", "Google Chrome.app/Contents/MacOS/Google Chrome"),
            "chromium": ("/opt/homebrew/Caskroom/chromium", "Chromium.app/Contents/MacOS/Chromium"),
            "edge": ("/opt/homebrew/Caskroom/microsoft-edge", "Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
            "brave": ("/opt/homebrew/Caskroom/brave-browser", "Brave Browser.app/Contents/MacOS/Brave Browser"),
        }
        entry = homebrew.get(browser_name)
        if entry:
            base_dir, suffix = entry
            if Path(base_dir).exists():
                try:
                    for v in sorted(Path(base_dir).iterdir(), reverse=True):
                        candidate = base_dir / v.name / suffix
                        if candidate.exists():
                            return str(candidate)
                except OSError:
                    pass

    # 4. which / where fallback
    exe_names = {
        "chrome": ["google-chrome", "google-chrome-stable", "chrome"],
        "chromium": ["chromium", "chromium-browser"],
        "edge": ["microsoft-edge", "microsoft-edge-stable", "msedge"],
        "brave": ["brave-browser", "brave"],
    }
    cmd = "where" if platform.system() == "Windows" else "which"
    for name in exe_names.get(browser_name, []):
        found = shutil.which(name)
        if found and Path(found).exists():
            return found

    return ""
