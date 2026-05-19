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


def _update_global_keys(keys: list[str]):
    text = _load_text()
    new_line = f"browser_global_keys = {json.dumps(keys, ensure_ascii=False)}\n"

    if "browser_global_keys" in text:
        text = re.sub(
            r"^browser_global_keys\s*=.*$",
            new_line.strip(),
            text,
            flags=re.MULTILINE,
        )
    else:
        lines = text.split("\n")
        insert_idx = 0
        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped and not stripped.startswith("#"):
                insert_idx = i
                break
        lines.insert(insert_idx, new_line.strip())
        lines.insert(insert_idx + 1, "")
        text = "\n".join(lines)

    CONFIG_TOML.write_text(text, encoding="utf-8")


def main():
    args = sys.argv[1:]
    if not args:
        guohub_error_print(
            "用法: set-browser-global-keys <key> [--set-value] [--from-clipboard] [--force]"
        )

    key = None
    set_value = False
    from_clipboard = False
    force = False
    i = 0
    while i < len(args):
        if args[i] == "--set-value":
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

    if not key:
        guohub_error_print("请指定 key 名称")

    config_text = _load_text()
    existing_keys = []
    if "browser_global_keys" in config_text:
        import tomllib
        with open(CONFIG_TOML, "rb") as f:
            config = tomllib.load(f)
        existing_keys = config.get("browser_global_keys", [])

    if key in existing_keys and not force:
        guohub_error_print(f"key [{key}] 已存在，请使用 --force 强制更新")

    if key not in existing_keys:
        existing_keys.append(key)
        _update_global_keys(existing_keys)
        guohub_logger.info(f"已添加 key: {key}")
    else:
        guohub_logger.info(f"key [{key}] 已存在，强制更新")

    if set_value:
        if from_clipboard:
            value = guohub_skill_clipboard_read()
            if not value:
                guohub_error_print("剪贴板为空")
            guohub_logger.info(f"从剪贴板读取到值: {value[:4]}***")
        else:
            import getpass
            value = getpass.getpass(f"请输入 {key} 的值: ")
        keyring_name = f"guohub-chrome:{key}"
        guohub_set_credential(keyring_name, value)
        guohub_logger.info(f"已存入 keyring: {keyring_name}")
        if from_clipboard:
            guohub_skill_clipboard_clear()
            guohub_logger.info("已清空剪贴板")

    guohub_json_print(
        {
            "browser_global_keys": existing_keys,
            "set_value": set_value,
            "from_clipboard": from_clipboard,
        }
    )


if __name__ == "__main__":
    main()
