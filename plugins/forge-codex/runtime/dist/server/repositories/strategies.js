import { randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { decorateOwnedEntity, filterOwnedEntities, inferFirstOwnedUserId, setEntityOwner } from "./entity-ownership.js";
import { getUserById, resolveUserForMutation } from "./users.js";
import { getBehaviorById, getBehaviorPatternById, getBeliefEntryById, getEmotionDefinitionById, getEventTypeById, getModeGuideSessionById, getModeProfileById, getPsycheValueById, getTriggerReportById } from "./psyche.js";
import { getCalendarEventById, getTaskTimeboxById, getWorkBlockTemplateById } from "./calendar.js";
import { getGoalById } from "./goals.js";
import { getHabitById } from "./habits.js";
import { getInsightById } from "./collaboration.js";
import { getNoteById } from "./notes.js";
import { getProjectById } from "./projects.js";
import { getTagById } from "./tags.js";
import { getTaskById, listTasks } from "./tasks.js";
import { getProjectSummary } from "../services/projects.js";
import { createStrategySchema, strategySchema, updateStrategySchema } from "../types.js";
function statusProgress(status) {
    switch (status) {
        case "done":
        case "completed":
        case "reviewed":
        case "integrated":
            return 1;
        case "in_progress":
        case "active":
            return 0.66;
        case "focus":
            return 0.5;
        case "blocked":
        case "paused":
            return 0.25;
        default:
            return 0;
    }
}
function goalProgress(goalId) {
    const tasks = listTasks({ goalId });
    if (tasks.length === 0) {
        const goal = getGoalById(goalId);
        return goal?.status === "completed" ? 1 : 0;
    }
    const completed = tasks.filter((task) => task.status === "done").length;
    return completed / tasks.length;
}
function resolveLinkedEntity(entityType, entityId) {
    switch (entityType) {
        case "goal":
            return getGoalById(entityId);
        case "project":
            return getProjectById(entityId);
        case "task":
            return getTaskById(entityId);
        case "strategy":
            return getStrategyById(entityId);
        case "habit":
            return getHabitById(entityId);
        case "tag":
            return getTagById(entityId);
        case "note":
            return getNoteById(entityId);
        case "insight":
            return getInsightById(entityId);
        case "calendar_event":
            return getCalendarEventById(entityId);
        case "work_block_template":
            return getWorkBlockTemplateById(entityId);
        case "task_timebox":
            return getTaskTimeboxById(entityId);
        case "psyche_value":
            return getPsycheValueById(entityId);
        case "behavior_pattern":
            return getBehaviorPatternById(entityId);
        case "behavior":
            return getBehaviorById(entityId);
        case "belief_entry":
            return getBeliefEntryById(entityId);
        case "mode_profile":
            return getModeProfileById(entityId);
        case "mode_guide_session":
            return getModeGuideSessionById(entityId);
        case "event_type":
            return getEventTypeById(entityId);
        case "emotion_definition":
            return getEmotionDefinitionById(entityId);
        case "trigger_report":
            return getTriggerReportById(entityId);
        default:
            return null;
    }
}
function assertStrategyRelations(input) {
    for (const goalId of input.targetGoalIds) {
        if (!getGoalById(goalId)) {
            throw new Error(`Goal ${goalId} does not exist`);
        }
    }
    for (const projectId of input.targetProjectIds) {
        if (!getProjectById(projectId)) {
            throw new Error(`Project ${projectId} does not exist`);
        }
    }
    for (const linked of input.linkedEntities) {
        if (!resolveLinkedEntity(linked.entityType, linked.entityId)) {
            throw new Error(`${linked.entityType} ${linked.entityId} does not exist`);
        }
    }
    for (const node of input.graph.nodes) {
        if (node.entityType === "project" && !getProjectById(node.entityId)) {
            throw new Error(`Project ${node.entityId} does not exist`);
        }
        if (node.entityType === "task" && !getTaskById(node.entityId)) {
            throw new Error(`Task ${node.entityId} does not exist`);
        }
    }
}
function parseJsonArray(value) {
    return JSON.parse(value);
}
function nodeProgress(node) {
    if (node.entityType === "project") {
        return (getProjectSummary(node.entityId)?.progress ?? 0) / 100;
    }
    return statusProgress(getTaskById(node.entityId)?.status ?? "backlog");
}
function buildStrategyMetrics(graph, targetGoalIds, targetProjectIds) {
    const nodeProgressById = new Map(graph.nodes.map((node) => [node.id, nodeProgress(node)]));
    const incoming = new Map();
    for (const node of graph.nodes) {
        incoming.set(node.id, []);
    }
    for (const edge of graph.edges) {
        incoming.get(edge.to)?.push(edge.from);
    }
    const completedNodeIds = graph.nodes
        .filter((node) => (nodeProgressById.get(node.id) ?? 0) >= 1)
        .map((node) => node.id);
    const startedNodeIds = graph.nodes
        .filter((node) => (nodeProgressById.get(node.id) ?? 0) > 0)
        .map((node) => node.id);
    const blockedNodeIds = graph.nodes
        .filter((node) => {
        if (node.entityType === "project") {
            return getProjectById(node.entityId)?.status === "paused";
        }
        return getTaskById(node.entityId)?.status === "blocked";
    })
        .map((node) => node.id);
    const outOfOrderNodeIds = graph.nodes
        .filter((node) => {
        const progress = nodeProgressById.get(node.id) ?? 0;
        if (progress <= 0) {
            return false;
        }
        const prerequisites = incoming.get(node.id) ?? [];
        return prerequisites.some((dependencyId) => (nodeProgressById.get(dependencyId) ?? 0) < 1);
    })
        .map((node) => node.id);
    const activeNodeIds = graph.nodes
        .filter((node) => {
        const progress = nodeProgressById.get(node.id) ?? 0;
        if (progress >= 1) {
            return false;
        }
        const prerequisites = incoming.get(node.id) ?? [];
        return prerequisites.every((dependencyId) => (nodeProgressById.get(dependencyId) ?? 0) >= 1);
    })
        .map((node) => node.id);
    const goalScores = targetGoalIds.map((goalId) => goalProgress(goalId));
    const projectScores = targetProjectIds.map((projectId) => (getProjectSummary(projectId)?.progress ?? 0) / 100);
    const targetScores = [...goalScores, ...projectScores];
    const nodeAverage = graph.nodes.length === 0
        ? 0
        : graph.nodes.reduce((sum, node) => sum + (nodeProgressById.get(node.id) ?? 0), 0) / graph.nodes.length;
    const targetAverage = targetScores.length === 0
        ? nodeAverage
        : targetScores.reduce((sum, value) => sum + value, 0) /
            targetScores.length;
    const graphProjectIds = new Set(graph.nodes
        .filter((node) => node.entityType === "project")
        .map((node) => node.entityId));
    const graphTaskIds = new Set(graph.nodes
        .filter((node) => node.entityType === "task")
        .map((node) => node.entityId));
    const offPlanEntityKeys = new Set();
    const offPlanActiveEntityKeys = new Set();
    const offPlanCompletedEntityKeys = new Set();
    const markOffPlanTask = (taskId) => {
        const task = getTaskById(taskId);
        if (!task) {
            return;
        }
        const entityKey = `task:${task.id}`;
        offPlanEntityKeys.add(entityKey);
        if (task.status === "done") {
            offPlanCompletedEntityKeys.add(entityKey);
            return;
        }
        if (["focus", "in_progress", "blocked"].includes(task.status)) {
            offPlanActiveEntityKeys.add(entityKey);
        }
    };
    for (const projectId of targetProjectIds) {
        const project = getProjectById(projectId);
        if (project &&
            !graphProjectIds.has(project.id) &&
            project.status !== "completed") {
            const entityKey = `project:${project.id}`;
            offPlanEntityKeys.add(entityKey);
            offPlanActiveEntityKeys.add(entityKey);
        }
        for (const task of listTasks({ projectId })) {
            if (!graphTaskIds.has(task.id) &&
                ["focus", "in_progress", "done", "blocked"].includes(task.status)) {
                markOffPlanTask(task.id);
            }
        }
    }
    for (const goalId of targetGoalIds) {
        for (const task of listTasks({ goalId })) {
            if (!graphTaskIds.has(task.id) &&
                ["focus", "in_progress", "done", "blocked"].includes(task.status)) {
                markOffPlanTask(task.id);
            }
        }
    }
    const totalNodes = Math.max(1, graph.nodes.length);
    const offPlanEntityCount = offPlanEntityKeys.size;
    const offPlanActiveEntityCount = offPlanActiveEntityKeys.size;
    const offPlanCompletedEntityCount = offPlanCompletedEntityKeys.size;
    const planCoverageScore = Math.max(0, Math.min(100, Math.round(nodeAverage * 100)));
    const sequencingScore = Math.max(0, Math.min(100, Math.round(100 - (outOfOrderNodeIds.length / totalNodes) * 100)));
    const scopeDisciplineScore = Math.max(0, Math.min(100, Math.round(100 - (offPlanEntityCount / totalNodes) * 100)));
    const blockedRatio = blockedNodeIds.length / totalNodes;
    const qualityScore = Math.max(0, Math.min(100, Math.round(Math.max(0, Math.min(1, targetAverage * 0.8 + (1 - blockedRatio) * 0.2)) * 100)));
    const targetProgressScore = Math.max(0, Math.min(100, Math.round(targetAverage * 100)));
    const alignmentScore = Math.max(0, Math.min(100, Math.round(planCoverageScore * 0.35 +
        sequencingScore * 0.3 +
        scopeDisciplineScore * 0.2 +
        qualityScore * 0.15)));
    return {
        alignmentScore,
        planCoverageScore,
        sequencingScore,
        scopeDisciplineScore,
        qualityScore,
        targetProgressScore,
        completedNodeCount: completedNodeIds.length,
        startedNodeCount: startedNodeIds.length,
        readyNodeCount: activeNodeIds.length,
        totalNodeCount: totalNodes,
        completedTargetCount: targetScores.filter((score) => score >= 1).length,
        totalTargetCount: targetScores.length,
        offPlanEntityCount,
        offPlanActiveEntityCount,
        offPlanCompletedEntityCount,
        activeNodeIds: activeNodeIds.slice(0, 8),
        nextNodeIds: activeNodeIds.slice(0, 5),
        blockedNodeIds,
        outOfOrderNodeIds
    };
}
function assertStrategyContractReady(input) {
    if (input.graph.nodes.length === 0) {
        throw new HttpError(400, "strategy_contract_invalid", "A locked strategy needs at least one project or task node in its graph.", { fields: ["graph.nodes"] });
    }
    if (input.targetGoalIds.length === 0 && input.targetProjectIds.length === 0) {
        throw new HttpError(400, "strategy_contract_invalid", "A locked strategy must target at least one goal or project.", { fields: ["targetGoalIds", "targetProjectIds"] });
    }
    if (input.overview.trim().length === 0 &&
        input.endStateDescription.trim().length === 0) {
        throw new HttpError(400, "strategy_contract_invalid", "A locked strategy needs an overview or end-state description so the contract is explicit.", { fields: ["overview", "endStateDescription"] });
    }
}
function mapStrategy(row) {
    const graph = JSON.parse(row.graph_json);
    return strategySchema.parse(decorateOwnedEntity("strategy", {
        id: row.id,
        title: row.title,
        overview: row.overview,
        endStateDescription: row.end_state_description,
        status: row.status,
        targetGoalIds: parseJsonArray(row.target_goal_ids_json),
        targetProjectIds: parseJsonArray(row.target_project_ids_json),
        linkedEntities: parseJsonArray(row.linked_entities_json),
        graph,
        metrics: buildStrategyMetrics(graph, parseJsonArray(row.target_goal_ids_json), parseJsonArray(row.target_project_ids_json)),
        isLocked: row.is_locked === 1,
        lockedAt: row.locked_at,
        lockedByUserId: row.locked_by_user_id,
        lockedByUser: row.locked_by_user_id
            ? (getUserById(row.locked_by_user_id) ?? null)
            : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }));
}
export function listStrategies(filters = {}) {
    const whereClauses = [];
    const params = [];
    if (filters.status) {
        whereClauses.push("status = ?");
        params.push(filters.status);
    }
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const limitSql = filters.limit ? "LIMIT ?" : "";
    if (filters.limit) {
        params.push(filters.limit);
    }
    const rows = getDatabase()
        .prepare(`SELECT id, title, overview, end_state_description, status, target_goal_ids_json, target_project_ids_json,
              linked_entities_json, graph_json, is_locked, locked_at, locked_by_user_id, created_at, updated_at
       FROM strategies
       ${whereSql}
       ORDER BY updated_at DESC
       ${limitSql}`)
        .all(...params);
    return filterOwnedEntities("strategy", rows.map(mapStrategy), filters.userIds);
}
export function getStrategyById(strategyId) {
    const row = getDatabase()
        .prepare(`SELECT id, title, overview, end_state_description, status, target_goal_ids_json, target_project_ids_json,
              linked_entities_json, graph_json, is_locked, locked_at, locked_by_user_id, created_at, updated_at
       FROM strategies
       WHERE id = ?`)
        .get(strategyId);
    return row ? mapStrategy(row) : undefined;
}
export function createStrategy(input) {
    return runInTransaction(() => {
        const parsed = createStrategySchema.parse(input);
        assertStrategyRelations(parsed);
        if (parsed.isLocked) {
            assertStrategyContractReady(parsed);
        }
        const now = new Date().toISOString();
        const id = `strategy_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
        const inferredOwnerUserId = parsed.userId ??
            inferFirstOwnedUserId([
                ...parsed.targetProjectIds.map((entityId) => ({
                    entityType: "project",
                    entityId
                })),
                ...parsed.targetGoalIds.map((entityId) => ({
                    entityType: "goal",
                    entityId
                })),
                ...parsed.graph.nodes.map((node) => ({
                    entityType: node.entityType,
                    entityId: node.entityId
                })),
                ...parsed.linkedEntities.map((entity) => ({
                    entityType: entity.entityType,
                    entityId: entity.entityId
                }))
            ]);
        const ownerUser = resolveUserForMutation(inferredOwnerUserId);
        const lockedByUserId = parsed.isLocked
            ? resolveUserForMutation(parsed.lockedByUserId ?? ownerUser.id).id
            : null;
        getDatabase()
            .prepare(`INSERT INTO strategies (
          id, title, overview, end_state_description, status, target_goal_ids_json, target_project_ids_json,
          linked_entities_json, graph_json, is_locked, locked_at, locked_by_user_id, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, parsed.title, parsed.overview, parsed.endStateDescription, parsed.status, JSON.stringify(parsed.targetGoalIds), JSON.stringify(parsed.targetProjectIds), JSON.stringify(parsed.linkedEntities), JSON.stringify(parsed.graph), parsed.isLocked ? 1 : 0, parsed.isLocked ? now : null, lockedByUserId, now, now);
        setEntityOwner("strategy", id, ownerUser.id);
        return getStrategyById(id);
    });
}
export function updateStrategy(strategyId, patch) {
    const current = getStrategyById(strategyId);
    if (!current) {
        return undefined;
    }
    return runInTransaction(() => {
        const parsed = updateStrategySchema.parse(patch);
        const changesCoreStrategyShape = parsed.title !== undefined ||
            parsed.overview !== undefined ||
            parsed.endStateDescription !== undefined ||
            parsed.targetGoalIds !== undefined ||
            parsed.targetProjectIds !== undefined ||
            parsed.linkedEntities !== undefined ||
            parsed.graph !== undefined ||
            parsed.userId !== undefined;
        if (current.isLocked &&
            parsed.isLocked !== false &&
            changesCoreStrategyShape) {
            throw new Error("Strategy is locked as a contract. Unlock it before changing the plan, targets, links, or owner.");
        }
        const next = {
            title: parsed.title ?? current.title,
            overview: parsed.overview ?? current.overview,
            endStateDescription: parsed.endStateDescription ?? current.endStateDescription,
            status: parsed.status ?? current.status,
            targetGoalIds: parsed.targetGoalIds ?? current.targetGoalIds,
            targetProjectIds: parsed.targetProjectIds ?? current.targetProjectIds,
            linkedEntities: parsed.linkedEntities ?? current.linkedEntities,
            graph: parsed.graph ?? current.graph,
            isLocked: parsed.isLocked ?? current.isLocked,
            lockedAt: parsed.isLocked === false
                ? null
                : parsed.isLocked === true && !current.isLocked
                    ? new Date().toISOString()
                    : current.lockedAt,
            lockedByUserId: parsed.isLocked === false
                ? null
                : parsed.isLocked === true
                    ? resolveUserForMutation(parsed.lockedByUserId ??
                        current.lockedByUserId ??
                        parsed.userId ??
                        current.userId ??
                        inferFirstOwnedUserId([
                            ...current.targetProjectIds.map((entityId) => ({
                                entityType: "project",
                                entityId
                            })),
                            ...current.targetGoalIds.map((entityId) => ({
                                entityType: "goal",
                                entityId
                            }))
                        ])).id
                    : current.lockedByUserId,
            updatedAt: new Date().toISOString()
        };
        assertStrategyRelations(next);
        if (next.isLocked) {
            assertStrategyContractReady(next);
        }
        getDatabase()
            .prepare(`UPDATE strategies
         SET title = ?, overview = ?, end_state_description = ?, status = ?, target_goal_ids_json = ?,
             target_project_ids_json = ?, linked_entities_json = ?, graph_json = ?, is_locked = ?, locked_at = ?,
             locked_by_user_id = ?, updated_at = ?
         WHERE id = ?`)
            .run(next.title, next.overview, next.endStateDescription, next.status, JSON.stringify(next.targetGoalIds), JSON.stringify(next.targetProjectIds), JSON.stringify(next.linkedEntities), JSON.stringify(next.graph), next.isLocked ? 1 : 0, next.lockedAt, next.lockedByUserId, next.updatedAt, strategyId);
        if (parsed.userId !== undefined) {
            setEntityOwner("strategy", strategyId, parsed.userId);
        }
        return getStrategyById(strategyId);
    });
}
export function deleteStrategy(strategyId) {
    const strategy = getStrategyById(strategyId);
    if (!strategy) {
        return undefined;
    }
    getDatabase().prepare(`DELETE FROM strategies WHERE id = ?`).run(strategyId);
    return strategy;
}
