from __future__ import annotations

import pytest

import forge_hermes
from forge_hermes import tools


@pytest.fixture(autouse=True)
def clear_session_startup_contexts():
    tools.SESSION_STARTUP_CONTEXTS.clear()
    tools.SESSION_RUNTIME_IDS.clear()
    tools.SESSION_ACTOR_LABELS.clear()
    tools.GATEWAY_RUNTIME_THREAD = None
    tools.GATEWAY_RUNTIME_STOP = None
    yield
    tools.SESSION_STARTUP_CONTEXTS.clear()
    tools.SESSION_RUNTIME_IDS.clear()
    tools.SESSION_ACTOR_LABELS.clear()
    tools.GATEWAY_RUNTIME_THREAD = None
    tools.GATEWAY_RUNTIME_STOP = None


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


def test_build_startup_context_injects_cached_context_on_every_turn(
    monkeypatch: pytest.MonkeyPatch,
):
    tools.SESSION_STARTUP_CONTEXTS["telegram-session"] = (
        "Forge context for this session:\n- Operator: Albert"
    )

    def fail_fetch() -> str:
        raise AssertionError("startup context should come from the session cache")

    monkeypatch.setattr(tools, "_fetch_startup_context_text", fail_fetch)

    assert tools.build_startup_context(session_id="telegram-session", is_first_turn=False) == {
        "context": "Forge context for this session:\n- Operator: Albert"
    }
    assert tools.build_startup_context(session_id="telegram-session", is_first_turn=True) == {
        "context": "Forge context for this session:\n- Operator: Albert"
    }


def test_clear_startup_context_removes_cached_session():
    tools.SESSION_STARTUP_CONTEXTS["telegram-session"] = "cached"

    tools.clear_startup_context(session_id="telegram-session")

    assert "telegram-session" not in tools.SESSION_STARTUP_CONTEXTS


def test_start_gateway_runtime_presence_registers_single_gateway_session(
    monkeypatch: pytest.MonkeyPatch,
):
    calls: list[tuple[str, str]] = []

    monkeypatch.setattr(tools.sys, "argv", ["hermes", "gateway", "run"])
    monkeypatch.setattr(
        tools,
        "_register_runtime_session",
        lambda session_id="": calls.append(("register", session_id)) or "ags_gateway",
    )
    monkeypatch.setattr(
        tools,
        "_append_runtime_session_event",
        lambda session_id="", **kwargs: calls.append(("event", session_id)),
    )
    monkeypatch.setattr(
        tools,
        "_heartbeat_runtime_session",
        lambda session_id="", summary="", metadata=None: calls.append(("heartbeat", session_id)),
    )

    thread_starts: list[str] = []

    class FakeThread:
        def __init__(self, target=None, args=(), name="", daemon=False):
            self.target = target
            self.args = args
            self.name = name
            self.daemon = daemon
            self._alive = False

        def start(self):
            self._alive = True
            thread_starts.append(self.name)

        def is_alive(self):
            return self._alive

    monkeypatch.setattr(tools.threading, "Thread", FakeThread)
    monkeypatch.setattr(tools.atexit, "register", lambda fn: None)

    tools.start_gateway_runtime_presence()
    tools.start_gateway_runtime_presence()

    assert calls == [
        ("register", "gateway:main"),
        ("event", "gateway:main"),
        ("heartbeat", "gateway:main"),
    ]
    assert thread_starts == ["forge-hermes-gateway-heartbeat"]


def test_start_gateway_runtime_presence_skips_non_gateway_process(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(tools.sys, "argv", ["hermes", "--message", "hi"])

    called = False

    def fail_register(session_id=""):
        nonlocal called
        called = True
        raise AssertionError("gateway registration should not run outside the gateway process")

    monkeypatch.setattr(tools, "_register_runtime_session", fail_register)

    tools.start_gateway_runtime_presence()

    assert called is False


def test_runtime_agent_identity_key_is_stable_for_same_runtime():
    config = tools.ForgeConfig(
        origin="http://127.0.0.1",
        port=4317,
        base_url="http://127.0.0.1:4317",
        web_app_url="http://127.0.0.1:4317/forge/",
        data_root="/tmp/forge",
        api_token="",
        actor_label="",
        timeout_ms=15000,
    )

    first = tools._stable_agent_identity_key(config)
    second = tools._stable_agent_identity_key(config)

    assert first == second
    assert first.startswith("runtime:hermes:machine_")


def test_register_skips_hooks_missing_from_current_hermes(monkeypatch: pytest.MonkeyPatch):
    registered_hooks: list[str] = []

    class FakeContext:
        def register_tool(self, **_kwargs):
            return None

        def register_hook(self, hook_name, _handler):
            registered_hooks.append(hook_name)

        def register_skill(self, _skill_name, _source):
            return None

    monkeypatch.setattr(forge_hermes, "_hook_is_supported", lambda hook_name: hook_name != "gateway:startup")

    forge_hermes.register(FakeContext())

    assert "gateway:startup" not in registered_hooks
    assert {
        "on_session_start",
        "pre_llm_call",
        "on_session_finalize",
        "on_session_reset",
    }.issubset(set(registered_hooks))


def test_register_publishes_every_bundled_conversation_skill(
    monkeypatch: pytest.MonkeyPatch,
):
    registered_skills: dict[str, object] = {}

    class FakeContext:
        def register_tool(self, **_kwargs):
            return None

        def register_hook(self, _hook_name, _handler):
            return None

        def register_skill(self, skill_name, source):
            registered_skills[skill_name] = source

    monkeypatch.setattr(forge_hermes, "_hook_is_supported", lambda _name: True)
    monkeypatch.setattr(tools, "start_gateway_runtime_presence", lambda: None)

    forge_hermes.register(FakeContext())

    assert set(registered_skills) == {
        "forge-hermes",
        "entity-conversation-playbooks",
        "psyche-entity-playbooks",
    }
    for source in registered_skills.values():
        assert source.exists()
        assert source.stat().st_size > 1_000
