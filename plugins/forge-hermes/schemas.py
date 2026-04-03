"""Hermes-visible tool schemas for Forge."""

from __future__ import annotations

from .catalog import TOOL_CATALOG


SCHEMAS = {
    spec["name"]: {
        "name": spec["name"],
        "description": spec["description"],
        "parameters": spec["parameters"],
    }
    for spec in TOOL_CATALOG
}
