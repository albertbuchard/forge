import { access, readdir } from "node:fs/promises";
import path from "node:path";
import type { SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { getDatabase, runInTransaction } from "../db.js";
import type { ForgeSettingsFileStatus } from "../repositories/settings.js";
import type { SettingsPayload } from "../types.js";
import { GAMIFICATION_CATALOG } from "@/lib/gamification-catalog.js";

export type DoctorSeverity = "info" | "warning" | "error";
export type DoctorCheckStatus = "pass" | "warn" | "fail" | "skipped";
export type DoctorFixKind = "manual" | "safe_auto_fix";

export type DoctorFixProposal = {
  id: string;
  kind: DoctorFixKind;
  title: string;
  description: string;
  requiresConfirmation: boolean;
};

export type DoctorCheck = {
  id: string;
  group: string;
  title: string;
  status: DoctorCheckStatus;
  severity: DoctorSeverity;
  summary: string;
  evidence: string[];
  affectedCount: number;
  fix?: DoctorFixProposal;
};

export type DoctorIssue = DoctorCheck & {
  status: "warn" | "fail";
};

export type ForgeDoctorIntegrity = {
  score: number;
  status: "healthy" | "warning" | "critical";
  headline: string;
  lastCheckedAt: string;
  issueCount: number;
  warningCount: number;
  errorCount: number;
  topIssues: Array<{
    id: string;
    severity: DoctorSeverity;
    summary: string;
    affectedCount: number;
  }>;
};

export type ForgeDoctorReport = {
  ok: boolean;
  now: string;
  integrity: ForgeDoctorIntegrity;
  runtime: Record<string, unknown>;
  health: Record<string, unknown>;
  settingsFile: ForgeSettingsFileStatus;
  settingsSummary: {
    themePreference: SettingsPayload["themePreference"];
    localePreference: SettingsPayload["localePreference"];
    operatorName: string;
    maxActiveTasks: number;
    timeAccountingMode: SettingsPayload["execution"]["timeAccountingMode"];
    psycheAuthRequired: boolean;
    webAppUrl: string;
  };
  checks: DoctorCheck[];
  issues: DoctorIssue[];
  fixProposals: DoctorFixProposal[];
  warnings: string[];
};

export type DoctorFixResult = {
  fixId: string;
  status: "applied" | "skipped" | "failed";
  summary: string;
};

export type DoctorFixRequest = {
  fixIds?: string[];
  applyAllSafe?: boolean;
};

const apiRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
const migrationsDir = path.join(apiRoot, "migrations");
const safeIntegrityRefreshFix: DoctorFixProposal = {
  id: "settings.integrity.refresh",
  kind: "safe_auto_fix",
  title: "Refresh stored integrity audit",
  description:
    "Update the legacy Settings integrity score and last audit timestamp from the current Doctor result.",
  requiresConfirmation: true
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function toCount(row: unknown) {
  if (typeof row !== "object" || row === null || !("count" in row)) {
    return 0;
  }
  const count = (row as { count: unknown }).count;
  return typeof count === "number" ? count : Number(count) || 0;
}

function tableExists(tableName: string) {
  const row = getDatabase()
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
    )
    .get(tableName);
  return Boolean(row);
}

function countRows(sql: string, params: SQLInputValue[] = []) {
  return toCount(getDatabase().prepare(sql).get(...params));
}

function check(
  input: Omit<DoctorCheck, "status" | "severity" | "evidence"> & {
    passed: boolean;
    evidence?: string[];
    severity?: DoctorSeverity;
  }
): DoctorCheck {
  const severity = input.severity ?? (input.passed ? "info" : "warning");
  return {
    id: input.id,
    group: input.group,
    title: input.title,
    status: input.passed ? "pass" : severity === "error" ? "fail" : "warn",
    severity,
    summary: input.summary,
    evidence: input.evidence ?? [],
    affectedCount: input.affectedCount,
    fix: input.fix
  };
}

function skippedCheck(input: {
  id: string;
  group: string;
  title: string;
  summary: string;
}): DoctorCheck {
  return {
    ...input,
    status: "skipped",
    severity: "info",
    evidence: [],
    affectedCount: 0
  };
}

function safeCountCheck(input: {
  id: string;
  group: string;
  title: string;
  sql: string;
  summary: (count: number) => string;
  severity?: DoctorSeverity;
  evidence?: (count: number) => string[];
  fix?: DoctorFixProposal;
}) {
  try {
    const count = countRows(input.sql);
    return check({
      id: input.id,
      group: input.group,
      title: input.title,
      passed: count === 0,
      severity: input.severity,
      summary: input.summary(count),
      evidence: input.evidence?.(count),
      affectedCount: count,
      fix: input.fix
    });
  } catch (error) {
    return check({
      id: input.id,
      group: input.group,
      title: input.title,
      passed: false,
      severity: "error",
      summary: `Doctor could not run this check: ${errorMessage(error)}`,
      affectedCount: 1
    });
  }
}

async function buildStorageChecks() {
  const checks: DoctorCheck[] = [];
  try {
    const integrityRows = getDatabase().prepare("PRAGMA integrity_check").all();
    const messages = integrityRows
      .map((row) => Object.values(row as Record<string, unknown>)[0])
      .filter((value): value is string => typeof value === "string");
    const passed = messages.length === 1 && messages[0] === "ok";
    checks.push(
      check({
        id: "storage.sqlite.integrity",
        group: "Storage",
        title: "SQLite integrity",
        passed,
        severity: passed ? "info" : "error",
        summary: passed
          ? "SQLite integrity_check passed."
          : "SQLite integrity_check reported database corruption or structural errors.",
        evidence: passed ? [] : messages.slice(0, 8),
        affectedCount: passed ? 0 : messages.length
      })
    );
  } catch (error) {
    checks.push(
      check({
        id: "storage.sqlite.integrity",
        group: "Storage",
        title: "SQLite integrity",
        passed: false,
        severity: "error",
        summary: `SQLite integrity_check failed to run: ${errorMessage(error)}`,
        affectedCount: 1
      })
    );
  }

  try {
    const rows = getDatabase().prepare("PRAGMA foreign_key_check").all();
    checks.push(
      check({
        id: "storage.sqlite.foreign_keys",
        group: "Storage",
        title: "SQLite foreign keys",
        passed: rows.length === 0,
        severity: rows.length === 0 ? "info" : "error",
        summary:
          rows.length === 0
            ? "SQLite foreign_key_check passed."
            : `${rows.length} foreign key violation${rows.length === 1 ? "" : "s"} found in SQLite.`,
        evidence: rows
          .slice(0, 8)
          .map((row) => JSON.stringify(row as Record<string, unknown>)),
        affectedCount: rows.length
      })
    );
  } catch (error) {
    checks.push(
      check({
        id: "storage.sqlite.foreign_keys",
        group: "Storage",
        title: "SQLite foreign keys",
        passed: false,
        severity: "error",
        summary: `SQLite foreign_key_check failed to run: ${errorMessage(error)}`,
        affectedCount: 1
      })
    );
  }

  const requiredTables = [
    "app_settings",
    "users",
    "goals",
    "projects",
    "strategies",
    "tasks",
    "entity_owners",
    "entity_assignments",
    "notes",
    "habits",
    "calendar_events",
    "task_runs",
    "reward_ledger",
    "gamification_daily_activity",
    "gamification_item_unlocks",
    "gamification_equipment",
    "wiki_spaces",
    "wiki_link_edges",
    "agent_runtime_sessions"
  ];
  const missingTables = requiredTables.filter((table) => !tableExists(table));
  checks.push(
    check({
      id: "storage.schema.required_tables",
      group: "Storage",
      title: "Required schema tables",
      passed: missingTables.length === 0,
      severity: missingTables.length === 0 ? "info" : "error",
      summary:
        missingTables.length === 0
          ? "All required Forge tables are present."
          : `${missingTables.length} required table${missingTables.length === 1 ? "" : "s"} missing from the database.`,
      evidence: missingTables,
      affectedCount: missingTables.length
    })
  );

  try {
    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const applied = new Set(
      (
        getDatabase()
          .prepare("SELECT id FROM migrations")
          .all() as Array<{ id: string }>
      ).map((row) => row.id)
    );
    const missing = files.filter((file) => !applied.has(file));
    checks.push(
      check({
        id: "storage.schema.migrations",
        group: "Storage",
        title: "Applied migrations",
        passed: missing.length === 0,
        severity: missing.length === 0 ? "info" : "error",
        summary:
          missing.length === 0
            ? `${files.length} migration${files.length === 1 ? "" : "s"} applied.`
            : `${missing.length} migration${missing.length === 1 ? "" : "s"} not recorded as applied.`,
        evidence: missing.slice(0, 12),
        affectedCount: missing.length
      })
    );
  } catch (error) {
    checks.push(
      check({
        id: "storage.schema.migrations",
        group: "Storage",
        title: "Applied migrations",
        passed: false,
        severity: "error",
        summary: `Doctor could not compare migration files: ${errorMessage(error)}`,
        affectedCount: 1
      })
    );
  }

  return checks;
}

function entityReferenceChecks() {
  const checks: DoctorCheck[] = [];
  checks.push(
    safeCountCheck({
      id: "entities.owners.missing_users",
      group: "Entities",
      title: "Entity owner users",
      sql: `SELECT COUNT(*) AS count
            FROM entity_owners
            LEFT JOIN users ON users.id = entity_owners.user_id
            WHERE users.id IS NULL`,
      summary: (count) =>
        count === 0
          ? "All entity owners point to existing users."
          : `${count} entity owner record${count === 1 ? "" : "s"} point to missing users.`,
      severity: "warning"
    }),
    safeCountCheck({
      id: "entities.assignments.missing_users",
      group: "Entities",
      title: "Entity assignee users",
      sql: `SELECT COUNT(*) AS count
            FROM entity_assignments
            LEFT JOIN users ON users.id = entity_assignments.user_id
            WHERE users.id IS NULL`,
      summary: (count) =>
        count === 0
          ? "All entity assignments point to existing users."
          : `${count} assignment record${count === 1 ? "" : "s"} point to missing users.`,
      severity: "warning"
    }),
    safeCountCheck({
      id: "entities.projects.missing_goals",
      group: "Entities",
      title: "Project goal links",
      sql: `SELECT COUNT(*) AS count
            FROM projects
            LEFT JOIN goals ON goals.id = projects.goal_id
            WHERE goals.id IS NULL`,
      summary: (count) =>
        count === 0
          ? "All projects point to existing goals."
          : `${count} project${count === 1 ? "" : "s"} point to missing goals.`,
      severity: "warning"
    }),
    safeCountCheck({
      id: "entities.tasks.missing_projects",
      group: "Entities",
      title: "Task project links",
      sql: `SELECT COUNT(*) AS count
            FROM tasks
            LEFT JOIN projects ON projects.id = tasks.project_id
            WHERE tasks.project_id IS NOT NULL AND projects.id IS NULL`,
      summary: (count) =>
        count === 0
          ? "All task project links resolve."
          : `${count} task${count === 1 ? "" : "s"} point to missing projects.`,
      severity: "warning"
    }),
    safeCountCheck({
      id: "entities.tasks.missing_goals",
      group: "Entities",
      title: "Task goal links",
      sql: `SELECT COUNT(*) AS count
            FROM tasks
            LEFT JOIN goals ON goals.id = tasks.goal_id
            WHERE tasks.goal_id IS NOT NULL AND goals.id IS NULL`,
      summary: (count) =>
        count === 0
          ? "All task goal links resolve."
          : `${count} task${count === 1 ? "" : "s"} point to missing goals.`,
      severity: "warning"
    })
  );

  const ownedEntityChecks = [
    ["goal", "goals"],
    ["project", "projects"],
    ["strategy", "strategies"],
    ["task", "tasks"],
    ["tag", "tags"],
    ["habit", "habits"],
    ["note", "notes"]
  ] as const;
  for (const [entityType, tableName] of ownedEntityChecks) {
    if (!tableExists(tableName)) continue;
    checks.push(
      safeCountCheck({
        id: `entities.owners.missing_${entityType}`,
        group: "Entities",
        title: `${entityType} owner targets`,
        sql: `SELECT COUNT(*) AS count
              FROM entity_owners
              LEFT JOIN ${tableName} target ON target.id = entity_owners.entity_id
              WHERE entity_owners.entity_type = '${entityType}' AND target.id IS NULL`,
        summary: (count) =>
          count === 0
            ? `All ${entityType} owner rows point to existing records.`
            : `${count} ${entityType} owner row${count === 1 ? " points" : "s point"} to missing records.`,
        severity: "warning"
      })
    );
  }

  return checks;
}

function hierarchyChecks() {
  if (!tableExists("tasks")) {
    return [
      skippedCheck({
        id: "entities.hierarchy.tasks",
        group: "Hierarchy",
        title: "Work item hierarchy",
        summary: "Task table is missing, so hierarchy checks could not run."
      })
    ];
  }

  return [
    safeCountCheck({
      id: "entities.hierarchy.missing_parents",
      group: "Hierarchy",
      title: "Work item parents",
      sql: `SELECT COUNT(*) AS count
            FROM tasks child
            LEFT JOIN tasks parent ON parent.id = child.parent_task_id
            WHERE child.parent_task_id IS NOT NULL AND parent.id IS NULL`,
      summary: (count) =>
        count === 0
          ? "All parent work-item links resolve."
          : `${count} work item${count === 1 ? "" : "s"} point to missing parents.`,
      severity: "warning"
    }),
    safeCountCheck({
      id: "entities.hierarchy.self_parent",
      group: "Hierarchy",
      title: "Self-parented work items",
      sql: "SELECT COUNT(*) AS count FROM tasks WHERE parent_task_id = id",
      summary: (count) =>
        count === 0
          ? "No work items point to themselves as parent."
          : `${count} work item${count === 1 ? "" : "s"} point to themselves as parent.`,
      severity: "error"
    }),
    safeCountCheck({
      id: "entities.hierarchy.issue_project",
      group: "Hierarchy",
      title: "Issue project links",
      sql: "SELECT COUNT(*) AS count FROM tasks WHERE level = 'issue' AND project_id IS NULL",
      summary: (count) =>
        count === 0
          ? "Every issue is linked to a project."
          : `${count} issue${count === 1 ? "" : "s"} are not linked to a project.`,
      severity: "info"
    }),
    safeCountCheck({
      id: "entities.hierarchy.task_parent_level",
      group: "Hierarchy",
      title: "Task parent levels",
      sql: `SELECT COUNT(*) AS count
            FROM tasks child
            JOIN tasks parent ON parent.id = child.parent_task_id
            WHERE child.level = 'task' AND parent.level != 'issue'`,
      summary: (count) =>
        count === 0
          ? "All task parents are issues when a parent is set."
          : `${count} task${count === 1 ? "" : "s"} have a parent that is not an issue.`,
      severity: "warning"
    }),
    safeCountCheck({
      id: "entities.hierarchy.subtask_parent_level",
      group: "Hierarchy",
      title: "Subtask parent levels",
      sql: `SELECT COUNT(*) AS count
            FROM tasks child
            LEFT JOIN tasks parent ON parent.id = child.parent_task_id
            WHERE child.level = 'subtask' AND (parent.id IS NULL OR parent.level != 'task')`,
      summary: (count) =>
        count === 0
          ? "All subtasks sit under tasks."
          : `${count} subtask${count === 1 ? "" : "s"} are missing a task parent.`,
      severity: "warning"
    }),
    safeCountCheck({
      id: "entities.hierarchy.project_mismatch",
      group: "Hierarchy",
      title: "Parent/project consistency",
      sql: `SELECT COUNT(*) AS count
            FROM tasks child
            JOIN tasks parent ON parent.id = child.parent_task_id
            WHERE child.project_id IS NOT NULL
              AND parent.project_id IS NOT NULL
              AND child.project_id != parent.project_id`,
      summary: (count) =>
        count === 0
          ? "Child work items stay inside the same project as their parent."
          : `${count} work item${count === 1 ? "" : "s"} have a different project than their parent.`,
      severity: "warning"
    })
  ];
}

function strategyJsonChecks() {
  if (!tableExists("strategies")) {
    return [
      skippedCheck({
        id: "entities.strategies.json",
        group: "Entities",
        title: "Strategy JSON fields",
        summary: "Strategy table is missing, so strategy JSON checks could not run."
      })
    ];
  }

  const goalIds = new Set(
    (getDatabase().prepare("SELECT id FROM goals").all() as Array<{ id: string }>).map(
      (row) => row.id
    )
  );
  const projectIds = new Set(
    (
      getDatabase().prepare("SELECT id FROM projects").all() as Array<{ id: string }>
    ).map((row) => row.id)
  );
  const rows = getDatabase()
    .prepare(
      `SELECT id, target_goal_ids_json, target_project_ids_json, linked_entities_json, graph_json
       FROM strategies`
    )
    .all() as Array<{
    id: string;
    target_goal_ids_json: string;
    target_project_ids_json: string;
    linked_entities_json: string;
    graph_json: string;
  }>;

  let invalidJson = 0;
  let missingGoalRefs = 0;
  let missingProjectRefs = 0;
  for (const row of rows) {
    try {
      const goals = JSON.parse(row.target_goal_ids_json) as unknown;
      if (Array.isArray(goals)) {
        missingGoalRefs += goals.filter(
          (id) => typeof id === "string" && !goalIds.has(id)
        ).length;
      }
      const projects = JSON.parse(row.target_project_ids_json) as unknown;
      if (Array.isArray(projects)) {
        missingProjectRefs += projects.filter(
          (id) => typeof id === "string" && !projectIds.has(id)
        ).length;
      }
      JSON.parse(row.linked_entities_json);
      JSON.parse(row.graph_json);
    } catch {
      invalidJson += 1;
    }
  }

  return [
    check({
      id: "entities.strategies.json",
      group: "Entities",
      title: "Strategy JSON fields",
      passed: invalidJson === 0,
      severity: "warning",
      summary:
        invalidJson === 0
          ? "All strategy JSON fields parse cleanly."
          : `${invalidJson} strateg${invalidJson === 1 ? "y has" : "ies have"} invalid JSON fields.`,
      affectedCount: invalidJson
    }),
    check({
      id: "entities.strategies.goal_refs",
      group: "Entities",
      title: "Strategy goal references",
      passed: missingGoalRefs === 0,
      severity: "warning",
      summary:
        missingGoalRefs === 0
          ? "All strategy target goal references resolve."
          : `${missingGoalRefs} strategy goal reference${missingGoalRefs === 1 ? "" : "s"} point to missing goals.`,
      affectedCount: missingGoalRefs
    }),
    check({
      id: "entities.strategies.project_refs",
      group: "Entities",
      title: "Strategy project references",
      passed: missingProjectRefs === 0,
      severity: "warning",
      summary:
        missingProjectRefs === 0
          ? "All strategy target project references resolve."
          : `${missingProjectRefs} strategy project reference${missingProjectRefs === 1 ? "" : "s"} point to missing projects.`,
      affectedCount: missingProjectRefs
    })
  ];
}

function rewardAndGamificationChecks(settings: SettingsPayload) {
  const checks: DoctorCheck[] = [];
  const catalogItemIds = new Set(GAMIFICATION_CATALOG.map((item) => item.id));
  const equipmentValueFields = [
    {
      column: "selected_mascot_skin",
      unlockType: "mascot_skin",
      payloadKey: "mascotSkin"
    },
    {
      column: "selected_hud_treatment",
      unlockType: "hud_treatment",
      payloadKey: "hudTreatment"
    },
    {
      column: "selected_streak_effect",
      unlockType: "streak_effect",
      payloadKey: "streakEffect"
    },
    {
      column: "selected_trophy_shelf",
      unlockType: "trophy_shelf",
      payloadKey: "trophyShelf"
    },
    {
      column: "selected_celebration_variant",
      unlockType: "celebration_variant",
      payloadKey: "celebrationVariant"
    }
  ] as const;
  const equipmentValuesByColumn = new Map(
    equipmentValueFields.map((field) => [
      field.column,
      new Set(
        GAMIFICATION_CATALOG.filter(
          (item) =>
            item.kind === "unlock" &&
            item.unlockType === field.unlockType &&
            typeof item.rewardPayload[field.payloadKey] === "string"
        ).map((item) => item.rewardPayload[field.payloadKey] as string)
      )
    ])
  );

  checks.push(
    safeCountCheck({
      id: "rewards.rules.missing",
      group: "Rewards",
      title: "Reward ledger rules",
      sql: `SELECT COUNT(*) AS count
            FROM reward_ledger
            LEFT JOIN reward_rules ON reward_rules.id = reward_ledger.rule_id
            WHERE reward_ledger.rule_id IS NOT NULL AND reward_rules.id IS NULL`,
      summary: (count) =>
        count === 0
          ? "All reward ledger rule references resolve."
          : `${count} reward ledger row${count === 1 ? "" : "s"} point to missing rules.`,
      severity: "warning"
    }),
    safeCountCheck({
      id: "rewards.entity_creation.duplicates",
      group: "Rewards",
      title: "Entity creation XP duplicates",
      sql: `SELECT COUNT(*) AS count
            FROM (
              SELECT reversible_group
              FROM reward_ledger
              WHERE reversible_group LIKE 'entity_created:%'
                AND reversed_by_reward_id IS NULL
              GROUP BY reversible_group
              HAVING COUNT(*) > 1
            ) duplicates`,
      summary: (count) =>
        count === 0
          ? "Entity creation XP has no duplicate active reversible groups."
          : `${count} entity creation reward group${count === 1 ? "" : "s"} have duplicate active XP rows.`,
      severity: "warning"
    }),
    safeCountCheck({
      id: "rewards.daily_activity.users",
      group: "Rewards",
      title: "Daily activity users",
      sql: `SELECT COUNT(*) AS count
            FROM gamification_daily_activity
            LEFT JOIN users ON users.id = gamification_daily_activity.user_id
            WHERE users.id IS NULL`,
      summary: (count) =>
        count === 0
          ? "All gamification daily activity rows point to existing users."
          : `${count} daily activity row${count === 1 ? "" : "s"} point to missing users.`,
      severity: "warning"
    })
  );

  const staleUnlockRows = tableExists("gamification_item_unlocks")
    ? (
        getDatabase()
          .prepare("SELECT item_id FROM gamification_item_unlocks")
          .all() as Array<{ item_id: string }>
      ).filter((row) => !catalogItemIds.has(row.item_id)).length
    : 0;
  checks.push(
    check({
      id: "rewards.gamification.stale_unlocks",
      group: "Rewards",
      title: "Gamification unlock catalog",
      passed: staleUnlockRows === 0,
      severity: "info",
      summary:
        staleUnlockRows === 0
          ? "All gamification unlock rows point to the current catalog."
          : `${staleUnlockRows} old gamification unlock row${staleUnlockRows === 1 ? "" : "s"} are kept for audit but no longer match the current catalog.`,
      affectedCount: staleUnlockRows
    })
  );

  const equipmentRows = tableExists("gamification_equipment")
    ? (getDatabase()
        .prepare(
          `SELECT selected_mascot_skin, selected_hud_treatment, selected_streak_effect,
                  selected_trophy_shelf, selected_celebration_variant
           FROM gamification_equipment`
        )
        .all() as Array<Record<string, string | null>>)
    : [];
  const staleEquipment = equipmentRows.reduce((count, row) => {
    return (
      count +
      Object.entries(row).filter(
        ([column, value]) =>
          typeof value === "string" &&
          !(
            equipmentValuesByColumn
              .get(column as (typeof equipmentValueFields)[number]["column"])
              ?.has(value) ?? false
          )
      ).length
    );
  }, 0);
  checks.push(
    check({
      id: "rewards.gamification.equipment",
      group: "Rewards",
      title: "Gamification equipment catalog",
      passed: staleEquipment === 0,
      severity: "warning",
      summary:
        staleEquipment === 0
          ? "Selected gamification equipment values match current unlock reward payloads."
          : `${staleEquipment} selected equipment value${staleEquipment === 1 ? "" : "s"} point to removed catalog rewards.`,
      affectedCount: staleEquipment
    })
  );

  return checks.concat(
    check({
      id: "settings.integrity.stored_score",
      group: "Settings",
      title: "Stored integrity score",
      passed: true,
      severity: "info",
      summary: `The legacy Settings score is ${settings.security.integrityScore}%; Doctor computes the live score from real checks.`,
      affectedCount: settings.security.integrityScore,
      fix: safeIntegrityRefreshFix
    })
  );
}

async function buildDataRootCheck(runtime: Record<string, unknown>) {
  const root =
    typeof runtime.storageRoot === "string"
      ? runtime.storageRoot
      : typeof runtime.dataDir === "string"
        ? runtime.dataDir
        : null;
  if (!root) {
    return check({
      id: "runtime.data_root",
      group: "Runtime",
      title: "Data root access",
      passed: false,
      severity: "warning",
      summary: "Doctor could not resolve the Forge data root from the runtime payload.",
      affectedCount: 1
    });
  }

  try {
    await access(root);
    return check({
      id: "runtime.data_root",
      group: "Runtime",
      title: "Data root access",
      passed: true,
      summary: `Forge can read the data root at ${root}.`,
      affectedCount: 0
    });
  } catch (error) {
    return check({
      id: "runtime.data_root",
      group: "Runtime",
      title: "Data root access",
      passed: false,
      severity: "error",
      summary: `Forge cannot access the data root at ${root}: ${errorMessage(error)}`,
      affectedCount: 1
    });
  }
}

function buildIntegrity(now: string, checks: DoctorCheck[]): ForgeDoctorIntegrity {
  const issues = checks.filter(
    (entry): entry is DoctorIssue =>
      entry.status === "warn" || entry.status === "fail"
  );
  const penalizedIssues = issues.filter((issue) => issue.severity !== "info");
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const score = Math.max(0, 100 - errorCount * 12 - warningCount * 2);
  const status =
    errorCount > 0 ? "critical" : warningCount > 0 ? "warning" : "healthy";
  return {
    score,
    status,
    headline:
      status === "healthy"
        ? "All active Doctor consistency checks passed."
        : status === "critical"
          ? `${errorCount} critical consistency issue${errorCount === 1 ? "" : "s"} need attention.`
          : `${warningCount} consistency warning${warningCount === 1 ? "" : "s"} need attention.`,
    lastCheckedAt: now,
    issueCount: issues.length,
    warningCount,
    errorCount,
    topIssues: penalizedIssues.slice(0, 5).map((issue) => ({
      id: issue.id,
      severity: issue.severity,
      summary: issue.summary,
      affectedCount: issue.affectedCount
    }))
  };
}

function buildWebAppUrl(runtime: Record<string, unknown>) {
  const devWebOrigin =
    typeof runtime.devWebOrigin === "string" ? runtime.devWebOrigin.trim() : "";
  if (devWebOrigin) {
    return devWebOrigin.endsWith("/") ? devWebOrigin : `${devWebOrigin}/`;
  }
  const port = typeof runtime.port === "number" ? runtime.port : 4317;
  const basePath =
    typeof runtime.basePath === "string" ? runtime.basePath : "/forge/";
  return `http://127.0.0.1:${port}${basePath}`;
}

export async function buildForgeDoctorReport(input: {
  settings: SettingsPayload;
  settingsFile: ForgeSettingsFileStatus;
  runtime: Record<string, unknown>;
  health: Record<string, unknown>;
}): Promise<ForgeDoctorReport> {
  const now = new Date().toISOString();
  const healthOk = input.health.ok !== false;
  const checks: DoctorCheck[] = [
    check({
      id: "runtime.health",
      group: "Runtime",
      title: "Runtime health",
      passed: healthOk,
      severity: healthOk ? "info" : "error",
      summary: healthOk
        ? "Forge runtime health is green."
        : "Forge runtime health is degraded.",
      affectedCount: healthOk ? 0 : 1
    }),
    await buildDataRootCheck(input.runtime),
    check({
      id: "settings.file.valid",
      group: "Settings",
      title: "forge.json validity",
      passed: input.settingsFile.valid,
      severity: input.settingsFile.valid ? "info" : "error",
      summary: input.settingsFile.valid
        ? "forge.json is valid."
        : `forge.json is invalid at ${input.settingsFile.path}. Forge ignored file precedence until the JSON is repaired or rewritten.`,
      evidence: input.settingsFile.parseError ? [input.settingsFile.parseError] : [],
      affectedCount: input.settingsFile.valid ? 0 : 1
    }),
    check({
      id: "settings.file.sync",
      group: "Settings",
      title: "forge.json sync state",
      passed: input.settingsFile.syncState !== "applied_file_overrides",
      severity:
        input.settingsFile.syncState === "applied_file_overrides"
          ? "warning"
          : "info",
      summary:
        input.settingsFile.syncState === "applied_file_overrides"
          ? "forge.json overrode persisted database settings on this run."
          : `forge.json sync state is ${input.settingsFile.syncState}.`,
      evidence: input.settingsFile.overrideKeys.slice(0, 12),
      affectedCount:
        input.settingsFile.syncState === "applied_file_overrides"
          ? input.settingsFile.overrideKeys.length
          : 0
    })
  ];

  checks.push(...(await buildStorageChecks()));
  checks.push(...entityReferenceChecks());
  checks.push(...hierarchyChecks());
  checks.push(...strategyJsonChecks());
  checks.push(...rewardAndGamificationChecks(input.settings));

  const issues = checks.filter(
    (entry): entry is DoctorIssue =>
      entry.status === "warn" || entry.status === "fail"
  );
  const integrity = buildIntegrity(now, checks);
  const fixProposals = checks
    .map((entry) => entry.fix)
    .filter((fix): fix is DoctorFixProposal => Boolean(fix));

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    now,
    integrity,
    runtime: input.runtime,
    health: input.health,
    settingsFile: input.settingsFile,
    settingsSummary: {
      themePreference: input.settings.themePreference,
      localePreference: input.settings.localePreference,
      operatorName: input.settings.profile.operatorName,
      maxActiveTasks: input.settings.execution.maxActiveTasks,
      timeAccountingMode: input.settings.execution.timeAccountingMode,
      psycheAuthRequired: input.settings.security.psycheAuthRequired,
      webAppUrl: buildWebAppUrl(input.runtime)
    },
    checks,
    issues,
    fixProposals,
    warnings: issues
      .filter((issue) => issue.severity !== "info")
      .map((issue) => issue.summary)
  };
}

export function applyForgeDoctorFixes(
  input: DoctorFixRequest,
  options: { integrityScore?: number } = {}
): {
  results: DoctorFixResult[];
} {
  const requested = new Set(input.fixIds ?? []);
  const shouldApplyIntegrityRefresh =
    input.applyAllSafe === true || requested.has(safeIntegrityRefreshFix.id);
  const results: DoctorFixResult[] = [];

  if (!shouldApplyIntegrityRefresh) {
    return {
      results:
        requested.size === 0
          ? []
          : [...requested].map((fixId) => ({
              fixId,
              status: "skipped",
              summary: "Forge Doctor does not know this fix id."
            }))
    };
  }

  try {
    runInTransaction(() => {
      getDatabase()
        .prepare(
          `UPDATE app_settings
           SET integrity_score = ?,
               last_audit_at = ?,
               updated_at = ?
           WHERE id = 1`
        )
        .run(
          Math.max(0, Math.min(100, Math.round(options.integrityScore ?? 100))),
          new Date().toISOString(),
          new Date().toISOString()
        );
    });
    results.push({
      fixId: safeIntegrityRefreshFix.id,
      status: "applied",
      summary: "Stored Settings integrity audit timestamp was refreshed."
    });
  } catch (error) {
    results.push({
      fixId: safeIntegrityRefreshFix.id,
      status: "failed",
      summary: errorMessage(error)
    });
  }

  for (const fixId of requested) {
    if (fixId !== safeIntegrityRefreshFix.id) {
      results.push({
        fixId,
        status: "skipped",
        summary: "Forge Doctor does not know this fix id."
      });
    }
  }

  return { results };
}
