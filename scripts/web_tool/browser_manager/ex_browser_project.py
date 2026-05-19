import sys
import tomllib
from pathlib import Path

from scripts.common_py.log import (
    guohub_error_print,
    guohub_json_print,
    guohub_text_print,
    guohub_logger,
)

HERE = Path(__file__).resolve().parent
CONFIG_TOML = HERE / "config.toml"
LOCAL_DATA_DIR = HERE / "local_data"


def _load_toml() -> dict:
    if not CONFIG_TOML.exists():
        return {}
    with open(CONFIG_TOML, "rb") as f:
        return tomllib.load(f)


def _save_toml_add(project_name: str, config: dict):
    existing = _load_toml()
    if project_name in existing:
        guohub_error_print(f"项目 [{project_name}] 已存在，如需修改请先删除再添加")

    lines = []
    if CONFIG_TOML.exists():
        with open(CONFIG_TOML, "r", encoding="utf-8") as f:
            lines = f.readlines()

    lines.append(f"\n[{project_name}]\n")
    if config.get("description"):
        lines.append(f'description = "{config["description"]}"\n')
    if config.get("browser"):
        lines.append(f'browser = "{config["browser"]}"\n')
    if config.get("browser_path"):
        lines.append(f'browser_path = "{config["browser_path"]}"\n')
    if config.get("proxy"):
        lines.append(f'proxy = "{config["proxy"]}"\n')
    if config.get("browser_project_keys"):
        keys = config["browser_project_keys"]
        lines.append(f"browser_project_keys = {repr(keys)}\n")
    if config.get("chrome_args"):
        args = config["chrome_args"]
        lines.append(f"chrome_args = {repr(args)}\n")

    with open(CONFIG_TOML, "w", encoding="utf-8") as f:
        f.writelines(lines)


def _remove_from_toml(project_name: str):
    with open(CONFIG_TOML, "r", encoding="utf-8") as f:
        lines = f.readlines()

    in_target = False
    new_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("[") and not stripped.startswith("[["):
            section_name = stripped.strip("[]")
            if section_name == project_name:
                in_target = True
                continue
            in_target = False
        if in_target:
            continue
        new_lines.append(line)

    with open(CONFIG_TOML, "w", encoding="utf-8") as f:
        f.writelines(new_lines)


def cmd_list():
    profiles = _load_toml()
    projects = []
    for name, config in profiles.items():
        if name == "browser_global_keys":
            continue
        projects.append({
            "name": name,
            "description": config.get("description", ""),
            "browser": config.get("browser", "chrome"),
            "has_instance": (LOCAL_DATA_DIR / name).exists(),
        })
    guohub_json_print({"count": len(projects), "projects": projects})


def _detect_browser_path(browser_name: str) -> str:
    from scripts.common_py.find_browser import find_browser
    return find_browser(browser_name)


def cmd_add(args):
    project_name = None
    description = ""
    browser = ""
    browser_path = ""
    proxy = ""
    chrome_args = []

    i = 0
    while i < len(args):
        if args[i] == "--description" and i + 1 < len(args):
            description = args[i + 1]; i += 2
        elif args[i] == "--browser" and i + 1 < len(args):
            browser = args[i + 1]; i += 2
        elif args[i] == "--browser-path" and i + 1 < len(args):
            browser_path = args[i + 1]; i += 2
        elif args[i] == "--proxy" and i + 1 < len(args):
            proxy = args[i + 1]; i += 2
        elif args[i] == "--chrome-args" and i + 1 < len(args):
            chrome_args = args[i + 1].split(","); i += 2
        elif not project_name and not args[i].startswith("--"):
            project_name = args[i]; i += 1
        else:
            i += 1

    if not project_name:
        guohub_error_print("请指定项目名称: ex-browser-project add <项目名> [选项]")

    target_browser = browser or "chrome"

    # Auto-detect browser path if not specified
    if not browser_path:
        detected = _detect_browser_path(target_browser)
        if detected:
            browser_path = detected
            guohub_logger.info(f"自动探测到浏览器路径: {browser_path}")

    config = {}
    if description: config["description"] = description
    if browser: config["browser"] = browser
    if browser_path: config["browser_path"] = browser_path
    if proxy: config["proxy"] = proxy
    if chrome_args: config["chrome_args"] = chrome_args

    _save_toml_add(project_name, config)
    (LOCAL_DATA_DIR / project_name).mkdir(parents=True, exist_ok=True)
    guohub_text_print(f"项目 [{project_name}] 已创建")


def cmd_remove(args):
    from scripts.common_py.keyring_helper import guohub_delete_credential

    if not args:
        guohub_error_print("请指定项目名称: ex-browser-project remove <项目名>")

    project_name = args[0]
    if project_name == "default":
        guohub_error_print("default 项目无法删除，它是默认 fallback 项目")

    profiles = _load_toml()
    if project_name not in profiles:
        guohub_error_print(f"项目 [{project_name}] 不存在")

    profile_config = profiles.get(project_name, {})

    _remove_from_toml(project_name)

    project_keys = profile_config.get("browser_project_keys", [])
    for key in project_keys:
        keyring_name = f"{project_name}:{key}"
        try:
            guohub_delete_credential(keyring_name)
            guohub_logger.info(f"已删除 keyring: {keyring_name}")
        except Exception:
            pass

    profile_dir = LOCAL_DATA_DIR / project_name
    if profile_dir.exists():
        import shutil
        guohub_logger.info(f"删除 local_data 目录: {profile_dir}")
        shutil.rmtree(profile_dir)

    guohub_text_print(f"项目 [{project_name}] 已删除")


def cmd_info(args):
    if not args:
        guohub_error_print("请指定项目名称: ex-browser-project info <项目名>")

    project_name = args[0]
    profiles = _load_toml()

    config = {}
    if project_name in profiles:
        config = profiles[project_name]
    elif project_name != "default":
        guohub_error_print(f"项目 [{project_name}] 不存在")

    from scripts.common_py.keyring_helper import guohub_get_credential

    _global_keys = profiles.get("browser_global_keys", [])
    _project_keys = config.get("browser_project_keys", [])
    credential_keys = list(dict.fromkeys(_project_keys + _global_keys))

    credentials = []
    for key in credential_keys:
        val = guohub_get_credential(key) or guohub_get_credential(f"{project_name}:{key}")
        credentials.append({"key": key, "has_value": val is not None})

    profile_dir = LOCAL_DATA_DIR / project_name
    has_data = profile_dir.exists()

    instance = None
    from scripts.web_tool.browser_manager.find_existing_browsers import find_all_managed_browsers
    for b in find_all_managed_browsers():
        if b["project"] == project_name and b["is_alive"]:
            instance = b
            break

    result = {
        "name": project_name,
        "description": config.get("description", ""),
        "browser": config.get("browser", "chrome"),
        "browser_path": config.get("browser_path", ""),
        "proxy": config.get("proxy", ""),
        "chrome_args": config.get("chrome_args", []),
        "has_data_dir": has_data,
        "credentials": credentials,
        "instance": instance,
    }
    guohub_json_print(result)


def main():
    args = sys.argv[1:]
    if not args:
        guohub_error_print("用法: ex-browser-project <list|add|remove|info> [参数]")

    subcmd = args[0]
    rest = args[1:]

    if subcmd == "list":
        cmd_list()
    elif subcmd == "add":
        cmd_add(rest)
    elif subcmd == "remove":
        cmd_remove(rest)
    elif subcmd == "info":
        cmd_info(rest)
    else:
        guohub_error_print(f"未知子命令: {subcmd}，支持: list, add, remove, info")


if __name__ == "__main__":
    main()
