"""Forge Hermes tool handlers."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
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
DEFAULT_HERMES_ACTOR_LABEL = "aurel (hermes)"


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


class ForgePluginError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


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
    headers = {
        "accept": "application/json",
        "x-forge-source": "agent",
        "x-forge-plugin-version": __version__,
        "x-forge-actor": config.actor_label,
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
        try:
            payload = _execute_spec(spec, dict(args or {}))
            return _json_result(payload)
        except ForgePluginError as exc:
            return _safe_error(exc.code, str(exc))
        except subprocess.TimeoutExpired:
            return _safe_error("forge_runtime_timeout", "Timed out while waiting for the local Forge runtime.")
        except Exception as exc:  # pragma: no cover - final safety net for Hermes handlers
            return _safe_error("forge_plugin_error", str(exc))

    return handler
