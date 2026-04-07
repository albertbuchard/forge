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


def _install_skill_bundle() -> None:
    try:
        from hermes_cli.config import get_hermes_home  # type: ignore

        destination_dir = get_hermes_home() / "skills" / "forge-hermes"
    except Exception:
        destination_dir = Path.home() / ".hermes" / "skills" / "forge-hermes"

    for source in sorted(PACKAGE_DIR.glob("*.md")):
        destination_name = "SKILL.md" if source.name == "skill.md" else source.name
        destination = destination_dir / destination_name
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists() and destination.read_bytes() == source.read_bytes():
            continue
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

    _install_skill_bundle()
    logger.info("Registered Forge Hermes plugin with %s tools", len(TOOL_CATALOG))
