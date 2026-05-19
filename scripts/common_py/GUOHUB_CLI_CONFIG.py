import os
import tomllib
from pathlib import Path


def _load_config():
    root = os.environ.get("GUOHUB_ROOT")
    if root:
        path = Path(root) / "config.toml"
    else:
        path = Path(__file__).resolve().parent.parent.parent / "config.toml"
    if not path.exists():
        return {"keyring_namespace": "GUOHUB_CLI"}
    with open(path, "rb") as f:
        return tomllib.load(f)


NAME_SPACE = _load_config().get("keyring_namespace", "GUOHUB_CLI")
