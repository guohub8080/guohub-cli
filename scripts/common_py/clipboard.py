import subprocess
import sys


def guohub_clipboard_read() -> str:
    """读取系统剪贴板内容，失败返回空字符串。"""
    try:
        if sys.platform == "darwin":
            return subprocess.run(["pbpaste"], capture_output=True, text=True, check=True).stdout
        if sys.platform == "win32":
            return subprocess.run(
                ["powershell", "-command", "Get-Clipboard"],
                capture_output=True, text=True, check=True,
            ).stdout
    except Exception:
        pass
    return ""


def guohub_clipboard_write(text: str):
    """写入系统剪贴板。"""
    if sys.platform == "darwin":
        subprocess.run(["pbcopy"], input=text, text=True, check=True)
    elif sys.platform == "win32":
        subprocess.run(["clip"], input=text, text=True, check=True)


def guohub_clipboard_clear():
    """清空系统剪贴板。"""
    guohub_clipboard_write("")
