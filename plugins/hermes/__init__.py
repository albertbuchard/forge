"""Local-folder compatibility wrapper for the pip-installable Forge Hermes package."""

try:
    from .forge_hermes import __version__, register
except ImportError:  # pragma: no cover - direct local import fallback
    from forge_hermes import __version__, register

__all__ = ["__version__", "register"]
