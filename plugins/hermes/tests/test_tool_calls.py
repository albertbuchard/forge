from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from forge_hermes import tools
from forge_hermes.catalog import (
    ATTENTION_ROUTE_SPECS,
    ENTITY_NAVIGATION_ROUTE_SPECS,
    LIFE_FORCE_ROUTE_SPECS,
    MOVEMENT_ROUTE_SPECS,
    TOOL_CATALOG,
    WORKBENCH_ROUTE_EXAMPLES,
    WORKBENCH_ROUTE_SPECS,
    release_task_run_body,
    release_task_run_path,
    sports_overview_path,
    specialized_route_path,
    start_task_run_body,
    start_task_run_path,
)


HERMES_PLUGIN_ROOT = Path(__file__).resolve().parents[1]


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


def test_sports_overview_path_uses_compact_aggregates():
    assert sports_overview_path({}) == "/api/v1/health/fitness?compact=1"
    assert sports_overview_path(
        {"userIds": ["user_operator", "user_coach"]}
    ) == (
        "/api/v1/health/fitness?userIds=user_operator"
        "&userIds=user_coach&compact=1"
    )


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


def test_live_contract_descriptions_prevent_catalog_and_update_drift():
    specs = {tool["name"]: tool for tool in TOOL_CATALOG}
    onboarding = specs["forge_get_agent_onboarding"]["description"]
    create = specs["forge_create_entities"]["description"]
    update = specs["forge_update_entities"]["description"]

    assert "before the first Forge read or write" in onboarding
    assert "entityCatalog" in onboarding
    assert "required fields" in onboarding
    assert "question flows" in onboarding
    assert "route keys, methods, paths, and placeholders" in onboarding
    assert "data.level" in create
    assert "never entityType issue or subtask" in create
    assert "after reading the current record" in update
    assert "Preserve omitted fields" in update
    assert "patch.level" in update


def test_hermes_source_and_packaged_skill_contracts_are_identical():
    assert (HERMES_PLUGIN_ROOT / "skill.md").read_text() == (
        HERMES_PLUGIN_ROOT / "forge_hermes" / "skill.md"
    ).read_text()


def test_nutrition_experiment_tools_publish_the_full_api_contract():
    specs = {tool["name"]: tool for tool in TOOL_CATALOG}
    create_properties = specs["forge_start_nutrition_experiment"]["parameters"][
        "properties"
    ]
    update_properties = specs["forge_update_nutrition_experiment"]["parameters"][
        "properties"
    ]

    assert set(
        specs["forge_start_nutrition_experiment"]["parameters"]["required"]
    ) == {"title", "hypothesis", "metricKey", "intervention"}
    assert {
        "baselineStart",
        "baselineEnd",
        "experimentStart",
        "experimentEnd",
        "status",
        "successCriteria",
        "confounders",
    } <= set(create_properties)
    assert {
        "title",
        "hypothesis",
        "metricKey",
        "intervention",
        "baselineStart",
        "baselineEnd",
        "experimentStart",
        "experimentEnd",
        "status",
        "successCriteria",
        "confounders",
        "conclusion",
    } <= set(update_properties)
    assert "paused" in create_properties["status"]["enum"]
    assert "paused" in update_properties["status"]["enum"]


def test_specialized_domain_tools_are_explicit_route_key_tools():
    specs = {tool["name"]: tool for tool in TOOL_CATALOG}

    assert specs["forge_call_attention_route"]["parameters"]["properties"]["routeKey"][
        "enum"
    ] == ["dismiss", "list", "restore", "snooze"]
    assert specs["forge_call_entity_navigation_route"]["parameters"]["properties"][
        "routeKey"
    ]["enum"] == ["list", "touch"]
    assert set(
        specs["forge_call_movement_route"]["parameters"]["properties"]["routeKey"]["enum"]
    ) >= {
        "day",
        "month",
        "allTime",
        "timeline",
        "places",
        "boxDetail",
        "tripDetail",
        "selection",
        "settings",
        "settingsUpdate",
        "placeCreate",
        "placeUpdate",
        "userBoxPreflight",
        "userBoxCreate",
        "userBoxUpdate",
        "userBoxDelete",
        "automaticBoxInvalidate",
        "stayUpdate",
        "stayDelete",
        "tripUpdate",
        "tripDelete",
        "tripPointUpdate",
        "tripPointDelete",
    }
    assert specs["forge_call_life_force_route"]["parameters"]["properties"]["routeKey"][
        "enum"
    ] == ["fatigueSignal", "overview", "profile", "weekdayTemplate"]
    assert set(
        specs["forge_call_workbench_route"]["parameters"]["properties"]["routeKey"]["enum"]
    ) >= {
        "boxCatalog",
        "listFlows",
        "flowById",
        "flowBySlug",
        "createFlow",
        "updateFlow",
        "deleteFlow",
        "runFlow",
        "runByPayload",
        "chatFlow",
        "publishedOutput",
        "runs",
        "runDetail",
        "runNodes",
        "nodeResult",
        "latestNodeOutput",
    }
    attention_route_description = specs["forge_call_attention_route"]["parameters"][
        "properties"
    ]["routeKey"]["description"]
    entity_navigation_route_description = specs[
        "forge_call_entity_navigation_route"
    ]["parameters"]["properties"]["routeKey"]["description"]
    movement_route_description = specs["forge_call_movement_route"]["parameters"][
        "properties"
    ]["routeKey"]["description"]
    life_force_route_description = specs["forge_call_life_force_route"]["parameters"][
        "properties"
    ]["routeKey"]["description"]
    workbench_route_description = specs["forge_call_workbench_route"]["parameters"][
        "properties"
    ]["routeKey"]["description"]
    assert "list: GET /api/v1/attention-inbox" in attention_route_description
    assert (
        "list: GET /api/v1/entity-navigation"
        in entity_navigation_route_description
    )
    assert (
        "touch: POST /api/v1/entity-navigation/touch"
        in entity_navigation_route_description
    )
    assert (
        "snooze: POST /api/v1/attention-inbox/:id/snooze"
        in attention_route_description
    )
    assert "day: GET /api/v1/movement/day" in movement_route_description
    assert "userBoxCreate: POST /api/v1/movement/user-boxes" in movement_route_description
    assert (
        "tripPointDelete: DELETE /api/v1/movement/trips/:id/points/:pointId"
        in movement_route_description
    )
    assert "overview: GET /api/v1/life-force" in life_force_route_description
    assert (
        "weekdayTemplate: PUT /api/v1/life-force/templates/:weekday"
        in life_force_route_description
    )
    assert "listFlows: GET /api/v1/workbench/flows" in workbench_route_description
    assert "runFlow: POST /api/v1/workbench/flows/:id/run" in workbench_route_description
    assert (
        "latestNodeOutput: GET /api/v1/workbench/flows/:id/nodes/:nodeId/output"
        in workbench_route_description
    )
    for tool_name in [
        "forge_call_attention_route",
        "forge_call_entity_navigation_route",
        "forge_call_movement_route",
        "forge_call_life_force_route",
        "forge_call_workbench_route",
    ]:
        properties = specs[tool_name]["parameters"]["properties"]
        assert (
            "fill pathParams with that exact placeholder name"
            in properties["routeKey"]["description"]
        )
        assert (
            "do not put raw paths or ids into routeKey"
            in properties["routeKey"]["description"]
        )
        assert (
            "Use the exact :placeholder names shown in the routeKey description"
            in properties["pathParams"]["description"]
        )

    assert specialized_route_path(
        ATTENTION_ROUTE_SPECS,
        {"routeKey": "restore", "pathParams": {"id": "attn:task/task 1"}},
    ) == "/api/v1/attention-inbox/attn%3Atask%2Ftask%201/restore"
    assert specialized_route_path(
        ENTITY_NAVIGATION_ROUTE_SPECS,
        {"routeKey": "touch"},
    ) == "/api/v1/entity-navigation/touch"
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


def _extract_published_workbench_execution_examples(skill_path: Path):
    text = skill_path.read_text(encoding="utf-8")
    labels = (
        "Workbench run execution",
        "Workbench one-off input execution",
        "Workbench flow chat follow-up",
    )
    examples = []
    for label in labels:
        match = re.search(
            rf"^- {re.escape(label)}:\n\s+`(?P<payload>\{{.*\}})`$",
            text,
            flags=re.MULTILINE,
        )
        assert match is not None, f"Missing published example: {label} in {skill_path}"
        examples.append(json.loads(match.group("payload")))
    return examples


def test_published_workbench_examples_execute_with_exact_api_fields(
    monkeypatch: pytest.MonkeyPatch,
):
    tool_spec = next(
        spec for spec in TOOL_CATALOG if spec["name"] == "forge_call_workbench_route"
    )
    expected_examples = WORKBENCH_ROUTE_EXAMPLES
    config = tools.ForgeConfig(
        origin="http://127.0.0.1",
        port=4317,
        base_url="http://127.0.0.1:4317",
        web_app_url="http://127.0.0.1:4317/forge/",
        data_root="",
        api_token="token",
        actor_label="Albert",
        timeout_ms=4000,
    )
    monkeypatch.setattr(tools, "_load_config", lambda: config)
    monkeypatch.setattr(tools, "_ensure_runtime", lambda current: current)
    calls = []

    def fake_request(current, method, path, body=None, write=None, **_kwargs):  # noqa: ANN001
        calls.append((method, path, body))
        if method == "POST":
            return {
                "flow": {"id": "flow_research_digest"},
                "run": {"id": f"run_{len(calls)}"},
            }
        if method == "GET":
            return {"run": {"id": path.rsplit("/", 1)[-1], "status": "completed"}}
        raise AssertionError(f"Unexpected request: {method} {path}")

    monkeypatch.setattr(tools, "_request_json", fake_request)

    assert tool_spec["parameters"]["examples"] == expected_examples
    for skill_path in (
        HERMES_PLUGIN_ROOT / "skill.md",
        HERMES_PLUGIN_ROOT / "forge_hermes" / "skill.md",
    ):
        assert _extract_published_workbench_execution_examples(
            skill_path
        ) == expected_examples

    expected_routes = {
        "runFlow": "/api/v1/workbench/flows/flow_research_digest/run",
        "runByPayload": "/api/v1/workbench/run",
        "chatFlow": "/api/v1/workbench/flows/flow_research_digest/chat",
    }
    for example in expected_examples:
        route_key = example["routeKey"]
        assert tool_spec["method_builder"](example) == "POST"
        assert tool_spec["path_builder"](example) == expected_routes[route_key]
        assert tool_spec["body_builder"](example, None) == example["body"]
        result = json.loads(
            tools.build_handler("forge_call_workbench_route")(example)
        )
        assert result["verification"]["status"] == "verified"

    assert expected_examples[0]["body"] == {
        "inputs": {"topic": "question flow quality"}
    }
    assert expected_examples[1]["body"] == {
        "flowId": "flow_research_digest",
        "inputs": {"topic": "question flow quality"},
    }
    assert expected_examples[2]["body"] == {
        "userInput": "Refine the summary around API route risks and keep the published output stable."
    }
    assert [call for call in calls if call[0] == "POST"] == [
        ("POST", expected_routes[example["routeKey"]], example["body"])
        for example in expected_examples
    ]


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


def test_workbench_create_handler_reads_back_the_created_flow(
    monkeypatch: pytest.MonkeyPatch,
):
    config = tools.ForgeConfig(
        origin="http://127.0.0.1",
        port=4317,
        base_url="http://127.0.0.1:4317",
        web_app_url="http://127.0.0.1:4317/forge/",
        data_root="",
        api_token="token",
        actor_label="Albert",
        timeout_ms=4000,
    )
    monkeypatch.setattr(tools, "_load_config", lambda: config)
    monkeypatch.setattr(tools, "_ensure_runtime", lambda current: current)
    calls: list[tuple[str, str, object]] = []

    def fake_request(current, method, path, body=None, write=None, **_kwargs):  # noqa: ANN001
        calls.append((method, path, body))
        if method == "POST":
            return {"flow": {"id": "flow/123", "title": "Risk review"}}
        if method == "GET":
            return {
                "flow": {
                    "id": "flow/123",
                    "title": "Risk review",
                    "publicInputs": [],
                }
            }
        raise AssertionError(f"Unexpected request: {method} {path}")

    monkeypatch.setattr(tools, "_request_json", fake_request)

    handler = tools.build_handler("forge_call_workbench_route")
    payload = json.loads(
        handler(
            {
                "routeKey": "createFlow",
                "body": {"title": "Risk review", "kind": "functor"},
            }
        )
    )

    assert payload["flow"]["id"] == "flow/123"
    assert payload["verification"] == {
        "status": "verified",
        "routeKey": "createFlow",
        "readPath": "/api/v1/workbench/flows/flow%2F123",
        "readback": {
            "flow": {
                "id": "flow/123",
                "title": "Risk review",
                "publicInputs": [],
            }
        },
    }
    assert calls == [
        (
            "POST",
            "/api/v1/workbench/flows",
            {"title": "Risk review", "kind": "functor"},
        ),
        ("GET", "/api/v1/workbench/flows/flow%2F123", None),
    ]


def test_workbench_update_handler_reports_every_readback_mismatch(
    monkeypatch: pytest.MonkeyPatch,
):
    config = tools.ForgeConfig(
        origin="http://127.0.0.1",
        port=4317,
        base_url="http://127.0.0.1:4317",
        web_app_url="http://127.0.0.1:4317/forge/",
        data_root="",
        api_token="token",
        actor_label="Albert",
        timeout_ms=4000,
    )
    monkeypatch.setattr(tools, "_load_config", lambda: config)
    monkeypatch.setattr(tools, "_ensure_runtime", lambda current: current)
    requested_graph = {
        "nodes": [{"id": "node_summary", "type": "output", "label": "Summary"}],
        "edges": [],
    }
    requested_body = {
        "title": "  Risk review  ",
        "description": "Review API risks.",
        "kind": "functor",
        "homeSurfaceId": "overview",
        "endpointEnabled": False,
        "publicInputs": [],
        "graph": requested_graph,
    }

    def fake_request(current, method, path, body=None, write=None, **_kwargs):  # noqa: ANN001
        if method == "PATCH":
            return {"flow": {"id": "flow_123"}}
        if method == "GET":
            return {
                "flow": {
                    "id": "flow_123",
                    "title": "Risk review",
                    "description": "Review API risks.",
                    "kind": "functor",
                    "endpointEnabled": False,
                    "publicInputs": [],
                    "graph": {
                        "nodes": [
                            {
                                "id": "node_summary",
                                "type": "output",
                                "label": "Normalized summary",
                            }
                        ],
                        "edges": [],
                    },
                }
            }
        raise AssertionError(f"Unexpected request: {method} {path}")

    monkeypatch.setattr(tools, "_request_json", fake_request)

    payload = json.loads(
        tools.build_handler("forge_call_workbench_route")(
            {
                "routeKey": "updateFlow",
                "pathParams": {"id": "flow_123"},
                "body": requested_body,
            }
        )
    )

    verification = payload["verification"]
    assert verification["status"] == "failed"
    assert verification["routeKey"] == "updateFlow"
    assert verification["readPath"] == "/api/v1/workbench/flows/flow_123"
    assert verification["checkedFields"] == list(tools.WORKBENCH_MUTABLE_FLOW_FIELDS)
    assert verification["mismatches"] == [
        {
            "field": "title",
            "requested": "  Risk review  ",
            "actualPresent": True,
            "actual": "Risk review",
        },
        {
            "field": "homeSurfaceId",
            "requested": "overview",
            "actualPresent": False,
        },
        {
            "field": "graph",
            "requested": requested_graph,
            "actualPresent": True,
            "actual": {
                "nodes": [
                    {
                        "id": "node_summary",
                        "type": "output",
                        "label": "Normalized summary",
                    }
                ],
                "edges": [],
            },
        },
    ]
    assert verification["readback"] == {
        "flow": {
            "id": "flow_123",
            "title": "Risk review",
            "description": "Review API risks.",
            "kind": "functor",
            "endpointEnabled": False,
            "publicInputs": [],
            "graph": {
                "nodes": [
                    {
                        "id": "node_summary",
                        "type": "output",
                        "label": "Normalized summary",
                    }
                ],
                "edges": [],
            },
        }
    }


def test_workbench_run_handler_reports_partial_readback_failure(
    monkeypatch: pytest.MonkeyPatch,
):
    config = tools.ForgeConfig(
        origin="http://127.0.0.1",
        port=4317,
        base_url="http://127.0.0.1:4317",
        web_app_url="http://127.0.0.1:4317/forge/",
        data_root="",
        api_token="token",
        actor_label="Albert",
        timeout_ms=4000,
    )
    monkeypatch.setattr(tools, "_load_config", lambda: config)
    monkeypatch.setattr(tools, "_ensure_runtime", lambda current: current)

    def fake_request(current, method, path, body=None, write=None, **_kwargs):  # noqa: ANN001
        if method == "POST":
            return {
                "flow": {"id": "flow_123"},
                "run": {"id": "run_456", "status": "completed"},
            }
        raise tools.ForgePluginError(
            "forge_unreachable", "Forge disconnected before run verification."
        )

    monkeypatch.setattr(tools, "_request_json", fake_request)

    payload = json.loads(
        tools.build_handler("forge_call_workbench_route")(
            {
                "routeKey": "runFlow",
                "pathParams": {"id": "flow_123"},
                "body": {"inputs": {"topic": "risk"}},
            }
        )
    )

    assert payload["run"]["id"] == "run_456"
    assert payload["verification"] == {
        "status": "failed",
        "routeKey": "runFlow",
        "readPath": "/api/v1/workbench/flows/flow_123/runs/run_456",
        "error": {
            "code": "forge_unreachable",
            "message": "Forge disconnected before run verification.",
        },
    }


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
