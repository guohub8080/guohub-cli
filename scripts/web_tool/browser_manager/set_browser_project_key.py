import json
import re
import sys
from pathlib import Path

from scripts.common_py.clipboard import (
    guohub_skill_clipboard_clear,
    guohub_skill_clipboard_read,
)
from scripts.common_py.keyring_helper import guohub_set_credential
from scripts.common_py.log import (
    guohub_error_print,
    guohub_json_print,
    guohub_logger,
)

HERE = Path(__file__).resolve().parent
CONFIG_TOML = HERE / "config.toml"


def _load_text() -> str:
    if not CONFIG_TOML.exists():
        return ""
    return CONFIG_TOML.read_text(encoding="utf-8")


def _update_project_keys(project: str, keys: list[str]):
    text = _load_text()
    section_pattern = rf"^\[{re.escape(project)}\]$"

    # 检查项目段是否存在
    has_section = bool(re.search(section_pattern, text, flags=re.MULTILINE))

    if not has_section:
        # 在文件末尾添加新项目段
        text = text.rstrip() + f"\n\n[{project}]\nbrowser_project_keys = {json.dumps(keys, ensure_ascii=False)}\n"
    else:
        # 在项目段内查找/替换 browser_project_keys
        lines = text.split("\n")
        in_section = False
        replaced = False
        new_lines = []
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("[") and not stripped.startswith("[["):
                in_section = bool(re.match(section_pattern, stripped))
            if in_section and stripped.startswith("browser_project_keys"):
                new_lines.append(f"browser_project_keys = {json.dumps(keys, ensure_ascii=False)}")
                replaced = True
                continue
            new_lines.append(line)

        if not replaced:
            # 在段的第一行后插入
            for i, line in enumerate(new_lines):
                if re.match(section_pattern, line.strip()):
                    new_lines.insert(i + 1, f"browser_project_keys = {json.dumps(keys, ensure_ascii=False)}")
                    break

        text = "\n".join(new_lines)

    CONFIG_TOML.write_text(text, encoding="utf-8")


def main():
    args = sys.argv[1:]
    if not args:
        guohub_error_print(
            "用法: set-browser-project-key --project <项目名> <key> [--set-value] [--from-clipboard] [--force]"
        )

    project = None
    key = None
    set_value = False
    from_clipboard = False
    force = False
    i = 0
    while i < len(args):
        if args[i] == "--project" and i + 1 < len(args):
            project = args[i + 1]
            i += 2
        elif args[i] == "--set-value":
            set_value = True
            i += 1
        elif args[i] == "--from-clipboard":
            from_clipboard = True
            i += 1
        elif args[i] == "--force":
            force = True
            i += 1
        elif not key:
            key = args[i]
            i += 1
        else:
            guohub_error_print("一次只能设置一个 key")

    if not project:
        guohub_error_print("请指定 --project <项目名>")
    if not key:
        guohub_error_print("请指定 key 名称")

    import tomllib
    with open(CONFIG_TOML, "rb") as f:
        config = tomllib.load(f)

    project_config = config.get(project, {})
    existing_keys = project_config.get("browser_project_keys", [])

    if key in existing_keys and not force:
        guohub_error_print(f"key [{key}] 已存在于项目 [{project}]，请使用 --force 强制更新")

    if key not in existing_keys:
        existing_keys.append(key)
        _update_project_keys(project, existing_keys)
        guohub_logger.info(f"已添加 key [{key}] 到项目 [{project}]")
    else:
        guohub_logger.info(f"key [{key}] 已存在于项目 [{project}]，强制更新")

    if set_value:
        if from_clipboard:
            value = guohub_skill_clipboard_read()
            if not value:
                guohub_error_print("剪贴板为空")
            guohub_logger.info(f"从剪贴板读取到值: {value[:4]}***")
        else:
            import getpass
            value = getpass.getpass(f"请输入 {key} 的值: ")
        keyring_name = f"guohub-chrome:{project}:{key}"
        guohub_set_credential(keyring_name, value)
        guohub_logger.info(f"已存入 keyring: {keyring_name}")
        if from_clipboard:
            guohub_skill_clipboard_clear()
            guohub_logger.info("已清空剪贴板")

    guohub_json_print(
        {
            "project": project,
            "browser_project_keys": existing_keys,
            "set_value": set_value,
            "from_clipboard": from_clipboard,
        }
    )


if __name__ == "__main__":
    main()
