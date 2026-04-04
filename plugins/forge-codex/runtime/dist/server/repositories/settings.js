import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { recordActivityEvent } from "./activity-events.js";
import { recordEventLog } from "./event-log.js";
import { createAgentTokenSchema, agentIdentitySchema, settingsPayloadSchema, updateSettingsSchema } from "../types.js";
function boolFromInt(value) {
    return value === 1;
}
function toInt(value) {
    return value ? 1 : 0;
}
function hashToken(token) {
    return createHash("sha256").update(token).digest("hex");
}
function defaultMicrosoftRedirectUri() {
    const port = process.env.PORT?.trim() || "4317";
    return `http://127.0.0.1:${port}/api/v1/calendar/oauth/microsoft/callback`;
}
function normalizeMicrosoftTenantId(value) {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : "common";
}
function normalizeMicrosoftRedirectUri(value) {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : defaultMicrosoftRedirectUri();
}
function buildTokenSecret() {
    return `fg_live_${randomBytes(18).toString("hex")}`;
}
function mapAgent(row) {
    return agentIdentitySchema.parse({
        id: row.id,
        label: row.label,
        agentType: row.agent_type,
        trustLevel: row.trust_level,
        autonomyMode: row.autonomy_mode,
        approvalMode: row.approval_mode,
        description: row.description,
        tokenCount: row.token_count,
        activeTokenCount: row.active_token_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
function mapToken(row) {
    return {
        id: row.id,
        label: row.label,
        tokenPrefix: row.token_prefix,
        scopes: JSON.parse(row.scopes_json),
        agentId: row.agent_id,
        agentLabel: row.agent_label,
        trustLevel: row.trust_level,
        autonomyMode: row.autonomy_mode,
        approvalMode: row.approval_mode,
        description: row.description,
        lastUsedAt: row.last_used_at,
        revokedAt: row.revoked_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        status: row.revoked_at ? "revoked" : "active"
    };
}
function findAgentIdentity(agentId) {
    const row = getDatabase()
        .prepare(`SELECT
         agent_identities.id,
         agent_identities.label,
         agent_identities.agent_type,
         agent_identities.trust_level,
         agent_identities.autonomy_mode,
         agent_identities.approval_mode,
         agent_identities.description,
         agent_identities.created_at,
         agent_identities.updated_at,
         COUNT(agent_tokens.id) AS token_count,
         COALESCE(SUM(CASE WHEN agent_tokens.revoked_at IS NULL THEN 1 ELSE 0 END), 0) AS active_token_count
       FROM agent_identities
       LEFT JOIN agent_tokens ON agent_tokens.agent_id = agent_identities.id
       WHERE agent_identities.id = ?
       GROUP BY agent_identities.id`)
        .get(agentId);
    return row ? mapAgent(row) : undefined;
}
function upsertAgentIdentity(input) {
    const now = new Date().toISOString();
    const existing = getDatabase()
        .prepare(`SELECT id
       FROM agent_identities
       WHERE lower(label) = lower(?)
       LIMIT 1`)
        .get(input.agentLabel);
    if (existing) {
        getDatabase()
            .prepare(`UPDATE agent_identities
         SET agent_type = ?, trust_level = ?, autonomy_mode = ?, approval_mode = ?, description = ?, updated_at = ?
         WHERE id = ?`)
            .run(input.agentType, input.trustLevel, input.autonomyMode, input.approvalMode, input.description, now, existing.id);
        return findAgentIdentity(existing.id);
    }
    const agentId = `agt_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    getDatabase()
        .prepare(`INSERT INTO agent_identities (
        id, label, agent_type, trust_level, autonomy_mode, approval_mode, description, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(agentId, input.agentLabel, input.agentType, input.trustLevel, input.autonomyMode, input.approvalMode, input.description, now, now);
    return findAgentIdentity(agentId);
}
function ensureSettingsRow(now = new Date().toISOString()) {
    getDatabase()
        .prepare(`INSERT OR IGNORE INTO app_settings (
        id, operator_name, operator_email, operator_title, theme_preference, locale_preference, goal_drift_alerts,
        daily_quest_reminders, achievement_celebrations, max_active_tasks, time_accounting_mode, integrity_score, last_audit_at, created_at, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run("Master Architect", "architect@kineticforge.ai", "Local-first operator", "obsidian", "en", 1, 1, 1, 2, "split", 98, now, now, now);
}
function readSettingsRow() {
    ensureSettingsRow();
    return getDatabase()
        .prepare(`SELECT
        operator_name, operator_email, operator_title, theme_preference, locale_preference,
        goal_drift_alerts, daily_quest_reminders, achievement_celebrations, max_active_tasks, time_accounting_mode,
        integrity_score, last_audit_at, psyche_auth_required, microsoft_client_id, microsoft_tenant_id, microsoft_redirect_uri, created_at, updated_at
       FROM app_settings
       WHERE id = 1`)
        .get();
}
export function listAgentTokens() {
    const rows = getDatabase()
        .prepare(`SELECT
         agent_tokens.id,
         agent_tokens.label,
         agent_tokens.token_prefix,
         agent_tokens.scopes_json,
         agent_tokens.agent_id,
         agent_identities.label AS agent_label,
         agent_tokens.trust_level,
         agent_tokens.autonomy_mode,
         agent_tokens.approval_mode,
         agent_tokens.description,
         agent_tokens.last_used_at,
         agent_tokens.revoked_at,
         agent_tokens.created_at,
         agent_tokens.updated_at
       FROM agent_tokens
       LEFT JOIN agent_identities ON agent_identities.id = agent_tokens.agent_id
       ORDER BY agent_tokens.created_at DESC`)
        .all();
    return rows.map(mapToken);
}
export function listAgentIdentities() {
    const rows = getDatabase()
        .prepare(`SELECT
         agent_identities.id,
         agent_identities.label,
         agent_identities.agent_type,
         agent_identities.trust_level,
         agent_identities.autonomy_mode,
         agent_identities.approval_mode,
         agent_identities.description,
         agent_identities.created_at,
         agent_identities.updated_at,
         COUNT(agent_tokens.id) AS token_count,
         COALESCE(SUM(CASE WHEN agent_tokens.revoked_at IS NULL THEN 1 ELSE 0 END), 0) AS active_token_count
       FROM agent_identities
       LEFT JOIN agent_tokens ON agent_tokens.agent_id = agent_identities.id
       GROUP BY agent_identities.id
       ORDER BY agent_identities.created_at DESC`)
        .all();
    return rows.map(mapAgent);
}
export function isPsycheAuthRequired() {
    ensureSettingsRow();
    const row = getDatabase()
        .prepare(`SELECT psyche_auth_required FROM app_settings WHERE id = 1`)
        .get();
    return row ? boolFromInt(row.psyche_auth_required) : false;
}
export function getSettings() {
    const row = readSettingsRow();
    const microsoftClientId = row.microsoft_client_id?.trim() ?? "";
    const microsoftTenantId = normalizeMicrosoftTenantId(row.microsoft_tenant_id);
    const microsoftRedirectUri = normalizeMicrosoftRedirectUri(row.microsoft_redirect_uri);
    return settingsPayloadSchema.parse({
        profile: {
            operatorName: row.operator_name,
            operatorEmail: row.operator_email,
            operatorTitle: row.operator_title
        },
        notifications: {
            goalDriftAlerts: boolFromInt(row.goal_drift_alerts),
            dailyQuestReminders: boolFromInt(row.daily_quest_reminders),
            achievementCelebrations: boolFromInt(row.achievement_celebrations)
        },
        execution: {
            maxActiveTasks: row.max_active_tasks,
            timeAccountingMode: row.time_accounting_mode
        },
        themePreference: row.theme_preference,
        localePreference: row.locale_preference,
        security: {
            integrityScore: row.integrity_score,
            lastAuditAt: row.last_audit_at,
            storageMode: "local-first",
            activeSessions: 1,
            tokenCount: listAgentTokens().filter((token) => token.status === "active").length,
            psycheAuthRequired: boolFromInt(row.psyche_auth_required)
        },
        calendarProviders: {
            microsoft: {
                clientId: microsoftClientId,
                tenantId: microsoftTenantId,
                redirectUri: microsoftRedirectUri,
                usesClientSecret: false,
                readOnly: true,
                authMode: "public_client_pkce",
                isConfigured: microsoftClientId.length > 0,
                isReadyForSignIn: microsoftClientId.length > 0,
                setupMessage: microsoftClientId.length > 0
                    ? "Microsoft local sign-in is configured. Test it if you want, then continue to the guided sign-in flow."
                    : "Save the Microsoft client ID and the Forge callback redirect URI here before you try to sign in."
            }
        },
        agents: listAgentIdentities(),
        agentTokens: listAgentTokens()
    });
}
export function updateSettings(input, activity) {
    const parsed = updateSettingsSchema.parse(input);
    return runInTransaction(() => {
        const current = getSettings();
        const now = new Date().toISOString();
        const next = {
            profile: {
                operatorName: parsed.profile?.operatorName ?? current.profile.operatorName,
                operatorEmail: parsed.profile?.operatorEmail ?? current.profile.operatorEmail,
                operatorTitle: parsed.profile?.operatorTitle ?? current.profile.operatorTitle
            },
            notifications: {
                goalDriftAlerts: parsed.notifications?.goalDriftAlerts ?? current.notifications.goalDriftAlerts,
                dailyQuestReminders: parsed.notifications?.dailyQuestReminders ?? current.notifications.dailyQuestReminders,
                achievementCelebrations: parsed.notifications?.achievementCelebrations ?? current.notifications.achievementCelebrations
            },
            execution: {
                maxActiveTasks: parsed.execution?.maxActiveTasks ?? current.execution.maxActiveTasks,
                timeAccountingMode: parsed.execution?.timeAccountingMode ?? current.execution.timeAccountingMode
            },
            themePreference: parsed.themePreference ?? current.themePreference,
            localePreference: parsed.localePreference ?? current.localePreference,
            psycheAuthRequired: parsed.security?.psycheAuthRequired ?? current.security.psycheAuthRequired,
            calendarProviders: {
                microsoft: {
                    clientId: parsed.calendarProviders?.microsoft?.clientId?.trim() ??
                        current.calendarProviders.microsoft.clientId,
                    tenantId: normalizeMicrosoftTenantId(parsed.calendarProviders?.microsoft?.tenantId ??
                        current.calendarProviders.microsoft.tenantId),
                    redirectUri: normalizeMicrosoftRedirectUri(parsed.calendarProviders?.microsoft?.redirectUri ??
                        current.calendarProviders.microsoft.redirectUri)
                }
            }
        };
        getDatabase()
            .prepare(`UPDATE app_settings
         SET operator_name = ?, operator_email = ?, operator_title = ?, theme_preference = ?, locale_preference = ?,
             goal_drift_alerts = ?, daily_quest_reminders = ?, achievement_celebrations = ?, max_active_tasks = ?, time_accounting_mode = ?,
             psyche_auth_required = ?, microsoft_client_id = ?, microsoft_tenant_id = ?, microsoft_redirect_uri = ?, updated_at = ?
         WHERE id = 1`)
            .run(next.profile.operatorName, next.profile.operatorEmail, next.profile.operatorTitle, next.themePreference, next.localePreference, toInt(next.notifications.goalDriftAlerts), toInt(next.notifications.dailyQuestReminders), toInt(next.notifications.achievementCelebrations), next.execution.maxActiveTasks, next.execution.timeAccountingMode, toInt(next.psycheAuthRequired), next.calendarProviders.microsoft.clientId, next.calendarProviders.microsoft.tenantId, next.calendarProviders.microsoft.redirectUri, now);
        if (activity) {
            recordActivityEvent({
                entityType: "system",
                entityId: "app_settings",
                eventType: "settings_updated",
                title: "Forge settings updated",
                description: `Theme is now ${next.themePreference}. Language is ${next.localePreference}.`,
                actor: activity.actor ?? null,
                source: activity.source,
                metadata: {
                    themePreference: next.themePreference,
                    localePreference: next.localePreference,
                    goalDriftAlerts: next.notifications.goalDriftAlerts,
                    dailyQuestReminders: next.notifications.dailyQuestReminders,
                    maxActiveTasks: next.execution.maxActiveTasks,
                    timeAccountingMode: next.execution.timeAccountingMode,
                    microsoftConfigured: next.calendarProviders.microsoft.clientId.trim().length > 0,
                    microsoftTenantId: next.calendarProviders.microsoft.tenantId
                }
            });
        }
        return getSettings();
    });
}
export function createAgentToken(input, activity) {
    const parsed = createAgentTokenSchema.parse(input);
    return runInTransaction(() => {
        const now = new Date().toISOString();
        const agent = upsertAgentIdentity(parsed);
        const id = `tok_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
        const token = buildTokenSecret();
        const tokenPrefix = `${token.slice(0, 10)}••••`;
        getDatabase()
            .prepare(`INSERT INTO agent_tokens (
          id, label, token_hash, token_prefix, scopes_json, agent_id, trust_level, autonomy_mode, approval_mode, description, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, parsed.label, hashToken(token), tokenPrefix, JSON.stringify(parsed.scopes), agent.id, parsed.trustLevel, parsed.autonomyMode, parsed.approvalMode, parsed.description, now, now);
        const tokenSummary = listAgentTokens().find((entry) => entry.id === id);
        if (activity) {
            recordActivityEvent({
                entityType: "system",
                entityId: id,
                eventType: "agent_token_created",
                title: `Agent token created: ${parsed.label}`,
                description: "A new local API token was issued.",
                actor: activity.actor ?? null,
                source: activity.source,
                metadata: {
                    agentId: agent.id,
                    agentLabel: agent.label,
                    scopes: parsed.scopes.join(",")
                }
            });
            recordEventLog({
                eventKind: "agent.token_created",
                entityType: "agent_token",
                entityId: id,
                actor: activity.actor ?? null,
                source: activity.source,
                metadata: {
                    agentId: agent.id,
                    trustLevel: parsed.trustLevel,
                    autonomyMode: parsed.autonomyMode,
                    approvalMode: parsed.approvalMode
                }
            });
        }
        return {
            token,
            tokenSummary
        };
    });
}
export function rotateAgentToken(tokenId, activity) {
    const existing = listAgentTokens().find((token) => token.id === tokenId);
    if (!existing) {
        return null;
    }
    return runInTransaction(() => {
        const now = new Date().toISOString();
        const token = buildTokenSecret();
        const tokenPrefix = `${token.slice(0, 10)}••••`;
        getDatabase()
            .prepare(`UPDATE agent_tokens SET token_hash = ?, token_prefix = ?, revoked_at = NULL, updated_at = ? WHERE id = ?`)
            .run(hashToken(token), tokenPrefix, now, tokenId);
        const tokenSummary = listAgentTokens().find((entry) => entry.id === tokenId);
        if (activity) {
            recordActivityEvent({
                entityType: "system",
                entityId: tokenId,
                eventType: "agent_token_rotated",
                title: `Agent token rotated: ${existing.label}`,
                description: "Local API token credentials were rotated.",
                actor: activity.actor ?? null,
                source: activity.source
            });
            recordEventLog({
                eventKind: "agent.token_rotated",
                entityType: "agent_token",
                entityId: tokenId,
                actor: activity.actor ?? null,
                source: activity.source
            });
        }
        return {
            token,
            tokenSummary
        };
    });
}
export function revokeAgentToken(tokenId, activity) {
    const existing = listAgentTokens().find((token) => token.id === tokenId);
    if (!existing) {
        return null;
    }
    return runInTransaction(() => {
        const now = new Date().toISOString();
        getDatabase()
            .prepare(`UPDATE agent_tokens SET revoked_at = ?, updated_at = ? WHERE id = ?`)
            .run(now, now, tokenId);
        const tokenSummary = listAgentTokens().find((entry) => entry.id === tokenId);
        if (activity) {
            recordActivityEvent({
                entityType: "system",
                entityId: tokenId,
                eventType: "agent_token_revoked",
                title: `Agent token revoked: ${existing.label}`,
                description: "The token can no longer access the local API.",
                actor: activity.actor ?? null,
                source: activity.source
            });
            recordEventLog({
                eventKind: "agent.token_revoked",
                entityType: "agent_token",
                entityId: tokenId,
                actor: activity.actor ?? null,
                source: activity.source
            });
        }
        return tokenSummary;
    });
}
export function getAgentTokenById(tokenId) {
    return listAgentTokens().find((token) => token.id === tokenId);
}
export function verifyAgentToken(token) {
    const hash = hashToken(token);
    const row = getDatabase()
        .prepare(`SELECT
         agent_tokens.id,
         agent_tokens.label,
         agent_tokens.token_prefix,
         agent_tokens.scopes_json,
         agent_tokens.agent_id,
         agent_identities.label AS agent_label,
         agent_tokens.trust_level,
         agent_tokens.autonomy_mode,
         agent_tokens.approval_mode,
         agent_tokens.description,
         agent_tokens.last_used_at,
         agent_tokens.revoked_at,
         agent_tokens.created_at,
         agent_tokens.updated_at
       FROM agent_tokens
       LEFT JOIN agent_identities ON agent_identities.id = agent_tokens.agent_id
       WHERE agent_tokens.token_hash = ?`)
        .get(hash);
    if (!row || row.revoked_at) {
        return null;
    }
    getDatabase().prepare(`UPDATE agent_tokens SET last_used_at = ?, updated_at = ? WHERE id = ?`).run(new Date().toISOString(), new Date().toISOString(), row.id);
    return mapToken(row);
}
