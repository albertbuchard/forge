from __future__ import annotations

import json

from forge_hermes import tools
from forge_hermes.catalog import TOOL_CATALOG


def test_food_log_edit_catalog_uses_exact_scoped_patch_contract():
    spec = next(
        tool for tool in TOOL_CATALOG if tool["name"] == "forge_update_food_log"
    )
    schema = spec["parameters"]

    assert spec["method"] == "PATCH"
    assert spec["write"] is True
    assert schema["additionalProperties"] is False
    assert schema["required"] == ["foodLogId"]
    assert schema["properties"]["foodLogId"]["minLength"] == 1
    assert "items" not in schema["required"]
    assert "dayKey" in schema["properties"]
    assert "parserProvenance" in schema["properties"]
    assert "satietyScore" not in schema["properties"]
    assert spec["path_builder"](
        {
            "foodLogId": " meal/123 ",
            "userIds": ["user_albert"],
        }
    ) == (
        "/api/v1/health/weight-loss/food-logs/meal%2F123"
        "?userIds=user_albert"
    )
    assert spec["body_builder"](
        {
            "foodLogId": "meal_123",
            "userIds": ["user_albert"],
            "mealLabel": "Corrected lunch",
        },
        None,
    ) == {"mealLabel": "Corrected lunch"}


def test_food_log_edit_handler_sends_only_the_exact_patch(monkeypatch):
    config = tools.ForgeConfig(
        origin="http://127.0.0.1",
        port=4317,
        base_url="http://127.0.0.1:4317",
        web_app_url="http://127.0.0.1:4317/forge/",
        data_root="/tmp/forge-test",
        api_token="fg_scoped_test",
        actor_label="Hermes",
        timeout_ms=15_000,
    )
    calls: list[dict[str, object]] = []

    monkeypatch.setattr(tools, "_load_config", lambda: config)
    monkeypatch.setattr(tools, "_ensure_runtime", lambda current: current)

    def fake_request(current, method, path, body=None, write=None):
        assert current is config
        calls.append(
            {
                "method": method,
                "path": path,
                "body": body,
                "write": write,
            }
        )
        return {
            "log": {
                "id": "meal_123",
                "mealLabel": "Corrected lunch",
            }
        }

    monkeypatch.setattr(tools, "_request_json", fake_request)

    payload = json.loads(
        tools.build_handler("forge_update_food_log")(
            {
                "foodLogId": "meal_123",
                "userIds": ["user_albert"],
                "mealLabel": "Corrected lunch",
                "notes": "Corrected after reviewing the original log",
            }
        )
    )

    assert payload == {
        "log": {
            "id": "meal_123",
            "mealLabel": "Corrected lunch",
        }
    }
    assert calls == [
        {
            "method": "PATCH",
            "path": (
                "/api/v1/health/weight-loss/food-logs/meal_123"
                "?userIds=user_albert"
            ),
            "body": {
                "mealLabel": "Corrected lunch",
                "notes": "Corrected after reviewing the original log",
            },
            "write": True,
        }
    ]
