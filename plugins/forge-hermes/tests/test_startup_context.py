from __future__ import annotations

import pytest

from forge_hermes import tools


@pytest.fixture(autouse=True)
def clear_session_startup_contexts():
    tools.SESSION_STARTUP_CONTEXTS.clear()
    yield
    tools.SESSION_STARTUP_CONTEXTS.clear()


def test_warm_startup_context_fetches_once_per_session(monkeypatch: pytest.MonkeyPatch):
    calls: list[str] = []

    def fake_fetch() -> str:
        calls.append("fetch")
        return "Forge context for this session:\n- Operator: Albert"

    monkeypatch.setattr(tools, "_fetch_startup_context_text", fake_fetch)

    tools.warm_startup_context(session_id="telegram-session")
    tools.warm_startup_context(session_id="telegram-session")

    assert tools.SESSION_STARTUP_CONTEXTS["telegram-session"] == (
        "Forge context for this session:\n- Operator: Albert"
    )
    assert calls == ["fetch"]


def test_build_startup_context_only_injects_on_first_turn(monkeypatch: pytest.MonkeyPatch):
    tools.SESSION_STARTUP_CONTEXTS["telegram-session"] = (
        "Forge context for this session:\n- Operator: Albert"
    )

    def fail_fetch() -> str:
        raise AssertionError("startup context should come from the session cache")

    monkeypatch.setattr(tools, "_fetch_startup_context_text", fail_fetch)

    assert tools.build_startup_context(session_id="telegram-session", is_first_turn=False) is None
    assert tools.build_startup_context(session_id="telegram-session", is_first_turn=True) == {
        "context": "Forge context for this session:\n- Operator: Albert"
    }


def test_clear_startup_context_removes_cached_session():
    tools.SESSION_STARTUP_CONTEXTS["telegram-session"] = "cached"

    tools.clear_startup_context(session_id="telegram-session")

    assert "telegram-session" not in tools.SESSION_STARTUP_CONTEXTS
