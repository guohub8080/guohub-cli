import sys
import tomllib
from pathlib import Path

from scripts.common_py.keyring_helper import guohub_get_credential
from scripts.common_py.log import (
    guohub_error_print,
    guohub_json_print,
    guohub_logger,
)

HERE = Path(__file__).resolve().parent
CONFIG_TOML = HERE / "config.toml"


def main():
    args = sys.argv[1:]

    project = None
    target_key = None
    i = 0
    while i < len(args):
        if args[i] == "--project" and i + 1 < len(args):
            project = args[i + 1]
            i += 2
        elif not args[i].startswith("-") and not target_key:
            target_key = args[i]
            i += 1
        else:
            i += 1

    if not project:
        guohub_error_print("请指定 --project <项目名>")

    if not CONFIG_TOML.exists():
        guohub_error_print("找不到配置文件: config.toml")

    with open(CONFIG_TOML, "rb") as f:
        config = tomllib.load(f)

    project_config = config.get(project)
    if not project_config:
        guohub_error_print(f"项目 [{project}] 不存在于 config.toml 中")

    keys = project_config.get("browser_project_keys", [])

    if not keys:
        guohub_json_print({"project": project, "keys": [], "values": {}})
        return

    if target_key:
        keys = [k for k in keys if k == target_key]

    values = {}
    for key in keys:
        keyring_name = f"guohub-chrome:{project}:{key}"
        value = guohub_get_credential(keyring_name)
        if value:
            values[key] = value[:4] + "***" if len(value) > 4 else "****"
        else:
            values[key] = None
            guohub_logger.info(f"key [{keyring_name}] 未在 keyring 中找到值")

    guohub_json_print({"project": project, "keys": keys, "values": values})


if __name__ == "__main__":
    main()
