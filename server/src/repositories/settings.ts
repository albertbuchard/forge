import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { SecretsManager } from "../managers/platform/secrets-manager.js";
import { getDatabase, getEffectiveDataRoot, runInTransaction } from "../db.js";
import { logForgeDebug } from "../debug.js";
import { recordActivityEvent } from "./activity-events.js";
import { recordEventLog } from "./event-log.js";
import { resolveGoogleCalendarOauthPublicConfig } from "../services/google-calendar-oauth-config.js";
import {
  buildConnectionAgentIdentity,
  defaultBaseUrlForProvider,
  FORGE_DEFAULT_AGENT_ID,
  listAiModelConnections,
  syncForgeManagedWikiProfile
} from "./model-settings.js";
import { listUsersByIds } from "./users.js";
import {
  agentBootstrapPolicySchema,
  agentScopePolicySchema,
  createAgentTokenSchema,
  legacyAgentBootstrapPolicy,
  defaultAgentScopePolicy,
  agentIdentitySchema,
  customThemeSchema,
  settingsPayloadSchema,
  updateSettingsSchema,
  type ActivitySource,
  type AgentIdentity,
  type AgentTokenMutationResult,
  type AgentTokenSummary,
  type CreateAgentTokenInput,
  type AgentRuntimeProvider,
  type SettingsPayload,
  type UpdateSettingsInput
} from "../types.js";

type ActivityContext = {
  source: ActivitySource;
  actor?: string | null;
};

export type ForgeSettingsFileStatus = {
  path: string;
  exists: boolean;
  valid: boolean;
  syncState:
    | "uninitialized"
    | "created_from_database"
    | "mirrored_from_database"
    | "applied_file_overrides"
    | "invalid"
    | "up_to_date";
  parseError: string | null;
  overrideKeys: string[];
};

type SettingsRow = {
  operator_name: string;
  operator_email: string;
  operator_title: string;
  theme_preference:
    | "obsidian"
    | "solar"
    | "aurora"
    | "ember"
    | "paper"
    | "dawn"
    | "atelier"
    | "custom"
    | "system";
  gamification_theme: "dark-fantasy" | "dramatic-smithie" | "mind-locksmith";
  custom_theme_json: string;
  locale_preference: "en" | "fr";
  goal_drift_alerts: number;
  daily_quest_reminders: number;
  achievement_celebrations: number;
  max_active_tasks: number;
  time_accounting_mode: "split" | "parallel" | "primary_only";
  integrity_score: number;
  last_audit_at: string;
  psyche_auth_required: number;
  google_client_id: string;
  google_client_secret: string;
  microsoft_client_id: string;
  microsoft_tenant_id: string;
  microsoft_redirect_uri: string;
  forge_basic_chat_connection_id: string;
  forge_basic_chat_model: string;
  forge_wiki_connection_id: string;
  forge_wiki_model: string;
  created_at: string;
  updated_at: string;
};

type AgentTokenRow = {
  id: string;
  label: string;
  token_prefix: string;
  scopes_json: string;
  bootstrap_policy_json: string | null;
  scope_policy_json: string | null;
  agent_id: string | null;
  agent_label: string | null;
  trust_level: AgentTokenSummary["trustLevel"];
  autonomy_mode: AgentTokenSummary["autonomyMode"];
  approval_mode: AgentTokenSummary["approvalMode"];
  description: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

type AgentIdentityRow = {
  id: string;
  label: string;
  agent_type: string;
  identity_key: string | null;
  provider: AgentRuntimeProvider | null;
  machine_key: string | null;
  persona_key: string | null;
  trust_level: AgentIdentity["trustLevel"];
  autonomy_mode: AgentIdentity["autonomyMode"];
  approval_mode: AgentIdentity["approvalMode"];
  description: string;
  created_at: string;
  updated_at: string;
  token_count: number;
  active_token_count: number;
};

type AgentIdentityUserRow = {
  agent_id: string;
  user_id: string;
  role: string;
};

const settingsFileSchema = settingsPayloadSchema.deepPartial();
type SettingsFilePayload = z.infer<typeof settingsFileSchema>;

let settingsFileSyncDepth = 0;
let lastSettingsFileStatus: ForgeSettingsFileStatus = {
  path: path.join(getEffectiveDataRoot(), "forge.json"),
  exists: false,
  valid: false,
  syncState: "uninitialized",
  parseError: null,
  overrideKeys: []
};

function boolFromInt(value: number): boolean {
  return value === 1;
}

function toInt(value: boolean): number {
  return value ? 1 : 0;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function defaultMicrosoftRedirectUri() {
  const port = process.env.PORT?.trim() || "4317";
  return `http://127.0.0.1:${port}/api/v1/calendar/oauth/microsoft/callback`;
}

function normalizeMicrosoftTenantId(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "common";
}

function normalizeMicrosoftRedirectUri(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0
    ? trimmed
    : defaultMicrosoftRedirectUri();
}

function logCalendarSettingsDebug(
  message: string,
  details: Record<string, unknown>
) {
  const serialized = Object.entries(details)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
  logForgeDebug(`[forge-calendar-settings] ${message} ${serialized}`);
}

function normalizeModelConnectionId(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "";
}

function buildTokenSecret() {
  return `fg_live_${randomBytes(18).toString("hex")}`;
}

function parseCustomThemeJson(raw: string | null | undefined) {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return customThemeSchema.parse(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function getForgeSettingsFilePath() {
  return path.join(getEffectiveDataRoot(), "forge.json");
}

function writeForgeSettingsFileSnapshot(payload: SettingsPayload) {
  const filePath = getForgeSettingsFilePath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  lastSettingsFileStatus = {
    path: filePath,
    exists: true,
    valid: true,
    syncState: "mirrored_from_database",
    parseError: null,
    overrideKeys: []
  };
}

function readForgeSettingsFile() {
  const filePath = getForgeSettingsFilePath();
  if (!existsSync(filePath)) {
    return {
      filePath,
      exists: false,
      valid: false,
      settings: null,
      parseError: null
    };
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const settings = settingsFileSchema.parse(parsed);
    return {
      filePath,
      exists: true,
      valid: true,
      settings,
      parseError: null
    };
  } catch (error) {
    return {
      filePath,
      exists: true,
      valid: false,
      settings: null,
      parseError: error instanceof Error ? error.message : String(error)
    };
  }
}

function toSettingsFileOverrideInput(
  input: SettingsFilePayload
): UpdateSettingsInput {
  const next: UpdateSettingsInput = {};

  if (input.profile) {
    next.profile = {};
    if (input.profile.operatorName !== undefined) {
      next.profile.operatorName = input.profile.operatorName;
    }
    if (input.profile.operatorEmail !== undefined) {
      next.profile.operatorEmail = input.profile.operatorEmail;
    }
    if (input.profile.operatorTitle !== undefined) {
      next.profile.operatorTitle = input.profile.operatorTitle;
    }
    if (Object.keys(next.profile).length === 0) {
      delete next.profile;
    }
  }

  if (input.notifications) {
    next.notifications = {};
    if (input.notifications.goalDriftAlerts !== undefined) {
      next.notifications.goalDriftAlerts = input.notifications.goalDriftAlerts;
    }
    if (input.notifications.dailyQuestReminders !== undefined) {
      next.notifications.dailyQuestReminders =
        input.notifications.dailyQuestReminders;
    }
    if (input.notifications.achievementCelebrations !== undefined) {
      next.notifications.achievementCelebrations =
        input.notifications.achievementCelebrations;
    }
    if (Object.keys(next.notifications).length === 0) {
      delete next.notifications;
    }
  }

  if (input.execution) {
    next.execution = {};
    if (input.execution.maxActiveTasks !== undefined) {
      next.execution.maxActiveTasks = input.execution.maxActiveTasks;
    }
    if (input.execution.timeAccountingMode !== undefined) {
      next.execution.timeAccountingMode = input.execution.timeAccountingMode;
    }
    if (Object.keys(next.execution).length === 0) {
      delete next.execution;
    }
  }

  if (input.themePreference !== undefined) {
    next.themePreference = input.themePreference;
  }
  if (input.gamificationTheme !== undefined) {
    next.gamificationTheme = input.gamificationTheme;
  }
  if (input.customTheme !== undefined) {
    if (input.customTheme === null) {
      next.customTheme = null;
    } else {
      const parsedCustomTheme = customThemeSchema.safeParse(input.customTheme);
      if (parsedCustomTheme.success) {
        next.customTheme = parsedCustomTheme.data;
      }
    }
  }
  if (input.localePreference !== undefined) {
    next.localePreference = input.localePreference;
  }

  if (input.security?.psycheAuthRequired !== undefined) {
    next.security = {
      psycheAuthRequired: input.security.psycheAuthRequired
    };
  }

  if (input.calendarProviders) {
    next.calendarProviders = {};
    if (input.calendarProviders.google) {
      next.calendarProviders.google = {};
      if (input.calendarProviders.google.clientId !== undefined) {
        next.calendarProviders.google.clientId =
          input.calendarProviders.google.clientId;
      }
      if (input.calendarProviders.google.clientSecret !== undefined) {
        next.calendarProviders.google.clientSecret =
          input.calendarProviders.google.clientSecret;
      }
      if (Object.keys(next.calendarProviders.google).length === 0) {
        delete next.calendarProviders.google;
      }
    }
    if (input.calendarProviders.microsoft) {
      next.calendarProviders.microsoft = {};
      if (input.calendarProviders.microsoft.clientId !== undefined) {
        next.calendarProviders.microsoft.clientId =
          input.calendarProviders.microsoft.clientId;
      }
      if (input.calendarProviders.microsoft.tenantId !== undefined) {
        next.calendarProviders.microsoft.tenantId =
          input.calendarProviders.microsoft.tenantId;
      }
      if (input.calendarProviders.microsoft.redirectUri !== undefined) {
        next.calendarProviders.microsoft.redirectUri =
          input.calendarProviders.microsoft.redirectUri;
      }
      if (Object.keys(next.calendarProviders.microsoft).length === 0) {
        delete next.calendarProviders.microsoft;
      }
    }
    if (Object.keys(next.calendarProviders).length === 0) {
      delete next.calendarProviders;
    }
  }

  if (input.modelSettings?.forgeAgent) {
    const forgeAgent: NonNullable<
      NonNullable<UpdateSettingsInput["modelSettings"]>["forgeAgent"]
    > = {};
    if (input.modelSettings.forgeAgent.basicChat) {
      forgeAgent.basicChat = {};
      if (input.modelSettings.forgeAgent.basicChat.connectionId !== undefined) {
        forgeAgent.basicChat.connectionId =
          input.modelSettings.forgeAgent.basicChat.connectionId;
      }
      if (input.modelSettings.forgeAgent.basicChat.model !== undefined) {
        forgeAgent.basicChat.model =
          input.modelSettings.forgeAgent.basicChat.model;
      }
      if (Object.keys(forgeAgent.basicChat).length === 0) {
        delete forgeAgent.basicChat;
      }
    }
    if (input.modelSettings.forgeAgent.wiki) {
      forgeAgent.wiki = {};
      if (input.modelSettings.forgeAgent.wiki.connectionId !== undefined) {
        forgeAgent.wiki.connectionId =
          input.modelSettings.forgeAgent.wiki.connectionId;
      }
      if (input.modelSettings.forgeAgent.wiki.model !== undefined) {
        forgeAgent.wiki.model =
          input.modelSettings.forgeAgent.wiki.model;
      }
      if (Object.keys(forgeAgent.wiki).length === 0) {
        delete forgeAgent.wiki;
      }
    }
    if (Object.keys(forgeAgent).length > 0) {
      next.modelSettings = { forgeAgent };
    }
  }

  return next;
}

function listOverrideKeys(input: UpdateSettingsInput) {
  const keys: string[] = [];
  const pushNestedKeys = (prefix: string, value: Record<string, unknown>) => {
    for (const [key, nestedValue] of Object.entries(value)) {
      if (
        nestedValue &&
        typeof nestedValue === "object" &&
        !Array.isArray(nestedValue)
      ) {
        pushNestedKeys(
          `${prefix}.${key}`,
          nestedValue as Record<string, unknown>
        );
      } else if (nestedValue !== undefined) {
        keys.push(`${prefix}.${key}`);
      }
    }
  };

  for (const [key, value] of Object.entries(input)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      keys.push(key);
      continue;
    }
    pushNestedKeys(key, value as Record<string, unknown>);
  }

  return keys.sort();
}

function pickComparableOverrideSubset(
  source: UpdateSettingsInput,
  template: UpdateSettingsInput
): UpdateSettingsInput {
  const picked: Record<string, unknown> = {};

  for (const [key, templateValue] of Object.entries(template)) {
    if (templateValue === undefined) {
      continue;
    }

    const sourceValue = source[key as keyof UpdateSettingsInput];
    if (
      templateValue &&
      typeof templateValue === "object" &&
      !Array.isArray(templateValue) &&
      sourceValue &&
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue)
    ) {
      const nested = pickComparableOverrideSubset(
        sourceValue as UpdateSettingsInput,
        templateValue as UpdateSettingsInput
      );
      if (Object.keys(nested).length > 0) {
        picked[key] = nested;
      }
      continue;
    }

    picked[key] = sourceValue;
  }

  return picked as UpdateSettingsInput;
}

function listAgentIdentityUserLinks(
  agentIds: string[]
): Map<string, AgentIdentity["linkedUsers"]> {
  if (agentIds.length === 0) {
    return new Map();
  }
  const placeholders = agentIds.map(() => "?").join(",");
  const rows = getDatabase()
    .prepare(
      `SELECT agent_id, user_id, role
       FROM agent_identity_users
       WHERE agent_id IN (${placeholders})
       ORDER BY role = 'primary' DESC, created_at ASC`
    )
    .all(...agentIds) as AgentIdentityUserRow[];
  const usersById = new Map(
    listUsersByIds(rows.map((row) => row.user_id)).map(
      (user) => [user.id, user] as const
    )
  );
  const linksByAgentId = new Map<string, AgentIdentity["linkedUsers"]>();
  for (const row of rows) {
    const current = linksByAgentId.get(row.agent_id) ?? [];
    current.push({
      userId: row.user_id,
      role: row.role,
      user: usersById.get(row.user_id) ?? null
    });
    linksByAgentId.set(row.agent_id, current);
  }
  return linksByAgentId;
}

function mapAgent(
  row: AgentIdentityRow,
  linkedUsers: AgentIdentity["linkedUsers"] = []
): AgentIdentity {
  return agentIdentitySchema.parse({
    id: row.id,
    label: row.label,
    agentType: row.agent_type,
    identityKey: row.identity_key,
    provider: row.provider,
    machineKey: row.machine_key,
    personaKey: row.persona_key,
    linkedUsers,
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

function mapToken(row: AgentTokenRow): AgentTokenSummary {
  const bootstrapPolicy = agentBootstrapPolicySchema.parse(
    row.bootstrap_policy_json
      ? JSON.parse(row.bootstrap_policy_json)
      : legacyAgentBootstrapPolicy
  );
  const scopePolicy = agentScopePolicySchema.parse(
    row.scope_policy_json
      ? JSON.parse(row.scope_policy_json)
      : defaultAgentScopePolicy
  );
  return {
    id: row.id,
    label: row.label,
    tokenPrefix: row.token_prefix,
    scopes: JSON.parse(row.scopes_json) as string[],
    agentId: row.agent_id,
    agentLabel: row.agent_label,
    trustLevel: row.trust_level,
    autonomyMode: row.autonomy_mode,
    approvalMode: row.approval_mode,
    description: row.description,
    bootstrapPolicy,
    scopePolicy,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.revoked_at ? "revoked" : "active"
  };
}

function findAgentIdentity(agentId: string): AgentIdentity | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT
         agent_identities.id,
         agent_identities.label,
         agent_identities.agent_type,
         agent_identities.identity_key,
         agent_identities.provider,
         agent_identities.machine_key,
         agent_identities.persona_key,
         agent_identities.trust_level,
         agent_identities.autonomy_mode,
         agent_identities.approval_mode,
         agent_identities.description,
         agent_identities.created_at,
         agent_identities.updated_at,
         COUNT(agent_tokens.id) AS token_count,
         COALESCE(SUM(CASE WHEN agent_tokens.id IS NOT NULL AND agent_tokens.revoked_at IS NULL THEN 1 ELSE 0 END), 0) AS active_token_count
       FROM agent_identities
       LEFT JOIN agent_tokens ON agent_tokens.agent_id = agent_identities.id
       WHERE agent_identities.id = ?
       GROUP BY agent_identities.id`
    )
    .get(agentId) as AgentIdentityRow | undefined;
  const links = row ? listAgentIdentityUserLinks([row.id]) : new Map();
  return row ? mapAgent(row, links.get(row.id) ?? []) : undefined;
}

function normalizeAgentIdentityPart(value: string | null | undefined) {
  return value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:]+/g, "_")
    .replace(/^_+|_+$/g, "") || "";
}

function runtimeProviderFromAgentType(
  agentType: string
): AgentRuntimeProvider | null {
  const normalized = normalizeAgentIdentityPart(agentType);
  if (
    normalized === "openclaw" ||
    normalized === "hermes" ||
    normalized === "codex"
  ) {
    return normalized;
  }
  return null;
}

function deriveTokenAgentIdentityFields(input: CreateAgentTokenInput): {
  identityKey: string | null;
  provider: AgentRuntimeProvider | null;
  machineKey: string | null;
  personaKey: string | null;
} {
  const provider = runtimeProviderFromAgentType(input.agentType);
  if (!provider) {
    return {
      identityKey: null,
      provider: null,
      machineKey: null,
      personaKey: null
    };
  }
  return {
    identityKey: `runtime:${provider}:token:default`,
    provider,
    machineKey: "token",
    personaKey: "default"
  };
}

function upsertAgentIdentity(input: CreateAgentTokenInput): AgentIdentity {
  const now = new Date().toISOString();
  const identityFields = deriveTokenAgentIdentityFields(input);
  const existing = getDatabase()
    .prepare(
      `SELECT id
       FROM agent_identities
       WHERE (? IS NOT NULL AND identity_key = ?)
          OR lower(label) = lower(?)
       LIMIT 1`
    )
    .get(
      identityFields.identityKey,
      identityFields.identityKey,
      input.agentLabel
    ) as { id: string } | undefined;

  if (existing) {
    getDatabase()
      .prepare(
        `UPDATE agent_identities
         SET agent_type = ?, identity_key = COALESCE(identity_key, ?),
             provider = COALESCE(provider, ?), machine_key = COALESCE(machine_key, ?),
             persona_key = COALESCE(persona_key, ?), trust_level = ?,
             autonomy_mode = ?, approval_mode = ?, description = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.agentType,
        identityFields.identityKey,
        identityFields.provider,
        identityFields.machineKey,
        identityFields.personaKey,
        input.trustLevel,
        input.autonomyMode,
        input.approvalMode,
        input.description,
        now,
        existing.id
      );
    return findAgentIdentity(existing.id)!;
  }

  const agentId = `agt_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  getDatabase()
    .prepare(
      `INSERT INTO agent_identities (
        id, label, agent_type, identity_key, provider, machine_key, persona_key,
        trust_level, autonomy_mode, approval_mode, description, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      agentId,
      input.agentLabel,
      input.agentType,
      identityFields.identityKey,
      identityFields.provider,
      identityFields.machineKey,
      identityFields.personaKey,
      input.trustLevel,
      input.autonomyMode,
      input.approvalMode,
      input.description,
      now,
      now
    );
  return findAgentIdentity(agentId)!;
}

function ensureSettingsRow(now = new Date().toISOString()) {
  getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO app_settings (
        id, operator_name, operator_email, operator_title, theme_preference, gamification_theme, locale_preference, goal_drift_alerts,
        daily_quest_reminders, achievement_celebrations, max_active_tasks, time_accounting_mode, integrity_score, last_audit_at, created_at, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "Master Architect",
      "architect@kineticforge.ai",
      "Local-first operator",
      "obsidian",
      "dramatic-smithie",
      "en",
      1,
      1,
      1,
      2,
      "split",
      98,
      now,
      now,
      now
    );
}

function readSettingsRow(): SettingsRow {
  ensureSettingsRow();
  return getDatabase()
    .prepare(
      `SELECT
        operator_name, operator_email, operator_title, theme_preference, gamification_theme, custom_theme_json, locale_preference,
        goal_drift_alerts, daily_quest_reminders, achievement_celebrations, max_active_tasks, time_accounting_mode,
        integrity_score, last_audit_at, psyche_auth_required, google_client_id, google_client_secret, microsoft_client_id, microsoft_tenant_id, microsoft_redirect_uri,
        forge_basic_chat_connection_id, forge_basic_chat_model, forge_wiki_connection_id, forge_wiki_model, created_at, updated_at
       FROM app_settings
       WHERE id = 1`
    )
    .get() as SettingsRow;
}

export function listAgentTokens(): AgentTokenSummary[] {
  const rows = getDatabase()
    .prepare(
        `SELECT
         agent_tokens.id,
         agent_tokens.label,
         agent_tokens.token_prefix,
         agent_tokens.scopes_json,
         agent_tokens.bootstrap_policy_json,
         agent_tokens.scope_policy_json,
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
       ORDER BY agent_tokens.created_at DESC`
    )
    .all() as AgentTokenRow[];
  return rows.map(mapToken);
}

export function listAgentIdentities(): AgentIdentity[] {
  const rows = getDatabase()
    .prepare(
      `SELECT
         agent_identities.id,
         agent_identities.label,
         agent_identities.agent_type,
         agent_identities.identity_key,
         agent_identities.provider,
         agent_identities.machine_key,
         agent_identities.persona_key,
         agent_identities.trust_level,
         agent_identities.autonomy_mode,
         agent_identities.approval_mode,
         agent_identities.description,
         agent_identities.created_at,
         agent_identities.updated_at,
         COUNT(agent_tokens.id) AS token_count,
         COALESCE(SUM(CASE WHEN agent_tokens.id IS NOT NULL AND agent_tokens.revoked_at IS NULL THEN 1 ELSE 0 END), 0) AS active_token_count
       FROM agent_identities
       LEFT JOIN agent_tokens ON agent_tokens.agent_id = agent_identities.id
       GROUP BY agent_identities.id
       ORDER BY agent_identities.created_at DESC`
    )
    .all() as AgentIdentityRow[];
  const links = listAgentIdentityUserLinks(rows.map((row) => row.id));
  const manualAgents = rows.map((row) => mapAgent(row, links.get(row.id) ?? []));
  const modelAgents = listAiModelConnections().map(
    buildConnectionAgentIdentity
  );
  const settings = readSettingsRow();
  const forgeAgent = agentIdentitySchema.parse({
    id: FORGE_DEFAULT_AGENT_ID,
    label: "Forge Agent",
    agentType: "forge_default",
    identityKey: "forge:default",
    provider: null,
    machineKey: null,
    personaKey: "default",
    linkedUsers: [],
    trustLevel: "trusted",
    autonomyMode: "approval_required",
    approvalMode: "approval_by_default",
    description:
      "Built-in Forge operator agent. Owns Forge-native task flows, prompts, and orchestration.",
    tokenCount: 0,
    activeTokenCount: 0,
    createdAt: settings.created_at,
    updatedAt: settings.updated_at
  });
  const deduped = new Map<string, AgentIdentity>();
  for (const agent of [forgeAgent, ...modelAgents, ...manualAgents]) {
    deduped.set(agent.identityKey ?? agent.id, agent);
  }
  return Array.from(deduped.values());
}

export function isPsycheAuthRequired(): boolean {
  ensureSettingsRow();
  const row = getDatabase()
    .prepare(`SELECT psyche_auth_required FROM app_settings WHERE id = 1`)
    .get() as { psyche_auth_required: number } | undefined;
  return row ? boolFromInt(row.psyche_auth_required) : false;
}

function buildSettingsPayloadFromDatabase(): SettingsPayload {
  const row = readSettingsRow();
  const connections = listAiModelConnections();
  const googleConfig = resolveGoogleCalendarOauthPublicConfig(process.env, {
    clientId: row.google_client_id,
    clientSecret: row.google_client_secret
  });
  logCalendarSettingsDebug("get_settings", {
    storedGoogleClientId: row.google_client_id,
    storedGoogleClientSecret: row.google_client_secret.length > 0,
    resolvedGoogleClientId: googleConfig.clientId,
    resolvedGoogleClientSecret: googleConfig.clientSecret.length > 0,
    googleIsConfigured: googleConfig.isConfigured,
    googleRedirectUri: googleConfig.redirectUri
  });
  const microsoftClientId = row.microsoft_client_id?.trim() ?? "";
  const microsoftTenantId = normalizeMicrosoftTenantId(row.microsoft_tenant_id);
  const microsoftRedirectUri = normalizeMicrosoftRedirectUri(
    row.microsoft_redirect_uri
  );
  const basicChatConnectionId = normalizeModelConnectionId(
    row.forge_basic_chat_connection_id
  );
  const wikiConnectionId = normalizeModelConnectionId(
    row.forge_wiki_connection_id
  );
  const basicChatConnection =
    connections.find((entry) => entry.id === basicChatConnectionId) ?? null;
  const wikiConnection =
    connections.find((entry) => entry.id === wikiConnectionId) ?? null;
  const customTheme = parseCustomThemeJson(row.custom_theme_json);
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
    gamificationTheme: row.gamification_theme,
    customTheme,
    localePreference: row.locale_preference,
    security: {
      integrityScore: row.integrity_score,
      lastAuditAt: row.last_audit_at,
      storageMode: "local-first",
      activeSessions: 1,
      tokenCount: listAgentTokens().filter((token) => token.status === "active")
        .length,
      psycheAuthRequired: boolFromInt(row.psyche_auth_required)
    },
    calendarProviders: {
      google: googleConfig,
      microsoft: {
        clientId: microsoftClientId,
        tenantId: microsoftTenantId,
        redirectUri: microsoftRedirectUri,
        usesClientSecret: false,
        readOnly: true,
        authMode: "public_client_pkce",
        isConfigured: microsoftClientId.length > 0,
        isReadyForSignIn: microsoftClientId.length > 0,
        setupMessage:
          microsoftClientId.length > 0
            ? "Microsoft local sign-in is configured. Test it if you want, then continue to the guided sign-in flow."
            : "Save the Microsoft client ID and the Forge callback redirect URI here before you try to sign in."
      }
    },
    modelSettings: {
      forgeAgent: {
        basicChat: {
          connectionId: basicChatConnection?.id ?? null,
          connectionLabel: basicChatConnection?.label ?? null,
          provider: basicChatConnection?.provider ?? null,
          baseUrl: basicChatConnection?.baseUrl ?? null,
          model:
            row.forge_basic_chat_model?.trim() ||
            basicChatConnection?.model ||
            "gpt-5.4-mini"
        },
        wiki: {
          connectionId: wikiConnection?.id ?? null,
          connectionLabel: wikiConnection?.label ?? null,
          provider: wikiConnection?.provider ?? null,
          baseUrl: wikiConnection?.baseUrl ?? null,
          model:
            row.forge_wiki_model?.trim() ||
            wikiConnection?.model ||
            "gpt-5.4-mini"
        }
      },
      connections,
      oauth: {
        openAiCodex: {
          authorizeUrl: "https://auth.openai.com/oauth/authorize",
          callbackUrl: "http://127.0.0.1:1455/auth/callback",
          setupMessage:
            "Forge mirrors OpenClaw's local OpenAI Codex PKCE flow. The browser returns to localhost:1455, and Forge can also accept a pasted redirect URL when the callback cannot bind."
        }
      }
    },
    agents: listAgentIdentities(),
    agentTokens: listAgentTokens()
  });
}

function reconcileSettingsFileWithDatabase(
  current: SettingsPayload
): SettingsPayload {
  const fileState = readForgeSettingsFile();
  if (!fileState.exists) {
    writeForgeSettingsFileSnapshot(current);
    lastSettingsFileStatus = {
      path: fileState.filePath,
      exists: true,
      valid: true,
      syncState: "created_from_database",
      parseError: null,
      overrideKeys: []
    };
    return current;
  }

  if (!fileState.valid || !fileState.settings) {
    lastSettingsFileStatus = {
      path: fileState.filePath,
      exists: true,
      valid: false,
      syncState: "invalid",
      parseError: fileState.parseError,
      overrideKeys: []
    };
    return current;
  }

  const overrideInput = toSettingsFileOverrideInput(fileState.settings);
  const overrideKeys = listOverrideKeys(overrideInput);
  let next = current;
  const currentOverride = pickComparableOverrideSubset(
    toSettingsFileOverrideInput(current),
    overrideInput
  );
  const overridesDiffer =
    JSON.stringify(currentOverride) !== JSON.stringify(overrideInput);
  if (overrideKeys.length > 0 && overridesDiffer) {
    next = updateSettingsInternal(overrideInput, {
      mirrorSettingsFile: false
    });
  }

  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  let syncState: ForgeSettingsFileStatus["syncState"] =
    overrideKeys.length > 0 && overridesDiffer
      ? "applied_file_overrides"
      : "up_to_date";
  try {
    const existing = readFileSync(fileState.filePath, "utf8");
    if (existing !== serialized) {
      mkdirSync(path.dirname(fileState.filePath), { recursive: true });
      writeFileSync(fileState.filePath, serialized, "utf8");
      if (syncState !== "applied_file_overrides") {
        syncState = "mirrored_from_database";
      }
    }
  } catch {
    mkdirSync(path.dirname(fileState.filePath), { recursive: true });
    writeFileSync(fileState.filePath, serialized, "utf8");
    if (syncState !== "applied_file_overrides") {
      syncState = "mirrored_from_database";
    }
  }

  lastSettingsFileStatus = {
    path: fileState.filePath,
    exists: true,
    valid: true,
    syncState,
    parseError: null,
    overrideKeys
  };
  return next;
}

export function getSettingsFileStatus(): ForgeSettingsFileStatus {
  return {
    ...lastSettingsFileStatus,
    path: getForgeSettingsFilePath()
  };
}

export function mirrorSettingsFileFromCurrentState(): SettingsPayload {
  const current = buildSettingsPayloadFromDatabase();
  writeForgeSettingsFileSnapshot(current);
  return current;
}

export function getSettings(): SettingsPayload {
  if (settingsFileSyncDepth > 0) {
    return buildSettingsPayloadFromDatabase();
  }
  settingsFileSyncDepth += 1;
  try {
    return reconcileSettingsFileWithDatabase(
      buildSettingsPayloadFromDatabase()
    );
  } finally {
    settingsFileSyncDepth = Math.max(0, settingsFileSyncDepth - 1);
  }
}

function updateSettingsInternal(
  input: UpdateSettingsInput,
  options: {
    activity?: ActivityContext;
    secrets?: SecretsManager;
    mirrorSettingsFile?: boolean;
  } = {}
): SettingsPayload {
  const parsed = updateSettingsSchema.parse(input);
  return runInTransaction(() => {
    const current = buildSettingsPayloadFromDatabase();
    const now = new Date().toISOString();
    const nextGoogleClientId =
      parsed.calendarProviders?.google?.clientId?.trim() ??
      current.calendarProviders.google.storedClientId;
    const nextGoogleClientSecret =
      parsed.calendarProviders?.google?.clientSecret?.trim() ??
      current.calendarProviders.google.storedClientSecret;
    logCalendarSettingsDebug("update_settings_requested", {
      requestedGoogleClientId:
        parsed.calendarProviders?.google?.clientId ?? null,
      requestedGoogleClientSecret:
        parsed.calendarProviders?.google?.clientSecret !== undefined
          ? parsed.calendarProviders.google.clientSecret.length > 0
          : null,
      currentGoogleClientId: current.calendarProviders.google.storedClientId,
      currentGoogleClientSecret:
        current.calendarProviders.google.storedClientSecret.length > 0,
      nextGoogleClientId,
      nextGoogleClientSecret: nextGoogleClientSecret.length > 0
    });
    const next = {
      profile: {
        operatorName:
          parsed.profile?.operatorName ?? current.profile.operatorName,
        operatorEmail:
          parsed.profile?.operatorEmail ?? current.profile.operatorEmail,
        operatorTitle:
          parsed.profile?.operatorTitle ?? current.profile.operatorTitle
      },
      notifications: {
        goalDriftAlerts:
          parsed.notifications?.goalDriftAlerts ??
          current.notifications.goalDriftAlerts,
        dailyQuestReminders:
          parsed.notifications?.dailyQuestReminders ??
          current.notifications.dailyQuestReminders,
        achievementCelebrations:
          parsed.notifications?.achievementCelebrations ??
          current.notifications.achievementCelebrations
      },
      execution: {
        maxActiveTasks:
          parsed.execution?.maxActiveTasks ?? current.execution.maxActiveTasks,
        timeAccountingMode:
          parsed.execution?.timeAccountingMode ??
          current.execution.timeAccountingMode
      },
      themePreference: parsed.themePreference ?? current.themePreference,
      gamificationTheme:
        parsed.gamificationTheme ?? current.gamificationTheme,
      customTheme:
        parsed.customTheme === undefined
          ? (current.customTheme ?? null)
          : parsed.customTheme,
      localePreference: parsed.localePreference ?? current.localePreference,
      psycheAuthRequired:
        parsed.security?.psycheAuthRequired ??
        current.security.psycheAuthRequired,
      calendarProviders: {
        google: resolveGoogleCalendarOauthPublicConfig(process.env, {
          clientId: nextGoogleClientId,
          clientSecret: nextGoogleClientSecret
        }),
        microsoft: {
          clientId:
            parsed.calendarProviders?.microsoft?.clientId?.trim() ??
            current.calendarProviders.microsoft.clientId,
          tenantId: normalizeMicrosoftTenantId(
            parsed.calendarProviders?.microsoft?.tenantId ??
              current.calendarProviders.microsoft.tenantId
          ),
          redirectUri: normalizeMicrosoftRedirectUri(
            parsed.calendarProviders?.microsoft?.redirectUri ??
              current.calendarProviders.microsoft.redirectUri
          )
        }
      },
      modelSettings: {
        forgeAgent: {
          basicChat: {
            connectionId:
              parsed.modelSettings?.forgeAgent?.basicChat?.connectionId !==
              undefined
                ? normalizeModelConnectionId(
                    parsed.modelSettings.forgeAgent.basicChat.connectionId
                  )
                : (current.modelSettings.forgeAgent.basicChat.connectionId ??
                  ""),
            model:
              parsed.modelSettings?.forgeAgent?.basicChat?.model?.trim() ||
              current.modelSettings.forgeAgent.basicChat.model
          },
          wiki: {
            connectionId:
              parsed.modelSettings?.forgeAgent?.wiki?.connectionId !== undefined
                ? normalizeModelConnectionId(
                    parsed.modelSettings.forgeAgent.wiki.connectionId
                  )
                : (current.modelSettings.forgeAgent.wiki.connectionId ?? ""),
            model:
              parsed.modelSettings?.forgeAgent?.wiki?.model?.trim() ||
              current.modelSettings.forgeAgent.wiki.model
          }
        }
      }
    };

    getDatabase()
      .prepare(
        `UPDATE app_settings
         SET operator_name = ?, operator_email = ?, operator_title = ?, theme_preference = ?, gamification_theme = ?, custom_theme_json = ?, locale_preference = ?,
             goal_drift_alerts = ?, daily_quest_reminders = ?, achievement_celebrations = ?, max_active_tasks = ?, time_accounting_mode = ?,
             psyche_auth_required = ?, google_client_id = ?, google_client_secret = ?, microsoft_client_id = ?, microsoft_tenant_id = ?, microsoft_redirect_uri = ?,
             forge_basic_chat_connection_id = ?, forge_basic_chat_model = ?, forge_wiki_connection_id = ?, forge_wiki_model = ?, updated_at = ?
         WHERE id = 1`
      )
      .run(
        next.profile.operatorName,
        next.profile.operatorEmail,
        next.profile.operatorTitle,
        next.themePreference,
        next.gamificationTheme,
        next.customTheme ? JSON.stringify(next.customTheme) : "",
        next.localePreference,
        toInt(next.notifications.goalDriftAlerts),
        toInt(next.notifications.dailyQuestReminders),
        toInt(next.notifications.achievementCelebrations),
        next.execution.maxActiveTasks,
        next.execution.timeAccountingMode,
        toInt(next.psycheAuthRequired),
        nextGoogleClientId,
        nextGoogleClientSecret,
        next.calendarProviders.microsoft.clientId,
        next.calendarProviders.microsoft.tenantId,
        next.calendarProviders.microsoft.redirectUri,
        next.modelSettings.forgeAgent.basicChat.connectionId,
        next.modelSettings.forgeAgent.basicChat.model,
        next.modelSettings.forgeAgent.wiki.connectionId,
        next.modelSettings.forgeAgent.wiki.model,
        now
      );

    logCalendarSettingsDebug("update_settings_committed", {
      persistedGoogleClientId: nextGoogleClientId,
      persistedGoogleClientSecret: nextGoogleClientSecret.length > 0,
      persistedMicrosoftClientId: next.calendarProviders.microsoft.clientId,
      updatedAt: now
    });

    if (options.secrets) {
      syncForgeManagedWikiProfile(options.secrets);
    }

    if (options.activity) {
      recordActivityEvent({
        entityType: "system",
        entityId: "app_settings",
        eventType: "settings_updated",
        title: "Forge settings updated",
        description: `Theme is now ${next.themePreference}. Gamification is ${next.gamificationTheme}. Language is ${next.localePreference}.`,
        actor: options.activity.actor ?? null,
        source: options.activity.source,
        metadata: {
          themePreference: next.themePreference,
          gamificationTheme: next.gamificationTheme,
          customThemeLabel: next.customTheme?.label ?? null,
          localePreference: next.localePreference,
          goalDriftAlerts: next.notifications.goalDriftAlerts,
          dailyQuestReminders: next.notifications.dailyQuestReminders,
          maxActiveTasks: next.execution.maxActiveTasks,
          timeAccountingMode: next.execution.timeAccountingMode,
          googleConfigured: next.calendarProviders.google.isConfigured,
          googleAppBaseUrl: next.calendarProviders.google.appBaseUrl,
          googleRedirectUri: next.calendarProviders.google.redirectUri,
          microsoftConfigured:
            next.calendarProviders.microsoft.clientId.trim().length > 0,
          microsoftTenantId: next.calendarProviders.microsoft.tenantId,
          forgeBasicChatModel: next.modelSettings.forgeAgent.basicChat.model,
          forgeWikiModel: next.modelSettings.forgeAgent.wiki.model,
          forgeBasicChatConnectionId:
            next.modelSettings.forgeAgent.basicChat.connectionId || null,
          forgeWikiConnectionId:
            next.modelSettings.forgeAgent.wiki.connectionId || null
        }
      });
    }

    const updated = buildSettingsPayloadFromDatabase();
    if (options.mirrorSettingsFile !== false) {
      writeForgeSettingsFileSnapshot(updated);
    }
    return updated;
  });
}

export function updateSettings(
  input: UpdateSettingsInput,
  options: {
    activity?: ActivityContext;
    secrets?: SecretsManager;
  } = {}
): SettingsPayload {
  return updateSettingsInternal(input, {
    ...options,
    mirrorSettingsFile: true
  });
}

export function createAgentToken(
  input: CreateAgentTokenInput,
  activity?: ActivityContext
): AgentTokenMutationResult {
  const parsed = createAgentTokenSchema.parse(input);
  return runInTransaction(() => {
    const now = new Date().toISOString();
    const agent = upsertAgentIdentity(parsed);
    const id = `tok_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const token = buildTokenSecret();
    const tokenPrefix = `${token.slice(0, 10)}••••`;
    getDatabase()
      .prepare(
        `INSERT INTO agent_tokens (
          id, label, token_hash, token_prefix, scopes_json, bootstrap_policy_json, scope_policy_json, agent_id, trust_level, autonomy_mode, approval_mode, description, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        parsed.label,
        hashToken(token),
        tokenPrefix,
        JSON.stringify(parsed.scopes),
        JSON.stringify(parsed.bootstrapPolicy),
        JSON.stringify(parsed.scopePolicy),
        agent.id,
        parsed.trustLevel,
        parsed.autonomyMode,
        parsed.approvalMode,
        parsed.description,
        now,
        now
      );

    const tokenSummary = listAgentTokens().find((entry) => entry.id === id)!;
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
          scopes: parsed.scopes.join(","),
          bootstrapMode: parsed.bootstrapPolicy.mode,
          scopedUserIds: parsed.scopePolicy.userIds.join(","),
          scopedProjectIds: parsed.scopePolicy.projectIds.join(","),
          scopedTagIds: parsed.scopePolicy.tagIds.join(",")
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
          approvalMode: parsed.approvalMode,
          bootstrapMode: parsed.bootstrapPolicy.mode,
          scopeUserCount: parsed.scopePolicy.userIds.length,
          scopeProjectCount: parsed.scopePolicy.projectIds.length,
          scopeTagCount: parsed.scopePolicy.tagIds.length
        }
      });
    }

    mirrorSettingsFileFromCurrentState();

    return {
      token,
      tokenSummary
    };
  });
}

export function rotateAgentToken(
  tokenId: string,
  activity?: ActivityContext
): AgentTokenMutationResult | null {
  const existing = listAgentTokens().find((token) => token.id === tokenId);
  if (!existing) {
    return null;
  }

  return runInTransaction(() => {
    const now = new Date().toISOString();
    const token = buildTokenSecret();
    const tokenPrefix = `${token.slice(0, 10)}••••`;
    getDatabase()
      .prepare(
        `UPDATE agent_tokens SET token_hash = ?, token_prefix = ?, revoked_at = NULL, updated_at = ? WHERE id = ?`
      )
      .run(hashToken(token), tokenPrefix, now, tokenId);

    const tokenSummary = listAgentTokens().find(
      (entry) => entry.id === tokenId
    )!;
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

    mirrorSettingsFileFromCurrentState();

    return {
      token,
      tokenSummary
    };
  });
}

export function revokeAgentToken(
  tokenId: string,
  activity?: ActivityContext
): AgentTokenSummary | null {
  const existing = listAgentTokens().find((token) => token.id === tokenId);
  if (!existing) {
    return null;
  }

  return runInTransaction(() => {
    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `UPDATE agent_tokens SET revoked_at = ?, updated_at = ? WHERE id = ?`
      )
      .run(now, now, tokenId);

    const tokenSummary = listAgentTokens().find(
      (entry) => entry.id === tokenId
    )!;
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
    mirrorSettingsFileFromCurrentState();
    return tokenSummary;
  });
}

export function getAgentTokenById(
  tokenId: string
): AgentTokenSummary | undefined {
  return listAgentTokens().find((token) => token.id === tokenId);
}

export function verifyAgentToken(token: string): AgentTokenSummary | null {
  const hash = hashToken(token);
  const row = getDatabase()
    .prepare(
        `SELECT
         agent_tokens.id,
         agent_tokens.label,
         agent_tokens.token_prefix,
         agent_tokens.scopes_json,
         agent_tokens.bootstrap_policy_json,
         agent_tokens.scope_policy_json,
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
       WHERE agent_tokens.token_hash = ?`
    )
    .get(hash) as AgentTokenRow | undefined;

  if (!row || row.revoked_at) {
    return null;
  }

  getDatabase()
    .prepare(
      `UPDATE agent_tokens SET last_used_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(new Date().toISOString(), new Date().toISOString(), row.id);
  return mapToken(row);
}
