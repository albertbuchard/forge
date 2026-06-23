"""Shared Forge Hermes config helpers."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict


def get_hermes_home() -> Path:
    env_home = os.environ.get("HERMES_HOME", "").strip()
    if env_home:
        return Path(env_home).expanduser().resolve()

    try:
        from hermes_cli.config import get_hermes_home as resolve_hermes_home  # type: ignore

        return resolve_hermes_home().resolve()
    except Exception:
        return (Path.home() / ".hermes").resolve()


def get_default_data_root() -> Path:
    configured = os.environ.get("FORGE_DATA_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return (Path.home() / ".forge").resolve()


def get_config_path() -> Path:
    return get_hermes_home() / "forge" / "config.json"


def ensure_plugin_config() -> Path:
    config_path = get_config_path()
    if config_path.exists():
        return config_path

    config_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "dataRoot": str(get_default_data_root()),
    }
    config_path.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")
    return config_path


def read_plugin_config() -> Dict[str, Any]:
    config_path = ensure_plugin_config()

    try:
        payload = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception:
        return {}

    return payload if isinstance(payload, dict) else {}
