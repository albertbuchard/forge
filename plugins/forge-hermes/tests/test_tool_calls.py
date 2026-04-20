from __future__ import annotations

import json

import pytest

from forge_hermes import tools
from forge_hermes.catalog import (
    release_task_run_body,
    release_task_run_path,
    start_task_run_body,
    start_task_run_path,
)


@pytest.fixture(autouse=True)
def clear_runtime_state():
    tools.SESSION_COOKIES.clear()
    tools.SESSION_STARTUP_CONTEXTS.clear()
    tools.SESSION_RUNTIME_IDS.clear()
    tools.SESSION_ACTOR_LABELS.clear()
    yield
    tools.SESSION_COOKIES.clear()
    tools.SESSION_STARTUP_CONTEXTS.clear()
    tools.SESSION_RUNTIME_IDS.clear()
    tools.SESSION_ACTOR_LABELS.clear()


def test_start_task_run_body_normalizes_unlimited_mode():
    assert start_task_run_path({"taskId": " task_123 "}) == "/api/v1/tasks/task_123/runs"
    assert start_task_run_body(
        {
            "actor": "  Albert  ",
            "timerMode": "unlimited",
            "plannedDurationSeconds": 1200,
            "note": "  Focus block  ",
        },
        None,
    ) == {
        "actor": "Albert",
        "timerMode": "unlimited",
        "plannedDurationSeconds": None,
        "note": "Focus block",
    }


def test_start_task_run_body_requires_duration_for_planned_mode():
    with pytest.raises(
        ValueError,
        match="forge_start_task_run requires plannedDurationSeconds when timerMode is planned",
    ):
        start_task_run_body(
            {
                "actor": "Albert",
                "timerMode": "planned",
            },
            None,
        )


def test_release_task_run_body_omits_empty_optionals():
    assert release_task_run_path({"taskRunId": " run_123 "}) == "/api/v1/task-runs/run_123/release"
    assert release_task_run_body({"actor": "  Albert  ", "note": "  stop now  "}, None) == {
        "actor": "Albert",
        "note": "stop now",
    }


def test_start_task_run_handler_uses_operator_session_and_task_run_route(
    monkeypatch: pytest.MonkeyPatch,
):
    config = tools.ForgeConfig(
        origin="http://127.0.0.1",
        port=4317,
        base_url="http://127.0.0.1:4317",
        web_app_url="http://127.0.0.1:4317/forge/",
        data_root="",
        api_token="",
        actor_label="",
        timeout_ms=4000,
    )
    monkeypatch.setattr(tools, "_load_config", lambda: config)
    monkeypatch.setattr(tools, "_ensure_runtime", lambda current: current)

    calls: list[dict[str, object]] = []

    class FakeResponse:
        def __init__(self, body: object, headers: dict[str, str] | None = None):
            self._body = json.dumps(body).encode("utf-8")
            self.headers = headers or {}

        def read(self) -> bytes:
            return self._body

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    def fake_urlopen(req, timeout=0):  # noqa: ANN001 - urllib request object
        body = json.loads(req.data.decode("utf-8")) if req.data else None
        headers = dict(req.header_items())
        calls.append(
            {
                "url": req.full_url,
                "method": req.get_method(),
                "headers": headers,
                "body": body,
            }
        )
        if req.full_url.endswith("/api/v1/auth/operator-session"):
            return FakeResponse(
                {"session": {"id": "ses_local", "actorLabel": "Albert"}},
                headers={
                    "Set-Cookie": "forge_operator_session=fg_session_cookie; Path=/; HttpOnly"
                },
            )
        if req.full_url.endswith("/api/v1/tasks/task_123/runs"):
            return FakeResponse({"taskRun": {"id": "run_123"}})
        raise AssertionError(f"Unexpected Hermes request: {req.full_url}")

    monkeypatch.setattr(tools.request, "urlopen", fake_urlopen)

    handler = tools.build_handler("forge_start_task_run")
    payload = json.loads(
        handler(
            {
                "taskId": " task_123 ",
                "actor": "  Albert  ",
                "timerMode": "unlimited",
                "plannedDurationSeconds": 1200,
                "note": "  Focus block  ",
            }
        )
    )

    assert payload == {"taskRun": {"id": "run_123"}}
    assert [call["url"] for call in calls] == [
        "http://127.0.0.1:4317/api/v1/auth/operator-session",
        "http://127.0.0.1:4317/api/v1/tasks/task_123/runs",
    ]
    assert all("/forge/" not in str(call["url"]) for call in calls)
    assert calls[1]["body"] == {
        "actor": "Albert",
        "timerMode": "unlimited",
        "plannedDurationSeconds": None,
        "note": "Focus block",
    }
