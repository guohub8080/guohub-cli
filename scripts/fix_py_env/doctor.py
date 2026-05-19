import json
import shutil
import subprocess
import sys
from pathlib import Path

from scripts.common_py.log import guohub_logger, guohub_json_print

SKILL_ROOT = Path(__file__).resolve().parent.parent.parent


def ensure_dependencies():
    deps = []
    try:
        import keyring  # noqa: F401
    except ImportError:
        deps.append("keyring")
    try:
        import requests  # noqa: F401
    except ImportError:
        deps.append("requests")
    try:
        import pyperclip  # noqa: F401
    except ImportError:
        deps.append("pyperclip")
    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        deps.append("pillow")
    try:
        import docx  # noqa: F401
    except ImportError:
        deps.append("python-docx")

    if not deps:
        guohub_logger.info("所有依赖已安装")
        return

    guohub_logger.info(f"正在安装依赖（{', '.join(deps)}）...")
    uv = shutil.which("uv")
    subprocess.run(
        [uv, "add", *deps],
        cwd=SKILL_ROOT,
        check=True,
    )
    guohub_logger.info("依赖安装完成")


def scan_plugin_dependencies():
    """扫描 plugins/*/plugin.json，收集所有插件的 py_dependencies 并安装"""
    plugins_dir = SKILL_ROOT / "plugins"
    if not plugins_dir.exists():
        return

    deps = []
    for plugin_dir in plugins_dir.iterdir():
        if not plugin_dir.is_dir():
            continue
        meta_path = plugin_dir / "plugin.json"
        if not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text("utf-8"))
        deps.extend(meta.get("py_dependencies", []))

    if not deps:
        return

    guohub_logger.info(f"正在安装插件依赖（{', '.join(deps)}）...")
    uv = shutil.which("uv")
    subprocess.run(
        [uv, "add", *deps],
        cwd=SKILL_ROOT,
        check=True,
    )
    guohub_logger.info("插件依赖安装完成")


def _find_pandoc():
    # 1. PATH
    pandoc = shutil.which("pandoc")
    if pandoc:
        return pandoc

    # 2. 各平台常见安装路径
    candidates = []
    if sys.platform == "win32":
        local_appdata = Path.home() / "AppData" / "Local"
        candidates = [
            local_appdata / "Pandoc" / "pandoc.exe",
            Path("C:/Program Files/Pandoc/pandoc.exe"),
            Path("C:/Program Files (x86)/Pandoc/pandoc.exe"),
        ]
    elif sys.platform == "darwin":
        candidates = [
            Path("/usr/local/bin/pandoc"),
            Path("/opt/homebrew/bin/pandoc"),
            Path.home() / ".local" / "bin" / "pandoc",
        ]
    else:
        candidates = [
            Path("/usr/bin/pandoc"),
            Path("/usr/local/bin/pandoc"),
            Path.home() / ".local" / "bin" / "pandoc",
        ]

    for path in candidates:
        if path.exists():
            return str(path)
    return None


def check_pandoc():
    pandoc = _find_pandoc()
    if pandoc:
        guohub_logger.info(f"✓ pandoc 已安装：{pandoc}")
        return True

    guohub_logger.info("✗ pandoc 未安装（用于 .doc 格式转换）")
    if sys.platform == "win32":
        guohub_logger.info("  安装命令：winget install JohnMacFarlane.Pandoc")
    elif sys.platform == "darwin":
        guohub_logger.info("  安装命令：brew install pandoc")
    else:
        guohub_logger.info("  安装命令：sudo apt install pandoc  （或对应发行版的包管理器）")
    return False


def check_env():
    guohub_logger.info("=== GuoHub Skill 环境检查 ===")

    venv = SKILL_ROOT / ".venv"
    if venv.exists():
        guohub_logger.info(f"✓ 虚拟环境已存在：{venv}")
    else:
        guohub_logger.info("✗ 虚拟环境不存在，请先执行 uv init --bare")

    config = SKILL_ROOT / "config.toml"
    if config.exists():
        guohub_logger.info(f"✓ 配置文件已存在：{config}")
    else:
        guohub_logger.info("  配置文件不存在（首次运行会自动生成）")

    dev_temp = SKILL_ROOT / "dev_temp"
    if dev_temp.exists():
        guohub_logger.info(f"✓ 临时目录已存在：{dev_temp}")
    else:
        dev_temp.mkdir(parents=True, exist_ok=True)
        guohub_logger.info(f"  已创建临时目录：{dev_temp}")


def check_global_link():
    result = shutil.which("guohub-cli")
    if result:
        guohub_logger.info(f"✓ guohub-cli 已注册全局命令：{result}")
        return True

    guohub_logger.info("✗ guohub-cli 未注册为全局命令，正在执行 npm link...")
    try:
        subprocess.run(
            ["npm", "link"],
            cwd=SKILL_ROOT,
            check=True,
        )
        guohub_logger.info("✓ npm link 完成")
        return True
    except Exception as e:
        guohub_logger.info(f"  npm link 失败：{e}，请手动执行 npm link")
        return False


def main():
    check_env()
    check_global_link()
    check_pandoc()
    ensure_dependencies()
    scan_plugin_dependencies()
    guohub_json_print({"status": "ready"})


if __name__ == "__main__":
    main()
