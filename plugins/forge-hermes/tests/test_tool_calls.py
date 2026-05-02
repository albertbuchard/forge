from __future__ import annotations

import json

import pytest

from forge_hermes import tools
from forge_hermes.catalog import (
    LIFE_FORCE_ROUTE_SPECS,
    MOVEMENT_ROUTE_SPECS,
    TOOL_CATALOG,
    WORKBENCH_ROUTE_SPECS,
    release_task_run_body,
    release_task_run_path,
    specialized_route_path,
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

        def close(self) -> None:
            return None

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


def test_update_entities_tool_description_mentions_habit_checkins():
    spec = next(tool for tool in TOOL_CATALOG if tool["name"] == "forge_update_entities")
    description = spec["description"]

    assert "habit.patch.checkIn" in description
    assert "official habit outcome logging" in description


def test_specialized_domain_tools_are_explicit_route_key_tools():
    specs = {tool["name"]: tool for tool in TOOL_CATALOG}

    assert set(
        specs["forge_call_movement_route"]["parameters"]["properties"]["routeKey"]["enum"]
    ) >= {
        "timeline",
        "places",
        "tripDetail",
        "selection",
        "userBoxPreflight",
        "userBoxCreate",
        "automaticBoxInvalidate",
        "stayUpdate",
        "tripPointUpdate",
    }
    assert specs["forge_call_life_force_route"]["parameters"]["properties"]["routeKey"][
        "enum"
    ] == ["fatigueSignal", "overview", "profile", "weekdayTemplate"]
    assert set(
        specs["forge_call_workbench_route"]["parameters"]["properties"]["routeKey"]["enum"]
    ) >= {
        "boxCatalog",
        "listFlows",
        "createFlow",
        "runFlow",
        "publishedOutput",
        "runDetail",
        "nodeResult",
        "latestNodeOutput",
    }

    assert specialized_route_path(
        LIFE_FORCE_ROUTE_SPECS,
        {"routeKey": "weekdayTemplate", "pathParams": {"weekday": "monday"}},
    ) == "/api/v1/life-force/templates/monday"
    assert specialized_route_path(
        MOVEMENT_ROUTE_SPECS,
        {
            "routeKey": "tripPointUpdate",
            "pathParams": {"id": "trip 1", "pointId": "point/2"},
        },
    ) == "/api/v1/movement/trips/trip%201/points/point%2F2"
    assert specialized_route_path(
        WORKBENCH_ROUTE_SPECS,
        {
            "routeKey": "latestNodeOutput",
            "pathParams": {"id": "flow_123", "nodeId": "node_456"},
            "query": {"format": "json", "userIds": ["user_a", "user_b"]},
        },
    ) == (
        "/api/v1/workbench/flows/flow_123/nodes/node_456/output"
        "?format=json&userIds=user_a&userIds=user_b"
    )


def test_life_force_route_handler_uses_dedicated_put_route(
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

        def close(self) -> None:
            return None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    def fake_urlopen(req, timeout=0):  # noqa: ANN001 - urllib request object
        body = json.loads(req.data.decode("utf-8")) if req.data else None
        calls.append(
            {
                "url": req.full_url,
                "method": req.get_method(),
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
        if req.full_url.endswith("/api/v1/life-force/templates/monday"):
            return FakeResponse({"lifeForce": {"weekday": "monday"}})
        raise AssertionError(f"Unexpected Hermes request: {req.full_url}")

    monkeypatch.setattr(tools.request, "urlopen", fake_urlopen)

    handler = tools.build_handler("forge_call_life_force_route")
    payload = json.loads(
        handler(
            {
                "routeKey": "weekdayTemplate",
                "pathParams": {"weekday": "monday"},
                "body": {"points": [{"hour": 13, "freeAp": -4}]},
            }
        )
    )

    assert payload == {"lifeForce": {"weekday": "monday"}}
    assert [call["url"] for call in calls] == [
        "http://127.0.0.1:4317/api/v1/auth/operator-session",
        "http://127.0.0.1:4317/api/v1/life-force/templates/monday",
    ]
    assert calls[1]["method"] == "PUT"
    assert calls[1]["body"] == {"points": [{"hour": 13, "freeAp": -4}]}
    assert all("/api/v1/entities" not in str(call["url"]) for call in calls)


def test_update_entities_handler_uses_batch_route_for_habit_checkins(
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

        def close(self) -> None:
            return None

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
        if req.full_url.endswith("/api/v1/entities/update"):
            return FakeResponse({"results": [{"entityType": "habit", "id": "habit_123"}]})
        raise AssertionError(f"Unexpected Hermes request: {req.full_url}")

    monkeypatch.setattr(tools.request, "urlopen", fake_urlopen)

    handler = tools.build_handler("forge_update_entities")
    payload = json.loads(
        handler(
            {
                "operations": [
                    {
                        "entityType": "habit",
                        "id": "habit_123",
                        "patch": {
                            "checkIn": {
                                "status": "missed",
                                "note": "Resisted the bad habit after dinner.",
                                "description": "85 sec reset",
                            }
                        },
                    }
                ]
            }
        )
    )

    assert payload == {"results": [{"entityType": "habit", "id": "habit_123"}]}
    assert [call["url"] for call in calls] == [
        "http://127.0.0.1:4317/api/v1/auth/operator-session",
        "http://127.0.0.1:4317/api/v1/entities/update",
    ]
    assert all("/api/v1/habits/" not in str(call["url"]) for call in calls)
    assert calls[1]["body"] == {
        "operations": [
            {
                "entityType": "habit",
                "id": "habit_123",
                "patch": {
                    "checkIn": {
                        "status": "missed",
                        "note": "Resisted the bad habit after dinner.",
                        "description": "85 sec reset",
                    }
                },
            }
        ]
    }


def test_auth_required_errors_include_habit_guidance(
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

    class FakeResponse:
        def __init__(self, body: object, headers: dict[str, str] | None = None):
            self._body = json.dumps(body).encode("utf-8")
            self.headers = headers or {}

        def read(self) -> bytes:
            return self._body

        def close(self) -> None:
            return None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    def fake_urlopen(req, timeout=0):  # noqa: ANN001 - urllib request object
        if req.full_url.endswith("/api/v1/auth/operator-session"):
            return FakeResponse(
                {"session": {"id": "ses_local", "actorLabel": "Albert"}},
                headers={
                    "Set-Cookie": "forge_operator_session=fg_session_cookie; Path=/; HttpOnly"
                },
            )

        payload = json.dumps(
            {
                "error": {
                    "code": "auth_required",
                    "message": "A token or operator session is required.",
                }
            }
        ).encode("utf-8")
        raise tools.error.HTTPError(
            req.full_url,
            401,
            "Unauthorized",
            hdrs=None,
            fp=FakeResponse({"error": {"code": "auth_required", "message": "A token or operator session is required."}}),
        )

    monkeypatch.setattr(tools.request, "urlopen", fake_urlopen)

    handler = tools.build_handler("forge_update_entities")
    payload = json.loads(
        handler(
            {
                "operations": [
                    {
                        "entityType": "habit",
                        "id": "habit_123",
                        "patch": {"checkIn": {"status": "missed"}},
                    }
                ]
            }
        )
    )

    assert payload["error"]["code"] == "forge_http_401"
    assert "forge_get_agent_onboarding" in payload["error"]["message"]
    assert "forge_update_entities" in payload["error"]["message"]
    assert "patch.checkIn" in payload["error"]["message"]
