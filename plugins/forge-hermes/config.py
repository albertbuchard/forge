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
    return get_hermes_home() / "forge"


def get_config_path() -> Path:
    return get_default_data_root() / "config.json"


def read_plugin_config() -> Dict[str, Any]:
    config_path = get_config_path()
    if not config_path.exists():
        return {}

    try:
        payload = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception:
        return {}

    return payload if isinstance(payload, dict) else {}
