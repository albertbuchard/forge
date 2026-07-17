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


def array_schema(
    items: JsonSchema,
    description: Optional[str] = None,
    min_items: Optional[int] = None,
    max_items: Optional[int] = None,
) -> JsonSchema:
    schema: JsonSchema = {"type": "array", "items": items}
    if description:
        schema["description"] = description
    if min_items is not None:
        schema["minItems"] = min_items
    if max_items is not None:
        schema["maxItems"] = max_items
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
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            query_parts.append((key, str(value)))
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


def route_key_description(route_specs: Dict[str, Dict[str, Any]]) -> str:
    route_guide = "; ".join(
        f"{route_key}: {spec.get('method', 'GET')} {spec.get('path')}"
        for route_key, spec in sorted(route_specs.items())
    )
    return (
        f"Dedicated route key. Exact routes: {route_guide}. "
        "For any :placeholder shown in a route, fill pathParams with that exact "
        "placeholder name; do not put raw paths or ids into routeKey."
    )


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
    "flowDetail": {"method": "GET", "path": "/api/v1/workbench/flows/:id"},
    "flowById": {"method": "GET", "path": "/api/v1/workbench/flows/:id"},
    "flowBySlug": {"method": "GET", "path": "/api/v1/workbench/flows/by-slug/:slug"},
    "createFlow": {"method": "POST", "path": "/api/v1/workbench/flows", "write": True},
    "updateFlow": {"method": "PATCH", "path": "/api/v1/workbench/flows/:id", "write": True},
    "deleteFlow": {"method": "DELETE", "path": "/api/v1/workbench/flows/:id", "write": True},
    "runFlow": {"method": "POST", "path": "/api/v1/workbench/flows/:id/run", "write": True},
    "runByPayload": {"method": "POST", "path": "/api/v1/workbench/run", "write": True},
    "chatFlow": {"method": "POST", "path": "/api/v1/workbench/flows/:id/chat", "write": True},
    "publishedOutput": {"method": "GET", "path": "/api/v1/workbench/flows/:id/output"},
    "runHistory": {"method": "GET", "path": "/api/v1/workbench/flows/:id/runs"},
    "runs": {"method": "GET", "path": "/api/v1/workbench/flows/:id/runs"},
    "runDetail": {"method": "GET", "path": "/api/v1/workbench/flows/:id/runs/:runId"},
    "runNodes": {"method": "GET", "path": "/api/v1/workbench/flows/:id/runs/:runId/nodes"},
    "nodeResult": {"method": "GET", "path": "/api/v1/workbench/flows/:id/runs/:runId/nodes/:nodeId"},
    "latestNodeOutput": {"method": "GET", "path": "/api/v1/workbench/flows/:id/nodes/:nodeId/output"},
}

WORKBENCH_ROUTE_EXAMPLES: List[Dict[str, Any]] = [
    {
        "routeKey": "runFlow",
        "pathParams": {"id": "flow_research_digest"},
        "body": {"inputs": {"topic": "question flow quality"}},
    },
    {
        "routeKey": "runByPayload",
        "body": {
            "flowId": "flow_research_digest",
            "inputs": {"topic": "question flow quality"},
        },
    },
    {
        "routeKey": "chatFlow",
        "pathParams": {"id": "flow_research_digest"},
        "body": {
            "userInput": "Refine the summary around API route risks and keep the published output stable."
        },
    },
]

ARTIFACT_ROUTE_SPECS: Dict[str, Dict[str, Any]] = {
    "list": {"method": "GET", "path": "/api/v1/artifacts"},
    "createWithBytes": {"method": "POST", "path": "/api/v1/artifacts", "write": True},
    "readMetadata": {"method": "GET", "path": "/api/v1/artifacts/:id"},
    "updateMetadata": {"method": "PATCH", "path": "/api/v1/artifacts/:id", "write": True},
    "rescan": {"method": "POST", "path": "/api/v1/artifacts/:id/scan", "write": True},
    "enrichWithLlm": {"method": "POST", "path": "/api/v1/artifacts/:id/enrich", "write": True},
    "replaceGenericLinks": {"method": "POST", "path": "/api/v1/artifacts/:id/links", "write": True},
    "trustState": {"method": "POST", "path": "/api/v1/artifacts/:id/trust", "write": True},
    "versions": {"method": "GET", "path": "/api/v1/artifacts/:id/versions"},
    "audit": {"method": "GET", "path": "/api/v1/artifacts/:id/audit"},
}

ARTIFACT_ROUTE_EXAMPLES: List[Dict[str, Any]] = [
    {
        "routeKey": "createWithBytes",
        "body": {
            "idempotencyKey": "artifact-upload-budget-2026-07-16",
            "originalFileName": "budget.xlsx",
            "contentBase64": "<base64>",
            "title": "Thesis budget workbook",
            "sourceLabel": "Research budget folder",
            "useLlmEnrichment": True,
        },
    },
]

LIFE_EVENT_ROUTE_SPECS: Dict[str, Dict[str, Any]] = {
    "timeline": {"method": "GET", "path": "/api/v1/life-events/timeline"},
    "read": {"method": "GET", "path": "/api/v1/life-events/:id"},
    "calendarSync": {"method": "POST", "path": "/api/v1/life-events/:id/calendar-sync", "write": True},
    "fromCalendarEvent": {"method": "POST", "path": "/api/v1/life-events/from-calendar-event", "write": True},
    "importTicket": {"method": "POST", "path": "/api/v1/life-events/import-ticket", "write": True},
    "travelStatus": {"method": "GET", "path": "/api/v1/life-events/:id/travel-status"},
}

ATTENTION_ROUTE_SPECS: Dict[str, Dict[str, Any]] = {
    "list": {"method": "GET", "path": "/api/v1/attention-inbox"},
    "snooze": {"method": "POST", "path": "/api/v1/attention-inbox/:id/snooze", "write": True},
    "dismiss": {"method": "POST", "path": "/api/v1/attention-inbox/:id/dismiss", "write": True},
    "restore": {"method": "POST", "path": "/api/v1/attention-inbox/:id/restore", "write": True},
}

ENTITY_NAVIGATION_ROUTE_SPECS: Dict[str, Dict[str, Any]] = {
    "list": {"method": "GET", "path": "/api/v1/entity-navigation"},
    "touch": {"method": "POST", "path": "/api/v1/entity-navigation/touch", "write": True},
}

CALENDAR_CONNECTION_ROUTE_SPECS: Dict[str, Dict[str, Any]] = {
    "list": {"method": "GET", "path": "/api/v1/calendar/connections"},
    "discover": {"method": "POST", "path": "/api/v1/calendar/discovery", "write": True},
    "discoverMacOSLocal": {"method": "GET", "path": "/api/v1/calendar/macos-local/discovery"},
    "rediscover": {"method": "GET", "path": "/api/v1/calendar/connections/:id/discovery"},
    "create": {"method": "POST", "path": "/api/v1/calendar/connections", "write": True},
    "update": {"method": "PATCH", "path": "/api/v1/calendar/connections/:id", "write": True},
    "sync": {"method": "POST", "path": "/api/v1/calendar/connections/:id/sync", "write": True},
    "delete": {"method": "DELETE", "path": "/api/v1/calendar/connections/:id", "write": True},
}

WIKI_ROUTE_SPECS: Dict[str, Dict[str, Any]] = {
    "list": {"method": "GET", "path": "/api/v1/wiki/pages"},
    "search": {"method": "POST", "path": "/api/v1/wiki/search"},
    "create": {"method": "POST", "path": "/api/v1/wiki/pages", "write": True},
    "read": {"method": "GET", "path": "/api/v1/wiki/pages/:id"},
    "readBySlug": {"method": "GET", "path": "/api/v1/wiki/by-slug/:slug"},
    "update": {"method": "PATCH", "path": "/api/v1/wiki/pages/:id", "write": True},
    "delete": {"method": "DELETE", "path": "/api/v1/wiki/pages/:id", "write": True},
    "health": {"method": "GET", "path": "/api/v1/wiki/health"},
    "sync": {"method": "POST", "path": "/api/v1/wiki/sync", "write": True},
    "reindex": {"method": "POST", "path": "/api/v1/wiki/reindex", "write": True},
    "ingest": {"method": "POST", "path": "/api/v1/wiki/ingest-jobs", "write": True},
}


def _people_peer_id_schema() -> JsonSchema:
    return {"type": "string", "minLength": 1, "maxLength": 240}


def _people_peer_version_schema() -> JsonSchema:
    return {"type": "string", "minLength": 1, "maxLength": 240}


def _people_peer_cursor_schema() -> JsonSchema:
    return {
        "type": "string",
        "minLength": 8,
        "maxLength": 2048,
        "pattern": r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$",
    }


def _people_peer_hash_schema() -> JsonSchema:
    return {"type": "string", "pattern": "^[a-f0-9]{64}$"}


def _people_peer_idempotency_key_schema() -> JsonSchema:
    return {
        "type": "string",
        "minLength": 16,
        "maxLength": 240,
        "pattern": "^[A-Za-z0-9._:-]+$",
    }


def _people_peer_enum(values: List[str], default: Any = None) -> JsonSchema:
    schema: JsonSchema = {"type": "string", "enum": values}
    if default is not None:
        schema["default"] = default
    return schema


PEER_PROJECTION_IDS = [
    "calendar.availability.v1",
    "calendar.selected_events.v1",
    "goals.horizon_summary.v1",
    "health.cycling.aggregate.v1",
    "person.profile.v1",
    "life_events.selected.v1",
    "movement.aggregate.v1",
    "custom.selected_entities.v1",
]


def _people_wiki_decision_schema() -> JsonSchema:
    return {
        "anyOf": [
            object_schema(
                {
                    "wikiPageId": _people_peer_id_schema(),
                    "action": {"type": "string", "const": "associate"},
                    "personId": _people_peer_id_schema(),
                    "expectedWikiVersion": _people_peer_version_schema(),
                    "expectedPersonVersion": _people_peer_version_schema(),
                },
                required=[
                    "wikiPageId",
                    "action",
                    "personId",
                    "expectedWikiVersion",
                    "expectedPersonVersion",
                ],
            ),
            object_schema(
                {
                    "wikiPageId": _people_peer_id_schema(),
                    "action": {"type": "string", "const": "create_person"},
                    "displayName": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 160,
                    },
                    "preferredName": {
                        "type": "string",
                        "maxLength": 160,
                    },
                    "relationshipCategory": _people_peer_enum(
                        [
                            "family",
                            "friend",
                            "partner",
                            "colleague",
                            "community",
                            "professional",
                            "other",
                        ]
                    ),
                    "relationshipLabel": {
                        "type": "string",
                        "maxLength": 240,
                    },
                    "shortDescription": {
                        "type": "string",
                        "maxLength": 2000,
                    },
                    "aliases": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 160,
                        },
                        "maxItems": 32,
                    },
                    "expectedWikiVersion": _people_peer_version_schema(),
                },
                required=[
                    "wikiPageId",
                    "action",
                    "displayName",
                    "expectedWikiVersion",
                ],
            ),
            object_schema(
                {
                    "wikiPageId": _people_peer_id_schema(),
                    "action": {"type": "string", "const": "skip"},
                    "expectedWikiVersion": _people_peer_version_schema(),
                },
                required=["wikiPageId", "action", "expectedWikiVersion"],
            ),
        ]
    }


def _list_people_query_schema() -> JsonSchema:
    return object_schema(
        {
            "userId": _people_peer_id_schema(),
            "query": {"type": "string", "maxLength": 200},
            "relationshipStatus": _people_peer_enum(
                ["none", "pending", "active", "paused", "revoked"]
            ),
            "source": _people_peer_enum(["local", "shared", "both"], "both"),
            "hasUpcomingSharedContext": {"type": "boolean"},
            "sort": _people_peer_enum(
                ["display_name", "updated_at", "next_shared_event"],
                "display_name",
            ),
            "direction": _people_peer_enum(["asc", "desc"], "asc"),
            "cursor": _people_peer_cursor_schema(),
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100,
                "default": 50,
            },
        }
    )


def _person_context_query_schema() -> JsonSchema:
    return object_schema(
        {
            "includePrivate": {"type": "boolean", "default": False},
            "includeShared": {"type": "boolean", "default": True},
            "linkLimit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 200,
                "default": 100,
            },
            "projectionLimit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100,
                "default": 40,
            },
        }
    )


def _people_wiki_candidate_scan_body_schema() -> JsonSchema:
    return object_schema(
        {
            "userId": _people_peer_id_schema(),
            "peopleRootPageId": _people_peer_id_schema(),
            "query": {"type": "string", "maxLength": 200},
            "cursor": _people_peer_cursor_schema(),
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100,
                "default": 50,
            },
        },
        required=["peopleRootPageId"],
    )


def _people_wiki_association_preview_body_schema() -> JsonSchema:
    return object_schema(
        {
            "userId": _people_peer_id_schema(),
            "peopleRootPageId": _people_peer_id_schema(),
            "decisions": array_schema(
                _people_wiki_decision_schema(), min_items=1, max_items=100
            ),
        },
        required=["peopleRootPageId", "decisions"],
    )


def _people_wiki_association_apply_body_schema() -> JsonSchema:
    return object_schema(
        {
            "userId": _people_peer_id_schema(),
            "peopleRootPageId": _people_peer_id_schema(),
            "previewId": _people_peer_id_schema(),
            "previewHash": _people_peer_hash_schema(),
            "idempotencyKey": _people_peer_idempotency_key_schema(),
            "decisions": array_schema(
                _people_wiki_decision_schema(), min_items=1, max_items=100
            ),
        },
        required=[
            "peopleRootPageId",
            "previewId",
            "previewHash",
            "idempotencyKey",
            "decisions",
        ],
    )


def _peer_requests_query_schema() -> JsonSchema:
    return object_schema(
        {
            "kind": _people_peer_enum(["pairing", "device", "grant"]),
            "status": _people_peer_enum(
                ["pending", "accepted", "rejected", "expired"]
            ),
            "cursor": _people_peer_cursor_schema(),
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100,
                "default": 50,
            },
        }
    )


def _peer_relationships_query_schema() -> JsonSchema:
    return object_schema(
        {
            "query": {"type": "string", "maxLength": 200},
            "status": _people_peer_enum(
                [
                    "pending_verification",
                    "active",
                    "paused",
                    "revoked",
                    "recovery_required",
                ]
            ),
            "cursor": _people_peer_cursor_schema(),
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100,
                "default": 50,
            },
        }
    )


def _peer_grants_query_schema() -> JsonSchema:
    return object_schema(
        {
            "status": _people_peer_enum(
                [
                    "draft",
                    "proposed",
                    "active",
                    "countered",
                    "rejected",
                    "revoked",
                    "superseded",
                    "expired",
                    "conflicted",
                ]
            ),
            "cursor": _people_peer_cursor_schema(),
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100,
                "default": 50,
            },
        }
    )


def _peer_diagnostics_query_schema() -> JsonSchema:
    return object_schema(
        {
            "cursor": _people_peer_cursor_schema(),
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 200,
                "default": 100,
            },
        }
    )


def _person_question_interpret_body_schema() -> JsonSchema:
    return object_schema(
        {
            "question": {"type": "string", "minLength": 1, "maxLength": 1000},
            "timeZone": {"type": "string", "minLength": 1, "maxLength": 100},
            "referenceTime": {"type": "string", "format": "date-time"},
        },
        required=["question", "timeZone"],
    )


def _person_typed_question_schema() -> JsonSchema:
    interval = object_schema(
        {
            "startsAt": {"type": "string", "format": "date-time"},
            "endsAt": {"type": "string", "format": "date-time"},
            "timeZone": {"type": "string", "minLength": 1, "maxLength": 64},
        },
        required=["startsAt", "endsAt", "timeZone"],
    )

    def variant(
        projection_id: str,
        parameters: JsonSchema,
        query_interval: JsonSchema,
        fields: List[str],
        entity_limit: int,
        precision: JsonSchema,
    ) -> JsonSchema:
        return object_schema(
            {
                "projectionId": {"type": "string", "const": projection_id},
                "parameters": parameters,
                "interval": query_interval,
                "entityIds": array_schema(
                    _people_peer_id_schema(), max_items=entity_limit
                )
                | {"default": []},
                "fields": array_schema(
                    _people_peer_enum(fields), max_items=len(fields)
                )
                | {"default": []},
                "precision": precision,
                "maximumResultCount": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 1000,
                    "default": 100,
                },
            },
            required=["projectionId", "parameters", "interval", "precision"],
        )

    empty_parameters = object_schema({})
    exact = {"type": "string", "const": "exact"}
    calendar_fields = [
        "start",
        "end",
        "timezone",
        "busyState",
        "eventTitle",
        "eventLocation",
    ]
    return {
        "anyOf": [
            variant(
                "calendar.availability.v1",
                empty_parameters,
                interval,
                calendar_fields,
                0,
                _people_peer_enum(["exact", "fifteen_minutes", "hour"]),
            ),
            variant(
                "calendar.selected_events.v1",
                empty_parameters,
                interval,
                calendar_fields,
                256,
                exact,
            ),
            variant(
                "goals.horizon_summary.v1",
                empty_parameters,
                interval,
                ["goalTitle", "goalSummary", "goalState", "goalProgress"],
                0,
                exact,
            ),
            variant(
                "health.cycling.aggregate.v1",
                object_schema(
                    {
                        "granularity": _people_peer_enum(["day", "week", "month"]),
                        "units": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 240,
                        },
                    },
                    required=["granularity", "units"],
                ),
                interval,
                ["duration", "distance", "activityCount", "energy"],
                0,
                exact,
            ),
            variant(
                "person.profile.v1",
                empty_parameters,
                {"type": "null"},
                [
                    "displayName",
                    "preferredName",
                    "pronouns",
                    "relationshipLabel",
                    "shortDescription",
                ],
                0,
                exact,
            ),
            variant(
                "life_events.selected.v1",
                empty_parameters,
                interval,
                ["lifeEventTitle", "lifeEventType", "lifeEventPlace"],
                256,
                exact,
            ),
            variant(
                "movement.aggregate.v1",
                object_schema(
                    {
                        "granularity": _people_peer_enum(["day", "week", "month"])
                    },
                    required=["granularity"],
                ),
                interval,
                ["movementDuration", "movementDistance"],
                0,
                exact,
            ),
            variant(
                "custom.selected_entities.v1",
                empty_parameters,
                {"type": "null"},
                ["customTitle", "customSummary", "customState"],
                256,
                exact,
            ),
        ]
    }


def _person_question_execute_body_schema() -> JsonSchema:
    return object_schema(
        {
            "interpretationId": _people_peer_id_schema(),
            "interpretationHash": _people_peer_hash_schema(),
            "query": _person_typed_question_schema(),
            "sourcePreference": _people_peer_enum(
                ["live_then_cache", "live_only", "cache_only"],
                "live_then_cache",
            ),
        },
        required=["interpretationId", "interpretationHash", "query"],
    )


def _person_question_history_query_schema() -> JsonSchema:
    return object_schema(
        {
            "cursor": _people_peer_cursor_schema(),
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100,
                "default": 50,
            },
        }
    )


def _people_peer_route_spec(
    operation_id: str,
    method: str,
    path: str,
    scopes: List[str],
    principals: List[str],
    params: JsonSchema,
    query: JsonSchema,
    body: Optional[JsonSchema] = None,
) -> Dict[str, Any]:
    spec: Dict[str, Any] = {
        "operationId": operation_id,
        "method": method,
        "path": path,
        "requiredScopes": scopes,
        "principalClasses": principals,
        "humanOnly": False,
        "mcpExposed": True,
        "write": method != "GET",
        "params": params,
        "query": query,
    }
    if body is not None:
        spec["body"] = body
    return spec


_OPERATOR_AGENT = ["operator_session", "agent_token"]
_OPERATOR_AGENT_COMPANION = [
    "operator_session",
    "agent_token",
    "companion_session",
]
_EMPTY_PEOPLE_PEER_SCHEMA = object_schema({})
_PERSON_PATH_SCHEMA = object_schema(
    {"personId": _people_peer_id_schema()}, required=["personId"]
)
_RELATIONSHIP_PATH_SCHEMA = object_schema(
    {"relationshipId": _people_peer_id_schema()}, required=["relationshipId"]
)


PEOPLE_AGENT_ROUTE_SPECS: Dict[str, Dict[str, Any]] = {
    "listPeopleReadModel": _people_peer_route_spec(
        "listPeopleReadModel", "GET", "/api/v1/people",
        ["people:read:basic"], _OPERATOR_AGENT,
        _EMPTY_PEOPLE_PEER_SCHEMA, _list_people_query_schema(),
    ),
    "getPersonContext": _people_peer_route_spec(
        "getPersonContext", "GET", "/api/v1/people/:personId/context",
        ["people:read:basic"], _OPERATOR_AGENT,
        _PERSON_PATH_SCHEMA, _person_context_query_schema(),
    ),
    "scanPeopleWikiCandidates": _people_peer_route_spec(
        "scanPeopleWikiCandidates", "POST", "/api/v1/people/wiki-candidates/scan",
        ["people:read:basic", "wiki:read"], _OPERATOR_AGENT,
        _EMPTY_PEOPLE_PEER_SCHEMA, _EMPTY_PEOPLE_PEER_SCHEMA,
        _people_wiki_candidate_scan_body_schema(),
    ),
    "previewPeopleWikiAssociations": _people_peer_route_spec(
        "previewPeopleWikiAssociations", "POST", "/api/v1/people/wiki-associations/preview",
        ["people:write", "wiki:read"], _OPERATOR_AGENT,
        _EMPTY_PEOPLE_PEER_SCHEMA, _EMPTY_PEOPLE_PEER_SCHEMA,
        _people_wiki_association_preview_body_schema(),
    ),
    "applyPeopleWikiAssociations": _people_peer_route_spec(
        "applyPeopleWikiAssociations", "POST", "/api/v1/people/wiki-associations/apply",
        ["people:write", "wiki:read"], _OPERATOR_AGENT,
        _EMPTY_PEOPLE_PEER_SCHEMA, _EMPTY_PEOPLE_PEER_SCHEMA,
        _people_wiki_association_apply_body_schema(),
    ),
    "interpretPersonQuestion": _people_peer_route_spec(
        "interpretPersonQuestion", "POST", "/api/v1/people/:personId/questions/interpret",
        ["people:read:basic", "peer:query"], _OPERATOR_AGENT,
        _PERSON_PATH_SCHEMA, _EMPTY_PEOPLE_PEER_SCHEMA,
        _person_question_interpret_body_schema(),
    ),
    "executePersonQuestion": _people_peer_route_spec(
        "executePersonQuestion", "POST", "/api/v1/people/:personId/questions/execute",
        ["people:read:basic", "peer:query"], _OPERATOR_AGENT,
        _PERSON_PATH_SCHEMA, _EMPTY_PEOPLE_PEER_SCHEMA,
        _person_question_execute_body_schema(),
    ),
    "listPersonQuestionHistory": _people_peer_route_spec(
        "listPersonQuestionHistory", "GET", "/api/v1/people/:personId/questions",
        ["people:read:basic", "peer:query"], _OPERATOR_AGENT,
        _PERSON_PATH_SCHEMA, _person_question_history_query_schema(),
    ),
}


PEER_AGENT_ROUTE_SPECS: Dict[str, Dict[str, Any]] = {
    "listPeerRequests": _people_peer_route_spec(
        "listPeerRequests", "GET", "/api/v1/peers/requests",
        ["peer:status"], _OPERATOR_AGENT_COMPANION,
        _EMPTY_PEOPLE_PEER_SCHEMA, _peer_requests_query_schema(),
    ),
    "listPeerRelationships": _people_peer_route_spec(
        "listPeerRelationships", "GET", "/api/v1/peers/relationships",
        ["peer:status"], _OPERATOR_AGENT_COMPANION,
        _EMPTY_PEOPLE_PEER_SCHEMA, _peer_relationships_query_schema(),
    ),
    "getPeerRelationship": _people_peer_route_spec(
        "getPeerRelationship", "GET", "/api/v1/peers/relationships/:relationshipId",
        ["peer:status"], _OPERATOR_AGENT_COMPANION,
        _RELATIONSHIP_PATH_SCHEMA, _EMPTY_PEOPLE_PEER_SCHEMA,
    ),
    "listPeerDevices": _people_peer_route_spec(
        "listPeerDevices", "GET", "/api/v1/peers/relationships/:relationshipId/devices",
        ["peer:status"], _OPERATOR_AGENT_COMPANION,
        _RELATIONSHIP_PATH_SCHEMA, _EMPTY_PEOPLE_PEER_SCHEMA,
    ),
    "listPeerGrants": _people_peer_route_spec(
        "listPeerGrants", "GET", "/api/v1/peers/relationships/:relationshipId/grants",
        ["peer:status"], _OPERATOR_AGENT_COMPANION,
        _RELATIONSHIP_PATH_SCHEMA, _peer_grants_query_schema(),
    ),
    "getPeerSyncStatus": _people_peer_route_spec(
        "getPeerSyncStatus", "GET", "/api/v1/peers/relationships/:relationshipId/sync",
        ["peer:status"], _OPERATOR_AGENT_COMPANION,
        _RELATIONSHIP_PATH_SCHEMA, _EMPTY_PEOPLE_PEER_SCHEMA,
    ),
    "getPeerDiagnostics": _people_peer_route_spec(
        "getPeerDiagnostics", "GET", "/api/v1/peers/relationships/:relationshipId/diagnostics",
        ["peer:status"], _OPERATOR_AGENT_COMPANION,
        _RELATIONSHIP_PATH_SCHEMA, _peer_diagnostics_query_schema(),
    ),
}


def people_peer_route_parameters(
    route_specs: Dict[str, Dict[str, Any]],
) -> JsonSchema:
    variants: List[JsonSchema] = []
    for route_key, spec in route_specs.items():
        contract = (
            f"{spec['operationId']}: {spec['method']} {spec['path']}; "
            f"scopes: {', '.join(spec['requiredScopes'])}; "
            f"principals: {', '.join(spec['principalClasses'])}."
        )
        properties: Dict[str, Any] = {
            "routeKey": {"type": "string", "const": route_key, "description": contract}
        }
        required = ["routeKey"]
        if spec["params"].get("properties"):
            properties["pathParams"] = spec["params"]
            required.append("pathParams")
        if spec["query"].get("properties"):
            properties["query"] = spec["query"]
        if spec.get("body") is not None:
            properties["body"] = spec["body"]
            required.append("body")
        variants.append(object_schema(properties, required=required))
    return {
        "oneOf": variants,
        "description": (
            "Choose one published MCP operation id. Each variant fixes the exact "
            "method, path parameters, query fields, JSON body, principal classes, "
            "and local token scopes accepted by Forge."
        ),
    }


def specialized_route_parameters(
    route_specs: Dict[str, Dict[str, Any]],
    examples: Optional[List[Dict[str, Any]]] = None,
) -> JsonSchema:
    schema = object_schema(
        {
            "routeKey": {
                "enum": sorted(route_specs.keys()),
                "description": route_key_description(route_specs),
            },
            "pathParams": {
                "type": "object",
                "additionalProperties": {"type": "string"},
                "description": "Path parameters required by the selected route key. Use the exact :placeholder names shown in the routeKey description, such as id, weekday, slug, runId, nodeId, or pointId.",
            },
            "query": {
                "type": "object",
                "additionalProperties": True,
                "description": "Optional query parameters for the selected dedicated route.",
            },
            "body": {
                "type": "object",
                "description": "JSON body for POST, PATCH, and PUT route keys. Omit for GET and DELETE route keys.",
            },
        },
        required=["routeKey"],
    )
    if examples:
        schema["examples"] = examples
    return schema


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
    path = with_query("/api/v1/health/fitness", args, ["userIds"])
    return f"{path}{'&' if '?' in path else '?'}compact=1"


def training_load_overview_path(args: Dict[str, Any]) -> str:
    return with_query("/api/v1/health/training-load", args, ["userIds"])


def weight_loss_overview_path(args: Dict[str, Any]) -> str:
    return with_query("/api/v1/health/weight-loss", args, ["userIds"])


def nutrition_scoped_path(path: str, args: Dict[str, Any]) -> str:
    return with_query(path, args, ["userIds"])


def nutrition_experiment_path(args: Dict[str, Any]) -> str:
    experiment_id = str(args.get("experimentId") or "").strip()
    if not experiment_id:
        raise ValueError("Nutrition experiment updates require a non-empty experimentId.")
    return nutrition_scoped_path(f"/api/v1/health/weight-loss/experiments/{experiment_id}", args)


def without_user_ids_body(args: Dict[str, Any], _config: Any) -> Dict[str, Any]:
    return {key: value for key, value in args.items() if key not in {"userIds", "experimentId"}}


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
    include_completion: bool = False,
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
    if include_completion and args.get("completionReport") is not None:
        body["completionReport"] = args.get("completionReport")
    if include_completion and args.get("gitRefs") is not None:
        body["gitRefs"] = args.get("gitRefs")
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
    return _task_run_actor_body(args, include_closeout=True, include_completion=True)


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

COMPLETION_REPORT_INPUT = object_schema(
    {
        "modifiedFiles": array_schema(
            {
                "type": "string",
                "minLength": 1,
                "maxLength": 512,
                "description": "Safe repository-relative path without traversal.",
            },
            max_items=256,
        )
        | {"uniqueItems": True},
        "workSummary": {"type": "string", "maxLength": 8000},
        "linkedGitRefIds": array_schema(
            {"type": "string", "minLength": 1, "maxLength": 128},
            max_items=64,
        )
        | {"uniqueItems": True},
    }
)

WORK_ITEM_GIT_REF_INPUT = object_schema(
    {
        "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
        },
        "refType": {"type": "string", "enum": ["commit", "branch", "pull_request"]},
        "provider": {"type": "string", "maxLength": 64, "default": "git"},
        "repository": {"type": "string", "maxLength": 255, "default": ""},
        "refValue": {"type": "string", "minLength": 1, "maxLength": 512},
        "url": {
            "anyOf": [
                {
                    "type": "string",
                    "format": "uri",
                    "pattern": "^https?://",
                    "maxLength": 2048,
                },
                {"type": "null"},
            ]
        },
        "displayTitle": {"type": "string", "maxLength": 512, "default": ""},
    },
    required=["refType", "refValue"],
)

NUTRITION_MEAL_ITEM = object_schema(
    {
        "foodId": optional_nullable_string("Existing nutrition_food_catalog id from forge_search_foods/forge_search_nutrition_foods."),
        "name": {"type": "string", "minLength": 1},
        "brand": optional_nullable_string("Optional brand."),
        "quantity": {"type": "number", "minimum": 0},
        "unit": optional_nullable_string("Serving unit."),
        "grams": {"anyOf": [{"type": "number"}, {"type": "null"}]},
        "caloriesKcal": {"anyOf": [{"type": "number"}, {"type": "null"}]},
        "proteinG": {"anyOf": [{"type": "number"}, {"type": "null"}]},
        "carbsG": {"anyOf": [{"type": "number"}, {"type": "null"}]},
        "fatG": {"anyOf": [{"type": "number"}, {"type": "null"}]},
        "fiberG": {"anyOf": [{"type": "number"}, {"type": "null"}]},
        "tags": array_schema({"type": "string"}, "Optional food tags."),
        "confidence": {"anyOf": [{"type": "number"}, {"type": "null"}]},
    },
    required=["name", "quantity"],
)

NUTRITION_FOOD_LOG = object_schema(
    {
        "userIds": array_schema({"type": "string"}, "Optional user ownership scope."),
        "loggedAt": optional_string("Optional ISO logged-at timestamp."),
        "mealLabel": optional_nullable_string("Optional meal label."),
        "source": {"enum": ["manual", "search", "barcode", "chatgpt", "photo", "saved_meal"]},
        "confirmationState": {"enum": ["candidate", "confirmed", "needs_review", "discarded"]},
        "satietyScore": {"anyOf": [{"type": "number"}, {"type": "null"}]},
        "hungerBefore": {"anyOf": [{"type": "number"}, {"type": "null"}]},
        "hungerAfter": {"anyOf": [{"type": "number"}, {"type": "null"}]},
        "cravingScore": {"anyOf": [{"type": "number"}, {"type": "null"}]},
        "enjoymentScore": {"anyOf": [{"type": "number"}, {"type": "null"}]},
        "notes": optional_nullable_string("Optional notes."),
        "items": array_schema(NUTRITION_MEAL_ITEM, "Food items in the meal."),
    },
    required=["items"],
)

NUTRITION_SCORE_CHECKIN = object_schema(
    {
        "userIds": array_schema({"type": "string"}, "Optional user ownership scope."),
        "checkedAt": optional_string("Optional ISO checked-at timestamp."),
        "notes": optional_nullable_string("Optional notes."),
    }
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
        "limit": {"type": "integer", "minimum": 1, "maximum": 200},
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
        "idempotencyKey": {"type": "string", "minLength": 1, "maxLength": 128},
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
    return with_query(
        "/api/v1/wiki/pages", args, ["spaceId", "kind", "limit", "offset"]
    )


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
        "description": "Fetch the live Forge onboarding contract. Call this before the first Forge read or write in a session; entityCatalog is the exact source of truth for entity types, required fields, question flows, classifications, and preferred read/mutation paths, while specialized route maps are the exact source of truth for route keys, methods, paths, and placeholders.",
        "parameters": object_schema({}),
        "method": "GET",
        "path": "/api/v1/agents/onboarding",
    },
    {
        "name": "forge_call_attention_route",
        "description": "Call one allowed dedicated Attention route to list the current actor's bounded queue or snooze, dismiss, and restore an eligible item. Use the stable item id returned by list through pathParams.id. Do not invent attention records or use batch CRUD for this derived queue.",
        "parameters": specialized_route_parameters(ATTENTION_ROUTE_SPECS),
        "method_builder": lambda args: specialized_route_method(ATTENTION_ROUTE_SPECS, args),
        "path_builder": lambda args: specialized_route_path(ATTENTION_ROUTE_SPECS, args),
        "body_builder": specialized_route_body,
        "write_builder": lambda args: specialized_route_write(ATTENTION_ROUTE_SPECS, args),
    },
    {
        "name": "forge_call_entity_navigation_route",
        "description": "Call the dedicated Entity Navigation list or touch route. List returns bounded canonical pins and this agent's own recent records. Touch records that this agent viewed an existing in-scope record. Human pin and unpin operations are intentionally unavailable to agents.",
        "parameters": specialized_route_parameters(ENTITY_NAVIGATION_ROUTE_SPECS),
        "method_builder": lambda args: specialized_route_method(ENTITY_NAVIGATION_ROUTE_SPECS, args),
        "path_builder": lambda args: specialized_route_path(ENTITY_NAVIGATION_ROUTE_SPECS, args),
        "body_builder": specialized_route_body,
        "write_builder": lambda args: specialized_route_write(ENTITY_NAVIGATION_ROUTE_SPECS, args),
    },
    {
        "name": "forge_call_calendar_connection_route",
        "description": "Call one allowed dedicated Calendar Connection lifecycle route for list, provider discovery, macOS-local discovery, rediscovery, create, selected-calendar update, sync, or delete. Read the current connection first for existing-record changes and do not use batch CRUD for calendar connections.",
        "parameters": specialized_route_parameters(CALENDAR_CONNECTION_ROUTE_SPECS),
        "method_builder": lambda args: specialized_route_method(CALENDAR_CONNECTION_ROUTE_SPECS, args),
        "path_builder": lambda args: specialized_route_path(CALENDAR_CONNECTION_ROUTE_SPECS, args),
        "body_builder": specialized_route_body,
        "write_builder": lambda args: specialized_route_write(CALENDAR_CONNECTION_ROUTE_SPECS, args),
    },
    {
        "name": "forge_call_wiki_route",
        "description": "Call one allowed dedicated Wiki lifecycle route for list, search, create, id or slug read, update, delete, health, sync, reindex, or ingest. Read the exact page before existing-page changes and do not use batch CRUD for wiki pages.",
        "parameters": specialized_route_parameters(WIKI_ROUTE_SPECS),
        "method_builder": lambda args: specialized_route_method(WIKI_ROUTE_SPECS, args),
        "path_builder": lambda args: specialized_route_path(WIKI_ROUTE_SPECS, args),
        "body_builder": specialized_route_body,
        "write_builder": lambda args: specialized_route_write(WIKI_ROUTE_SPECS, args),
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
        "description": "Call one allowed dedicated Workbench route after the conversation has narrowed to flow catalog, flow CRUD, execution, run history, published output, node result, or latest node output. Do not use batch CRUD for Workbench. Mutations return explicit read-back verification status when Forge returns enough ids to verify the affected flow or run.",
        "parameters": specialized_route_parameters(
            WORKBENCH_ROUTE_SPECS, WORKBENCH_ROUTE_EXAMPLES
        ),
        "method_builder": lambda args: specialized_route_method(WORKBENCH_ROUTE_SPECS, args),
        "path_builder": lambda args: specialized_route_path(WORKBENCH_ROUTE_SPECS, args),
        "body_builder": specialized_route_body,
        "write_builder": lambda args: specialized_route_write(WORKBENCH_ROUTE_SPECS, args),
    },
    {
        "name": "forge_call_artifact_route",
        "description": "Call one allowed dedicated Artifact Store route for metadata listing, trusted upload, metadata update, static rescan, LLM metadata enrichment, generic entity-link replacement, trust state, versions, or audit. For createWithBytes, put one stable per-file idempotencyKey in the body and reuse it only for an exact transport retry; Forge normalizes agent provenance and rejects changed-payload key reuse. Agents may read contentProtection metadata and password hints, but must not receive, store, submit, or route artifact passwords. Do not expose download, password download, decrypt, open, execute, preview, or transform stored file bytes as an agent.",
        "parameters": specialized_route_parameters(
            ARTIFACT_ROUTE_SPECS, ARTIFACT_ROUTE_EXAMPLES
        ),
        "method_builder": lambda args: specialized_route_method(ARTIFACT_ROUTE_SPECS, args),
        "path_builder": lambda args: specialized_route_path(ARTIFACT_ROUTE_SPECS, args),
        "body_builder": specialized_route_body,
        "write_builder": lambda args: specialized_route_write(ARTIFACT_ROUTE_SPECS, args),
    },
    {
        "name": "forge_call_life_event_route",
        "description": "Call one allowed dedicated Life Events route for timeline reads, one-event reads, calendar linking or creation, marking a calendar event as a Life Event, ticket artifact import, or travel-status reads. Use shared batch CRUD for normal stored life_event create, update, delete, restore, and search. Use generic entity_links for relationships.",
        "parameters": specialized_route_parameters(LIFE_EVENT_ROUTE_SPECS),
        "method_builder": lambda args: specialized_route_method(LIFE_EVENT_ROUTE_SPECS, args),
        "path_builder": lambda args: specialized_route_path(LIFE_EVENT_ROUTE_SPECS, args),
        "body_builder": specialized_route_body,
        "write_builder": lambda args: specialized_route_write(LIFE_EVENT_ROUTE_SPECS, args),
    },
    {
        "name": "forge_call_people_route",
        "description": "Call one MCP-exposed People read or reviewed Wiki-association operation, or interpret, execute, and review a typed question against an existing directional grant. Person create, search, update, soft delete, restore, and general links stay on shared batch CRUD. Every call requires a configured agent token with the published People, Wiki, or peer-query scopes. For typed answers preserve result.state plus metadata source, freshness, precision, completeness, and redactedFields; never infer withheld fields. Agents cannot pair Forge installations or change consent, grants, devices, credentials, or human-presence approvals.",
        "parameters": people_peer_route_parameters(PEOPLE_AGENT_ROUTE_SPECS),
        "method_builder": lambda args: specialized_route_method(PEOPLE_AGENT_ROUTE_SPECS, args),
        "path_builder": lambda args: specialized_route_path(PEOPLE_AGENT_ROUTE_SPECS, args),
        "body_builder": specialized_route_body,
        "write_builder": lambda args: specialized_route_write(PEOPLE_AGENT_ROUTE_SPECS, args),
        "requires_agent_token": True,
    },
    {
        "name": "forge_call_peer_route",
        "description": "Call one MCP-exposed peer request, relationship, device, grant, sync-status, or diagnostic operation using an existing human-approved relationship. Every call requires a configured agent token with peer:status. This tool cannot create or accept pairing, request a resync, widen or revoke consent, accept or counter grants, approve or remove devices, manage credentials, or perform a human-presence ceremony.",
        "parameters": people_peer_route_parameters(PEER_AGENT_ROUTE_SPECS),
        "method_builder": lambda args: specialized_route_method(PEER_AGENT_ROUTE_SPECS, args),
        "path_builder": lambda args: specialized_route_path(PEER_AGENT_ROUTE_SPECS, args),
        "body_builder": specialized_route_body,
        "write_builder": lambda args: specialized_route_write(PEER_AGENT_ROUTE_SPECS, args),
        "requires_agent_token": True,
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
        "description": "List compact wiki or evidence page summaries inside one space with bounded offset pagination.",
        "parameters": object_schema(
            {
                "spaceId": optional_string("Optional wiki space id."),
                "kind": {"enum": ["wiki", "evidence"]},
                "limit": {"type": "integer", "minimum": 1, "maximum": 500},
                "offset": {"type": "integer", "minimum": 0, "maximum": 9999},
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
        "description": "Search compact wiki page summaries with ranked title, alias, content, entity, or semantic matches and bounded offset pagination.",
        "parameters": object_schema(
            {
                "spaceId": optional_string("Optional wiki space id."),
                "kind": {"enum": ["wiki", "evidence"]},
                "mode": {"enum": ["text", "semantic", "entity", "hybrid"]},
                "query": {
                    "type": "string",
                    "maxLength": 500,
                    "description": "Optional free-text wiki query. Forge uses at most the first 20 FTS tokens.",
                },
                "profileId": optional_string("Optional embedding profile id."),
                "linkedEntity": object_schema(
                    {
                        "entityType": {"type": "string", "minLength": 1},
                        "entityId": {"type": "string", "minLength": 1},
                    },
                    required=["entityType", "entityId"],
                ),
                "limit": {"type": "integer", "minimum": 1, "maximum": 50},
                "offset": {"type": "integer", "minimum": 0, "maximum": 999},
            }
        ),
        "method": "POST",
        "path": "/api/v1/wiki/search",
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
        "description": "Read the compact sports overview with workout volume, sport comparisons, energy and load coverage, and effort signals. Search workout_session records when individual sessions are needed.",
        "parameters": scoped_read_schema(),
        "method": "GET",
        "path_builder": sports_overview_path,
    },
    {
        "name": "forge_get_training_load_overview",
        "description": "Read the cardiovascular training-load surface with acute/chronic load, HR zone distribution, weekly intensity targets, and data-quality flags.",
        "parameters": scoped_read_schema(),
        "method": "GET",
        "path_builder": training_load_overview_path,
    },
    {
        "name": "forge_get_weight_loss_overview",
        "description": "Read the nutrition and weight-loss surface with calorie ledger, protein/fiber targets, energy balance, body trend, subjective energy, gut comfort, aesthetic check-ins, hypotheses, experiments, and data-quality flags.",
        "parameters": scoped_read_schema(),
        "method": "GET",
        "path_builder": weight_loss_overview_path,
    },
    {
        "name": "forge_search_nutrition_foods",
        "description": "Search local, Open Food Facts, and USDA-backed nutrition foods before logging a concrete food item.",
        "parameters": object_schema(
            {
                "userIds": array_schema({"type": "string"}, "Optional user ownership scope."),
                "query": {"type": "string", "minLength": 1},
                "limit": {"type": "integer", "minimum": 1, "maximum": 30},
            },
            required=["query"],
        ),
        "method": "POST",
        "path_builder": lambda args: nutrition_scoped_path("/api/v1/health/weight-loss/foods/search", args),
        "body_builder": without_user_ids_body,
        "write": True,
    },
    {
        "name": "forge_search_foods",
        "description": "Search local, Open Food Facts, and USDA-backed nutrition foods before logging a concrete food item. This is the short alias for forge_search_nutrition_foods.",
        "parameters": object_schema(
            {
                "userIds": array_schema({"type": "string"}, "Optional user ownership scope."),
                "query": {"type": "string", "minLength": 1},
                "limit": {"type": "integer", "minimum": 1, "maximum": 30},
            },
            required=["query"],
        ),
        "method": "POST",
        "path_builder": lambda args: nutrition_scoped_path("/api/v1/health/weight-loss/foods/search", args),
        "body_builder": without_user_ids_body,
        "write": True,
    },
    {
        "name": "forge_lookup_nutrition_barcode",
        "description": "Lookup a packaged food by barcode through Forge's nutrition catalog adapters.",
        "parameters": object_schema(
            {
                "userIds": array_schema({"type": "string"}, "Optional user ownership scope."),
                "barcode": {"type": "string", "minLength": 1},
            },
            required=["barcode"],
        ),
        "method": "POST",
        "path_builder": lambda args: nutrition_scoped_path("/api/v1/health/weight-loss/foods/barcode", args),
        "body_builder": without_user_ids_body,
        "write": True,
    },
    {
        "name": "forge_log_food",
        "description": "Create a confirmed or candidate food log. Search first and pass foodId when reusing a catalog food; for custom foods without foodId, caloriesKcal, proteinG, carbsG, and fatG are required.",
        "parameters": NUTRITION_FOOD_LOG,
        "method": "POST",
        "path_builder": lambda args: nutrition_scoped_path("/api/v1/health/weight-loss/food-logs", args),
        "body_builder": without_user_ids_body,
        "write": True,
    },
    {
        "name": "forge_parse_food_log_with_chatgpt",
        "description": "Use Forge's openai-codex ChatGPT subscription connection to parse natural-language food text or a photo description into a candidate nutrition log. This must not use the metered OpenAI API.",
        "parameters": object_schema(
            {
                "userIds": array_schema({"type": "string"}, "Optional user ownership scope."),
                "text": optional_string("Meal text to parse."),
                "imageDescription": optional_string("Photo description to parse."),
                "loggedAt": optional_string("Optional ISO logged-at timestamp."),
                "mealLabel": optional_string("Optional meal label."),
            }
        ),
        "method": "POST",
        "path_builder": lambda args: nutrition_scoped_path("/api/v1/health/weight-loss/parse", args),
        "body_builder": without_user_ids_body,
        "write": True,
    },
    {
        "name": "forge_log_body_checkin",
        "description": "Record body-composition check-ins such as weight, waist, hip, neck, body-fat estimate, and notes for trend calculations.",
        "parameters": object_schema(
            {
                **NUTRITION_SCORE_CHECKIN["properties"],
                "weightKg": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "waistCm": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "hipCm": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "neckCm": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "bodyFatPercent": {"anyOf": [{"type": "number"}, {"type": "null"}]},
            }
        ),
        "method": "POST",
        "path_builder": lambda args: nutrition_scoped_path("/api/v1/health/weight-loss/body-checkins", args),
        "body_builder": without_user_ids_body,
        "write": True,
    },
    {
        "name": "forge_log_appearance_checkin",
        "description": "Record aesthetic-look metrics such as fullness, leanness, vascularity, puffiness, visual bloat, outfit fit, and overall look.",
        "parameters": object_schema(
            {
                **NUTRITION_SCORE_CHECKIN["properties"],
                "muscleFullness": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "leanness": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "vascularity": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "facePuffiness": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "abdomenBloatLook": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "postureConfidence": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "outfitFit": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "aestheticScore": {"anyOf": [{"type": "number"}, {"type": "null"}]},
            }
        ),
        "method": "POST",
        "path_builder": lambda args: nutrition_scoped_path("/api/v1/health/weight-loss/appearance-checkins", args),
        "body_builder": without_user_ids_body,
        "write": True,
    },
    {
        "name": "forge_log_subjective_food_effect",
        "description": "Record subjective food-effect metrics such as energy, mood, focus, hunger, cravings, stress, sleepiness, soreness, libido, and workout performance.",
        "parameters": object_schema(
            {
                **NUTRITION_SCORE_CHECKIN["properties"],
                "energy": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "mood": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "focus": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "hunger": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "cravings": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "workoutPerformance": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "timeRelation": optional_nullable_string("Optional relation to food timing."),
                "linkedFoodLogId": optional_nullable_string("Optional linked food log id."),
            }
        ),
        "method": "POST",
        "path_builder": lambda args: nutrition_scoped_path("/api/v1/health/weight-loss/subjective-checkins", args),
        "body_builder": without_user_ids_body,
        "write": True,
    },
    {
        "name": "forge_log_gut_checkin",
        "description": "Record gut-health food-effect metrics such as bloating, pain, gas, reflux, nausea, stool type, frequency, and suspected triggers.",
        "parameters": object_schema(
            {
                **NUTRITION_SCORE_CHECKIN["properties"],
                "bloating": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "abdominalPain": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "gas": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "reflux": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "nausea": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "stoolType": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "stoolFrequency": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "suspectedTrigger": optional_nullable_string("Optional suspected trigger."),
                "linkedFoodLogId": optional_nullable_string("Optional linked food log id."),
            }
        ),
        "method": "POST",
        "path_builder": lambda args: nutrition_scoped_path("/api/v1/health/weight-loss/gut-checkins", args),
        "body_builder": without_user_ids_body,
        "write": True,
    },
    {
        "name": "forge_get_nutrition_patterns",
        "description": "Read food-effect hypotheses and nutrition experiments across meals, sport fueling, energy, gut comfort, cravings, and aesthetic look.",
        "parameters": scoped_read_schema(),
        "method": "GET",
        "path_builder": lambda args: nutrition_scoped_path("/api/v1/health/weight-loss/patterns", args),
    },
    {
        "name": "forge_start_nutrition_experiment",
        "description": "Create a structured N-of-1 nutrition experiment such as carb timing, caffeine timing, low-FODMAP trial, sodium/puffiness, fiber ramp, or pre-training fueling.",
        "parameters": object_schema(
            {
                "userIds": array_schema({"type": "string"}, "Optional user ownership scope."),
                "title": {"type": "string", "minLength": 1},
                "hypothesis": {"type": "string", "minLength": 1},
                "metricKey": {"type": "string", "minLength": 1},
                "intervention": {"type": "string", "minLength": 1},
                "baselineStart": optional_nullable_string("Optional baseline start date."),
                "baselineEnd": optional_nullable_string("Optional baseline end date."),
                "experimentStart": optional_nullable_string("Optional intervention start date."),
                "experimentEnd": optional_nullable_string("Optional intervention end date."),
                "status": {"enum": ["planned", "running", "paused", "completed", "abandoned"]},
                "successCriteria": optional_nullable_string("Optional success criteria."),
                "confounders": array_schema({"type": "string"}, "Optional factors that could affect interpretation."),
            },
            required=["title", "hypothesis", "metricKey", "intervention"],
        ),
        "method": "POST",
        "path_builder": lambda args: nutrition_scoped_path("/api/v1/health/weight-loss/experiments", args),
        "body_builder": without_user_ids_body,
        "write": True,
    },
    {
        "name": "forge_update_nutrition_experiment",
        "description": "Patch a nutrition experiment's status, dates, success criteria, intervention, hypothesis, or conclusion after new evidence arrives.",
        "parameters": object_schema(
            {
                "userIds": array_schema({"type": "string"}, "Optional user ownership scope."),
                "experimentId": {"type": "string", "minLength": 1},
                "title": optional_string("Optional revised title."),
                "hypothesis": optional_string("Optional revised hypothesis."),
                "metricKey": optional_string("Optional revised primary outcome."),
                "intervention": optional_string("Optional revised intervention."),
                "baselineStart": optional_nullable_string("Optional baseline start date."),
                "baselineEnd": optional_nullable_string("Optional baseline end date."),
                "experimentStart": optional_nullable_string("Optional intervention start date."),
                "experimentEnd": optional_nullable_string("Optional intervention end date."),
                "status": {"enum": ["planned", "running", "paused", "completed", "abandoned"]},
                "conclusion": optional_nullable_string("Optional conclusion."),
                "successCriteria": optional_nullable_string("Optional success criteria."),
                "confounders": array_schema({"type": "string"}, "Optional factors that could affect interpretation."),
            },
            required=["experimentId"],
        ),
        "method": "PATCH",
        "path_builder": nutrition_experiment_path,
        "body_builder": without_user_ids_body,
        "write": True,
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
        "name": "forge_get_psyche_schema_catalog",
        "description": "Read the read-only Psyche schema catalog before linking a belief_entry to schemaId or discussing a schema theme. Schema catalog entries are reference concepts, not user-owned belief records.",
        "parameters": object_schema({}),
        "method": "GET",
        "path": "/api/v1/psyche/schema-catalog",
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
        "name": "forge_get_today_priority",
        "description": "Read Forge's canonical deterministic decision for the next useful work, including active-run conflicts, task-timebox timing, Life Force capacity, ranked alternatives, and explicit no-work or overload states.",
        "parameters": object_schema(
            {
                "userIds": array_schema(
                    {"type": "string"},
                    "Optional Forge user ids. Select one user for Life Force capacity evidence.",
                ),
                "timeZone": optional_string("Optional IANA timezone for local-day evidence."),
                "candidateLimit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 100,
                    "default": 24,
                    "description": "Maximum ranked candidates to return.",
                },
            }
        ),
        "method": "GET",
        "path_builder": lambda args: with_query(
            "/api/v1/today/priority",
            args,
            ["userIds", "timeZone", "candidateLimit"],
        ),
    },
    {
        "name": "forge_search_entities",
        "description": "Search Forge entities before creating or updating to avoid duplicates. Pass searches as an array, even for one search.",
        "parameters": object_schema(
            {
                "searches": array_schema(
                    SEARCH_ENTITY,
                    "Ordered search requests.",
                    min_items=1,
                    max_items=50,
                ),
            },
            required=["searches"],
        ),
        "method": "POST",
        "path": "/api/v1/entities/search",
        "write": True,
    },
    {
        "name": "forge_create_entities",
        "description": "Create one or more normal stored Forge entities through the ordered batch workflow after checking live onboarding. Pass operations as an array; each operation needs an exact entityCatalog entityType and full data. Issues and subtasks are task records with data.level set to issue or subtask, never entityType issue or subtask. Do not use this tool for specialized domain surfaces.",
        "parameters": object_schema(
            {
                "atomic": {"type": "boolean"},
                "operations": array_schema(
                    CREATE_OPERATION,
                    "Ordered create requests.",
                    min_items=1,
                    max_items=100,
                ),
            },
            required=["operations"],
        ),
        "method": "POST",
        "path": "/api/v1/entities/create",
        "write": True,
    },
    {
        "name": "forge_update_entities",
        "description": "Update one or more normal stored Forge entities through the ordered batch workflow after reading the current record. Pass operations as an array; each operation needs an exact entityCatalog entityType, id, and narrow patch. Preserve omitted fields. Issues and subtasks use entityType task with patch.level, never entityType issue or subtask. This is also the official habit outcome logging path through habit.patch.checkIn.",
        "parameters": object_schema(
            {
                "atomic": {"type": "boolean"},
                "operations": array_schema(
                    UPDATE_OPERATION,
                    "Ordered update requests.",
                    min_items=1,
                    max_items=100,
                ),
            },
            required=["operations"],
        ),
        "method": "POST",
        "path": "/api/v1/entities/update",
        "write": True,
    },
    {
        "name": "forge_delete_entities",
        "description": "Delete Forge entities in one batch request. Pass operations as an array with entityType and id. Delete defaults to soft mode unless hard is requested explicitly. preference_catalog and preference_catalog_item use reversible soft deletion and forge_restore_entities; preference_context, preference_item, calendar-domain records, and questionnaire_instrument retain immediate deletion.",
        "parameters": object_schema(
            {
                "atomic": {"type": "boolean"},
                "operations": array_schema(
                    DELETE_OPERATION,
                    "Ordered delete requests.",
                    min_items=1,
                    max_items=100,
                ),
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
                "operations": array_schema(
                    RESTORE_OPERATION,
                    "Ordered restore requests.",
                    min_items=1,
                    max_items=100,
                ),
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
        "description": "Finish an active task run and atomically store bounded completionReport, canonical gitRefs, an optional linked closeoutNote, task state, time, rewards, and activity. An exact terminal replay is idempotent; changed closeout evidence conflicts. A quick or native completion may truthfully leave closeoutState deferred, so read the task back and inspect its closeout state and evidence.",
        "parameters": object_schema(
            {
                "taskRunId": {"type": "string", "minLength": 1},
                "actor": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 160,
                    "description": "Optional actor label.",
                },
                "note": {
                    "type": "string",
                    "maxLength": 4000,
                    "description": "Optional completion note.",
                },
                "completionReport": COMPLETION_REPORT_INPUT,
                "gitRefs": array_schema(WORK_ITEM_GIT_REF_INPUT, max_items=64),
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
        "description": "Stop an active task run without completing the task. Release accepts actor, note, and closeoutNote only; it never accepts completionReport or gitRefs. Use closeoutNote when blockers or handoff context should become a durable linked note.",
        "parameters": object_schema(
            {
                "taskRunId": {"type": "string", "minLength": 1},
                "actor": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 160,
                    "description": "Optional actor label.",
                },
                "note": {
                    "type": "string",
                    "maxLength": 4000,
                    "description": "Optional release note.",
                },
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
        "description": "Read up to 12 future task-timebox suggestions that fit the task owner, requested timezone, current calendar pressure, and scheduling rules. Use this when candidate slots are needed; if the slot is already clear from the calendar, create the timebox directly instead.",
        "parameters": object_schema(
            {
                "taskId": {"type": "string", "minLength": 1},
                "from": optional_string("Optional recommendation window start."),
                "to": optional_string("Optional recommendation window end."),
                "limit": {"type": "integer", "minimum": 1, "maximum": 12},
                "timezone": optional_string("Optional IANA timezone for fallback wall-time windows."),
            },
            required=["taskId"],
        ),
        "method": "POST",
        "path": "/api/v1/calendar/timeboxes/recommend",
        "write": False,
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
                "status": {
                    "enum": ["planned", "active", "completed", "cancelled"]
                },
                "overrideReason": optional_nullable_string("Optional note about why this slot exists or why it was chosen."),
                "activityPresetKey": {
                    "anyOf": [
                        {
                            "enum": [
                                "deep_work",
                                "admin",
                                "maintenance",
                                "meeting",
                                "recovery_break",
                                "holiday_leisure",
                                "light_context",
                                "task_inherited",
                            ]
                        },
                        {"type": "null"},
                    ],
                    "description": "Optional validated activity preset for the timebox AP profile.",
                },
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
