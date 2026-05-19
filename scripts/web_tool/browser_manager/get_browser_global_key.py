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

    if not CONFIG_TOML.exists():
        guohub_error_print("找不到配置文件: config.toml")

    with open(CONFIG_TOML, "rb") as f:
        config = tomllib.load(f)

    keys = config.get("browser_global_keys", [])

    if not keys:
        guohub_json_print({"keys": [], "values": {}})
        return

    # 如果有指定 key 名，只获取那个
    target_keys = []
    for arg in args:
        if not arg.startswith("-"):
            target_keys.append(arg)

    if target_keys:
        keys = [k for k in keys if k in target_keys]

    values = {}
    for key in keys:
        keyring_name = f"guohub-chrome:{key}"
        value = guohub_get_credential(keyring_name)
        if value:
            values[key] = value[:4] + "***" if len(value) > 4 else "****"
        else:
            values[key] = None
            guohub_logger.info(f"key [{key}] 未在 keyring 中找到值")

    guohub_json_print({"keys": keys, "values": values})


if __name__ == "__main__":
    main()
