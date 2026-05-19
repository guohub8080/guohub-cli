import sys
import tomllib
from pathlib import Path

from scripts.common_py.keyring_helper import guohub_delete_credential
from scripts.common_py.log import (
    guohub_error_print,
    guohub_text_print,
    guohub_logger,
)

HERE = Path(__file__).resolve().parent
CONFIG_TOML = HERE / "config.toml"
LOCAL_DATA_DIR = HERE / "local_data"


def _remove_from_toml(project_name: str):
    """从 config.toml 中删除指定项目，保留其他内容。"""
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


def main():
    args = sys.argv[1:]
    if not args:
        guohub_error_print("请指定项目名称: remove-browser-project <项目名>")

    project_name = args[0]

    if not CONFIG_TOML.exists():
        guohub_error_print(f"找不到配置文件: {CONFIG_TOML}")

    with open(CONFIG_TOML, "rb") as f:
        profiles = tomllib.load(f)

    if project_name not in profiles:
        guohub_error_print(f"项目 [{project_name}] 不存在于 config.toml 中")

    profile_dir = LOCAL_DATA_DIR / project_name

    # 从 TOML 中删除
    guohub_logger.info(f"从 config.toml 中移除 [{project_name}]")
    _remove_from_toml(project_name)

    # 清理 keyring 中的项目凭据
    project_keys = profiles.get(project_name, {}).get("browser_project_keys", [])
    for key in project_keys:
        keyring_name = f"{project_name}:{key}"
        try:
            guohub_delete_credential(keyring_name)
            guohub_logger.info(f"已删除 keyring: {keyring_name}")
        except Exception:
            pass

    # 删除 profile 目录
    if profile_dir.exists():
        import shutil
        guohub_logger.info(f"删除 local_data 目录: {profile_dir}")
        shutil.rmtree(profile_dir)

    guohub_text_print(f"项目 [{project_name}] 已删除")


if __name__ == "__main__":
    main()
