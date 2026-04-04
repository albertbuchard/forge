"""Forge Hermes plugin package."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

from .catalog import TOOL_CATALOG
from .config import ensure_plugin_config
from .schemas import SCHEMAS
from .tools import build_handler
from .version import __version__

logger = logging.getLogger(__name__)
PACKAGE_DIR = Path(__file__).resolve().parent


def _install_skill() -> None:
    try:
        from hermes_cli.config import get_hermes_home  # type: ignore

        destination = get_hermes_home() / "skills" / "forge-hermes" / "SKILL.md"
    except Exception:
        destination = Path.home() / ".hermes" / "skills" / "forge-hermes" / "SKILL.md"

    if destination.exists():
        return

    source = PACKAGE_DIR / "skill.md"
    if not source.exists():
        return

    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def register(ctx) -> None:
    ensure_plugin_config()

    for spec in TOOL_CATALOG:
        ctx.register_tool(
            name=spec["name"],
            toolset="forge",
            schema=SCHEMAS[spec["name"]],
            handler=build_handler(spec["name"]),
        )

    _install_skill()
    logger.info("Registered Forge Hermes plugin with %s tools", len(TOOL_CATALOG))
