import os
import tomllib
from pathlib import Path

from scripts.common_py.GUOHUB_CLI_CONFIG import NAME_SPACE


def get_config_path() -> Path:
    root = os.environ.get("GUOHUB_ROOT")
    if root:
        return Path(root) / "config.toml"
    return Path(__file__).resolve().parent.parent.parent / "config.toml"


def load_config() -> dict:
    path = get_config_path()
    if not path.exists():
        return {"defaults": {}, "services": {}}
    with open(path, "rb") as f:
        return tomllib.load(f)
