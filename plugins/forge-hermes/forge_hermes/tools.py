"""Forge Hermes tool handlers."""

from __future__ import annotations

import atexit
import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
import getpass
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional
from urllib import error, parse, request

from .catalog import TOOL_CATALOG
from .config import get_default_data_root, read_plugin_config
from .version import __version__

PACKAGE_DIR = Path(__file__).resolve().parent
NODE_RUNTIME_HELPER = PACKAGE_DIR / "scripts" / "ensure-runtime.mjs"
SESSION_COOKIES: Dict[str, str] = {}
DEFAULT_HERMES_ACTOR_LABEL = ""
DEFAULT_HERMES_RUNTIME_AGENT_LABEL = "Forge Hermes"
DEFAULT_HERMES_GATEWAY_SESSION_KEY = "gateway:main"
SESSION_STARTUP_CONTEXTS: Dict[str, str] = {}
SESSION_RUNTIME_IDS: Dict[str, str] = {}
SESSION_ACTOR_LABELS: Dict[str, str] = {}
GATEWAY_RUNTIME_THREAD: Optional[threading.Thread] = None
GATEWAY_RUNTIME_STOP: Optional[threading.Event] = None

logger = logging.getLogger(__name__)


@dataclass
class ForgeConfig:
    origin: str
    port: int
    base_url: str
    web_app_url: str
    data_root: str
    api_token: str
    actor_label: str
    timeout_ms: int


def _resolve_runtime_agent_label() -> str:
    candidate = _normalize_text(os.environ.get("FORGE_AGENT_LABEL"))
    return candidate or DEFAULT_HERMES_RUNTIME_AGENT_LABEL


def _fallback_actor_label() -> str:
    try:
        candidate = _normalize_text(getpass.getuser())
    except Exception:
        candidate = ""
    return candidate or "Local Operator"


def _is_gateway_process() -> bool:
    argv = [part.lower() for part in sys.argv[1:]]
    return "gateway" in argv


def _gateway_runtime_session_key() -> str:
    return DEFAULT_HERMES_GATEWAY_SESSION_KEY


class ForgePluginError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _normalize_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _truncate_text(value: Any, limit: int = 96) -> str:
    text = _normalize_text(value)
    if len(text) <= limit:
        return text
    return f"{text[: max(0, limit - 1)].rstrip()}…"


def _format_duration(seconds: Any) -> Optional[str]:
    if not isinstance(seconds, (int, float)):
        return None
    total = max(0, int(round(float(seconds))))
    hours, remainder = divmod(total, 3600)
    minutes = remainder // 60
    if hours and minutes:
        return f"{hours}h {minutes}m"
    if hours:
        return f"{hours}h"
    return f"{minutes}m"


def _safe_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _safe_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _format_title_list(items: Any, limit: int = 2) -> Optional[str]:
    labels: list[str] = []
    overflow = 0
    for entry in _safe_list(items):
        title = _truncate_text(_safe_dict(entry).get("title"), 54)
        if not title:
            continue
        if len(labels) < limit:
            labels.append(title)
        else:
            overflow += 1
    if not labels:
        return None
    if overflow:
        labels.append(f"+{overflow} more")
    return "; ".join(labels)


def _resolve_operator_name(overview_body: Dict[str, Any], context_body: Dict[str, Any]) -> Optional[str]:
    candidates = [
        *_safe_list(_safe_dict(overview_body.get("operator")).get("activeProjects")),
        *_safe_list(context_body.get("focusTasks")),
        context_body.get("recommendedNextTask"),
    ]
    for candidate in candidates:
        item = _safe_dict(candidate)
        owner = _safe_dict(item.get("ownerUser"))
        display_name = _normalize_text(owner.get("displayName") or owner.get("handle"))
        if display_name:
            return display_name
    return None


def _format_focus_line(context_body: Dict[str, Any]) -> Optional[str]:
    recommended = _safe_dict(context_body.get("recommendedNextTask"))
    if recommended:
        title = _truncate_text(recommended.get("title"), 72)
        if title:
            parts = [title]
            level = _normalize_text(recommended.get("level"))
            priority = _normalize_text(recommended.get("priority"))
            if level:
                parts.append(level)
            if priority:
                parts.append(priority)
            return " | ".join(parts)

    focus_tasks = _safe_list(context_body.get("focusTasks"))
    return _format_title_list(focus_tasks, limit=2)


def _format_sleep_line(overview_body: Dict[str, Any]) -> Optional[str]:
    sleep = _safe_dict(overview_body.get("sleep"))
    latest = _safe_dict(sleep.get("latestNight"))
    summary = _safe_dict(sleep.get("summary"))
    latest_bits: list[str] = []
    latest_duration = _format_duration(latest.get("asleepSeconds"))
    if latest_duration:
        latest_bits.append(latest_duration)
    score = latest.get("score")
    if isinstance(score, (int, float)):
        latest_bits.append(f"score {int(score)}")
    recovery = _normalize_text(latest.get("recoveryState") or latest.get("qualitativeState"))
    if recovery:
        latest_bits.append(recovery)

    average_bits: list[str] = []
    average_duration = _format_duration(summary.get("averageSleepSeconds"))
    if average_duration:
        average_bits.append(average_duration)
    average_score = summary.get("averageSleepScore")
    if isinstance(average_score, (int, float)):
        average_bits.append(f"score {int(average_score)}")

    sections: list[str] = []
    if latest_bits:
        sections.append(f"latest {' · '.join(latest_bits)}")
    if average_bits:
        sections.append(f"average {' · '.join(average_bits)}")
    return "; ".join(sections) or None


def _format_xp_line(overview_body: Dict[str, Any], context_body: Dict[str, Any]) -> Optional[str]:
    metrics = _safe_dict(_safe_dict(overview_body.get("snapshot")).get("metrics"))
    xp = _safe_dict(context_body.get("xp"))
    parts: list[str] = []
    level = metrics.get("level")
    if isinstance(level, (int, float)):
        parts.append(f"level {int(level)}")
    weekly = metrics.get("weeklyXp")
    if isinstance(weekly, (int, float)):
        parts.append(f"weekly {int(weekly)} XP")
    streak = metrics.get("streakDays")
    if isinstance(streak, (int, float)):
        parts.append(f"streak {int(streak)}d")
    if not parts:
        current_xp = xp.get("currentXp")
        if isinstance(current_xp, (int, float)):
            parts.append(f"{int(current_xp)} XP")
    return " | ".join(parts) or None


def _format_top_goals_line(overview_body: Dict[str, Any]) -> Optional[str]:
    dashboard = _safe_dict(_safe_dict(overview_body.get("snapshot")).get("dashboard"))
    return _format_title_list(dashboard.get("goals"), limit=2)


def _format_active_projects_line(overview_body: Dict[str, Any], context_body: Dict[str, Any]) -> Optional[str]:
    operator = _safe_dict(overview_body.get("operator"))
    active_projects = operator.get("activeProjects") or context_body.get("activeProjects")
    return _format_title_list(active_projects, limit=2)


def _fetch_startup_context_text() -> Optional[str]:
    try:
        config = _ensure_runtime(_load_config())
        overview_payload = _request_json(config, "GET", "/api/v1/operator/overview")
        context_payload = _request_json(config, "GET", "/api/v1/operator/context")
    except ForgePluginError as exc:
        logger.warning("Forge Hermes startup context unavailable: %s", exc)
        return None
    except subprocess.TimeoutExpired:
        logger.warning("Forge Hermes startup context timed out while booting the local runtime")
        return None
    except Exception as exc:  # pragma: no cover - defensive hook path
        logger.exception("Unexpected Forge Hermes startup context failure: %s", exc)
        return None

    overview_body = _safe_dict(_safe_dict(overview_payload).get("overview"))
    context_body = _safe_dict(_safe_dict(context_payload).get("context"))
    if not overview_body and not context_body:
        return None

    lines = ["Forge context for this session:"]

    operator_name = _resolve_operator_name(overview_body, context_body)
    if operator_name:
        lines.append(f"- Operator: {operator_name}")

    top_goals = _format_top_goals_line(overview_body)
    if top_goals:
        lines.append(f"- Top goals: {top_goals}")

    active_projects = _format_active_projects_line(overview_body, context_body)
    if active_projects:
        lines.append(f"- Active projects: {active_projects}")

    focus_line = _format_focus_line(context_body)
    if focus_line:
        lines.append(f"- Focus: {focus_line}")

    sleep_line = _format_sleep_line(overview_body)
    if sleep_line:
        lines.append(f"- Sleep: {sleep_line}")

    xp_line = _format_xp_line(overview_body, context_body)
    if xp_line:
        lines.append(f"- XP: {xp_line}")

    lines.append(f"- Forge web app: {config.web_app_url}")
    lines.append(
        "- Forge tools are available in this session for live overview, search, linking, updates, and closeout work."
    )
    lines.append(
        "- Forge bundled skills are available for Forge workflow guidance plus entity and Psyche interview playbooks."
    )

    if len(lines) == 1:
        return None
    return "\n".join(lines)


def _cache_startup_context(session_id: str = "") -> Optional[str]:
    cache_key = _normalize_text(session_id)
    if cache_key and cache_key in SESSION_STARTUP_CONTEXTS:
        return SESSION_STARTUP_CONTEXTS[cache_key]

    context_text = _fetch_startup_context_text()
    if context_text and cache_key:
        SESSION_STARTUP_CONTEXTS[cache_key] = context_text
    return context_text


def _register_runtime_session(session_id: str = "") -> Optional[str]:
    cache_key = _normalize_text(session_id)
    if not cache_key:
        return None
    existing = SESSION_RUNTIME_IDS.get(cache_key)
    if existing:
        return existing

    try:
        config = _ensure_runtime(_load_config())
        effective_actor_label = _resolve_effective_actor_label(config)
        payload = _request_json(
            config,
            "POST",
            "/api/v1/agents/sessions",
            body={
                "provider": "hermes",
                "agentLabel": _resolve_runtime_agent_label(),
                "agentType": "hermes",
                "actorLabel": effective_actor_label,
                "sessionKey": cache_key,
                "sessionLabel": cache_key,
                "connectionMode": "managed_token"
                if config.api_token
                else "operator_session",
                "baseUrl": config.base_url,
                "webUrl": config.web_app_url,
                "dataRoot": config.data_root or None,
                "externalSessionId": cache_key,
                "staleAfterSeconds": 120,
                "metadata": {
                    "hermesSessionId": cache_key,
                    "singleton": True,
                    "actorSource": "configured" if config.actor_label.strip() else "inherited",
                },
            },
        )
        session = _safe_dict(payload).get("session")
        session_id_value = _normalize_text(_safe_dict(session).get("id"))
        if session_id_value:
            SESSION_RUNTIME_IDS[cache_key] = session_id_value
            return session_id_value
    except Exception:
        logger.exception("Forge Hermes runtime session registration failed")
    return None


def _heartbeat_runtime_session(
    session_id: str = "",
    summary: str = "",
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    cache_key = _normalize_text(session_id)
    if not cache_key:
        return
    try:
        config = _ensure_runtime(_load_config())
        _request_json(
            config,
            "POST",
            "/api/v1/agents/sessions/heartbeat",
            body={
                "provider": "hermes",
                "sessionKey": cache_key,
                "externalSessionId": cache_key,
                "summary": summary,
                "metadata": metadata or {},
            },
        )
    except Exception:
        logger.exception("Forge Hermes runtime session heartbeat failed")


def _append_runtime_session_event(
    session_id: str = "",
    *,
    event_type: str,
    title: str,
    summary: str = "",
    metadata: Optional[Dict[str, Any]] = None,
    level: str = "info",
) -> None:
    cache_key = _normalize_text(session_id)
    if not cache_key:
        return
    try:
        config = _ensure_runtime(_load_config())
        _request_json(
            config,
            "POST",
            "/api/v1/agents/sessions/events",
            body={
                "provider": "hermes",
                "sessionKey": cache_key,
                "externalSessionId": cache_key,
                "eventType": event_type,
                "title": title,
                "summary": summary,
                "metadata": metadata or {},
                "level": level,
            },
        )
    except Exception:
        logger.exception("Forge Hermes runtime session event failed")


def _disconnect_runtime_session(
    session_id: str = "",
    *,
    note: str = "",
    last_error: Optional[str] = None,
) -> None:
    cache_key = _normalize_text(session_id)
    if not cache_key:
        return
    runtime_id = SESSION_RUNTIME_IDS.get(cache_key) or _register_runtime_session(cache_key)
    if not runtime_id:
        return
    config: Optional[ForgeConfig] = None
    try:
        config = _ensure_runtime(_load_config())
        _request_json(
            config,
            "POST",
            f"/api/v1/agents/sessions/{runtime_id}/disconnect",
            body={
                "note": note,
                "externalSessionId": cache_key,
                "lastError": last_error,
            },
        )
    except Exception:
        logger.exception("Forge Hermes runtime session disconnect failed")
    finally:
        SESSION_RUNTIME_IDS.pop(cache_key, None)
        if config is not None:
            SESSION_ACTOR_LABELS.pop(config.base_url.rstrip("/"), None)


def _gateway_runtime_presence_loop(stop_event: threading.Event) -> None:
    session_key = _gateway_runtime_session_key()
    while not stop_event.wait(60):
        _heartbeat_runtime_session(
            session_key,
            summary="Hermes gateway heartbeat.",
            metadata={
                "gateway": True,
                "pid": os.getpid(),
                "argv": sys.argv,
            },
        )


def stop_gateway_runtime_presence() -> None:
    global GATEWAY_RUNTIME_THREAD, GATEWAY_RUNTIME_STOP

    stop_event = GATEWAY_RUNTIME_STOP
    thread = GATEWAY_RUNTIME_THREAD
    if stop_event is None:
        return

    stop_event.set()
    if thread and thread.is_alive() and thread is not threading.current_thread():
        thread.join(timeout=2)

    _disconnect_runtime_session(
        _gateway_runtime_session_key(),
        note="Hermes gateway stopped.",
    )
    GATEWAY_RUNTIME_THREAD = None
    GATEWAY_RUNTIME_STOP = None


def start_gateway_runtime_presence() -> None:
    global GATEWAY_RUNTIME_THREAD, GATEWAY_RUNTIME_STOP

    if not _is_gateway_process():
        return
    if GATEWAY_RUNTIME_THREAD and GATEWAY_RUNTIME_THREAD.is_alive():
        return

    session_key = _gateway_runtime_session_key()
    _register_runtime_session(session_key)
    _append_runtime_session_event(
        session_key,
        event_type="gateway_started",
        title="Gateway started",
        summary="Hermes registered the gateway as a live Forge runtime session.",
        metadata={
            "gateway": True,
            "pid": os.getpid(),
            "argv": sys.argv,
        },
    )
    _heartbeat_runtime_session(
        session_key,
        summary="Hermes gateway heartbeat.",
        metadata={
            "gateway": True,
            "pid": os.getpid(),
            "argv": sys.argv,
            "startedAt": int(time.time()),
        },
    )

    stop_event = threading.Event()
    thread = threading.Thread(
        target=_gateway_runtime_presence_loop,
        args=(stop_event,),
        name="forge-hermes-gateway-heartbeat",
        daemon=True,
    )
    GATEWAY_RUNTIME_STOP = stop_event
    GATEWAY_RUNTIME_THREAD = thread
    thread.start()
    atexit.register(stop_gateway_runtime_presence)


def warm_gateway_runtime_presence(**_kwargs: Any) -> None:
    start_gateway_runtime_presence()


def warm_startup_context(
    *,
    session_id: str = "",
    **_kwargs: Any,
) -> None:
    _register_runtime_session(session_id)
    _cache_startup_context(session_id)
    _append_runtime_session_event(
        session_id,
        event_type="session_started",
        title="Session started",
        summary="Hermes registered a live Forge agent session.",
    )


def clear_startup_context(
    *,
    session_id: str = "",
    **_kwargs: Any,
) -> None:
    cache_key = _normalize_text(session_id)
    if cache_key:
        SESSION_STARTUP_CONTEXTS.pop(cache_key, None)
    _disconnect_runtime_session(
        session_id,
        note="Hermes finalized or reset the session.",
    )


def build_startup_context(
    *,
    session_id: str = "",
    user_message: str = "",
    conversation_history: Optional[list[Any]] = None,
    is_first_turn: bool = False,
    model: str = "",
    platform: str = "",
    **_kwargs: Any,
) -> Optional[Dict[str, str]]:
    _heartbeat_runtime_session(
        session_id,
        summary=_truncate_text(user_message, 140),
        metadata={
            "platform": _normalize_text(platform),
            "model": _normalize_text(model),
            "isFirstTurn": bool(is_first_turn),
        },
    )
    context_text = _cache_startup_context(session_id)
    if not context_text:
        return None
    return {"context": context_text}


def _json_result(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _safe_error(code: str, message: str) -> str:
    return _json_result({"error": {"code": code, "message": message}})


def _normalize_origin(value: Optional[str]) -> str:
    candidate = (value or "").strip() or "http://127.0.0.1"
    parsed = parse.urlparse(candidate)
    if not parsed.scheme or not parsed.hostname:
        return "http://127.0.0.1"
    return f"{parsed.scheme}://{parsed.hostname}"


def _read_int(raw: Any, fallback: int) -> int:
    if raw is None:
        return fallback
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return fallback
    return max(1, value)


def _normalize_data_root(value: Any) -> str:
    candidate = str(value).strip() if value is not None else ""
    if not candidate:
        return str(get_default_data_root())
    return str(Path(candidate).expanduser().resolve())


def _build_base_url(origin: str, port: int) -> str:
    return f"{origin}:{port}"


def _build_web_app_url(origin: str, port: int) -> str:
    return f"{_build_base_url(origin, port)}/forge/"


def _load_config() -> ForgeConfig:
    file_config = read_plugin_config()
    origin = _normalize_origin(os.environ.get("FORGE_ORIGIN") or file_config.get("origin"))
    port = _read_int(os.environ.get("FORGE_PORT") or file_config.get("port"), 4317)
    timeout_ms = max(1000, min(_read_int(os.environ.get("FORGE_TIMEOUT_MS") or file_config.get("timeoutMs"), 15000), 120000))
    data_root = _normalize_data_root(os.environ.get("FORGE_DATA_ROOT") or file_config.get("dataRoot"))
    api_token = (os.environ.get("FORGE_API_TOKEN") or str(file_config.get("apiToken") or "")).strip()
    actor_label = (os.environ.get("FORGE_ACTOR_LABEL") or str(file_config.get("actorLabel") or "")).strip() or DEFAULT_HERMES_ACTOR_LABEL
    return ForgeConfig(
        origin=origin,
        port=port,
        base_url=_build_base_url(origin, port),
        web_app_url=_build_web_app_url(origin, port),
        data_root=data_root,
        api_token=api_token,
        actor_label=actor_label,
        timeout_ms=timeout_ms,
    )


def _is_tailscale_ipv4(hostname: str) -> bool:
    parts = hostname.split(".")
    if len(parts) != 4:
        return False
    try:
        a, b = int(parts[0]), int(parts[1])
    except ValueError:
        return False
    return a == 100 and 64 <= b <= 127


def _can_bootstrap_operator_session(base_url: str) -> bool:
    hostname = parse.urlparse(base_url).hostname or ""
    hostname = hostname.lower()
    return hostname in {"localhost", "127.0.0.1", "::1"} or hostname.endswith(".ts.net") or _is_tailscale_ipv4(hostname)


def _resolve_effective_actor_label(config: ForgeConfig) -> str:
    explicit = _normalize_text(config.actor_label)
    if explicit:
        return explicit
    session_actor = SESSION_ACTOR_LABELS.get(config.base_url.rstrip("/"), "")
    if session_actor:
        return session_actor
    if not config.api_token and _can_bootstrap_operator_session(config.base_url):
        try:
            _ensure_operator_session_cookie(config)
        except ForgePluginError:
            pass
        session_actor = SESSION_ACTOR_LABELS.get(config.base_url.rstrip("/"), "")
        if session_actor:
            return session_actor
    return _fallback_actor_label()


def _requires_remote_token(config: ForgeConfig, write: bool) -> bool:
    return write and not config.api_token and not _can_bootstrap_operator_session(config.base_url)


def _health_url(config: ForgeConfig) -> str:
    return f"{config.base_url}/api/v1/health"


def _request_json(
    config: ForgeConfig,
    method: str,
    path: str,
    body: Optional[Any] = None,
    retry_with_fresh_session: bool = True,
) -> Any:
    if _requires_remote_token(config, method != "GET"):
        raise ForgePluginError(
            "forge_api_token_required",
            "Forge apiToken is required for remote Hermes mutations when this target cannot use local or Tailscale operator-session bootstrap.",
        )

    timeout = max(1.0, config.timeout_ms / 1000.0)
    actor_label = _resolve_effective_actor_label(config)
    headers = {
        "accept": "application/json",
        "x-forge-source": "agent",
        "x-forge-plugin-version": __version__,
        "x-forge-actor": actor_label,
    }
    if config.api_token:
        headers["authorization"] = f"Bearer {config.api_token}"

    session_key = config.base_url.rstrip("/")
    if not config.api_token and _can_bootstrap_operator_session(config.base_url):
        cookie = _ensure_operator_session_cookie(config)
        if cookie:
            headers["cookie"] = cookie

    data = None
    if body is not None:
        headers["content-type"] = "application/json"
        data = json.dumps(body).encode("utf-8")

    req = request.Request(f"{config.base_url}{path}", data=data, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=timeout) as response:
            payload = response.read().decode("utf-8").strip()
            if not payload:
                return None
            return json.loads(payload)
    except error.HTTPError as exc:
        payload_text = exc.read().decode("utf-8", errors="replace")
        parsed_payload: Any
        try:
            parsed_payload = json.loads(payload_text) if payload_text else {}
        except json.JSONDecodeError:
            parsed_payload = {"message": payload_text}

        if exc.code == 401 and "cookie" in headers and retry_with_fresh_session:
            SESSION_COOKIES.pop(session_key, None)
            return _request_json(config, method, path, body=body, retry_with_fresh_session=False)

        if isinstance(parsed_payload, dict):
            message = parsed_payload.get("message") or parsed_payload.get("error") or payload_text or exc.reason
        else:
            message = payload_text or exc.reason
        raise ForgePluginError(f"forge_http_{exc.code}", str(message))
    except error.URLError as exc:
        raise ForgePluginError("forge_unreachable", str(exc.reason))


def _ensure_operator_session_cookie(config: ForgeConfig) -> str:
    key = config.base_url.rstrip("/")
    cached = SESSION_COOKIES.get(key)
    if cached:
        return cached

    req = request.Request(
        f"{config.base_url}/api/v1/auth/operator-session",
        headers={
            "accept": "application/json",
            "x-forge-source": "agent",
        },
        method="GET",
    )
    try:
        with request.urlopen(req, timeout=max(1.0, config.timeout_ms / 1000.0)) as response:
            cookie_header = response.headers.get("Set-Cookie", "")
            payload_text = response.read().decode("utf-8", errors="replace").strip()
    except Exception as exc:  # pragma: no cover - surfaced in handler output
        raise ForgePluginError(
            "forge_session_bootstrap_failed",
            f"Forge did not issue an operator session. {exc}",
        )

    cookie = cookie_header.split(";", 1)[0].strip()
    if not cookie:
        raise ForgePluginError(
            "forge_session_bootstrap_failed",
            "Forge issued an unusable operator session cookie.",
        )
    if payload_text:
        try:
            payload = json.loads(payload_text)
            actor_label = _normalize_text(_safe_dict(_safe_dict(payload).get("session")).get("actorLabel"))
            if actor_label:
                SESSION_ACTOR_LABELS[key] = actor_label
        except json.JSONDecodeError:
            pass
    SESSION_COOKIES[key] = cookie
    return cookie


def _is_local_origin(config: ForgeConfig) -> bool:
    hostname = parse.urlparse(config.origin).hostname or ""
    return hostname.lower() in {"localhost", "127.0.0.1", "::1"}


def _ensure_runtime(config: ForgeConfig) -> ForgeConfig:
    if not _is_local_origin(config) or not NODE_RUNTIME_HELPER.exists():
        return config

    try:
        _request_json(config, "GET", "/api/v1/health")
        return config
    except ForgePluginError:
        pass

    node = shutil.which("node")
    if not node:
        return config

    env = os.environ.copy()
    env["FORGE_ORIGIN"] = config.origin
    env["FORGE_PORT"] = str(config.port)
    env["FORGE_TIMEOUT_MS"] = str(config.timeout_ms)
    env["FORGE_ACTOR_LABEL"] = config.actor_label
    if config.data_root:
        env["FORGE_DATA_ROOT"] = config.data_root
    if config.api_token:
        env["FORGE_API_TOKEN"] = config.api_token

    completed = subprocess.run(
        [node, str(NODE_RUNTIME_HELPER)],
        cwd=str(PACKAGE_DIR),
        env=env,
        capture_output=True,
        text=True,
        timeout=max(5, int(config.timeout_ms / 1000) + 5),
        check=False,
    )
    if completed.returncode != 0:
        stderr = completed.stderr.strip() or completed.stdout.strip() or "Unknown runtime startup failure"
        raise ForgePluginError("forge_runtime_start_failed", stderr)

    payload = json.loads(completed.stdout)
    resolved = payload.get("config") or {}
    return ForgeConfig(
        origin=resolved.get("origin", config.origin),
        port=int(resolved.get("port", config.port)),
        base_url=resolved.get("baseUrl", config.base_url),
        web_app_url=resolved.get("webAppUrl", config.web_app_url),
        data_root=resolved.get("dataRoot", config.data_root),
        api_token=resolved.get("apiToken", config.api_token),
        actor_label=resolved.get("actorLabel", config.actor_label),
        timeout_ms=int(resolved.get("timeoutMs", config.timeout_ms)),
    )


def _resolve_path(spec: Dict[str, Any], args: Dict[str, Any]) -> str:
    if "path_builder" in spec:
        return spec["path_builder"](args)
    return spec["path"]


def _resolve_method(spec: Dict[str, Any], args: Dict[str, Any]) -> str:
    if "method_builder" in spec:
        return spec["method_builder"](args)
    return spec.get("method", "GET")


def _resolve_body(spec: Dict[str, Any], args: Dict[str, Any], config: ForgeConfig) -> Any:
    if "body_builder" in spec:
        return spec["body_builder"](args, config)
    if "static_body" in spec:
        return spec["static_body"]
    return args


def _resolve_ui_entrypoint(config: ForgeConfig) -> Dict[str, Any]:
    web_app_url = config.web_app_url
    try:
        onboarding = _request_json(config, "GET", "/api/v1/agents/onboarding")
        if (
            isinstance(onboarding, dict)
            and isinstance(onboarding.get("onboarding"), dict)
            and isinstance(onboarding["onboarding"].get("webAppUrl"), str)
            and onboarding["onboarding"]["webAppUrl"].strip()
        ):
            web_app_url = onboarding["onboarding"]["webAppUrl"].strip()
    except ForgePluginError:
        pass
    return {
        "webAppUrl": web_app_url,
        "pluginUiRoute": "/forge/v1/ui",
        "note": "You can continue directly in the Forge UI when a visual workflow is easier for review, Kanban, or Psyche exploration.",
    }


def _resolve_current_work(config: ForgeConfig, args: Dict[str, Any]) -> Dict[str, Any]:
    path = "/api/v1/operator/context"
    user_ids = args.get("userIds")
    if isinstance(user_ids, list):
        scoped_user_ids = [str(entry).strip() for entry in user_ids if str(entry).strip()]
        if scoped_user_ids:
            path = f"{path}?{parse.urlencode([('userIds', user_id) for user_id in scoped_user_ids])}"
    payload = _request_json(config, "GET", path)
    context = payload.get("context") if isinstance(payload, dict) else None
    recent_task_runs = context.get("recentTaskRuns", []) if isinstance(context, dict) else []
    focus_tasks = context.get("focusTasks", []) if isinstance(context, dict) else []
    active_task_runs = [entry for entry in recent_task_runs if isinstance(entry, dict) and entry.get("status") == "active"]
    return {
        "generatedAt": context.get("generatedAt") if isinstance(context, dict) else None,
        "activeTaskRuns": active_task_runs,
        "focusTasks": focus_tasks,
        "recommendedNextTask": context.get("recommendedNextTask") if isinstance(context, dict) else None,
        "xp": context.get("xp") if isinstance(context, dict) else None,
    }


def _resolve_doctor(config: ForgeConfig) -> Dict[str, Any]:
    doctor_response = _request_json(config, "GET", "/api/v1/doctor")
    overview = _request_json(config, "GET", "/api/v1/operator/overview")
    onboarding = _request_json(config, "GET", "/api/v1/agents/onboarding")

    doctor = doctor_response.get("doctor") if isinstance(doctor_response, dict) else None
    overview_body = overview.get("overview") if isinstance(overview, dict) else None
    capabilities = overview_body.get("capabilities") if isinstance(overview_body, dict) else None

    warnings = [
        entry
        for entry in doctor.get("warnings", [])
        if isinstance(doctor, dict) and isinstance(entry, str)
    ] if isinstance(doctor, dict) else []

    can_bootstrap = _can_bootstrap_operator_session(config.base_url)
    if not config.api_token and can_bootstrap:
        warnings.append(
            "Forge apiToken is not set. Hermes will rely on operator-session bootstrap for protected reads and writes."
        )
    if not config.api_token and not can_bootstrap:
        warnings.append(
            "Forge apiToken is missing, and this target cannot use local or Tailscale operator-session bootstrap. Protected writes will fail."
        )
    if isinstance(capabilities, dict) and capabilities.get("canReadPsyche") is False:
        warnings.append(
            "The configured token cannot read Psyche state. Sensitive reflection summaries will stay partial."
        )

    return {
        **(doctor if isinstance(doctor, dict) else {}),
        "ok": bool(
            isinstance(doctor, dict)
            and doctor.get("ok") is True
            and (config.api_token.strip() or can_bootstrap)
        ),
        "origin": config.origin,
        "port": config.port,
        "baseUrl": config.base_url,
        "webAppUrl": config.web_app_url,
        "apiTokenConfigured": bool(config.api_token.strip()),
        "operatorSessionBootstrapAvailable": can_bootstrap,
        "warnings": warnings,
        "overview": overview,
        "onboarding": onboarding,
    }


def _execute_spec(spec: Dict[str, Any], args: Dict[str, Any]) -> Dict[str, Any]:
    config = _ensure_runtime(_load_config())
    custom_handler = spec.get("custom_handler")
    if custom_handler == "ui_entrypoint":
        return _resolve_ui_entrypoint(config)
    if custom_handler == "current_work":
        return _resolve_current_work(config, args)
    if custom_handler == "doctor":
        return _resolve_doctor(config)

    path = _resolve_path(spec, args)
    method = _resolve_method(spec, args)
    body = None if method == "GET" else _resolve_body(spec, args, config)
    return _request_json(config, method, path, body=body)


TOOL_SPECS = {spec["name"]: spec for spec in TOOL_CATALOG}


def build_handler(tool_name: str):
    def handler(args: Optional[Dict[str, Any]] = None, **_kwargs: Any) -> str:
        spec = TOOL_SPECS[tool_name]
        session_id = _normalize_text(_kwargs.get("session_id"))
        if session_id:
            _append_runtime_session_event(
                session_id,
                event_type="tool_call",
                title=f"Tool call: {tool_name}",
                summary=_truncate_text(json.dumps(args or {}, ensure_ascii=False), 160),
                metadata={"toolName": tool_name},
            )
        try:
            payload = _execute_spec(spec, dict(args or {}))
            if session_id:
                _append_runtime_session_event(
                    session_id,
                    event_type="tool_result",
                    title=f"Tool result: {tool_name}",
                    summary="Forge returned a result to Hermes.",
                    metadata={"toolName": tool_name},
                )
            return _json_result(payload)
        except ForgePluginError as exc:
            if session_id:
                _append_runtime_session_event(
                    session_id,
                    event_type="tool_error",
                    title=f"Tool error: {tool_name}",
                    summary=str(exc),
                    metadata={"toolName": tool_name},
                    level="error",
                )
            return _safe_error(exc.code, str(exc))
        except subprocess.TimeoutExpired:
            if session_id:
                _append_runtime_session_event(
                    session_id,
                    event_type="tool_error",
                    title=f"Tool timeout: {tool_name}",
                    summary="Timed out while waiting for the local Forge runtime.",
                    metadata={"toolName": tool_name},
                    level="error",
                )
            return _safe_error("forge_runtime_timeout", "Timed out while waiting for the local Forge runtime.")
        except Exception as exc:  # pragma: no cover - final safety net for Hermes handlers
            if session_id:
                _append_runtime_session_event(
                    session_id,
                    event_type="tool_error",
                    title=f"Tool error: {tool_name}",
                    summary=str(exc),
                    metadata={"toolName": tool_name},
                    level="error",
                )
            return _safe_error("forge_plugin_error", str(exc))

    return handler
