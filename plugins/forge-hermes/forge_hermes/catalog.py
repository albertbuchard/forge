"""Shared Forge Hermes plugin tool catalog."""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from urllib.parse import quote, urlencode


JsonSchema = Dict[str, Any]
ToolSpec = Dict[str, Any]


def optional_string(description: str) -> JsonSchema:
    return {"type": "string", "description": description}


def optional_nullable_string(description: str) -> JsonSchema:
    return {
        "anyOf": [
            {"type": "string", "description": description},
            {"type": "null"},
        ]
    }


def object_schema(properties: Dict[str, Any], required: Optional[List[str]] = None) -> JsonSchema:
    schema: JsonSchema = {
        "type": "object",
        "additionalProperties": False,
        "properties": properties,
    }
    if required:
        schema["required"] = required
    return schema


def array_schema(items: JsonSchema, description: Optional[str] = None) -> JsonSchema:
    schema: JsonSchema = {"type": "array", "items": items}
    if description:
        schema["description"] = description
    return schema


def scoped_read_schema() -> JsonSchema:
    return object_schema(
        {
            "userIds": array_schema(
                {"type": "string"},
                "Optional Forge user ids to scope the read across one or more human/bot owners.",
            )
        }
    )


def with_query(path: str, args: Dict[str, Any], allowed_keys: List[str]) -> str:
    query_parts = []
    for key in allowed_keys:
        value = args.get(key)
        if isinstance(value, str) and value.strip():
            query_parts.append((key, value.strip()))
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, str) and item.strip():
                    query_parts.append((key, item.strip()))
    if not query_parts:
        return path
    return f"{path}?{urlencode(query_parts, doseq=True)}"


def _encode_query_value(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if item is not None]
    return [str(value)]


def with_any_query(path: str, query: Any) -> str:
    if not isinstance(query, dict):
        return path
    query_parts = []
    for key, value in query.items():
        for item in _encode_query_value(value):
            query_parts.append((str(key), item))
    if not query_parts:
        return path
    return f"{path}?{urlencode(query_parts, doseq=True)}"


MOVEMENT_ROUTE_SPECS: Dict[str, Dict[str, Any]] = {
    "day": {"method": "GET", "path": "/api/v1/movement/day"},
    "month": {"method": "GET", "path": "/api/v1/movement/month"},
    "allTime": {"method": "GET", "path": "/api/v1/movement/all-time"},
    "timeline": {"method": "GET", "path": "/api/v1/movement/timeline"},
    "places": {"method": "GET", "path": "/api/v1/movement/places"},
    "settings": {"method": "GET", "path": "/api/v1/movement/settings"},
    "boxDetail": {"method": "GET", "path": "/api/v1/movement/boxes/:id"},
    "tripDetail": {"method": "GET", "path": "/api/v1/movement/trips/:id"},
    "selection": {"method": "POST", "path": "/api/v1/movement/selection"},
    "settingsUpdate": {"method": "PATCH", "path": "/api/v1/movement/settings", "write": True},
    "placeCreate": {"method": "POST", "path": "/api/v1/movement/places", "write": True},
    "placeUpdate": {"method": "PATCH", "path": "/api/v1/movement/places/:id", "write": True},
    "userBoxPreflight": {"method": "POST", "path": "/api/v1/movement/user-boxes/preflight", "write": True},
    "userBoxCreate": {"method": "POST", "path": "/api/v1/movement/user-boxes", "write": True},
    "userBoxUpdate": {"method": "PATCH", "path": "/api/v1/movement/user-boxes/:id", "write": True},
    "userBoxDelete": {"method": "DELETE", "path": "/api/v1/movement/user-boxes/:id", "write": True},
    "automaticBoxInvalidate": {"method": "POST", "path": "/api/v1/movement/automatic-boxes/:id/invalidate", "write": True},
    "stayUpdate": {"method": "PATCH", "path": "/api/v1/movement/stays/:id", "write": True},
    "stayDelete": {"method": "DELETE", "path": "/api/v1/movement/stays/:id", "write": True},
    "tripUpdate": {"method": "PATCH", "path": "/api/v1/movement/trips/:id", "write": True},
    "tripDelete": {"method": "DELETE", "path": "/api/v1/movement/trips/:id", "write": True},
    "tripPointUpdate": {"method": "PATCH", "path": "/api/v1/movement/trips/:id/points/:pointId", "write": True},
    "tripPointDelete": {"method": "DELETE", "path": "/api/v1/movement/trips/:id/points/:pointId", "write": True},
}

LIFE_FORCE_ROUTE_SPECS: Dict[str, Dict[str, Any]] = {
    "overview": {"method": "GET", "path": "/api/v1/life-force"},
    "profile": {"method": "PATCH", "path": "/api/v1/life-force/profile", "write": True},
    "weekdayTemplate": {"method": "PUT", "path": "/api/v1/life-force/templates/:weekday", "write": True},
    "fatigueSignal": {"method": "POST", "path": "/api/v1/life-force/fatigue-signals", "write": True},
}

WORKBENCH_ROUTE_SPECS: Dict[str, Dict[str, Any]] = {
    "boxCatalog": {"method": "GET", "path": "/api/v1/workbench/catalog/boxes"},
    "listFlows": {"method": "GET", "path": "/api/v1/workbench/flows"},
    "flowById": {"method": "GET", "path": "/api/v1/workbench/flows/:id"},
    "flowBySlug": {"method": "GET", "path": "/api/v1/workbench/flows/by-slug/:slug"},
    "createFlow": {"method": "POST", "path": "/api/v1/workbench/flows", "write": True},
    "updateFlow": {"method": "PATCH", "path": "/api/v1/workbench/flows/:id", "write": True},
    "deleteFlow": {"method": "DELETE", "path": "/api/v1/workbench/flows/:id", "write": True},
    "runFlow": {"method": "POST", "path": "/api/v1/workbench/flows/:id/run", "write": True},
    "runByPayload": {"method": "POST", "path": "/api/v1/workbench/run", "write": True},
    "chatFlow": {"method": "POST", "path": "/api/v1/workbench/flows/:id/chat", "write": True},
    "publishedOutput": {"method": "GET", "path": "/api/v1/workbench/flows/:id/output"},
    "runs": {"method": "GET", "path": "/api/v1/workbench/flows/:id/runs"},
    "runDetail": {"method": "GET", "path": "/api/v1/workbench/flows/:id/runs/:runId"},
    "runNodes": {"method": "GET", "path": "/api/v1/workbench/flows/:id/runs/:runId/nodes"},
    "nodeResult": {"method": "GET", "path": "/api/v1/workbench/flows/:id/runs/:runId/nodes/:nodeId"},
    "latestNodeOutput": {"method": "GET", "path": "/api/v1/workbench/flows/:id/nodes/:nodeId/output"},
}


def specialized_route_parameters(route_specs: Dict[str, Dict[str, Any]]) -> JsonSchema:
    return object_schema(
        {
            "routeKey": {"enum": sorted(route_specs.keys())},
            "pathParams": {
                "type": "object",
                "additionalProperties": {"type": "string"},
                "description": "Path parameters such as id, weekday, runId, nodeId, or slug.",
            },
            "query": {
                "type": "object",
                "additionalProperties": True,
                "description": "Optional query parameters for the selected route.",
            },
            "body": {
                "type": "object",
                "description": "JSON body for POST, PATCH, and PUT route keys.",
            },
        },
        required=["routeKey"],
    )


def _specialized_route_spec(route_specs: Dict[str, Dict[str, Any]], args: Dict[str, Any]) -> Dict[str, Any]:
    route_key = str(args.get("routeKey") or "").strip()
    spec = route_specs.get(route_key)
    if not spec:
        raise ValueError(f"Unknown specialized Forge route key: {route_key}")
    return spec


def _render_specialized_route_path(template: str, args: Dict[str, Any]) -> str:
    path_params = args.get("pathParams")
    if not isinstance(path_params, dict):
        path_params = {}

    path = template
    for part in template.split("/"):
        if not part.startswith(":"):
            continue
        key = part[1:]
        value = str(path_params.get(key) or "").strip()
        if not value:
            raise ValueError(f"Missing pathParams.{key} for {template}.")
        path = path.replace(f":{key}", quote(value, safe=""))
    return with_any_query(path, args.get("query"))


def specialized_route_path(route_specs: Dict[str, Dict[str, Any]], args: Dict[str, Any]) -> str:
    spec = _specialized_route_spec(route_specs, args)
    return _render_specialized_route_path(str(spec["path"]), args)


def specialized_route_method(route_specs: Dict[str, Dict[str, Any]], args: Dict[str, Any]) -> str:
    return str(_specialized_route_spec(route_specs, args).get("method", "GET"))


def specialized_route_body(args: Dict[str, Any], _config: Any) -> Any:
    return args.get("body") if args.get("body") is not None else {}


def specialized_route_write(route_specs: Dict[str, Dict[str, Any]], args: Dict[str, Any]) -> bool:
    return bool(_specialized_route_spec(route_specs, args).get("write"))


def calendar_overview_path(args: Dict[str, Any]) -> str:
    return with_query("/api/v1/calendar/overview", args, ["from", "to", "userIds"])


def sleep_overview_path(args: Dict[str, Any]) -> str:
    return with_query("/api/v1/health/sleep", args, ["userIds"])


def sports_overview_path(args: Dict[str, Any]) -> str:
    return with_query("/api/v1/health/fitness", args, ["userIds"])


def sync_calendar_connection_path(args: Dict[str, Any]) -> str:
    return f"/api/v1/calendar/connections/{args['connectionId']}/sync"


def start_task_run_path(args: Dict[str, Any]) -> str:
    task_id = str(args.get("taskId") or "").strip()
    if not task_id:
        raise ValueError("forge_start_task_run requires a non-empty taskId.")
    return f"/api/v1/tasks/{task_id}/runs"


def start_task_run_body(args: Dict[str, Any], _config: Any) -> Dict[str, Any]:
    actor = str(args.get("actor") or "").strip()
    if not actor:
        raise ValueError("forge_start_task_run requires a non-empty actor.")

    timer_mode = "planned" if args.get("timerMode") == "planned" else "unlimited"
    raw_duration = args.get("plannedDurationSeconds")
    planned_duration = raw_duration if isinstance(raw_duration, int) else None
    if timer_mode == "planned" and planned_duration is None:
        raise ValueError(
            "forge_start_task_run requires plannedDurationSeconds when timerMode is planned."
        )

    override_reason = str(args.get("overrideReason") or "").strip() or None
    note = str(args.get("note") or "").strip() or None

    body: Dict[str, Any] = {
        "actor": actor,
        "timerMode": timer_mode,
        "plannedDurationSeconds": planned_duration if timer_mode == "planned" else None,
    }
    if override_reason is not None:
        body["overrideReason"] = override_reason
    if isinstance(args.get("isCurrent"), bool):
        body["isCurrent"] = args.get("isCurrent")
    if isinstance(args.get("leaseTtlSeconds"), int):
        body["leaseTtlSeconds"] = args.get("leaseTtlSeconds")
    if note is not None:
        body["note"] = note
    return body


def task_run_action_path(action: str, args: Dict[str, Any]) -> str:
    task_run_id = str(args.get("taskRunId") or "").strip()
    if not task_run_id:
        raise ValueError("Task-run actions require a non-empty taskRunId.")
    return f"/api/v1/task-runs/{task_run_id}/{action}"


def _optional_trimmed_text(args: Dict[str, Any], key: str) -> Any:
    value = str(args.get(key) or "").strip()
    return value or None


def _task_run_actor_body(
    args: Dict[str, Any],
    *,
    include_lease: bool = False,
    include_closeout: bool = False,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {}
    actor = _optional_trimmed_text(args, "actor")
    note = _optional_trimmed_text(args, "note")
    if actor is not None:
        body["actor"] = actor
    if note is not None:
        body["note"] = note
    if include_lease and isinstance(args.get("leaseTtlSeconds"), int):
        body["leaseTtlSeconds"] = args.get("leaseTtlSeconds")
    if include_closeout and args.get("closeoutNote") is not None:
        body["closeoutNote"] = args.get("closeoutNote")
    return body


def heartbeat_task_run_path(args: Dict[str, Any]) -> str:
    return task_run_action_path("heartbeat", args)


def heartbeat_task_run_body(args: Dict[str, Any], _config: Any) -> Dict[str, Any]:
    return _task_run_actor_body(args, include_lease=True)


def focus_task_run_path(args: Dict[str, Any]) -> str:
    return task_run_action_path("focus", args)


def focus_task_run_body(args: Dict[str, Any], _config: Any) -> Dict[str, Any]:
    return _task_run_actor_body(args)


def complete_task_run_path(args: Dict[str, Any]) -> str:
    return task_run_action_path("complete", args)


def complete_task_run_body(args: Dict[str, Any], _config: Any) -> Dict[str, Any]:
    return _task_run_actor_body(args, include_closeout=True)


def release_task_run_path(args: Dict[str, Any]) -> str:
    return task_run_action_path("release", args)


def release_task_run_body(args: Dict[str, Any], _config: Any) -> Dict[str, Any]:
    return _task_run_actor_body(args, include_closeout=True)


def post_insight_body(args: Dict[str, Any], config: Any) -> Dict[str, Any]:
    return {
        "originType": "agent",
        "originAgentId": None,
        "originLabel": config.actor_label or "Hermes",
        "entityType": args.get("entityType"),
        "entityId": args.get("entityId"),
        "timeframeLabel": args.get("timeframeLabel"),
        "title": args["title"],
        "summary": args["summary"],
        "recommendation": args["recommendation"],
        "rationale": args.get("rationale") or "",
        "confidence": args.get("confidence"),
        "visibility": args.get("visibility"),
        "ctaLabel": args.get("ctaLabel") or "Review insight",
    }


NOTE_INPUT = object_schema(
    {
        "contentMarkdown": {"type": "string", "minLength": 1},
        "author": optional_nullable_string("Optional note author."),
        "tags": array_schema({"type": "string"}, "Optional note-owned tags."),
        "destroyAt": optional_nullable_string("Optional ephemeral destroy timestamp."),
        "links": array_schema(
            object_schema(
                {
                    "entityType": {"type": "string", "minLength": 1},
                    "entityId": {"type": "string", "minLength": 1},
                    "anchorKey": optional_nullable_string("Optional anchor key."),
                },
                required=["entityType", "entityId"],
            ),
            "Optional extra note links.",
        ),
    },
    required=["contentMarkdown"],
)


SEARCH_ENTITY = object_schema(
    {
        "entityTypes": array_schema({"type": "string"}, "Entity type filters."),
        "query": optional_string("Free-text query."),
        "ids": array_schema({"type": "string"}, "Exact ids to fetch."),
        "status": array_schema({"type": "string"}, "Status filters."),
        "userIds": array_schema({"type": "string"}, "Optional user ownership scope."),
        "linkedTo": object_schema(
            {
                "entityType": {"type": "string", "minLength": 1},
                "id": {"type": "string", "minLength": 1},
            },
            required=["entityType", "id"],
        ),
        "includeDeleted": {"type": "boolean"},
        "limit": {"type": "integer", "minimum": 1, "maximum": 100},
        "clientRef": optional_string("Client reference echoed back by Forge."),
    }
)

DELETE_OPERATION = object_schema(
    {
        "entityType": {"type": "string", "minLength": 1},
        "id": {"type": "string", "minLength": 1},
        "mode": {"enum": ["soft", "hard"]},
        "reason": optional_string("Optional delete reason."),
        "clientRef": optional_string("Client reference echoed back by Forge."),
    },
    required=["entityType", "id"],
)

RESTORE_OPERATION = object_schema(
    {
        "entityType": {"type": "string", "minLength": 1},
        "id": {"type": "string", "minLength": 1},
        "clientRef": optional_string("Client reference echoed back by Forge."),
    },
    required=["entityType", "id"],
)

CREATE_OPERATION = object_schema(
    {
        "entityType": {"type": "string", "minLength": 1},
        "data": {"type": "object"},
        "clientRef": optional_string("Client reference echoed back by Forge."),
    },
    required=["entityType", "data"],
)

UPDATE_OPERATION = object_schema(
    {
        "entityType": {"type": "string", "minLength": 1},
        "id": {"type": "string", "minLength": 1},
        "patch": {"type": "object"},
        "clientRef": optional_string("Client reference echoed back by Forge."),
    },
    required=["entityType", "id", "patch"],
)

PREFERENCE_DOMAINS = [
    "projects",
    "tasks",
    "strategies",
    "habits",
    "calendar",
    "sleep",
    "sports",
    "activities",
    "food",
    "places",
    "countries",
    "fashion",
    "people",
    "media",
    "tools",
    "custom",
]

PREFERENCE_CONTEXT_SHARE_MODES = ["shared", "isolated", "blended"]
PREFERENCE_JUDGMENT_OUTCOMES = ["left", "right", "tie", "skip"]
PREFERENCE_SIGNAL_TYPES = ["favorite", "veto", "must_have", "bookmark", "neutral", "compare_later"]
PREFERENCE_ITEM_STATUSES = [
    "liked",
    "disliked",
    "uncertain",
    "vetoed",
    "bookmarked",
    "favorite",
    "must_have",
    "neutral",
]


def preference_workspace_path(args: Dict[str, Any]) -> str:
    return with_query("/api/v1/preferences/workspace", args, ["userId", "domain", "contextId"])


def preference_catalog_path(args: Dict[str, Any]) -> str:
    return f"/api/v1/preferences/catalogs/{args['catalogId']}"


def preference_catalog_item_path(args: Dict[str, Any]) -> str:
    return f"/api/v1/preferences/catalog-items/{args['itemId']}"


def preference_context_path(args: Dict[str, Any]) -> str:
    return f"/api/v1/preferences/contexts/{args['contextId']}"


def preference_item_path(args: Dict[str, Any]) -> str:
    return f"/api/v1/preferences/items/{args['itemId']}"


def preference_score_path(args: Dict[str, Any]) -> str:
    return f"/api/v1/preferences/items/{args['itemId']}/score"


def wiki_pages_path(args: Dict[str, Any]) -> str:
    return with_query("/api/v1/wiki/pages", args, ["spaceId", "kind", "limit"])


def wiki_page_path(args: Dict[str, Any]) -> str:
    return f"/api/v1/wiki/pages/{args['pageId']}"


def wiki_health_path(args: Dict[str, Any]) -> str:
    return with_query("/api/v1/wiki/health", args, ["spaceId"])


def wiki_upsert_page_path(args: Dict[str, Any]) -> str:
    page_id = args.get("pageId")
    if isinstance(page_id, str) and page_id.strip():
        return f"/api/v1/wiki/pages/{page_id.strip()}"
    return "/api/v1/wiki/pages"


def wiki_upsert_page_method(args: Dict[str, Any]) -> str:
    page_id = args.get("pageId")
    return "PATCH" if isinstance(page_id, str) and page_id.strip() else "POST"


def wiki_upsert_page_body(args: Dict[str, Any], _config: Any) -> Dict[str, Any]:
    return {
        key: value
        for key, value in args.items()
        if key
        in {
            "kind",
            "title",
            "slug",
            "summary",
            "aliases",
            "contentMarkdown",
            "author",
            "tags",
            "spaceId",
            "frontmatter",
            "links",
        }
    }


def sleep_session_path(args: Dict[str, Any]) -> str:
    return f"/api/v1/health/sleep/{args['sleepId']}"


def sleep_session_body(args: Dict[str, Any], _config: Any) -> Dict[str, Any]:
    return {
        key: value for key, value in args.items() if key != "sleepId"
    }


def workout_session_path(args: Dict[str, Any]) -> str:
    return f"/api/v1/health/workouts/{args['workoutId']}"


def workout_session_body(args: Dict[str, Any], _config: Any) -> Dict[str, Any]:
    return {
        key: value for key, value in args.items() if key != "workoutId"
    }


PREFERENCE_FEATURE_WEIGHTS = {
    "type": "object",
    "description": "Optional weights keyed by novelty, simplicity, rigor, aesthetics, depth, structure, familiarity, and surprise.",
}

TOOL_CATALOG: List[ToolSpec] = [
    {
        "name": "forge_get_operator_overview",
        "description": "Start here for most Forge work. Read the compact progressive overview with current priorities, today/yesterday context, health, calendar, psyche signals, note previews, IDs, and drill-down routes before searching or mutating.",
        "parameters": scoped_read_schema(),
        "method": "GET",
        "path_builder": lambda args: with_query("/api/v1/operator/overview", args, ["userIds"]),
    },
    {
        "name": "forge_get_operator_context",
        "description": "Read the current operational task board, focus queue, recent task runs, and XP state. Use this for current-work questions and work runtime decisions.",
        "parameters": scoped_read_schema(),
        "method": "GET",
        "path_builder": lambda args: with_query("/api/v1/operator/context", args, ["userIds"]),
    },
    {
        "name": "forge_get_agent_onboarding",
        "description": "Fetch the live Forge onboarding contract with the exact Forge tool list, batch payload rules, UI handoff rules, and verification guidance.",
        "parameters": object_schema({}),
        "method": "GET",
        "path": "/api/v1/agents/onboarding",
    },
    {
        "name": "forge_call_movement_route",
        "description": "Call one allowed dedicated Movement route after the conversation has narrowed to day, month, all-time, timeline, place, trip detail, selection aggregate, overlay, or repair work. Do not use this for normal stored entities; those stay on batch CRUD.",
        "parameters": specialized_route_parameters(MOVEMENT_ROUTE_SPECS),
        "method_builder": lambda args: specialized_route_method(MOVEMENT_ROUTE_SPECS, args),
        "path_builder": lambda args: specialized_route_path(MOVEMENT_ROUTE_SPECS, args),
        "body_builder": specialized_route_body,
        "write_builder": lambda args: specialized_route_write(MOVEMENT_ROUTE_SPECS, args),
    },
    {
        "name": "forge_call_life_force_route",
        "description": "Call one allowed dedicated Life Force route after the conversation has narrowed to overview, profile update, weekday template, or fatigue signal. Do not use batch CRUD for Life Force.",
        "parameters": specialized_route_parameters(LIFE_FORCE_ROUTE_SPECS),
        "method_builder": lambda args: specialized_route_method(LIFE_FORCE_ROUTE_SPECS, args),
        "path_builder": lambda args: specialized_route_path(LIFE_FORCE_ROUTE_SPECS, args),
        "body_builder": specialized_route_body,
        "write_builder": lambda args: specialized_route_write(LIFE_FORCE_ROUTE_SPECS, args),
    },
    {
        "name": "forge_call_workbench_route",
        "description": "Call one allowed dedicated Workbench route after the conversation has narrowed to flow catalog, flow CRUD, execution, run history, published output, node result, or latest node output. Do not use batch CRUD for Workbench.",
        "parameters": specialized_route_parameters(WORKBENCH_ROUTE_SPECS),
        "method_builder": lambda args: specialized_route_method(WORKBENCH_ROUTE_SPECS, args),
        "path_builder": lambda args: specialized_route_path(WORKBENCH_ROUTE_SPECS, args),
        "body_builder": specialized_route_body,
        "write_builder": lambda args: specialized_route_write(WORKBENCH_ROUTE_SPECS, args),
    },
    {
        "name": "forge_get_doctor",
        "description": "Run Forge runtime diagnostics, config-file sync checks, and onboarding reachability from the Hermes surface.",
        "parameters": object_schema({}),
        "custom_handler": "doctor",
    },
    {
        "name": "forge_get_user_directory",
        "description": "Read the current human and bot user directory, ownership counts, and directional relationship graph before cross-owner planning or mutation.",
        "parameters": object_schema({}),
        "method": "GET",
        "path": "/api/v1/users/directory",
    },
    {
        "name": "forge_get_wiki_settings",
        "description": "Read the current wiki spaces plus enabled LLM and embedding profiles before search, ingest, or page writes.",
        "parameters": object_schema({}),
        "method": "GET",
        "path": "/api/v1/wiki/settings",
    },
    {
        "name": "forge_list_wiki_pages",
        "description": "List wiki or evidence pages inside one space without search ranking.",
        "parameters": object_schema(
            {
                "spaceId": optional_string("Optional wiki space id."),
                "kind": {"enum": ["wiki", "evidence"]},
                "limit": {"type": "integer", "minimum": 1, "maximum": 500},
            }
        ),
        "method": "GET",
        "path_builder": wiki_pages_path,
    },
    {
        "name": "forge_get_wiki_page",
        "description": "Read one wiki page with backlinks, source notes, and attached assets.",
        "parameters": object_schema(
            {
                "pageId": {"type": "string", "minLength": 1},
            },
            required=["pageId"],
        ),
        "method": "GET",
        "path_builder": wiki_page_path,
    },
    {
        "name": "forge_get_wiki_health",
        "description": "Read unresolved links, orphan pages, missing summaries, raw-source counts, and index-path state for one wiki space.",
        "parameters": object_schema(
            {
                "spaceId": optional_string("Optional wiki space id."),
            }
        ),
        "method": "GET",
        "path_builder": wiki_health_path,
    },
    {
        "name": "forge_search_wiki",
        "description": "Search the wiki with text, semantic, entity, or hybrid retrieval.",
        "parameters": object_schema(
            {
                "spaceId": optional_string("Optional wiki space id."),
                "kind": {"enum": ["wiki", "evidence"]},
                "mode": {"enum": ["text", "semantic", "entity", "hybrid"]},
                "query": optional_string("Optional free-text wiki query."),
                "profileId": optional_string("Optional embedding profile id."),
                "linkedEntity": object_schema(
                    {
                        "entityType": {"type": "string", "minLength": 1},
                        "entityId": {"type": "string", "minLength": 1},
                    },
                    required=["entityType", "entityId"],
                ),
                "limit": {"type": "integer", "minimum": 1, "maximum": 50},
            }
        ),
        "method": "POST",
        "path": "/api/v1/wiki/search",
        "write": True,
    },
    {
        "name": "forge_upsert_wiki_page",
        "description": "Create a new wiki page or update an existing one through the SQLite-backed wiki surface.",
        "parameters": object_schema(
            {
                "pageId": optional_string("Optional page id for updates."),
                "kind": {"enum": ["wiki", "evidence"]},
                "title": {"type": "string", "minLength": 1},
                "slug": optional_string("Optional slug."),
                "summary": optional_string("Optional summary."),
                "aliases": array_schema({"type": "string"}, "Optional aliases."),
                "contentMarkdown": {"type": "string", "minLength": 1},
                "author": optional_nullable_string("Optional author."),
                "tags": array_schema({"type": "string"}, "Optional tags."),
                "spaceId": optional_string("Optional wiki space id."),
                "frontmatter": {"type": "object"},
                "links": array_schema(
                    object_schema(
                        {
                            "entityType": {"type": "string", "minLength": 1},
                            "entityId": {"type": "string", "minLength": 1},
                            "anchorKey": optional_nullable_string("Optional anchor key."),
                        },
                        required=["entityType", "entityId"],
                    ),
                    "Optional Forge entity links.",
                ),
            },
            required=["title", "contentMarkdown"],
        ),
        "method_builder": wiki_upsert_page_method,
        "path_builder": wiki_upsert_page_path,
        "body_builder": wiki_upsert_page_body,
        "write": True,
    },
    {
        "name": "forge_sync_wiki_vault",
        "description": "Rebuild SQLite wiki search, link, and metadata indexes.",
        "parameters": object_schema(
            {
                "spaceId": optional_string("Optional wiki space id."),
            }
        ),
        "method": "POST",
        "path": "/api/v1/wiki/sync",
        "write": True,
    },
    {
        "name": "forge_reindex_wiki_embeddings",
        "description": "Recompute wiki embedding chunks for one space and optional profile.",
        "parameters": object_schema(
            {
                "spaceId": optional_string("Optional wiki space id."),
                "profileId": optional_string("Optional embedding profile id."),
            }
        ),
        "method": "POST",
        "path": "/api/v1/wiki/reindex",
        "write": True,
    },
    {
        "name": "forge_ingest_wiki_source",
        "description": "Ingest raw text, local files, or URLs into the wiki, preserving a raw source artifact and returning page plus proposal outputs.",
        "parameters": object_schema(
            {
                "spaceId": optional_string("Optional wiki space id."),
                "titleHint": optional_string("Optional title hint."),
                "sourceKind": {"enum": ["raw_text", "local_path", "url"]},
                "sourceText": optional_string("Inline source text."),
                "sourcePath": optional_string("Absolute local path."),
                "sourceUrl": optional_string("Remote URL."),
                "mimeType": optional_string("Optional MIME type override."),
                "llmProfileId": optional_string("Optional LLM profile id."),
                "parseStrategy": {"enum": ["auto", "text_only", "multimodal"]},
                "entityProposalMode": {"enum": ["none", "suggest"]},
                "userId": optional_nullable_string("Optional Forge user id."),
                "createAsKind": {"enum": ["wiki", "evidence"]},
                "linkedEntityHints": array_schema(
                    object_schema(
                        {
                            "entityType": {"type": "string", "minLength": 1},
                            "entityId": {"type": "string", "minLength": 1},
                            "anchorKey": optional_nullable_string("Optional anchor key."),
                        },
                        required=["entityType", "entityId"],
                    ),
                    "Optional linked-entity hints.",
                ),
            },
            required=["sourceKind"],
        ),
        "method": "POST",
        "path": "/api/v1/wiki/ingest-jobs",
        "write": True,
    },
    {
        "name": "forge_get_sleep_overview",
        "description": "Read the reflective sleep surface with recent nights, scores, regularity, stage averages, and linked-context counts.",
        "parameters": scoped_read_schema(),
        "method": "GET",
        "path_builder": sleep_overview_path,
    },
    {
        "name": "forge_get_sports_overview",
        "description": "Read the sports surface with workout volume, workout types, effort signals, and linked workout sessions.",
        "parameters": scoped_read_schema(),
        "method": "GET",
        "path_builder": sports_overview_path,
    },
    {
        "name": "forge_update_sleep_session",
        "description": "Patch one sleep session with reflective notes, tags, or linked Forge context after review.",
        "parameters": object_schema(
            {
                "sleepId": {"type": "string", "minLength": 1},
                "qualitySummary": optional_string("Optional short quality summary."),
                "notes": optional_string("Optional reflective notes."),
                "tags": array_schema({"type": "string"}, "Optional sleep tags."),
                "links": array_schema(
                    object_schema(
                        {
                            "entityType": {"type": "string", "minLength": 1},
                            "entityId": {"type": "string", "minLength": 1},
                            "relationshipType": optional_string("Optional link relationship type."),
                        },
                        required=["entityType", "entityId"],
                    ),
                    "Optional Forge links.",
                ),
            },
            required=["sleepId"],
        ),
        "method": "PATCH",
        "path_builder": sleep_session_path,
        "body_builder": sleep_session_body,
        "write": True,
    },
    {
        "name": "forge_update_workout_session",
        "description": "Patch one workout session with effort, mood, meaning, tags, or linked Forge context.",
        "parameters": object_schema(
            {
                "workoutId": {"type": "string", "minLength": 1},
                "subjectiveEffort": {
                    "anyOf": [
                        {"type": "integer", "minimum": 1, "maximum": 10},
                        {"type": "null"},
                    ]
                },
                "moodBefore": optional_string("Optional mood before the session."),
                "moodAfter": optional_string("Optional mood after the session."),
                "meaningText": optional_string("Optional meaning or narrative context."),
                "plannedContext": optional_string("Optional planned context."),
                "socialContext": optional_string("Optional social context."),
                "tags": array_schema({"type": "string"}, "Optional workout tags."),
                "links": array_schema(
                    object_schema(
                        {
                            "entityType": {"type": "string", "minLength": 1},
                            "entityId": {"type": "string", "minLength": 1},
                            "relationshipType": optional_string("Optional link relationship type."),
                        },
                        required=["entityType", "entityId"],
                    ),
                    "Optional Forge links.",
                ),
            },
            required=["workoutId"],
        ),
        "method": "PATCH",
        "path_builder": workout_session_path,
        "body_builder": workout_session_body,
        "write": True,
    },
    {
        "name": "forge_get_preferences_workspace",
        "description": "Read Forge's current preference model for one user and domain, including the summary-first landing view, next comparison pair, concept libraries, map, table, and history.",
        "parameters": object_schema(
            {
                "userId": optional_string("Optional Forge user id. Defaults to the operator."),
                "domain": {"enum": PREFERENCE_DOMAINS},
                "contextId": optional_string("Optional preference context id."),
            }
        ),
        "method": "GET",
        "path_builder": preference_workspace_path,
    },
    {
        "name": "forge_start_preferences_game",
        "description": "Start or refresh the Forge Preferences comparison game for one domain. Forge will seed matching Forge entities automatically for Forge-native domains and can seed a chosen concept catalog for broader taste domains.",
        "parameters": object_schema(
            {
                "userId": {"type": "string", "minLength": 1},
                "domain": {"enum": PREFERENCE_DOMAINS},
                "contextId": optional_string("Optional preference context id."),
                "catalogId": optional_string("Optional concept catalog id for seeded concept domains."),
            },
            required=["userId", "domain"],
        ),
        "method": "POST",
        "path": "/api/v1/preferences/game/start",
        "write": True,
    },
    {
        "name": "forge_merge_preferences_contexts",
        "description": "Merge one Forge Preferences context into another when the distinction is no longer useful.",
        "parameters": object_schema(
            {
                "sourceContextId": {"type": "string", "minLength": 1},
                "targetContextId": {"type": "string", "minLength": 1},
            },
            required=["sourceContextId", "targetContextId"],
        ),
        "method": "POST",
        "path": "/api/v1/preferences/contexts/merge",
        "write": True,
    },
    {
        "name": "forge_enqueue_preferences_item_from_entity",
        "description": "Queue an existing Forge entity into a preference domain so it can appear in the comparison game.",
        "parameters": object_schema(
            {
                "userId": {"type": "string", "minLength": 1},
                "domain": {"enum": PREFERENCE_DOMAINS},
                "entityType": {"type": "string", "minLength": 1},
                "entityId": {"type": "string", "minLength": 1},
                "label": optional_string("Optional override label."),
                "description": optional_string("Optional override description."),
                "tags": array_schema({"type": "string"}, "Optional item tags."),
            },
            required=["userId", "domain", "entityType", "entityId"],
        ),
        "method": "POST",
        "path": "/api/v1/preferences/items/from-entity",
        "write": True,
    },
    {
        "name": "forge_submit_preferences_judgment",
        "description": "Record one pairwise comparison result in Forge Preferences.",
        "parameters": object_schema(
            {
                "userId": {"type": "string", "minLength": 1},
                "domain": {"enum": PREFERENCE_DOMAINS},
                "contextId": {"type": "string", "minLength": 1},
                "leftItemId": {"type": "string", "minLength": 1},
                "rightItemId": {"type": "string", "minLength": 1},
                "outcome": {"enum": PREFERENCE_JUDGMENT_OUTCOMES},
                "strength": {"type": "number", "minimum": 0.5, "maximum": 2},
                "responseTimeMs": {
                    "anyOf": [
                        {"type": "integer", "minimum": 0},
                        {"type": "null"},
                    ]
                },
                "reasonTags": array_schema({"type": "string"}, "Optional predefined reason tags."),
            },
            required=["userId", "domain", "contextId", "leftItemId", "rightItemId", "outcome"],
        ),
        "method": "POST",
        "path": "/api/v1/preferences/judgments",
        "write": True,
    },
    {
        "name": "forge_submit_preferences_signal",
        "description": "Record a direct non-pairwise preference signal such as favorite, veto, must-have, bookmark, neutral, or compare-later.",
        "parameters": object_schema(
            {
                "userId": {"type": "string", "minLength": 1},
                "domain": {"enum": PREFERENCE_DOMAINS},
                "contextId": {"type": "string", "minLength": 1},
                "itemId": {"type": "string", "minLength": 1},
                "signalType": {"enum": PREFERENCE_SIGNAL_TYPES},
                "strength": {"type": "number", "minimum": 0.5, "maximum": 2},
            },
            required=["userId", "domain", "contextId", "itemId", "signalType"],
        ),
        "method": "POST",
        "path": "/api/v1/preferences/signals",
        "write": True,
    },
    {
        "name": "forge_update_preferences_score",
        "description": "Override or protect the inferred state of one preference item when the user wants explicit correction.",
        "parameters": object_schema(
            {
                "itemId": {"type": "string", "minLength": 1},
                "userId": {"type": "string", "minLength": 1},
                "domain": {"enum": PREFERENCE_DOMAINS},
                "contextId": {"type": "string", "minLength": 1},
                "manualStatus": {
                    "anyOf": [
                        {"enum": PREFERENCE_ITEM_STATUSES},
                        {"type": "null"},
                    ]
                },
                "manualScore": {
                    "anyOf": [
                        {"type": "number"},
                        {"type": "null"},
                    ]
                },
                "confidenceLock": {
                    "anyOf": [
                        {"type": "number", "minimum": 0, "maximum": 1},
                        {"type": "null"},
                    ]
                },
                "bookmarked": {"type": "boolean"},
                "compareLater": {"type": "boolean"},
                "frozen": {"type": "boolean"},
            },
            required=["itemId", "userId", "domain", "contextId"],
        ),
        "method": "PATCH",
        "path_builder": preference_score_path,
        "body_builder": lambda args, _config: {
            key: value for key, value in args.items() if key != "itemId"
        },
        "write": True,
    },
    {
        "name": "forge_list_questionnaires",
        "description": "List the Psyche questionnaire library across the selected user scope.",
        "parameters": scoped_read_schema(),
        "method": "GET",
        "path_builder": lambda args: with_query("/api/v1/psyche/questionnaires", args, ["userIds"]),
    },
    {
        "name": "forge_get_questionnaire",
        "description": "Read one Psyche questionnaire instrument with versions and scoring detail.",
        "parameters": object_schema(
            {
                "questionnaireId": {"type": "string", "minLength": 1},
                "userIds": array_schema({"type": "string"}, "Optional Forge user ids."),
            },
            required=["questionnaireId"],
        ),
        "method": "GET",
        "path_builder": lambda args: with_query(
            f"/api/v1/psyche/questionnaires/{args['questionnaireId']}",
            args,
            ["userIds"],
        ),
    },
    {
        "name": "forge_clone_questionnaire",
        "description": "Clone one Psyche questionnaire instrument into a new user-owned copy.",
        "parameters": object_schema(
            {
                "questionnaireId": {"type": "string", "minLength": 1},
                "userId": optional_nullable_string("Optional owner user id for the cloned copy."),
            },
            required=["questionnaireId"],
        ),
        "method": "POST",
        "path_builder": lambda args: f"/api/v1/psyche/questionnaires/{args['questionnaireId']}/clone",
        "body_builder": lambda args, _config: {"userId": args.get("userId")},
        "write": True,
    },
    {
        "name": "forge_ensure_questionnaire_draft",
        "description": "Create or return the editable draft version for one questionnaire instrument.",
        "parameters": object_schema(
            {
                "questionnaireId": {"type": "string", "minLength": 1},
            },
            required=["questionnaireId"],
        ),
        "method": "POST",
        "path_builder": lambda args: f"/api/v1/psyche/questionnaires/{args['questionnaireId']}/draft",
        "write": True,
    },
    {
        "name": "forge_publish_questionnaire_draft",
        "description": "Publish the current questionnaire draft as the live readable version.",
        "parameters": object_schema(
            {
                "questionnaireId": {"type": "string", "minLength": 1},
                "label": optional_string("Optional published version label."),
            },
            required=["questionnaireId"],
        ),
        "method": "POST",
        "path_builder": lambda args: f"/api/v1/psyche/questionnaires/{args['questionnaireId']}/publish",
        "body_builder": lambda args, _config: {"label": args.get("label")},
        "write": True,
    },
    {
        "name": "forge_start_questionnaire_run",
        "description": "Start one questionnaire answer session for a specific user.",
        "parameters": object_schema(
            {
                "questionnaireId": {"type": "string", "minLength": 1},
                "userId": {"type": "string", "minLength": 1},
                "versionId": optional_nullable_string("Optional questionnaire version id."),
            },
            required=["questionnaireId", "userId"],
        ),
        "method": "POST",
        "path_builder": lambda args: f"/api/v1/psyche/questionnaires/{args['questionnaireId']}/runs",
        "body_builder": lambda args, _config: {
            "userId": args.get("userId"),
            "versionId": args.get("versionId"),
        },
        "write": True,
    },
    {
        "name": "forge_get_questionnaire_run",
        "description": "Read one questionnaire run with answers, score results, and linked instrument detail.",
        "parameters": object_schema(
            {
                "runId": {"type": "string", "minLength": 1},
                "userIds": array_schema({"type": "string"}, "Optional Forge user ids."),
            },
            required=["runId"],
        ),
        "method": "GET",
        "path_builder": lambda args: with_query(
            f"/api/v1/psyche/questionnaire-runs/{args['runId']}",
            args,
            ["userIds"],
        ),
    },
    {
        "name": "forge_update_questionnaire_run",
        "description": "Save draft answers or progress on an in-progress questionnaire run.",
        "parameters": object_schema(
            {
                "runId": {"type": "string", "minLength": 1},
                "answers": array_schema({"type": "object"}, "Optional questionnaire answers."),
                "progressIndex": {
                    "anyOf": [
                        {"type": "integer", "minimum": 0},
                        {"type": "null"},
                    ]
                },
            },
            required=["runId"],
        ),
        "method": "PATCH",
        "path_builder": lambda args: f"/api/v1/psyche/questionnaire-runs/{args['runId']}",
        "body_builder": lambda args, _config: {
            key: value for key, value in args.items() if key != "runId"
        },
        "write": True,
    },
    {
        "name": "forge_complete_questionnaire_run",
        "description": "Complete a questionnaire run, score it, and persist the note-backed self-observation output.",
        "parameters": object_schema(
            {
                "runId": {"type": "string", "minLength": 1},
            },
            required=["runId"],
        ),
        "method": "POST",
        "path_builder": lambda args: f"/api/v1/psyche/questionnaire-runs/{args['runId']}/complete",
        "write": True,
    },
    {
        "name": "forge_get_self_observation_calendar",
        "description": "Read the Psyche self-observation calendar with note-backed observations, linked patterns, linked reports, and available tags.",
        "parameters": object_schema(
            {
                "userIds": array_schema({"type": "string"}, "Optional Forge user ids."),
                "from": optional_string("Optional ISO start timestamp."),
                "to": optional_string("Optional ISO end timestamp."),
            }
        ),
        "method": "GET",
        "path_builder": lambda args: with_query(
            "/api/v1/psyche/self-observation/calendar",
            args,
            ["userIds", "from", "to"],
        ),
    },
    {
        "name": "forge_get_ui_entrypoint",
        "description": "Get the live Forge web UI URL and plugin redirect route. Use this only when visual review or editing is genuinely easier, not as a substitute for normal batch entity creation or updates.",
        "parameters": object_schema({}),
        "custom_handler": "ui_entrypoint",
    },
    {
        "name": "forge_get_psyche_overview",
        "description": "Read the aggregate Psyche state across values, patterns, behaviors, beliefs, modes, and trigger reports before making Psyche recommendations or updates.",
        "parameters": scoped_read_schema(),
        "method": "GET",
        "path_builder": lambda args: with_query("/api/v1/psyche/overview", args, ["userIds"]),
    },
    {
        "name": "forge_get_xp_metrics",
        "description": "Read the live XP, level, streak, momentum, and reward metrics.",
        "parameters": object_schema({}),
        "method": "GET",
        "path": "/api/v1/metrics/xp",
    },
    {
        "name": "forge_get_weekly_review",
        "description": "Read the current weekly review payload with wins, trends, and reward framing.",
        "parameters": scoped_read_schema(),
        "method": "GET",
        "path_builder": lambda args: with_query("/api/v1/reviews/weekly", args, ["userIds"]),
    },
    {
        "name": "forge_get_current_work",
        "description": "Get the current live-work picture: active task runs, focus tasks, the recommended next task, and current XP state.",
        "parameters": scoped_read_schema(),
        "custom_handler": "current_work",
    },
    {
        "name": "forge_search_entities",
        "description": "Search Forge entities before creating or updating to avoid duplicates. Pass searches as an array, even for one search.",
        "parameters": object_schema(
            {
                "searches": array_schema(SEARCH_ENTITY, "Ordered search requests."),
            },
            required=["searches"],
        ),
        "method": "POST",
        "path": "/api/v1/entities/search",
        "write": True,
    },
    {
        "name": "forge_create_entities",
        "description": "Create one or more Forge entities through the ordered batch workflow. Pass operations as an array. Each operation must include entityType and full data. This is the preferred create path for planning, Psyche, calendar, preferences basic CRUD, and questionnaire_instrument records.",
        "parameters": object_schema(
            {
                "atomic": {"type": "boolean"},
                "operations": array_schema(CREATE_OPERATION, "Ordered create requests."),
            },
            required=["operations"],
        ),
        "method": "POST",
        "path": "/api/v1/entities/create",
        "write": True,
    },
    {
        "name": "forge_update_entities",
        "description": "Update one or more Forge entities through the ordered batch workflow. Pass operations as an array. Each operation must include entityType, id, and patch. This is the preferred update path for calendar_event, work_block_template, task_timebox, preferences basic CRUD entities, questionnaire_instrument, and official habit outcome logging through habit.patch.checkIn.",
        "parameters": object_schema(
            {
                "atomic": {"type": "boolean"},
                "operations": array_schema(UPDATE_OPERATION, "Ordered update requests."),
            },
            required=["operations"],
        ),
        "method": "POST",
        "path": "/api/v1/entities/update",
        "write": True,
    },
    {
        "name": "forge_delete_entities",
        "description": "Delete Forge entities in one batch request. Pass operations as an array with entityType and id. Delete defaults to soft mode unless hard is requested explicitly. Some entities such as calendar-domain records, preference CRUD entities, and questionnaire_instrument delete immediately by design.",
        "parameters": object_schema(
            {
                "atomic": {"type": "boolean"},
                "operations": array_schema(DELETE_OPERATION, "Ordered delete requests."),
            },
            required=["operations"],
        ),
        "method": "POST",
        "path": "/api/v1/entities/delete",
        "write": True,
    },
    {
        "name": "forge_restore_entities",
        "description": "Restore soft-deleted Forge entities from the settings bin through the batch workflow. Pass operations as an array with entityType and id.",
        "parameters": object_schema(
            {
                "atomic": {"type": "boolean"},
                "operations": array_schema(RESTORE_OPERATION, "Ordered restore requests."),
            },
            required=["operations"],
        ),
        "method": "POST",
        "path": "/api/v1/entities/restore",
        "write": True,
    },
    {
        "name": "forge_grant_reward_bonus",
        "description": "Grant an explicit manual XP bonus or penalty with provenance. Use only for auditable operator judgement beyond the normal task-run and habit reward flows.",
        "parameters": object_schema(
            {
                "entityType": {"type": "string", "minLength": 1},
                "entityId": {"type": "string", "minLength": 1},
                "deltaXp": {"type": "number"},
                "reasonTitle": {"type": "string", "minLength": 1},
                "reasonSummary": optional_string("Optional shorter explanation."),
                "metadata": {"type": "object"},
            },
            required=["entityType", "entityId", "deltaXp", "reasonTitle"],
        ),
        "method": "POST",
        "path": "/api/v1/rewards/bonus",
        "write": True,
    },
    {
        "name": "forge_adjust_work_minutes",
        "description": "Add or remove tracked work minutes on an existing task or project without creating a live task run. Forge applies symmetric XP changes when the total crosses reward buckets.",
        "parameters": object_schema(
            {
                "entityType": {"enum": ["task", "project"]},
                "entityId": {"type": "string", "minLength": 1},
                "deltaMinutes": {"type": "integer"},
                "note": optional_string("Optional note explaining the correction."),
            },
            required=["entityType", "entityId", "deltaMinutes"],
        ),
        "method": "POST",
        "path": "/api/v1/work-adjustments",
        "write": True,
    },
    {
        "name": "forge_post_insight",
        "description": "Post a structured Forge insight after reading the overview. This stores an agent-authored observation or recommendation with provenance.",
        "parameters": object_schema(
            {
                "entityType": optional_nullable_string("Optional linked entity type."),
                "entityId": optional_nullable_string("Optional linked entity id."),
                "timeframeLabel": optional_nullable_string("Optional timeframe label."),
                "title": {"type": "string", "minLength": 1},
                "summary": {"type": "string", "minLength": 1},
                "recommendation": {"type": "string", "minLength": 1},
                "rationale": optional_string("Optional reasoning detail."),
                "confidence": {"type": "number"},
                "visibility": optional_string("Optional visibility override."),
                "ctaLabel": optional_string("Optional call-to-action label."),
            },
            required=["title", "summary", "recommendation"],
        ),
        "method": "POST",
        "path": "/api/v1/insights",
        "body_builder": post_insight_body,
        "write": True,
    },
    {
        "name": "forge_log_work",
        "description": "Log retroactive work or mark an existing task as completed through the operator work-log flow. Use this when the user already did the work and wants truthful evidence plus XP. Prefer closeoutNote when the summary should survive as a real linked note.",
        "parameters": object_schema(
            {
                "taskId": optional_string("Existing task id when logging against a task."),
                "title": optional_string("Task title when creating from the log flow."),
                "description": optional_string("Task description when creating from the log flow."),
                "summary": optional_string("Short work summary."),
                "goalId": optional_nullable_string("Optional goal id."),
                "projectId": optional_nullable_string("Optional project id."),
                "owner": optional_string("Optional task owner."),
                "status": optional_string("Optional task status."),
                "priority": optional_string("Optional task priority."),
                "dueDate": optional_nullable_string("Optional due date."),
                "effort": optional_string("Optional effort enum."),
                "energy": optional_string("Optional energy enum."),
                "points": {"type": "integer", "minimum": 5, "maximum": 500},
                "tagIds": array_schema({"type": "string"}, "Optional tag ids."),
                "closeoutNote": NOTE_INPUT,
            }
        ),
        "method": "POST",
        "path": "/api/v1/operator/log-work",
        "write": True,
    },
    {
        "name": "forge_start_task_run",
        "description": "Start real live work on a task. This creates or reuses a task run and is the truthful way to start work, not just changing task status.",
        "parameters": object_schema(
            {
                "taskId": {"type": "string", "minLength": 1},
                "actor": {"type": "string", "minLength": 1},
                "timerMode": {"enum": ["planned", "unlimited"]},
                "plannedDurationSeconds": {
                    "anyOf": [
                        {"type": "integer", "minimum": 60, "maximum": 86400},
                        {"type": "null"},
                    ]
                },
                "overrideReason": optional_nullable_string("Optional reason for calendar override."),
                "isCurrent": {"type": "boolean"},
                "leaseTtlSeconds": {"type": "integer", "minimum": 1, "maximum": 14400},
                "note": optional_string("Optional run note."),
            },
            required=["taskId", "actor"],
        ),
        "method": "POST",
        "path_builder": start_task_run_path,
        "body_builder": start_task_run_body,
        "write": True,
    },
    {
        "name": "forge_heartbeat_task_run",
        "description": "Refresh the lease on an active task run while work is continuing.",
        "parameters": object_schema(
            {
                "taskRunId": {"type": "string", "minLength": 1},
                "actor": optional_string("Optional actor label."),
                "leaseTtlSeconds": {"type": "integer", "minimum": 1, "maximum": 14400},
                "note": optional_string("Optional run note."),
            },
            required=["taskRunId"],
        ),
        "method": "POST",
        "path_builder": heartbeat_task_run_path,
        "body_builder": heartbeat_task_run_body,
        "write": True,
    },
    {
        "name": "forge_focus_task_run",
        "description": "Mark an active task run as the current focused run when several runs exist.",
        "parameters": object_schema(
            {
                "taskRunId": {"type": "string", "minLength": 1},
                "actor": optional_string("Optional actor label."),
            },
            required=["taskRunId"],
        ),
        "method": "POST",
        "path_builder": focus_task_run_path,
        "body_builder": focus_task_run_body,
        "write": True,
    },
    {
        "name": "forge_complete_task_run",
        "description": "Finish an active task run as completed work and let Forge award the appropriate completion rewards. Prefer closeoutNote when the work summary should become a real linked note.",
        "parameters": object_schema(
            {
                "taskRunId": {"type": "string", "minLength": 1},
                "actor": optional_string("Optional actor label."),
                "note": optional_string("Optional completion note."),
                "closeoutNote": NOTE_INPUT,
            },
            required=["taskRunId"],
        ),
        "method": "POST",
        "path_builder": complete_task_run_path,
        "body_builder": complete_task_run_body,
        "write": True,
    },
    {
        "name": "forge_release_task_run",
        "description": "Stop an active task run without completing it. Use this to truthfully stop current work. Prefer closeoutNote when blockers or handoff context should become a real linked note.",
        "parameters": object_schema(
            {
                "taskRunId": {"type": "string", "minLength": 1},
                "actor": optional_string("Optional actor label."),
                "note": optional_string("Optional release note."),
                "closeoutNote": NOTE_INPUT,
            },
            required=["taskRunId"],
        ),
        "method": "POST",
        "path_builder": release_task_run_path,
        "body_builder": release_task_run_body,
        "write": True,
    },
    {
        "name": "forge_get_calendar_overview",
        "description": "Read the calendar domain in one response: provider metadata, connected calendars, Forge-native events, mirrored events, recurring work blocks, and task timeboxes.",
        "parameters": object_schema(
            {
                "from": optional_string("Optional start datetime."),
                "to": optional_string("Optional end datetime."),
                "userIds": array_schema(
                    {"type": "string"},
                    "Optional Forge user ids to scope the read across one or more human/bot owners.",
                ),
            }
        ),
        "method": "GET",
        "path_builder": calendar_overview_path,
    },
    {
        "name": "forge_connect_calendar_provider",
        "description": "Create a Google, Apple, Exchange Online, calendars already configured on this Mac, or custom CalDAV calendar connection. Use this only for explicit provider-connection requests after discovery choices are known.",
        "parameters": object_schema(
            {
                "provider": {
                    "enum": [
                        "google",
                        "apple",
                        "caldav",
                        "microsoft",
                        "macos_local",
                    ]
                },
                "label": {"type": "string", "minLength": 1},
                "username": optional_string("Optional username."),
                "password": optional_string("Optional password or app password."),
                "serverUrl": optional_string("Optional CalDAV server url."),
                "authSessionId": optional_string(
                    "Optional Google or Microsoft auth session id."
                ),
                "sourceId": optional_string(
                    "Optional macOS local calendar source id."
                ),
                "selectedCalendarUrls": {
                    "type": "array",
                    "items": {"type": "string", "minLength": 1},
                    "minItems": 1,
                    "description": "Selected calendar urls.",
                },
                "forgeCalendarUrl": optional_string("Optional writable Forge calendar url."),
                "createForgeCalendar": {"type": "boolean"},
                "replaceConnectionIds": array_schema(
                    {"type": "string", "minLength": 1},
                    "Optional existing connection ids to replace during a macOS-local migration.",
                ),
            },
            required=["provider", "label", "selectedCalendarUrls"],
        ),
        "method": "POST",
        "path": "/api/v1/calendar/connections",
        "write": True,
    },
    {
        "name": "forge_sync_calendar_connection",
        "description": "Pull and push changes for one connected calendar provider.",
        "parameters": object_schema(
            {
                "connectionId": {"type": "string", "minLength": 1},
            },
            required=["connectionId"],
        ),
        "method": "POST",
        "path_builder": sync_calendar_connection_path,
        "static_body": {},
        "write": True,
    },
    {
        "name": "forge_create_work_block_template",
        "description": "Create a recurring work-block template such as Main Activity, Secondary Activity, Third Activity, Rest, Holiday, or Custom. This is a planning helper; agents can also use forge_create_entities with entityType work_block_template.",
        "parameters": object_schema(
            {
                "title": {"type": "string", "minLength": 1},
                "kind": {"enum": ["main_activity", "secondary_activity", "third_activity", "rest", "holiday", "custom"]},
                "color": {"type": "string", "minLength": 1},
                "timezone": {"type": "string", "minLength": 1},
                "weekDays": array_schema({"type": "integer", "minimum": 0, "maximum": 6}, "Week days with Sunday as 0."),
                "startMinute": {"type": "integer", "minimum": 0, "maximum": 1440},
                "endMinute": {"type": "integer", "minimum": 0, "maximum": 1440},
                "startsOn": {
                    "anyOf": [
                        {"type": "string", "minLength": 1},
                        {"type": "null"},
                    ]
                },
                "endsOn": {
                    "anyOf": [
                        {"type": "string", "minLength": 1},
                        {"type": "null"},
                    ]
                },
                "blockingState": {"enum": ["allowed", "blocked"]},
            },
            required=[
                "title",
                "kind",
                "color",
                "timezone",
                "weekDays",
                "startMinute",
                "endMinute",
                "blockingState",
            ],
        ),
        "method": "POST",
        "path": "/api/v1/calendar/work-block-templates",
        "write": True,
    },
    {
        "name": "forge_recommend_task_timeboxes",
        "description": "Suggest future task timeboxes that fit the current calendar rules and current schedule. Use this when the agent wants candidate slots; if the slot is already clear from the calendar, create the timebox directly instead.",
        "parameters": object_schema(
            {
                "taskId": {"type": "string", "minLength": 1},
                "from": optional_string("Optional recommendation window start."),
                "to": optional_string("Optional recommendation window end."),
                "limit": {"type": "integer", "minimum": 1, "maximum": 24},
            },
            required=["taskId"],
        ),
        "method": "POST",
        "path": "/api/v1/calendar/timeboxes/recommend",
        "write": True,
    },
    {
        "name": "forge_create_task_timebox",
        "description": "Create a planned task timebox directly in Forge's calendar domain. This is the preferred manual timeboxing route once the agent has chosen a slot from the live calendar, and it also works to confirm a suggested slot.",
        "parameters": object_schema(
            {
                "taskId": {"type": "string", "minLength": 1},
                "projectId": optional_nullable_string("Optional project id."),
                "title": {"type": "string", "minLength": 1},
                "startsAt": {"type": "string", "minLength": 1},
                "endsAt": {"type": "string", "minLength": 1},
                "source": {"enum": ["manual", "suggested", "live_run"]},
                "overrideReason": optional_nullable_string("Optional note about why this slot exists or why it was chosen."),
                "activityPresetKey": optional_nullable_string("Optional activity preset key for the timebox AP profile."),
                "customSustainRateApPerHour": {
                    "type": ["number", "null"],
                    "minimum": 0,
                    "description": "Optional manual AP per hour override for the timebox."
                },
                "userId": optional_nullable_string("Optional owner override when the timebox should belong to a specific Forge user."),
            },
            required=["taskId", "title", "startsAt", "endsAt"],
        ),
        "method": "POST",
        "path": "/api/v1/calendar/timeboxes",
        "write": True,
    },
]
