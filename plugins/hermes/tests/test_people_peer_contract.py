from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

import pytest

from forge_hermes import tools
from forge_hermes.catalog import (
    PEER_AGENT_ROUTE_SPECS,
    PEOPLE_AGENT_ROUTE_SPECS,
    TOOL_CATALOG,
)


FORGE_ROOT = Path(__file__).resolve().parents[3]


def _server_contract() -> dict[str, Any]:
    script = r"""
import { zodToJsonSchema } from "zod-to-json-schema";
import { PEER_API_SCHEMAS } from "./apps/api/src/peer-api-schemas.ts";
import { PEER_ROUTE_CONTRACTS } from "./apps/api/src/peer-route-contract.ts";
const routes = PEER_ROUTE_CONTRACTS.map((route) => ({
  operationId: route.operationId,
  method: route.method,
  path: route.path,
  requiredScopes: [...route.requiredScopes],
  principalClasses: [...route.principalClasses],
  humanOnly: route.humanOnly,
  mcpExposed: route.mcpExposed
}));
const schemas = Object.fromEntries(
  routes.filter((route) => route.mcpExposed).map((route) => {
    const schema = PEER_API_SCHEMAS[route.operationId];
    return [route.operationId, {
      params: zodToJsonSchema(schema.params),
      query: zodToJsonSchema(schema.query),
      body: schema.body ? zodToJsonSchema(schema.body) : null
    }];
  })
);
process.stdout.write(JSON.stringify({ routes, schemas }));
"""
    completed = subprocess.run(
        ["node", "--import", "tsx", "--input-type=module", "-e", script],
        cwd=FORGE_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


def _resolve_pointer(root: Any, pointer: str) -> Any:
    if pointer == "#":
        return root
    if not pointer.startswith("#/"):
        raise ValueError(f"unsupported JSON Pointer: {pointer}")
    value: Any = root
    for part in pointer[2:].split("/"):
        part = part.replace("~1", "/").replace("~0", "~")
        if isinstance(value, list):
            if not part.isascii() or not part.isdecimal() or (
                len(part) > 1 and part.startswith("0")
            ):
                raise ValueError(f"invalid JSON Pointer array index: {part}")
            value = value[int(part)]
        elif isinstance(value, dict):
            value = value[part]
        else:
            raise TypeError(f"JSON Pointer traversed a scalar at segment: {part}")
    return value


def _normalize_schema(value: Any, root: dict[str, Any]) -> Any:
    if isinstance(value, list):
        return [_normalize_schema(entry, root) for entry in value]
    if not isinstance(value, dict):
        return value
    if isinstance(value.get("$ref"), str):
        referenced = _resolve_pointer(root, value["$ref"])
        merged = {**referenced, **value}
        merged.pop("$ref", None)
        return _normalize_schema(merged, root)

    any_of = value.get("anyOf") if isinstance(value.get("anyOf"), list) else None
    if any_of and all(isinstance(entry, dict) and "const" in entry for entry in any_of):
        types = [entry.get("type") for entry in any_of]
        normalized: dict[str, Any] = {"enum": sorted(entry["const"] for entry in any_of)}
        if all(isinstance(entry, str) for entry in types) and len(set(types)) == 1:
            normalized["type"] = types[0]
        if "default" in value:
            normalized["default"] = value["default"]
        return normalized

    normalized = {
        key: value[key]
        for key in (
            "type",
            "minLength",
            "maxLength",
            "minimum",
            "maximum",
            "pattern",
            "format",
            "minItems",
            "maxItems",
            "default",
        )
        if key in value
    }
    if isinstance(value.get("enum"), list):
        normalized["enum"] = sorted(value["enum"])
    if isinstance(value.get("required"), list):
        normalized["required"] = sorted(value["required"])
    if isinstance(value.get("properties"), dict):
        normalized["properties"] = {
            key: _normalize_schema(child, root)
            for key, child in sorted(value["properties"].items())
        }
    if "items" in value:
        normalized["items"] = _normalize_schema(value["items"], root)
    if any_of:
        normalized["anyOf"] = sorted(
            (_normalize_schema(entry, root) for entry in any_of),
            key=lambda entry: json.dumps(entry, sort_keys=True),
        )
    if value.get("additionalProperties") is False:
        normalized["additionalProperties"] = False
    elif isinstance(value.get("additionalProperties"), dict):
        normalized["additionalProperties"] = _normalize_schema(
            value["additionalProperties"], root
        )
    elif isinstance(value.get("patternProperties"), dict) and len(
        value["patternProperties"]
    ) == 1:
        normalized["additionalProperties"] = _normalize_schema(
            next(iter(value["patternProperties"].values())), root
        )
    return normalized


def _normalize_root(schema: dict[str, Any]) -> Any:
    return _normalize_schema(schema, schema)


def test_hermes_exposes_exactly_the_mcp_allowlist_with_exact_contract_metadata():
    server = _server_contract()
    expected = sorted(
        (route for route in server["routes"] if route["mcpExposed"]),
        key=lambda route: route["operationId"],
    )
    actual = sorted(
        (
            {
                key: route[key]
                for key in (
                    "operationId",
                    "method",
                    "path",
                    "requiredScopes",
                    "principalClasses",
                    "humanOnly",
                    "mcpExposed",
                )
            }
            for route in {
                **PEOPLE_AGENT_ROUTE_SPECS,
                **PEER_AGENT_ROUTE_SPECS,
            }.values()
        ),
        key=lambda route: route["operationId"],
    )
    assert actual == expected
    assert len(actual) == 15
    assert all("agent_token" in route["principalClasses"] for route in actual)
    assert not any(route["humanOnly"] for route in actual)


def test_hermes_people_peer_parameters_match_every_server_zod_schema():
    server = _server_contract()
    for operation_id, route in {
        **PEOPLE_AGENT_ROUTE_SPECS,
        **PEER_AGENT_ROUTE_SPECS,
    }.items():
        expected = server["schemas"][operation_id]
        assert _normalize_root(route["params"]) == _normalize_root(
            expected["params"]
        ), operation_id
        assert _normalize_root(route["query"]) == _normalize_root(
            expected["query"]
        ), operation_id
        if expected["body"] is None:
            assert "body" not in route
        else:
            assert _normalize_root(route["body"]) == _normalize_root(
                expected["body"]
            ), operation_id


def test_hermes_tool_schemas_exclude_all_human_only_peer_actions():
    server = _server_contract()
    specs = {spec["name"]: spec for spec in TOOL_CATALOG}
    published = {
        variant["properties"]["routeKey"]["const"]
        for tool_name in ("forge_call_people_route", "forge_call_peer_route")
        for variant in specs[tool_name]["parameters"]["oneOf"]
    }
    expected = {
        route["operationId"] for route in server["routes"] if route["mcpExposed"]
    }
    forbidden = {
        route["operationId"]
        for route in server["routes"]
        if route["humanOnly"] or not route["mcpExposed"]
    }
    assert published == expected
    assert published.isdisjoint(forbidden)
    assert "requestPeerResync" in forbidden
    assert "requestPeerResync" not in published
    assert "cannot pair Forge installations" in specs["forge_call_people_route"]["description"]
    assert "redactedFields" in specs["forge_call_people_route"]["description"]
    assert "never infer withheld fields" in specs["forge_call_people_route"]["description"]
    assert "cannot create or accept pairing" in specs["forge_call_peer_route"]["description"]
    assert "request a resync" in specs["forge_call_peer_route"]["description"]


def test_hermes_people_reads_require_a_configured_agent_token(
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
    result = json.loads(
        tools.build_handler("forge_call_people_route")(
            {"routeKey": "listPeopleReadModel"}
        )
    )
    assert result["error"]["code"] == "forge_scoped_agent_token_required"
    assert "operator session cannot substitute" in result["error"]["message"]


def test_hermes_people_and_peer_handlers_forward_exact_requests(
    monkeypatch: pytest.MonkeyPatch,
):
    config = tools.ForgeConfig(
        origin="http://127.0.0.1",
        port=4317,
        base_url="http://127.0.0.1:4317",
        web_app_url="http://127.0.0.1:4317/forge/",
        data_root="",
        api_token="fg_live_people_peer_test",
        actor_label="contract-test",
        timeout_ms=4000,
    )
    monkeypatch.setattr(tools, "_load_config", lambda: config)
    monkeypatch.setattr(tools, "_ensure_runtime", lambda current: current)
    calls: list[dict[str, Any]] = []

    def fake_request(
        current: tools.ForgeConfig,
        method: str,
        path: str,
        body: Any = None,
        write: bool | None = None,
        **_kwargs: Any,
    ) -> dict[str, bool]:
        calls.append(
            {
                "config": current,
                "method": method,
                "path": path,
                "body": body,
                "write": write,
            }
        )
        return {"accepted": True}

    monkeypatch.setattr(tools, "_request_json", fake_request)

    people = tools.build_handler("forge_call_people_route")
    peers = tools.build_handler("forge_call_peer_route")
    assert json.loads(
        people(
            {
                "routeKey": "listPeopleReadModel",
                "query": {"query": "Jon Doe", "source": "shared", "limit": 10},
            }
        )
    ) == {"accepted": True}

    question_body = {
        "question": "What is Jon doing next Monday?",
        "timeZone": "Europe/Zurich",
        "referenceTime": "2026-07-15T12:00:00.000+02:00",
    }
    assert json.loads(
        people(
            {
                "routeKey": "interpretPersonQuestion",
                "pathParams": {"personId": "person/jon"},
                "body": question_body,
            }
        )
    ) == {"accepted": True}

    assert json.loads(
        peers(
            {
                "routeKey": "listPeerRelationships",
                "query": {"status": "active", "limit": 10},
            }
        )
    ) == {"accepted": True}

    assert all(call["config"].api_token == config.api_token for call in calls)
    assert calls == [
        {
            "config": config,
            "method": "GET",
            "path": "/api/v1/people?query=Jon+Doe&source=shared&limit=10",
            "body": None,
            "write": False,
        },
        {
            "config": config,
            "method": "POST",
            "path": "/api/v1/people/person%2Fjon/questions/interpret",
            "body": question_body,
            "write": True,
        },
        {
            "config": config,
            "method": "GET",
            "path": "/api/v1/peers/relationships?status=active&limit=10",
            "body": None,
            "write": False,
        },
    ]


def test_person_is_named_in_hermes_catalog_and_shared_playbook():
    skill = (FORGE_ROOT / "plugins/hermes/skill.md").read_text(encoding="utf-8")
    playbook = (
        FORGE_ROOT / "plugins/hermes/forge_hermes/entity_conversation_playbooks.md"
    ).read_text(encoding="utf-8")
    assert "`person`" in skill
    assert "## Person" in playbook
    assert "forge_call_people_route" in skill
    assert "forge_call_peer_route" in skill
