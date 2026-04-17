"""Forge Hermes plugin package."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

from .catalog import TOOL_CATALOG
from .config import ensure_plugin_config
from .schemas import SCHEMAS
from .tools import (
    build_handler,
    build_startup_context,
    clear_startup_context,
    warm_startup_context,
)
from .version import __version__

logger = logging.getLogger(__name__)
PACKAGE_DIR = Path(__file__).resolve().parent
SKILL_FILES = {
    "forge-hermes": PACKAGE_DIR / "skill.md",
    "entity-conversation-playbooks": PACKAGE_DIR / "entity_conversation_playbooks.md",
    "psyche-entity-playbooks": PACKAGE_DIR / "psyche_entity_playbooks.md",
}


def _install_legacy_skill_bundle() -> None:
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


def _register_skill_bundle(ctx) -> None:
    register_skill = getattr(ctx, "register_skill", None)
    if callable(register_skill):
        registered = 0
        for skill_name, source in SKILL_FILES.items():
            if not source.exists():
                logger.warning("Forge Hermes skill source missing: %s", source)
                continue
            register_skill(skill_name, source)
            registered += 1
        logger.info(
            "Registered %s Forge Hermes bundled skills through ctx.register_skill",
            registered,
        )
        return

    logger.info(
        "Hermes runtime does not expose ctx.register_skill yet; "
        "falling back to legacy ~/.hermes/skills installation"
    )
    _install_legacy_skill_bundle()


def register(ctx) -> None:
    ensure_plugin_config()

    for spec in TOOL_CATALOG:
        ctx.register_tool(
            name=spec["name"],
            toolset="forge",
            schema=SCHEMAS[spec["name"]],
            handler=build_handler(spec["name"]),
        )

    register_hook = getattr(ctx, "register_hook", None)
    if callable(register_hook):
        register_hook("on_session_start", warm_startup_context)
        register_hook("pre_llm_call", build_startup_context)
        register_hook("on_session_finalize", clear_startup_context)
        register_hook("on_session_reset", clear_startup_context)

    _register_skill_bundle(ctx)
    logger.info("Registered Forge Hermes plugin with %s tools", len(TOOL_CATALOG))
