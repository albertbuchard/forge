"""Shared Forge Hermes plugin tool catalog."""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from urllib.parse import urlencode


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


def calendar_overview_path(args: Dict[str, Any]) -> str:
    return with_query("/api/v1/calendar/overview", args, ["from", "to"])


def sync_calendar_connection_path(args: Dict[str, Any]) -> str:
    return f"/api/v1/calendar/connections/{args['connectionId']}/sync"


def start_task_run_path(args: Dict[str, Any]) -> str:
    return f"/api/v1/tasks/{args['taskId']}/runs"


def start_task_run_body(args: Dict[str, Any], _config: Any) -> Dict[str, Any]:
    return {
        "actor": args.get("actor"),
        "timerMode": args.get("timerMode"),
        "plannedDurationSeconds": args.get("plannedDurationSeconds"),
        "overrideReason": args.get("overrideReason"),
        "isCurrent": args.get("isCurrent"),
        "leaseTtlSeconds": args.get("leaseTtlSeconds"),
        "note": args.get("note"),
    }


def task_run_action_path(action: str, args: Dict[str, Any]) -> str:
    return f"/api/v1/task-runs/{args['taskRunId']}/{action}"


def heartbeat_task_run_path(args: Dict[str, Any]) -> str:
    return task_run_action_path("heartbeat", args)


def heartbeat_task_run_body(args: Dict[str, Any], _config: Any) -> Dict[str, Any]:
    return {
        "actor": args.get("actor"),
        "leaseTtlSeconds": args.get("leaseTtlSeconds"),
        "note": args.get("note"),
    }


def focus_task_run_path(args: Dict[str, Any]) -> str:
    return task_run_action_path("focus", args)


def focus_task_run_body(args: Dict[str, Any], _config: Any) -> Dict[str, Any]:
    return {"actor": args.get("actor")}


def complete_task_run_path(args: Dict[str, Any]) -> str:
    return task_run_action_path("complete", args)


def complete_task_run_body(args: Dict[str, Any], _config: Any) -> Dict[str, Any]:
    return {
        "actor": args.get("actor"),
        "note": args.get("note"),
        "closeoutNote": args.get("closeoutNote"),
    }


def release_task_run_path(args: Dict[str, Any]) -> str:
    return task_run_action_path("release", args)


def release_task_run_body(args: Dict[str, Any], _config: Any) -> Dict[str, Any]:
    return {
        "actor": args.get("actor"),
        "note": args.get("note"),
        "closeoutNote": args.get("closeoutNote"),
    }


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

TOOL_CATALOG: List[ToolSpec] = [
    {
        "name": "forge_get_operator_overview",
        "description": "Start here for most Forge work. Read the one-shot operator overview with current priorities, momentum, and onboarding guidance before searching or mutating.",
        "parameters": object_schema({}),
        "method": "GET",
        "path": "/api/v1/operator/overview",
    },
    {
        "name": "forge_get_operator_context",
        "description": "Read the current operational task board, focus queue, recent task runs, and XP state. Use this for current-work questions and work runtime decisions.",
        "parameters": object_schema({}),
        "method": "GET",
        "path": "/api/v1/operator/context",
    },
    {
        "name": "forge_get_agent_onboarding",
        "description": "Fetch the live Forge onboarding contract with the exact Forge tool list, batch payload rules, UI handoff rules, and verification guidance.",
        "parameters": object_schema({}),
        "method": "GET",
        "path": "/api/v1/agents/onboarding",
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
        "parameters": object_schema({}),
        "method": "GET",
        "path": "/api/v1/psyche/overview",
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
        "parameters": object_schema({}),
        "method": "GET",
        "path": "/api/v1/reviews/weekly",
    },
    {
        "name": "forge_get_current_work",
        "description": "Get the current live-work picture: active task runs, focus tasks, the recommended next task, and current XP state.",
        "parameters": object_schema({}),
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
        "description": "Create one or more Forge entities through the ordered batch workflow. Pass operations as an array. Each operation must include entityType and full data. This is the preferred create path for planning, Psyche, and calendar records including calendar_event, work_block_template, and task_timebox.",
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
        "description": "Update one or more Forge entities through the ordered batch workflow. Pass operations as an array. Each operation must include entityType, id, and patch. This is the preferred update path for calendar_event, work_block_template, and task_timebox too; Forge runs calendar sync side effects downstream.",
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
        "description": "Delete Forge entities in one batch request. Pass operations as an array with entityType and id. Delete defaults to soft mode unless hard is requested explicitly. Calendar-domain deletes still run their downstream removal logic, including remote calendar projection cleanup for calendar_event.",
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
            }
        ),
        "method": "GET",
        "path_builder": calendar_overview_path,
    },
    {
        "name": "forge_connect_calendar_provider",
        "description": "Create a Google, Apple, Exchange Online, or custom CalDAV calendar connection. Use this only for explicit provider-connection requests after discovery choices are known.",
        "parameters": object_schema(
            {
                "provider": {"enum": ["google", "apple", "caldav", "microsoft"]},
                "label": {"type": "string", "minLength": 1},
                "username": optional_string("Optional username."),
                "clientId": optional_string("Optional OAuth client id."),
                "clientSecret": optional_string("Optional OAuth client secret."),
                "refreshToken": optional_string("Optional refresh token."),
                "password": optional_string("Optional password or app password."),
                "serverUrl": optional_string("Optional CalDAV server url."),
                "authSessionId": optional_string("Optional Microsoft auth session id."),
                "selectedCalendarUrls": array_schema({"type": "string", "minLength": 1}, "Selected calendar urls."),
                "forgeCalendarUrl": optional_string("Optional writable Forge calendar url."),
                "createForgeCalendar": {"type": "boolean"},
            },
            required=["provider", "label"],
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
        "description": "Suggest future task timeboxes that fit the current calendar rules and current schedule.",
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
        "description": "Create a planned task timebox directly in Forge's calendar domain. This is a planning helper; agents can also use forge_create_entities with entityType task_timebox.",
        "parameters": object_schema(
            {
                "taskId": {"type": "string", "minLength": 1},
                "projectId": optional_nullable_string("Optional project id."),
                "title": {"type": "string", "minLength": 1},
                "startsAt": {"type": "string", "minLength": 1},
                "endsAt": {"type": "string", "minLength": 1},
                "source": {"enum": ["manual", "suggested", "live_run"]},
            },
            required=["taskId", "title", "startsAt", "endsAt"],
        ),
        "method": "POST",
        "path": "/api/v1/calendar/timeboxes",
        "write": True,
    },
]
