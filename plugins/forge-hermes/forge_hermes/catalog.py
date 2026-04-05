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


def calendar_overview_path(args: Dict[str, Any]) -> str:
    return with_query("/api/v1/calendar/overview", args, ["from", "to", "userIds"])


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


PREFERENCE_FEATURE_WEIGHTS = {
    "type": "object",
    "description": "Optional weights keyed by novelty, simplicity, rigor, aesthetics, depth, structure, familiarity, and surprise.",
}

TOOL_CATALOG: List[ToolSpec] = [
    {
        "name": "forge_get_operator_overview",
        "description": "Start here for most Forge work. Read the one-shot operator overview with current priorities, momentum, and onboarding guidance before searching or mutating.",
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
        "description": "Create a new wiki page or update an existing one through the file-backed wiki surface.",
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
        "description": "Resync Markdown files from the local wiki vault into Forge metadata.",
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
        "name": "forge_create_preferences_catalog",
        "description": "Create a new editable concept list inside Forge Preferences for one user and domain.",
        "parameters": object_schema(
            {
                "userId": {"type": "string", "minLength": 1},
                "domain": {"enum": PREFERENCE_DOMAINS},
                "title": {"type": "string", "minLength": 1},
                "description": optional_string("Optional catalog description."),
                "slug": optional_string("Optional stable slug."),
            },
            required=["userId", "domain", "title"],
        ),
        "method": "POST",
        "path": "/api/v1/preferences/catalogs",
        "write": True,
    },
    {
        "name": "forge_update_preferences_catalog",
        "description": "Rename or revise an existing Forge Preferences concept list.",
        "parameters": object_schema(
            {
                "catalogId": {"type": "string", "minLength": 1},
                "title": optional_string("Optional new title."),
                "description": optional_string("Optional new description."),
                "slug": optional_string("Optional new slug."),
            },
            required=["catalogId"],
        ),
        "method": "PATCH",
        "path_builder": preference_catalog_path,
        "body_builder": lambda args, _config: {
            key: value for key, value in args.items() if key != "catalogId"
        },
        "write": True,
    },
    {
        "name": "forge_delete_preferences_catalog",
        "description": "Archive a Forge Preferences concept list and its editable item surface.",
        "parameters": object_schema(
            {
                "catalogId": {"type": "string", "minLength": 1},
            },
            required=["catalogId"],
        ),
        "method": "DELETE",
        "path_builder": preference_catalog_path,
        "write": True,
    },
    {
        "name": "forge_create_preferences_catalog_item",
        "description": "Add a concept to an editable Forge Preferences list.",
        "parameters": object_schema(
            {
                "catalogId": {"type": "string", "minLength": 1},
                "label": {"type": "string", "minLength": 1},
                "description": optional_string("Optional concept description."),
                "tags": array_schema({"type": "string"}, "Optional concept tags."),
                "featureWeights": PREFERENCE_FEATURE_WEIGHTS,
                "position": {"type": "integer", "minimum": 0},
            },
            required=["catalogId", "label"],
        ),
        "method": "POST",
        "path": "/api/v1/preferences/catalog-items",
        "write": True,
    },
    {
        "name": "forge_update_preferences_catalog_item",
        "description": "Edit one concept inside a Forge Preferences list.",
        "parameters": object_schema(
            {
                "itemId": {"type": "string", "minLength": 1},
                "label": optional_string("Optional new label."),
                "description": optional_string("Optional new description."),
                "tags": array_schema({"type": "string"}, "Optional concept tags."),
                "featureWeights": PREFERENCE_FEATURE_WEIGHTS,
                "position": {"type": "integer", "minimum": 0},
            },
            required=["itemId"],
        ),
        "method": "PATCH",
        "path_builder": preference_catalog_item_path,
        "body_builder": lambda args, _config: {
            key: value for key, value in args.items() if key != "itemId"
        },
        "write": True,
    },
    {
        "name": "forge_delete_preferences_catalog_item",
        "description": "Archive one concept from a Forge Preferences list.",
        "parameters": object_schema(
            {
                "itemId": {"type": "string", "minLength": 1},
            },
            required=["itemId"],
        ),
        "method": "DELETE",
        "path_builder": preference_catalog_item_path,
        "write": True,
    },
    {
        "name": "forge_create_preferences_context",
        "description": "Create a contextual preference profile slice such as work, personal, discovery, or deep research.",
        "parameters": object_schema(
            {
                "userId": {"type": "string", "minLength": 1},
                "domain": {"enum": PREFERENCE_DOMAINS},
                "name": {"type": "string", "minLength": 1},
                "description": optional_string("Optional context description."),
                "shareMode": {"enum": PREFERENCE_CONTEXT_SHARE_MODES},
                "active": {"type": "boolean"},
                "isDefault": {"type": "boolean"},
                "decayDays": {"type": "integer", "minimum": 7, "maximum": 365},
            },
            required=["userId", "domain", "name"],
        ),
        "method": "POST",
        "path": "/api/v1/preferences/contexts",
        "write": True,
    },
    {
        "name": "forge_update_preferences_context",
        "description": "Edit a Forge Preferences context without changing its owning user or domain.",
        "parameters": object_schema(
            {
                "contextId": {"type": "string", "minLength": 1},
                "name": optional_string("Optional new context name."),
                "description": optional_string("Optional new description."),
                "shareMode": {"enum": PREFERENCE_CONTEXT_SHARE_MODES},
                "active": {"type": "boolean"},
                "isDefault": {"type": "boolean"},
                "decayDays": {"type": "integer", "minimum": 7, "maximum": 365},
            },
            required=["contextId"],
        ),
        "method": "PATCH",
        "path_builder": preference_context_path,
        "body_builder": lambda args, _config: {
            key: value for key, value in args.items() if key != "contextId"
        },
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
        "name": "forge_create_preferences_item",
        "description": "Create a direct preference item inside Forge when it does not already exist as a Forge entity or catalog concept.",
        "parameters": object_schema(
            {
                "userId": {"type": "string", "minLength": 1},
                "domain": {"enum": PREFERENCE_DOMAINS},
                "label": {"type": "string", "minLength": 1},
                "description": optional_string("Optional item description."),
                "tags": array_schema({"type": "string"}, "Optional item tags."),
                "featureWeights": PREFERENCE_FEATURE_WEIGHTS,
                "sourceEntityType": optional_nullable_string("Optional source Forge entity type."),
                "sourceEntityId": optional_nullable_string("Optional source Forge entity id."),
                "metadata": {"type": "object"},
                "queueForCompare": {"type": "boolean"},
            },
            required=["userId", "domain", "label"],
        ),
        "method": "POST",
        "path": "/api/v1/preferences/items",
        "write": True,
    },
    {
        "name": "forge_update_preferences_item",
        "description": "Edit a Forge Preferences item without changing its owning user or domain.",
        "parameters": object_schema(
            {
                "itemId": {"type": "string", "minLength": 1},
                "label": optional_string("Optional new label."),
                "description": optional_string("Optional new description."),
                "tags": array_schema({"type": "string"}, "Optional item tags."),
                "featureWeights": PREFERENCE_FEATURE_WEIGHTS,
                "sourceEntityType": optional_nullable_string("Optional source Forge entity type."),
                "sourceEntityId": optional_nullable_string("Optional source Forge entity id."),
                "metadata": {"type": "object"},
                "queueForCompare": {"type": "boolean"},
            },
            required=["itemId"],
        ),
        "method": "PATCH",
        "path_builder": preference_item_path,
        "body_builder": lambda args, _config: {
            key: value for key, value in args.items() if key != "itemId"
        },
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
