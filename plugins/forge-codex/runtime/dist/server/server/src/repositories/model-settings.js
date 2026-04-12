import { randomUUID } from "node:crypto";
import { getDatabase } from "../db.js";
import { aiModelConnectionSchema, upsertAiModelConnectionSchema } from "../types.js";
import { deleteEncryptedSecret, readEncryptedSecret, storeEncryptedSecret } from "./calendar.js";
import { upsertWikiLlmProfile } from "./wiki-memory.js";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
export const DEFAULT_MOCK_LLM_BASE_URL = "mock://workbench";
export const FORGE_MANAGED_WIKI_PROFILE_ID = "wiki_llm_forge_managed";
export const FORGE_DEFAULT_AGENT_ID = "agt_forge_default";
function parseMetadata(value) {
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : {};
    }
    catch {
        return {};
    }
}
function defaultAuthMode(provider) {
    return provider === "openai-codex" ? "oauth" : "api_key";
}
export function defaultBaseUrlForProvider(provider) {
    if (provider === "openai-codex") {
        return DEFAULT_OPENAI_CODEX_BASE_URL;
    }
    if (provider === "openai-compatible") {
        return "http://127.0.0.1:11434/v1";
    }
    if (provider === "mock") {
        return DEFAULT_MOCK_LLM_BASE_URL;
    }
    return DEFAULT_OPENAI_BASE_URL;
}
function buildConnectionAgentId(connectionId) {
    return `agt_model_${connectionId.replace(/[^a-zA-Z0-9]+/g, "_")}`;
}
export function buildConnectionAgentIdentity(connection) {
    const detail = connection.provider === "openai-codex"
        ? "Chat agent backed by OpenAI Codex OAuth."
        : connection.provider === "openai-compatible"
            ? "Chat agent backed by a local or OpenAI-compatible endpoint."
            : connection.provider === "mock"
                ? "Chat agent backed by Forge's deterministic mock workflow runtime."
                : "Chat agent backed by the OpenAI API.";
    return {
        id: connection.agentId,
        label: connection.agentLabel,
        agentType: connection.provider,
        trustLevel: "trusted",
        autonomyMode: "approval_required",
        approvalMode: "approval_by_default",
        description: detail,
        tokenCount: 0,
        activeTokenCount: 0,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt
    };
}
function mapConnection(row) {
    const hasStoredCredential = row.provider === "mock" ||
        (Boolean(row.secret_id) && Boolean(readEncryptedSecret(row.secret_id)));
    return aiModelConnectionSchema.parse({
        id: row.id,
        label: row.label,
        provider: row.provider,
        authMode: row.auth_mode,
        baseUrl: row.base_url,
        model: row.model,
        accountLabel: row.account_label,
        enabled: row.enabled === 1,
        status: hasStoredCredential ? "connected" : "needs_attention",
        hasStoredCredential,
        usesOAuth: row.auth_mode === "oauth",
        supportsCustomBaseUrl: row.provider !== "openai-codex",
        agentId: buildConnectionAgentId(row.id),
        agentLabel: `${row.label} agent`,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
export function listAiModelConnections() {
    const rows = getDatabase()
        .prepare(`SELECT id, label, provider, auth_mode, base_url, model, account_label, secret_id, enabled, metadata_json, created_at, updated_at
       FROM ai_model_connections
       ORDER BY created_at DESC`)
        .all();
    return rows.map(mapConnection);
}
export function getAiModelConnectionById(connectionId) {
    const row = getDatabase()
        .prepare(`SELECT id, label, provider, auth_mode, base_url, model, account_label, secret_id, enabled, metadata_json, created_at, updated_at
       FROM ai_model_connections
       WHERE id = ?`)
        .get(connectionId);
    return row ? mapConnection(row) : null;
}
export function readModelConnectionCredential(connectionId, secrets) {
    const row = getDatabase()
        .prepare(`SELECT secret_id
       FROM ai_model_connections
       WHERE id = ?`)
        .get(connectionId);
    if (!row?.secret_id) {
        return null;
    }
    const cipherText = readEncryptedSecret(row.secret_id);
    if (!cipherText) {
        return null;
    }
    return secrets.openJson(cipherText);
}
export function upsertAiModelConnection(input, secrets, options = {}) {
    const parsed = upsertAiModelConnectionSchema.parse(input);
    const existing = parsed.id?.trim()
        ? getDatabase()
            .prepare(`SELECT id, label, provider, auth_mode, base_url, model, account_label, secret_id, enabled, metadata_json, created_at, updated_at
           FROM ai_model_connections
           WHERE id = ?`)
            .get(parsed.id.trim())
        : undefined;
    const id = existing?.id ??
        `mdl_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const now = new Date().toISOString();
    const provider = parsed.provider;
    const authMode = parsed.authMode ?? defaultAuthMode(provider);
    const baseUrl = parsed.baseUrl?.trim() ||
        existing?.base_url ||
        defaultBaseUrlForProvider(provider);
    let secretId = existing?.secret_id ?? null;
    let accountLabel = existing?.account_label ?? null;
    if (parsed.provider === "mock") {
        secretId = null;
    }
    else if (parsed.apiKey?.trim()) {
        secretId =
            secretId ?? `mdl_secret_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
        storeEncryptedSecret(secretId, secrets.sealJson({
            kind: "api_key",
            provider,
            apiKey: parsed.apiKey.trim()
        }), `${parsed.label} AI connection`);
    }
    else if (options.oauthCredential) {
        secretId =
            secretId ?? `mdl_secret_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
        accountLabel = options.oauthCredential.accountId;
        storeEncryptedSecret(secretId, secrets.sealJson(options.oauthCredential), `${parsed.label} AI OAuth connection`);
    }
    getDatabase()
        .prepare(`INSERT INTO ai_model_connections (
        id, label, provider, auth_mode, base_url, model, account_label, secret_id, enabled, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        provider = excluded.provider,
        auth_mode = excluded.auth_mode,
        base_url = excluded.base_url,
        model = excluded.model,
        account_label = excluded.account_label,
        secret_id = excluded.secret_id,
        enabled = excluded.enabled,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at`)
        .run(id, parsed.label, provider, authMode, baseUrl, parsed.model.trim(), accountLabel, secretId, parsed.enabled ? 1 : 0, JSON.stringify(parseMetadata(existing?.metadata_json ?? "{}")), existing?.created_at ?? now, now);
    return getAiModelConnectionById(id);
}
export function deleteAiModelConnection(connectionId, secrets) {
    const row = getDatabase()
        .prepare(`SELECT id, secret_id
       FROM ai_model_connections
       WHERE id = ?`)
        .get(connectionId);
    if (!row) {
        return null;
    }
    getDatabase()
        .prepare(`DELETE FROM ai_model_connections WHERE id = ?`)
        .run(connectionId);
    if (row.secret_id) {
        deleteEncryptedSecret(row.secret_id);
    }
    getDatabase()
        .prepare(`UPDATE app_settings
       SET forge_basic_chat_connection_id = CASE WHEN forge_basic_chat_connection_id = ? THEN '' ELSE forge_basic_chat_connection_id END,
           forge_wiki_connection_id = CASE WHEN forge_wiki_connection_id = ? THEN '' ELSE forge_wiki_connection_id END,
           updated_at = ?
       WHERE id = 1`)
        .run(connectionId, connectionId, new Date().toISOString());
    syncForgeManagedWikiProfile(secrets);
    return row.id;
}
export function syncForgeManagedWikiProfile(secrets) {
    const settings = getDatabase()
        .prepare(`SELECT forge_wiki_connection_id, forge_wiki_model
       FROM app_settings
       WHERE id = 1`)
        .get();
    const connectionId = settings?.forge_wiki_connection_id?.trim() ?? "";
    const fallbackModel = settings?.forge_wiki_model?.trim() || "gpt-5.4-mini";
    const connection = connectionId ? getAiModelConnectionById(connectionId) : null;
    const row = connectionId
        ? getDatabase()
            .prepare(`SELECT secret_id
           FROM ai_model_connections
           WHERE id = ?`)
            .get(connectionId)
        : undefined;
    upsertWikiLlmProfile({
        id: FORGE_MANAGED_WIKI_PROFILE_ID,
        label: "Forge wiki ingest",
        provider: connection?.provider === "openai-compatible"
            ? "openai-compatible"
            : connection?.provider === "openai-codex"
                ? "openai-codex"
                : "openai-responses",
        baseUrl: connection?.baseUrl ?? DEFAULT_OPENAI_BASE_URL,
        model: connection?.model ?? fallbackModel,
        secretId: row?.secret_id ?? null,
        enabled: true,
        metadata: {
            managedBySettings: true,
            connectionId: connection?.id ?? null
        }
    }, secrets);
}
