import { randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { recordActivityEvent } from "./activity-events.js";
import {
  decorateOwnedEntity,
  inferFirstOwnedUserId,
  replaceEntityAssignees,
  setEntityOwner
} from "./entity-ownership.js";
import { filterDeletedEntities, isEntityDeleted } from "./deleted-entities.js";
import { createLinkedNotes } from "./notes.js";
import { assertGoalExists } from "../services/relations.js";
import { getGoalById } from "./goals.js";
import { pruneLinkedEntityReferences } from "./psyche.js";
import { listTasks, updateTaskInTransaction } from "./tasks.js";
import {
  calendarSchedulingRulesSchema,
  createProjectSchema,
  projectSchema,
  updateProjectSchema,
  type ActivitySource,
  type CreateProjectInput,
  type Project,
  type ProjectListQuery,
  type UpdateProjectInput
} from "../types.js";

type ProjectRow = {
  id: string;
  goal_id: string;
  title: string;
  description: string;
  status: string;
  workflow_status: string;
  theme_color: string;
  target_points: number;
  product_requirements_document: string;
  scheduling_rules_json: string;
  created_at: string;
  updated_at: string;
};

type ActivityContext = {
  source: ActivitySource;
  actor?: string | null;
};

function getDefaultProjectTemplate(goal: {
  title: string;
  description: string;
  status: string;
  themeColor: string;
  targetPoints: number;
}) {
  switch (goal.title) {
    case "Build a durable body and calm energy":
      return {
        title: "Energy Foundation Sprint",
        description:
          "Build the routines, scheduling, and recovery rhythm that make consistent physical energy possible."
      };
    case "Ship meaningful creative work every week":
      return {
        title: "Weekly Creative Shipping System",
        description:
          "Create a repeatable system for deep work, reviews, and visible weekly output."
      };
    case "Strengthen shared life systems":
      return {
        title: "Shared Life Admin Reset",
        description:
          "Reduce friction in logistics, planning, and recurring obligations that support shared life."
      };
    default:
      return {
        title: `${goal.title}: Active Project`,
        description:
          "Concrete workstream under this life goal so tasks, evidence, and progress have a clear home."
      };
  }
}

function mapProject(row: ProjectRow): Project {
  return projectSchema.parse(
    decorateOwnedEntity("project", {
      id: row.id,
      goalId: row.goal_id,
      title: row.title,
      description: row.description,
      status: row.status,
      workflowStatus:
        row.workflow_status === "backlog" ||
        row.workflow_status === "focus" ||
        row.workflow_status === "in_progress" ||
        row.workflow_status === "blocked" ||
        row.workflow_status === "done"
          ? row.workflow_status
          : "backlog",
      themeColor: row.theme_color,
      targetPoints: row.target_points,
      productRequirementsDocument: row.product_requirements_document,
      schedulingRules: calendarSchedulingRulesSchema.parse(
        JSON.parse(row.scheduling_rules_json || "{}")
      ),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })
  );
}

function completeLinkedProjectTasks(
  projectId: string,
  activity?: ActivityContext
) {
  const openTasks = listTasks({ projectId }).filter(
    (task) => task.status !== "done"
  );
  for (const task of openTasks) {
    updateTaskInTransaction(task.id, { status: "done" }, activity);
  }
  return openTasks.length;
}

export function listProjects(filters: ProjectListQuery = {}): Project[] {
  const whereClauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters.goalId) {
    whereClauses.push("goal_id = ?");
    params.push(filters.goalId);
  }
  if (filters.status) {
    whereClauses.push("status = ?");
    params.push(filters.status);
  }

  const whereSql =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const limitSql = filters.limit ? "LIMIT ?" : "";
  if (filters.limit) {
    params.push(filters.limit);
  }

  const rows = getDatabase()
    .prepare(
      `SELECT id, goal_id, title, description, status, workflow_status, theme_color, target_points, product_requirements_document, created_at, updated_at
       , scheduling_rules_json
       FROM projects
       ${whereSql}
       ORDER BY created_at ASC
       ${limitSql}`
    )
    .all(...params) as ProjectRow[];
  return filterDeletedEntities("project", rows.map(mapProject));
}

export function getProjectById(projectId: string): Project | undefined {
  if (isEntityDeleted("project", projectId)) {
    return undefined;
  }
  const row = getDatabase()
    .prepare(
      `SELECT id, goal_id, title, description, status, workflow_status, theme_color, target_points, product_requirements_document, created_at, updated_at
       , scheduling_rules_json
       FROM projects
       WHERE id = ?`
    )
    .get(projectId) as ProjectRow | undefined;
  return row ? mapProject(row) : undefined;
}

export function createProject(
  input: CreateProjectInput,
  activity?: ActivityContext
): Project {
  return runInTransaction(() => {
    const parsed = createProjectSchema.parse(input);
    assertGoalExists(parsed.goalId);
    const now = new Date().toISOString();
    const id = `project_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    getDatabase()
      .prepare(
        `INSERT INTO projects (id, goal_id, title, description, status, workflow_status, theme_color, target_points, product_requirements_document, scheduling_rules_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        parsed.goalId,
        parsed.title,
        parsed.description,
        parsed.status,
        parsed.workflowStatus,
        parsed.themeColor,
        parsed.targetPoints,
        parsed.productRequirementsDocument,
        JSON.stringify(parsed.schedulingRules),
        now,
        now
      );
    setEntityOwner(
      "project",
      id,
      parsed.userId ??
        inferFirstOwnedUserId([{ entityType: "goal", entityId: parsed.goalId }])
    );
    replaceEntityAssignees("project", id, parsed.assigneeUserIds);

    const project = getProjectById(id)!;
    createLinkedNotes(
      parsed.notes,
      { entityType: "project", entityId: project.id, anchorKey: null },
      activity ?? { source: "ui", actor: null }
    );
    if (activity) {
      recordActivityEvent({
        entityType: "project",
        entityId: project.id,
        eventType: "project_created",
        title: `Project created: ${project.title}`,
        description: "A new path was added under a life goal.",
        actor: activity.actor ?? null,
        source: activity.source,
        metadata: {
          goalId: project.goalId,
          status: project.status,
          targetPoints: project.targetPoints
        }
      });
    }
    return project;
  });
}

export function updateProject(
  projectId: string,
  input: UpdateProjectInput,
  activity?: ActivityContext
): Project | undefined {
  const current = getProjectById(projectId);
  if (!current) {
    return undefined;
  }

  return runInTransaction(() => {
    const parsed = updateProjectSchema.parse(input);
    const nextGoalId = parsed.goalId ?? current.goalId;
    assertGoalExists(nextGoalId);
    const next = {
      goalId: nextGoalId,
      title: parsed.title ?? current.title,
      description: parsed.description ?? current.description,
      status: parsed.status ?? current.status,
      workflowStatus: parsed.workflowStatus ?? current.workflowStatus,
      themeColor: parsed.themeColor ?? current.themeColor,
      targetPoints: parsed.targetPoints ?? current.targetPoints,
      productRequirementsDocument:
        parsed.productRequirementsDocument ??
        current.productRequirementsDocument,
      schedulingRules: parsed.schedulingRules ?? current.schedulingRules,
      updatedAt: new Date().toISOString()
    };

    getDatabase()
      .prepare(
        `UPDATE projects
         SET goal_id = ?, title = ?, description = ?, status = ?, workflow_status = ?, theme_color = ?, target_points = ?, product_requirements_document = ?, scheduling_rules_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        next.goalId,
        next.title,
        next.description,
        next.status,
        next.workflowStatus,
        next.themeColor,
        next.targetPoints,
        next.productRequirementsDocument,
        JSON.stringify(next.schedulingRules),
        next.updatedAt,
        projectId
      );

    // Keep legacy task.goal_id aligned with the project's parent goal.
    getDatabase()
      .prepare(
        `UPDATE tasks SET goal_id = ?, updated_at = ? WHERE project_id = ?`
      )
      .run(next.goalId, next.updatedAt, projectId);
    if (parsed.userId !== undefined) {
      setEntityOwner("project", projectId, parsed.userId);
    }
    if (parsed.assigneeUserIds !== undefined) {
      replaceEntityAssignees("project", projectId, parsed.assigneeUserIds);
    }

    const completedLinkedTaskCount =
      current.status !== "completed" && next.status === "completed"
        ? completeLinkedProjectTasks(projectId, activity)
        : 0;

    const project = getProjectById(projectId);
    if (project && activity) {
      const statusChanged = current.status !== project.status;
      recordActivityEvent({
        entityType: "project",
        entityId: project.id,
        eventType: statusChanged ? "project_status_changed" : "project_updated",
        title: statusChanged
          ? `Project ${project.status}: ${project.title}`
          : `Project updated: ${project.title}`,
        description:
          statusChanged && project.status === "completed"
            ? `Project finished and auto-completed ${completedLinkedTaskCount} linked unfinished task${completedLinkedTaskCount === 1 ? "" : "s"}.`
            : statusChanged
              ? `Project status changed from ${current.status} to ${project.status}.`
              : "Project details were updated.",
        actor: activity.actor ?? null,
        source: activity.source,
        metadata: {
          goalId: project.goalId,
          previousGoalId: current.goalId,
          status: project.status,
          previousStatus: current.status,
          completedLinkedTaskCount
        }
      });
    }
    return project;
  });
}

export function ensureDefaultProjectForGoal(goalId: string): Project {
  assertGoalExists(goalId);
  const existing = listProjects({ goalId, limit: 1 })[0];
  if (existing) {
    return existing;
  }

  return runInTransaction(() => {
    const goal = getGoalById(goalId);
    if (!goal) {
      throw new Error(`Goal ${goalId} is missing`);
    }
    const template = getDefaultProjectTemplate(goal);
    const now = new Date().toISOString();
    const id = `project_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    getDatabase()
      .prepare(
        `INSERT INTO projects (id, goal_id, title, description, status, theme_color, target_points, scheduling_rules_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        goalId,
        template.title,
        template.description,
        goal.status === "completed"
          ? "completed"
          : goal.status === "paused"
            ? "paused"
            : "active",
        goal.themeColor,
        Math.max(100, Math.round(goal.targetPoints / 2)),
        JSON.stringify({
          allowWorkBlockKinds: [],
          blockWorkBlockKinds: [],
          allowCalendarIds: [],
          blockCalendarIds: [],
          allowEventTypes: [],
          blockEventTypes: [],
          allowEventKeywords: [],
          blockEventKeywords: [],
          allowAvailability: [],
          blockAvailability: []
        }),
        now,
        now
      );
    setEntityOwner("project", id, goal.userId);
    return getProjectById(id)!;
  });
}

export function deleteProject(
  projectId: string,
  activity?: ActivityContext
): Project | undefined {
  const current = getProjectById(projectId);
  if (!current) {
    return undefined;
  }

  return runInTransaction(() => {
    pruneLinkedEntityReferences("project", projectId);
    getDatabase().prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);

    if (activity) {
      recordActivityEvent({
        entityType: "project",
        entityId: current.id,
        eventType: "project_deleted",
        title: `Project deleted: ${current.title}`,
        description: "Project removed from the system.",
        actor: activity.actor ?? null,
        source: activity.source,
        metadata: {
          goalId: current.goalId,
          status: current.status,
          targetPoints: current.targetPoints
        }
      });
    }

    return current;
  });
}
