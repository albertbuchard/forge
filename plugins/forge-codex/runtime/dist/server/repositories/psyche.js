import { randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { recordActivityEvent } from "./activity-events.js";
import { filterDeletedEntities, filterDeletedIds, isEntityDeleted } from "./deleted-entities.js";
import { clearEntityOwner, decorateOwnedEntity, setEntityOwner } from "./entity-ownership.js";
import { recordEventLog } from "./event-log.js";
import { unlinkNotesForEntity } from "./notes.js";
import { recordPsycheClarityReward, recordPsycheReflectionReward } from "./rewards.js";
import { behaviorPatternSchema, behaviorSchema, beliefEntrySchema, createBehaviorPatternSchema, createBehaviorSchema, createBeliefEntrySchema, createEmotionDefinitionSchema, createEventTypeSchema, createModeGuideSessionSchema, createModeProfileSchema, createPsycheValueSchema, createTriggerReportSchema, domainSchema, emotionDefinitionSchema, eventTypeSchema, modeFamilySchema, modeGuideResultSchema, modeGuideSessionSchema, modeProfileSchema, modeTimelineEntrySchema, psycheValueSchema, schemaCatalogEntrySchema, triggerReportSchema, updateBehaviorPatternSchema, updateBehaviorSchema, updateBeliefEntrySchema, updateEmotionDefinitionSchema, updateEventTypeSchema, updateModeGuideSessionSchema, updateModeProfileSchema, updatePsycheValueSchema, updateTriggerReportSchema } from "../psyche-types.js";
const PSYCHE_DOMAIN_ID = "domain_psyche";
function parseJson(value) {
    return JSON.parse(value);
}
function buildId(prefix) {
    return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
}
function assignOwnedEntity(entityType, entityId, userId, actor) {
    return setEntityOwner(entityType, entityId, userId, actor ?? null);
}
function enrichTriggerItems(items, prefix) {
    return items.map((item) => ({
        ...item,
        id: item.id ?? buildId(prefix)
    }));
}
function mapDomain(row) {
    return domainSchema.parse({
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        themeColor: row.theme_color,
        sensitive: row.sensitive === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
function mapSchemaCatalogEntry(row) {
    return schemaCatalogEntrySchema.parse({
        id: row.id,
        slug: row.slug,
        title: row.title,
        family: row.family,
        schemaType: row.schema_type,
        description: row.description,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
function mapEventType(row) {
    return eventTypeSchema.parse({
        id: row.id,
        domainId: row.domain_id,
        label: row.label,
        description: row.description,
        system: row.system === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
function mapEmotionDefinition(row) {
    return emotionDefinitionSchema.parse({
        id: row.id,
        domainId: row.domain_id,
        label: row.label,
        description: row.description,
        category: row.category,
        system: row.system === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
function mapPsycheValue(row) {
    return psycheValueSchema.parse({
        id: row.id,
        domainId: row.domain_id,
        title: row.title,
        description: row.description,
        valuedDirection: row.valued_direction,
        whyItMatters: row.why_it_matters,
        linkedGoalIds: filterDeletedIds("goal", parseJson(row.linked_goal_ids_json)),
        linkedProjectIds: filterDeletedIds("project", parseJson(row.linked_project_ids_json)),
        linkedTaskIds: filterDeletedIds("task", parseJson(row.linked_task_ids_json)),
        committedActions: parseJson(row.committed_actions_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
function mapBehaviorPattern(row) {
    return behaviorPatternSchema.parse({
        id: row.id,
        domainId: row.domain_id,
        title: row.title,
        description: row.description,
        targetBehavior: row.target_behavior,
        cueContexts: parseJson(row.cue_contexts_json),
        shortTermPayoff: row.short_term_payoff,
        longTermCost: row.long_term_cost,
        preferredResponse: row.preferred_response,
        linkedValueIds: filterDeletedIds("psyche_value", parseJson(row.linked_value_ids_json)),
        linkedSchemaLabels: parseJson(row.linked_schema_labels_json),
        linkedModeLabels: parseJson(row.linked_mode_labels_json),
        linkedModeIds: filterDeletedIds("mode_profile", parseJson(row.linked_mode_ids_json)),
        linkedBeliefIds: filterDeletedIds("belief_entry", parseJson(row.linked_belief_ids_json)),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
function mapBehavior(row) {
    return behaviorSchema.parse({
        id: row.id,
        domainId: row.domain_id,
        kind: row.kind,
        title: row.title,
        description: row.description,
        commonCues: parseJson(row.common_cues_json),
        urgeStory: row.urge_story,
        shortTermPayoff: row.short_term_payoff,
        longTermCost: row.long_term_cost,
        replacementMove: row.replacement_move,
        repairPlan: row.repair_plan,
        linkedPatternIds: filterDeletedIds("behavior_pattern", parseJson(row.linked_pattern_ids_json)),
        linkedValueIds: filterDeletedIds("psyche_value", parseJson(row.linked_value_ids_json)),
        linkedSchemaIds: parseJson(row.linked_schema_ids_json),
        linkedModeIds: filterDeletedIds("mode_profile", parseJson(row.linked_mode_ids_json)),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
function mapBeliefEntry(row) {
    return beliefEntrySchema.parse({
        id: row.id,
        domainId: row.domain_id,
        schemaId: row.schema_id,
        statement: row.statement,
        beliefType: row.belief_type,
        originNote: row.origin_note,
        confidence: row.confidence,
        evidenceFor: parseJson(row.evidence_for_json),
        evidenceAgainst: parseJson(row.evidence_against_json),
        flexibleAlternative: row.flexible_alternative,
        linkedValueIds: filterDeletedIds("psyche_value", parseJson(row.linked_value_ids_json)),
        linkedBehaviorIds: filterDeletedIds("behavior", parseJson(row.linked_behavior_ids_json)),
        linkedModeIds: filterDeletedIds("mode_profile", parseJson(row.linked_mode_ids_json)),
        linkedReportIds: filterDeletedIds("trigger_report", parseJson(row.linked_report_ids_json)),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
function mapModeProfile(row) {
    return modeProfileSchema.parse({
        id: row.id,
        domainId: row.domain_id,
        family: row.family,
        archetype: row.archetype,
        title: row.title,
        persona: row.persona,
        imagery: row.imagery,
        symbolicForm: row.symbolic_form,
        facialExpression: row.facial_expression,
        fear: row.fear,
        burden: row.burden,
        protectiveJob: row.protective_job,
        originContext: row.origin_context,
        firstAppearanceAt: row.first_appearance_at,
        linkedPatternIds: filterDeletedIds("behavior_pattern", parseJson(row.linked_pattern_ids_json)),
        linkedBehaviorIds: filterDeletedIds("behavior", parseJson(row.linked_behavior_ids_json)),
        linkedValueIds: filterDeletedIds("psyche_value", parseJson(row.linked_value_ids_json)),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
function mapModeGuideSession(row) {
    return modeGuideSessionSchema.parse({
        id: row.id,
        summary: row.summary,
        answers: parseJson(row.answers_json),
        results: parseJson(row.results_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
function mapTriggerReport(row) {
    const emotions = parseJson(row.emotions_json).map((emotion) => emotion.emotionDefinitionId && isEntityDeleted("emotion_definition", emotion.emotionDefinitionId)
        ? { ...emotion, emotionDefinitionId: null }
        : emotion);
    const thoughts = parseJson(row.thoughts_json).map((thought) => thought.beliefId && isEntityDeleted("belief_entry", thought.beliefId)
        ? { ...thought, beliefId: null }
        : thought);
    const behaviors = parseJson(row.behaviors_json).map((behavior) => behavior.behaviorId && isEntityDeleted("behavior", behavior.behaviorId)
        ? { ...behavior, behaviorId: null }
        : behavior);
    const modeTimeline = parseJson(row.mode_timeline_json).map((entry) => entry.modeId && isEntityDeleted("mode_profile", entry.modeId)
        ? { ...entry, modeId: null }
        : entry);
    return triggerReportSchema.parse({
        id: row.id,
        domainId: row.domain_id,
        title: row.title,
        status: row.status,
        eventTypeId: row.event_type_id && isEntityDeleted("event_type", row.event_type_id) ? null : row.event_type_id,
        customEventType: row.custom_event_type,
        eventSituation: row.event_situation,
        occurredAt: row.occurred_at,
        emotions,
        thoughts,
        behaviors,
        consequences: parseJson(row.consequences_json),
        linkedPatternIds: filterDeletedIds("behavior_pattern", parseJson(row.linked_pattern_ids_json)),
        linkedValueIds: filterDeletedIds("psyche_value", parseJson(row.linked_value_ids_json)),
        linkedGoalIds: filterDeletedIds("goal", parseJson(row.linked_goal_ids_json)),
        linkedProjectIds: filterDeletedIds("project", parseJson(row.linked_project_ids_json)),
        linkedTaskIds: filterDeletedIds("task", parseJson(row.linked_task_ids_json)),
        linkedBehaviorIds: filterDeletedIds("behavior", parseJson(row.linked_behavior_ids_json)),
        linkedBeliefIds: filterDeletedIds("belief_entry", parseJson(row.linked_belief_ids_json)),
        linkedModeIds: filterDeletedIds("mode_profile", parseJson(row.linked_mode_ids_json)),
        modeOverlays: parseJson(row.mode_overlays_json),
        schemaLinks: parseJson(row.schema_links_json),
        modeTimeline,
        nextMoves: parseJson(row.next_moves_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
function scoreModeGuideSession(input) {
    const answers = new Map(input.answers.map((answer) => [answer.questionKey, answer.value]));
    const results = [];
    const coping = answers.get("coping_response");
    if (coping && coping !== "none") {
        results.push(modeGuideResultSchema.parse({
            family: "coping",
            archetype: coping,
            label: coping === "fight"
                ? "Fighter"
                : coping === "flight"
                    ? "Escaper"
                    : coping === "freeze"
                        ? "Freezer"
                        : coping === "detach"
                            ? "Detached protector"
                            : coping === "comply"
                                ? "Compliant surrender"
                                : "Overcompensator",
            confidence: 0.78,
            reasoning: `The coping response leaned most strongly toward ${coping}.`
        }));
    }
    const child = answers.get("child_state");
    if (child && child !== "none") {
        results.push(modeGuideResultSchema.parse({
            family: "child",
            archetype: child,
            label: child === "vulnerable"
                ? "Vulnerable child"
                : child === "angry"
                    ? "Angry child"
                    : child === "impulsive"
                        ? "Impulsive child"
                        : child === "lonely"
                            ? "Lonely child"
                            : "Ashamed child",
            confidence: 0.72,
            reasoning: `The child-state answers cluster around ${child} activation.`
        }));
    }
    const critic = answers.get("critic_style");
    if (critic && critic !== "none") {
        results.push(modeGuideResultSchema.parse({
            family: "critic_parent",
            archetype: critic,
            label: critic === "demanding" ? "Demanding critic" : "Punitive critic",
            confidence: 0.76,
            reasoning: `The inner critical tone reads as ${critic}.`
        }));
    }
    const healthy = answers.get("healthy_contact");
    if (healthy && healthy !== "none") {
        results.push(modeGuideResultSchema.parse({
            family: healthy === "happy_child" ? "happy_child" : "healthy_adult",
            archetype: healthy,
            label: healthy === "happy_child" ? "Happy child" : "Healthy adult",
            confidence: 0.69,
            reasoning: `There is still some contact with ${healthy === "happy_child" ? "playful aliveness" : "steady adult leadership"}.`
        }));
    }
    if (results.length === 0) {
        results.push(modeGuideResultSchema.parse({
            family: "healthy_adult",
            archetype: "undifferentiated",
            label: "Mixed state",
            confidence: 0.41,
            reasoning: "The questionnaire suggests a mixed or unclear state; name the mode manually after reflection."
        }));
    }
    return results;
}
function mapCreateUpdateContext(input) {
    recordActivityEvent({
        entityType: input.entityType,
        entityId: input.entityId,
        eventType: input.eventKind,
        title: input.title,
        description: input.title,
        actor: input.actor ?? null,
        source: input.source,
        metadata: input.metadata ?? {}
    });
    recordEventLog({
        eventKind: input.eventKind,
        entityType: input.entityType,
        entityId: input.entityId,
        actor: input.actor ?? null,
        source: input.source,
        metadata: input.metadata ?? {}
    });
}
function getRow(sql, id) {
    return getDatabase().prepare(sql).get(id);
}
function unlinkEntityNotes(entityType, entityId) {
    unlinkNotesForEntity(entityType, entityId, { source: "system", actor: null });
}
function rewriteJsonColumn(table, column, transform) {
    const rows = getDatabase()
        .prepare(`SELECT id, ${column} AS payload FROM ${table}`)
        .all();
    const update = getDatabase().prepare(`UPDATE ${table} SET ${column} = ?, updated_at = ? WHERE id = ?`);
    for (const row of rows) {
        const current = parseJson(row.payload);
        const next = transform(current);
        const currentJson = JSON.stringify(current);
        const nextJson = JSON.stringify(next);
        if (nextJson !== currentJson) {
            update.run(nextJson, new Date().toISOString(), row.id);
        }
    }
}
function removeIdFromStringArrayColumn(table, column, targetId) {
    rewriteJsonColumn(table, column, (values) => values.filter((value) => value !== targetId));
}
function nullifyTriggerThoughtBeliefReferences(beliefId) {
    rewriteJsonColumn("trigger_reports", "thoughts_json", (thoughts) => thoughts.map((thought) => (thought.beliefId === beliefId ? { ...thought, beliefId: null } : thought)));
}
function nullifyTriggerBehaviorReferences(behaviorId) {
    rewriteJsonColumn("trigger_reports", "behaviors_json", (behaviors) => behaviors.map((behavior) => (behavior.behaviorId === behaviorId ? { ...behavior, behaviorId: null } : behavior)));
}
function nullifyTriggerEmotionReferences(emotionId) {
    rewriteJsonColumn("trigger_reports", "emotions_json", (emotions) => emotions.map((emotion) => emotion.emotionDefinitionId === emotionId ? { ...emotion, emotionDefinitionId: null } : emotion));
}
function nullifyTriggerTimelineModeReferences(modeId) {
    rewriteJsonColumn("trigger_reports", "mode_timeline_json", (entries) => entries.map((entry) => (entry.modeId === modeId ? { ...entry, modeId: null } : entry)));
}
export function pruneLinkedEntityReferences(entityType, entityId) {
    const columnByEntityType = {
        goal: "linked_goal_ids_json",
        project: "linked_project_ids_json",
        task: "linked_task_ids_json"
    };
    const column = columnByEntityType[entityType];
    removeIdFromStringArrayColumn("psyche_values", column, entityId);
    removeIdFromStringArrayColumn("trigger_reports", column, entityId);
}
export function getPsycheDomain() {
    const row = getDatabase()
        .prepare(`SELECT id, slug, title, description, theme_color, sensitive, created_at, updated_at
       FROM domains
       WHERE id = ?`)
        .get(PSYCHE_DOMAIN_ID);
    return row ? mapDomain(row) : undefined;
}
export function listSchemaCatalog() {
    const rows = getDatabase()
        .prepare(`SELECT id, slug, title, family, schema_type, description, created_at, updated_at
       FROM schema_catalog
       ORDER BY CASE schema_type WHEN 'maladaptive' THEN 0 ELSE 1 END, family, title`)
        .all();
    return rows.map(mapSchemaCatalogEntry);
}
export function listEventTypes() {
    const rows = getDatabase()
        .prepare(`SELECT id, domain_id, label, description, system, created_at, updated_at
       FROM event_types
       WHERE domain_id = ?
       ORDER BY system DESC, label`)
        .all(PSYCHE_DOMAIN_ID);
    return filterDeletedEntities("event_type", rows.map(mapEventType));
}
export function getEventTypeById(eventTypeId) {
    if (isEntityDeleted("event_type", eventTypeId)) {
        return undefined;
    }
    const row = getRow(`SELECT id, domain_id, label, description, system, created_at, updated_at
     FROM event_types
     WHERE id = ?`, eventTypeId);
    return row ? decorateOwnedEntity("event_type", mapEventType(row)) : undefined;
}
export function createEventType(input, context) {
    const parsed = createEventTypeSchema.parse(input);
    const now = new Date().toISOString();
    const eventType = eventTypeSchema.parse({
        id: buildId("evt"),
        domainId: PSYCHE_DOMAIN_ID,
        label: parsed.label,
        description: parsed.description,
        system: false,
        createdAt: now,
        updatedAt: now
    });
    getDatabase()
        .prepare(`INSERT INTO event_types (id, domain_id, label, description, system, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`)
        .run(eventType.id, eventType.domainId, eventType.label, eventType.description, eventType.createdAt, eventType.updatedAt);
    assignOwnedEntity("event_type", eventType.id, parsed.userId, context.actor);
    mapCreateUpdateContext({
        entityType: "event_type",
        entityId: eventType.id,
        title: "Event type added",
        eventKind: "event_type.created",
        source: context.source,
        actor: context.actor ?? null,
        metadata: { domainId: eventType.domainId }
    });
    return decorateOwnedEntity("event_type", eventType);
}
export function updateEventType(eventTypeId, patch, context) {
    const existing = getEventTypeById(eventTypeId);
    if (!existing) {
        return undefined;
    }
    const parsed = updateEventTypeSchema.parse(patch);
    const updated = eventTypeSchema.parse({
        ...existing,
        ...parsed,
        updatedAt: new Date().toISOString()
    });
    getDatabase()
        .prepare(`UPDATE event_types
       SET label = ?, description = ?, updated_at = ?
       WHERE id = ?`)
        .run(updated.label, updated.description, updated.updatedAt, eventTypeId);
    if (parsed.userId !== undefined) {
        assignOwnedEntity("event_type", eventTypeId, parsed.userId, context.actor);
    }
    mapCreateUpdateContext({
        entityType: "event_type",
        entityId: eventTypeId,
        title: "Event type updated",
        eventKind: "event_type.updated",
        source: context.source,
        actor: context.actor ?? null,
        metadata: { domainId: updated.domainId }
    });
    return decorateOwnedEntity("event_type", updated);
}
export function deleteEventType(eventTypeId, context) {
    const existing = getEventTypeById(eventTypeId);
    if (!existing) {
        return undefined;
    }
    return runInTransaction(() => {
        unlinkEntityNotes("event_type", eventTypeId);
        clearEntityOwner("event_type", eventTypeId);
        getDatabase()
            .prepare(`DELETE FROM event_types WHERE id = ?`)
            .run(eventTypeId);
        mapCreateUpdateContext({
            entityType: "event_type",
            entityId: eventTypeId,
            title: "Event type deleted",
            eventKind: "event_type.deleted",
            source: context.source,
            actor: context.actor ?? null,
            metadata: { domainId: existing.domainId }
        });
        return existing;
    });
}
export function listEmotionDefinitions() {
    const rows = getDatabase()
        .prepare(`SELECT id, domain_id, label, description, category, system, created_at, updated_at
       FROM emotion_definitions
       WHERE domain_id = ?
       ORDER BY system DESC, label`)
        .all(PSYCHE_DOMAIN_ID);
    return filterDeletedEntities("emotion_definition", rows.map(mapEmotionDefinition));
}
export function getEmotionDefinitionById(emotionId) {
    if (isEntityDeleted("emotion_definition", emotionId)) {
        return undefined;
    }
    const row = getRow(`SELECT id, domain_id, label, description, category, system, created_at, updated_at
     FROM emotion_definitions
     WHERE id = ?`, emotionId);
    return row
        ? decorateOwnedEntity("emotion_definition", mapEmotionDefinition(row))
        : undefined;
}
export function createEmotionDefinition(input, context) {
    const parsed = createEmotionDefinitionSchema.parse(input);
    const now = new Date().toISOString();
    const emotion = emotionDefinitionSchema.parse({
        id: buildId("emo"),
        domainId: PSYCHE_DOMAIN_ID,
        label: parsed.label,
        description: parsed.description,
        category: parsed.category,
        system: false,
        createdAt: now,
        updatedAt: now
    });
    getDatabase()
        .prepare(`INSERT INTO emotion_definitions (id, domain_id, label, description, category, system, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`)
        .run(emotion.id, emotion.domainId, emotion.label, emotion.description, emotion.category, emotion.createdAt, emotion.updatedAt);
    assignOwnedEntity("emotion_definition", emotion.id, parsed.userId, context.actor);
    mapCreateUpdateContext({
        entityType: "emotion_definition",
        entityId: emotion.id,
        title: "Emotion definition added",
        eventKind: "emotion_definition.created",
        source: context.source,
        actor: context.actor ?? null,
        metadata: { domainId: emotion.domainId }
    });
    return decorateOwnedEntity("emotion_definition", emotion);
}
export function updateEmotionDefinition(emotionId, patch, context) {
    const existing = getEmotionDefinitionById(emotionId);
    if (!existing) {
        return undefined;
    }
    const parsed = updateEmotionDefinitionSchema.parse(patch);
    const updated = emotionDefinitionSchema.parse({
        ...existing,
        ...parsed,
        updatedAt: new Date().toISOString()
    });
    getDatabase()
        .prepare(`UPDATE emotion_definitions
       SET label = ?, description = ?, category = ?, updated_at = ?
       WHERE id = ?`)
        .run(updated.label, updated.description, updated.category, updated.updatedAt, emotionId);
    if (parsed.userId !== undefined) {
        assignOwnedEntity("emotion_definition", emotionId, parsed.userId, context.actor);
    }
    mapCreateUpdateContext({
        entityType: "emotion_definition",
        entityId: emotionId,
        title: "Emotion definition updated",
        eventKind: "emotion_definition.updated",
        source: context.source,
        actor: context.actor ?? null,
        metadata: { domainId: updated.domainId }
    });
    return decorateOwnedEntity("emotion_definition", updated);
}
export function deleteEmotionDefinition(emotionId, context) {
    const existing = getEmotionDefinitionById(emotionId);
    if (!existing) {
        return undefined;
    }
    return runInTransaction(() => {
        nullifyTriggerEmotionReferences(emotionId);
        unlinkEntityNotes("emotion_definition", emotionId);
        clearEntityOwner("emotion_definition", emotionId);
        getDatabase()
            .prepare(`DELETE FROM emotion_definitions WHERE id = ?`)
            .run(emotionId);
        mapCreateUpdateContext({
            entityType: "emotion_definition",
            entityId: emotionId,
            title: "Emotion definition deleted",
            eventKind: "emotion_definition.deleted",
            source: context.source,
            actor: context.actor ?? null,
            metadata: { domainId: existing.domainId }
        });
        return existing;
    });
}
export function listPsycheValues() {
    const rows = getDatabase()
        .prepare(`SELECT
         id, domain_id, title, description, valued_direction, why_it_matters,
         linked_goal_ids_json, linked_project_ids_json, linked_task_ids_json, committed_actions_json, created_at, updated_at
       FROM psyche_values
       WHERE domain_id = ?
       ORDER BY updated_at DESC`)
        .all(PSYCHE_DOMAIN_ID);
    return filterDeletedEntities("psyche_value", rows.map(mapPsycheValue));
}
export function getPsycheValueById(valueId) {
    if (isEntityDeleted("psyche_value", valueId)) {
        return undefined;
    }
    const row = getRow(`SELECT
       id, domain_id, title, description, valued_direction, why_it_matters,
       linked_goal_ids_json, linked_project_ids_json, linked_task_ids_json, committed_actions_json, created_at, updated_at
     FROM psyche_values
     WHERE id = ?`, valueId);
    return row ? decorateOwnedEntity("psyche_value", mapPsycheValue(row)) : undefined;
}
export function createPsycheValue(input, context) {
    const parsed = createPsycheValueSchema.parse(input);
    const now = new Date().toISOString();
    const value = psycheValueSchema.parse({
        id: buildId("psy"),
        domainId: PSYCHE_DOMAIN_ID,
        title: parsed.title,
        description: parsed.description,
        valuedDirection: parsed.valuedDirection,
        whyItMatters: parsed.whyItMatters,
        linkedGoalIds: parsed.linkedGoalIds,
        linkedProjectIds: parsed.linkedProjectIds,
        linkedTaskIds: parsed.linkedTaskIds,
        committedActions: parsed.committedActions,
        createdAt: now,
        updatedAt: now
    });
    getDatabase()
        .prepare(`INSERT INTO psyche_values (
        id, domain_id, title, description, valued_direction, why_it_matters, linked_goal_ids_json, linked_project_ids_json,
        linked_task_ids_json, committed_actions_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(value.id, value.domainId, value.title, value.description, value.valuedDirection, value.whyItMatters, JSON.stringify(value.linkedGoalIds), JSON.stringify(value.linkedProjectIds), JSON.stringify(value.linkedTaskIds), JSON.stringify(value.committedActions), value.createdAt, value.updatedAt);
    assignOwnedEntity("psyche_value", value.id, parsed.userId, context.actor);
    mapCreateUpdateContext({
        entityType: "psyche_value",
        entityId: value.id,
        title: "Psyche value added",
        eventKind: "psyche_value.created",
        source: context.source,
        actor: context.actor ?? null,
        metadata: { domainId: value.domainId }
    });
    recordPsycheClarityReward("psyche_value", value.id, value.title, "psyche_value_defined", context);
    return decorateOwnedEntity("psyche_value", value);
}
export function updatePsycheValue(valueId, patch, context) {
    const existing = getPsycheValueById(valueId);
    if (!existing) {
        return undefined;
    }
    const parsed = updatePsycheValueSchema.parse(patch);
    const updated = psycheValueSchema.parse({
        ...existing,
        ...parsed,
        committedActions: parsed.committedActions ?? existing.committedActions,
        updatedAt: new Date().toISOString()
    });
    getDatabase()
        .prepare(`UPDATE psyche_values
       SET title = ?, description = ?, valued_direction = ?, why_it_matters = ?, linked_goal_ids_json = ?,
           linked_project_ids_json = ?, linked_task_ids_json = ?, committed_actions_json = ?, updated_at = ?
       WHERE id = ?`)
        .run(updated.title, updated.description, updated.valuedDirection, updated.whyItMatters, JSON.stringify(updated.linkedGoalIds), JSON.stringify(updated.linkedProjectIds), JSON.stringify(updated.linkedTaskIds), JSON.stringify(updated.committedActions), updated.updatedAt, valueId);
    if (parsed.userId !== undefined) {
        assignOwnedEntity("psyche_value", valueId, parsed.userId, context.actor);
    }
    mapCreateUpdateContext({
        entityType: "psyche_value",
        entityId: valueId,
        title: "Psyche value updated",
        eventKind: "psyche_value.updated",
        source: context.source,
        actor: context.actor ?? null,
        metadata: { domainId: updated.domainId }
    });
    return decorateOwnedEntity("psyche_value", updated);
}
export function deletePsycheValue(valueId, context) {
    const existing = getPsycheValueById(valueId);
    if (!existing) {
        return undefined;
    }
    return runInTransaction(() => {
        removeIdFromStringArrayColumn("behavior_patterns", "linked_value_ids_json", valueId);
        removeIdFromStringArrayColumn("psyche_behaviors", "linked_value_ids_json", valueId);
        removeIdFromStringArrayColumn("belief_entries", "linked_value_ids_json", valueId);
        removeIdFromStringArrayColumn("mode_profiles", "linked_value_ids_json", valueId);
        removeIdFromStringArrayColumn("trigger_reports", "linked_value_ids_json", valueId);
        unlinkEntityNotes("psyche_value", valueId);
        clearEntityOwner("psyche_value", valueId);
        getDatabase()
            .prepare(`DELETE FROM psyche_values WHERE id = ?`)
            .run(valueId);
        mapCreateUpdateContext({
            entityType: "psyche_value",
            entityId: valueId,
            title: "Psyche value deleted",
            eventKind: "psyche_value.deleted",
            source: context.source,
            actor: context.actor ?? null,
            metadata: { domainId: existing.domainId }
        });
        return existing;
    });
}
export function listBehaviorPatterns() {
    const rows = getDatabase()
        .prepare(`SELECT
         id, domain_id, title, description, target_behavior, cue_contexts_json, short_term_payoff, long_term_cost,
         preferred_response, linked_value_ids_json, linked_schema_labels_json, linked_mode_labels_json, linked_mode_ids_json,
         linked_belief_ids_json, created_at, updated_at
       FROM behavior_patterns
       WHERE domain_id = ?
       ORDER BY updated_at DESC`)
        .all(PSYCHE_DOMAIN_ID);
    return filterDeletedEntities("behavior_pattern", rows.map(mapBehaviorPattern));
}
export function getBehaviorPatternById(patternId) {
    if (isEntityDeleted("behavior_pattern", patternId)) {
        return undefined;
    }
    const row = getRow(`SELECT
       id, domain_id, title, description, target_behavior, cue_contexts_json, short_term_payoff, long_term_cost,
       preferred_response, linked_value_ids_json, linked_schema_labels_json, linked_mode_labels_json, linked_mode_ids_json,
       linked_belief_ids_json, created_at, updated_at
     FROM behavior_patterns
     WHERE id = ?`, patternId);
    return row
        ? decorateOwnedEntity("behavior_pattern", mapBehaviorPattern(row))
        : undefined;
}
export function createBehaviorPattern(input, context) {
    const parsed = createBehaviorPatternSchema.parse(input);
    const now = new Date().toISOString();
    const pattern = behaviorPatternSchema.parse({
        id: buildId("pat"),
        domainId: PSYCHE_DOMAIN_ID,
        title: parsed.title,
        description: parsed.description,
        targetBehavior: parsed.targetBehavior,
        cueContexts: parsed.cueContexts,
        shortTermPayoff: parsed.shortTermPayoff,
        longTermCost: parsed.longTermCost,
        preferredResponse: parsed.preferredResponse,
        linkedValueIds: parsed.linkedValueIds,
        linkedSchemaLabels: parsed.linkedSchemaLabels,
        linkedModeLabels: parsed.linkedModeLabels,
        linkedModeIds: parsed.linkedModeIds,
        linkedBeliefIds: parsed.linkedBeliefIds,
        createdAt: now,
        updatedAt: now
    });
    getDatabase()
        .prepare(`INSERT INTO behavior_patterns (
        id, domain_id, title, description, target_behavior, cue_contexts_json, short_term_payoff, long_term_cost,
        preferred_response, linked_value_ids_json, linked_schema_labels_json, linked_mode_labels_json, linked_mode_ids_json,
        linked_belief_ids_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(pattern.id, pattern.domainId, pattern.title, pattern.description, pattern.targetBehavior, JSON.stringify(pattern.cueContexts), pattern.shortTermPayoff, pattern.longTermCost, pattern.preferredResponse, JSON.stringify(pattern.linkedValueIds), JSON.stringify(pattern.linkedSchemaLabels), JSON.stringify(pattern.linkedModeLabels), JSON.stringify(pattern.linkedModeIds), JSON.stringify(pattern.linkedBeliefIds), pattern.createdAt, pattern.updatedAt);
    assignOwnedEntity("behavior_pattern", pattern.id, parsed.userId, context.actor);
    mapCreateUpdateContext({
        entityType: "behavior_pattern",
        entityId: pattern.id,
        title: "Behavior pattern added",
        eventKind: "behavior_pattern.created",
        source: context.source,
        actor: context.actor ?? null,
        metadata: { domainId: pattern.domainId }
    });
    recordPsycheClarityReward("behavior_pattern", pattern.id, pattern.title, "psyche_pattern_defined", context);
    return decorateOwnedEntity("behavior_pattern", pattern);
}
export function updateBehaviorPattern(patternId, patch, context) {
    const existing = getBehaviorPatternById(patternId);
    if (!existing) {
        return undefined;
    }
    const parsed = updateBehaviorPatternSchema.parse(patch);
    const updated = behaviorPatternSchema.parse({
        ...existing,
        ...parsed,
        updatedAt: new Date().toISOString()
    });
    getDatabase()
        .prepare(`UPDATE behavior_patterns
       SET title = ?, description = ?, target_behavior = ?, cue_contexts_json = ?, short_term_payoff = ?, long_term_cost = ?,
           preferred_response = ?, linked_value_ids_json = ?, linked_schema_labels_json = ?, linked_mode_labels_json = ?,
           linked_mode_ids_json = ?, linked_belief_ids_json = ?, updated_at = ?
       WHERE id = ?`)
        .run(updated.title, updated.description, updated.targetBehavior, JSON.stringify(updated.cueContexts), updated.shortTermPayoff, updated.longTermCost, updated.preferredResponse, JSON.stringify(updated.linkedValueIds), JSON.stringify(updated.linkedSchemaLabels), JSON.stringify(updated.linkedModeLabels), JSON.stringify(updated.linkedModeIds), JSON.stringify(updated.linkedBeliefIds), updated.updatedAt, patternId);
    if (parsed.userId !== undefined) {
        assignOwnedEntity("behavior_pattern", patternId, parsed.userId, context.actor);
    }
    mapCreateUpdateContext({
        entityType: "behavior_pattern",
        entityId: patternId,
        title: "Behavior pattern updated",
        eventKind: "behavior_pattern.updated",
        source: context.source,
        actor: context.actor ?? null,
        metadata: { domainId: updated.domainId }
    });
    return decorateOwnedEntity("behavior_pattern", updated);
}
export function deleteBehaviorPattern(patternId, context) {
    const existing = getBehaviorPatternById(patternId);
    if (!existing) {
        return undefined;
    }
    return runInTransaction(() => {
        removeIdFromStringArrayColumn("psyche_behaviors", "linked_pattern_ids_json", patternId);
        removeIdFromStringArrayColumn("mode_profiles", "linked_pattern_ids_json", patternId);
        removeIdFromStringArrayColumn("trigger_reports", "linked_pattern_ids_json", patternId);
        unlinkEntityNotes("behavior_pattern", patternId);
        clearEntityOwner("behavior_pattern", patternId);
        getDatabase()
            .prepare(`DELETE FROM behavior_patterns WHERE id = ?`)
            .run(patternId);
        mapCreateUpdateContext({
            entityType: "behavior_pattern",
            entityId: patternId,
            title: "Behavior pattern deleted",
            eventKind: "behavior_pattern.deleted",
            source: context.source,
            actor: context.actor ?? null,
            metadata: { domainId: existing.domainId }
        });
        return existing;
    });
}
export function listBehaviors() {
    const rows = getDatabase()
        .prepare(`SELECT
         id, domain_id, kind, title, description, common_cues_json, urge_story, short_term_payoff, long_term_cost,
         replacement_move, repair_plan, linked_pattern_ids_json, linked_value_ids_json, linked_schema_ids_json,
         linked_mode_ids_json, created_at, updated_at
       FROM psyche_behaviors
       WHERE domain_id = ?
       ORDER BY kind, updated_at DESC`)
        .all(PSYCHE_DOMAIN_ID);
    return filterDeletedEntities("behavior", rows.map(mapBehavior));
}
export function getBehaviorById(behaviorId) {
    if (isEntityDeleted("behavior", behaviorId)) {
        return undefined;
    }
    const row = getRow(`SELECT
       id, domain_id, kind, title, description, common_cues_json, urge_story, short_term_payoff, long_term_cost,
       replacement_move, repair_plan, linked_pattern_ids_json, linked_value_ids_json, linked_schema_ids_json,
       linked_mode_ids_json, created_at, updated_at
     FROM psyche_behaviors
     WHERE id = ?`, behaviorId);
    return row ? decorateOwnedEntity("behavior", mapBehavior(row)) : undefined;
}
export function createBehavior(input, context) {
    const parsed = createBehaviorSchema.parse(input);
    const now = new Date().toISOString();
    const behavior = behaviorSchema.parse({
        id: buildId("bhv"),
        domainId: PSYCHE_DOMAIN_ID,
        ...parsed,
        createdAt: now,
        updatedAt: now
    });
    getDatabase()
        .prepare(`INSERT INTO psyche_behaviors (
        id, domain_id, kind, title, description, common_cues_json, urge_story, short_term_payoff, long_term_cost,
        replacement_move, repair_plan, linked_pattern_ids_json, linked_value_ids_json, linked_schema_ids_json, linked_mode_ids_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(behavior.id, behavior.domainId, behavior.kind, behavior.title, behavior.description, JSON.stringify(behavior.commonCues), behavior.urgeStory, behavior.shortTermPayoff, behavior.longTermCost, behavior.replacementMove, behavior.repairPlan, JSON.stringify(behavior.linkedPatternIds), JSON.stringify(behavior.linkedValueIds), JSON.stringify(behavior.linkedSchemaIds), JSON.stringify(behavior.linkedModeIds), behavior.createdAt, behavior.updatedAt);
    assignOwnedEntity("behavior", behavior.id, parsed.userId, context.actor);
    mapCreateUpdateContext({
        entityType: "behavior",
        entityId: behavior.id,
        title: "Behavior added",
        eventKind: "behavior.created",
        source: context.source,
        actor: context.actor ?? null,
        metadata: { kind: behavior.kind, domainId: behavior.domainId }
    });
    recordPsycheClarityReward("behavior", behavior.id, behavior.title, "psyche_behavior_defined", context);
    return decorateOwnedEntity("behavior", behavior);
}
export function updateBehavior(behaviorId, patch, context) {
    const existing = getBehaviorById(behaviorId);
    if (!existing) {
        return undefined;
    }
    const parsed = updateBehaviorSchema.parse(patch);
    const updated = behaviorSchema.parse({
        ...existing,
        ...parsed,
        updatedAt: new Date().toISOString()
    });
    getDatabase()
        .prepare(`UPDATE psyche_behaviors
       SET kind = ?, title = ?, description = ?, common_cues_json = ?, urge_story = ?, short_term_payoff = ?, long_term_cost = ?,
           replacement_move = ?, repair_plan = ?, linked_pattern_ids_json = ?, linked_value_ids_json = ?, linked_schema_ids_json = ?,
           linked_mode_ids_json = ?, updated_at = ?
       WHERE id = ?`)
        .run(updated.kind, updated.title, updated.description, JSON.stringify(updated.commonCues), updated.urgeStory, updated.shortTermPayoff, updated.longTermCost, updated.replacementMove, updated.repairPlan, JSON.stringify(updated.linkedPatternIds), JSON.stringify(updated.linkedValueIds), JSON.stringify(updated.linkedSchemaIds), JSON.stringify(updated.linkedModeIds), updated.updatedAt, behaviorId);
    if (parsed.userId !== undefined) {
        assignOwnedEntity("behavior", behaviorId, parsed.userId, context.actor);
    }
    mapCreateUpdateContext({
        entityType: "behavior",
        entityId: behaviorId,
        title: "Behavior updated",
        eventKind: "behavior.updated",
        source: context.source,
        actor: context.actor ?? null,
        metadata: { kind: updated.kind, domainId: updated.domainId }
    });
    return decorateOwnedEntity("behavior", updated);
}
export function deleteBehavior(behaviorId, context) {
    const existing = getBehaviorById(behaviorId);
    if (!existing) {
        return undefined;
    }
    return runInTransaction(() => {
        removeIdFromStringArrayColumn("belief_entries", "linked_behavior_ids_json", behaviorId);
        removeIdFromStringArrayColumn("mode_profiles", "linked_behavior_ids_json", behaviorId);
        removeIdFromStringArrayColumn("trigger_reports", "linked_behavior_ids_json", behaviorId);
        nullifyTriggerBehaviorReferences(behaviorId);
        unlinkEntityNotes("behavior", behaviorId);
        clearEntityOwner("behavior", behaviorId);
        getDatabase()
            .prepare(`DELETE FROM psyche_behaviors WHERE id = ?`)
            .run(behaviorId);
        mapCreateUpdateContext({
            entityType: "behavior",
            entityId: behaviorId,
            title: "Behavior deleted",
            eventKind: "behavior.deleted",
            source: context.source,
            actor: context.actor ?? null,
            metadata: { kind: existing.kind, domainId: existing.domainId }
        });
        return existing;
    });
}
export function listBeliefEntries() {
    const rows = getDatabase()
        .prepare(`SELECT
         id, domain_id, schema_id, statement, belief_type, origin_note, confidence, evidence_for_json, evidence_against_json,
         flexible_alternative, linked_value_ids_json, linked_behavior_ids_json, linked_mode_ids_json, linked_report_ids_json,
         created_at, updated_at
       FROM belief_entries
       WHERE domain_id = ?
       ORDER BY updated_at DESC`)
        .all(PSYCHE_DOMAIN_ID);
    return filterDeletedEntities("belief_entry", rows.map(mapBeliefEntry));
}
export function getBeliefEntryById(beliefId) {
    if (isEntityDeleted("belief_entry", beliefId)) {
        return undefined;
    }
    const row = getRow(`SELECT
       id, domain_id, schema_id, statement, belief_type, origin_note, confidence, evidence_for_json, evidence_against_json,
       flexible_alternative, linked_value_ids_json, linked_behavior_ids_json, linked_mode_ids_json, linked_report_ids_json,
       created_at, updated_at
     FROM belief_entries
     WHERE id = ?`, beliefId);
    return row ? decorateOwnedEntity("belief_entry", mapBeliefEntry(row)) : undefined;
}
export function createBeliefEntry(input, context) {
    const parsed = createBeliefEntrySchema.parse(input);
    const now = new Date().toISOString();
    const belief = beliefEntrySchema.parse({
        id: buildId("blf"),
        domainId: PSYCHE_DOMAIN_ID,
        ...parsed,
        createdAt: now,
        updatedAt: now
    });
    getDatabase()
        .prepare(`INSERT INTO belief_entries (
        id, domain_id, schema_id, statement, belief_type, origin_note, confidence, evidence_for_json, evidence_against_json,
        flexible_alternative, linked_value_ids_json, linked_behavior_ids_json, linked_mode_ids_json, linked_report_ids_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(belief.id, belief.domainId, belief.schemaId, belief.statement, belief.beliefType, belief.originNote, belief.confidence, JSON.stringify(belief.evidenceFor), JSON.stringify(belief.evidenceAgainst), belief.flexibleAlternative, JSON.stringify(belief.linkedValueIds), JSON.stringify(belief.linkedBehaviorIds), JSON.stringify(belief.linkedModeIds), JSON.stringify(belief.linkedReportIds), belief.createdAt, belief.updatedAt);
    assignOwnedEntity("belief_entry", belief.id, parsed.userId, context.actor);
    mapCreateUpdateContext({
        entityType: "belief_entry",
        entityId: belief.id,
        title: "Belief captured",
        eventKind: "belief_entry.created",
        source: context.source,
        actor: context.actor ?? null,
        metadata: { schemaId: belief.schemaId ?? "" }
    });
    recordPsycheClarityReward("belief_entry", belief.id, belief.statement, "psyche_belief_captured", context);
    return decorateOwnedEntity("belief_entry", belief);
}
export function updateBeliefEntry(beliefId, patch, context) {
    const existing = getBeliefEntryById(beliefId);
    if (!existing) {
        return undefined;
    }
    const parsed = updateBeliefEntrySchema.parse(patch);
    const updated = beliefEntrySchema.parse({
        ...existing,
        ...parsed,
        updatedAt: new Date().toISOString()
    });
    getDatabase()
        .prepare(`UPDATE belief_entries
       SET schema_id = ?, statement = ?, belief_type = ?, origin_note = ?, confidence = ?, evidence_for_json = ?,
           evidence_against_json = ?, flexible_alternative = ?, linked_value_ids_json = ?, linked_behavior_ids_json = ?,
           linked_mode_ids_json = ?, linked_report_ids_json = ?, updated_at = ?
       WHERE id = ?`)
        .run(updated.schemaId, updated.statement, updated.beliefType, updated.originNote, updated.confidence, JSON.stringify(updated.evidenceFor), JSON.stringify(updated.evidenceAgainst), updated.flexibleAlternative, JSON.stringify(updated.linkedValueIds), JSON.stringify(updated.linkedBehaviorIds), JSON.stringify(updated.linkedModeIds), JSON.stringify(updated.linkedReportIds), updated.updatedAt, beliefId);
    if (parsed.userId !== undefined) {
        assignOwnedEntity("belief_entry", beliefId, parsed.userId, context.actor);
    }
    mapCreateUpdateContext({
        entityType: "belief_entry",
        entityId: beliefId,
        title: "Belief updated",
        eventKind: "belief_entry.updated",
        source: context.source,
        actor: context.actor ?? null,
        metadata: { schemaId: updated.schemaId ?? "" }
    });
    return decorateOwnedEntity("belief_entry", updated);
}
export function deleteBeliefEntry(beliefId, context) {
    const existing = getBeliefEntryById(beliefId);
    if (!existing) {
        return undefined;
    }
    return runInTransaction(() => {
        removeIdFromStringArrayColumn("behavior_patterns", "linked_belief_ids_json", beliefId);
        removeIdFromStringArrayColumn("trigger_reports", "linked_belief_ids_json", beliefId);
        nullifyTriggerThoughtBeliefReferences(beliefId);
        unlinkEntityNotes("belief_entry", beliefId);
        clearEntityOwner("belief_entry", beliefId);
        getDatabase()
            .prepare(`DELETE FROM belief_entries WHERE id = ?`)
            .run(beliefId);
        mapCreateUpdateContext({
            entityType: "belief_entry",
            entityId: beliefId,
            title: "Belief deleted",
            eventKind: "belief_entry.deleted",
            source: context.source,
            actor: context.actor ?? null,
            metadata: { schemaId: existing.schemaId ?? "" }
        });
        return existing;
    });
}
export function listModeProfiles() {
    const rows = getDatabase()
        .prepare(`SELECT
         id, domain_id, family, archetype, title, persona, imagery, symbolic_form, facial_expression, fear, burden, protective_job,
         origin_context, first_appearance_at, linked_pattern_ids_json, linked_behavior_ids_json, linked_value_ids_json, created_at, updated_at
       FROM mode_profiles
       WHERE domain_id = ?
       ORDER BY family, updated_at DESC`)
        .all(PSYCHE_DOMAIN_ID);
    return filterDeletedEntities("mode_profile", rows.map(mapModeProfile));
}
export function getModeProfileById(modeId) {
    if (isEntityDeleted("mode_profile", modeId)) {
        return undefined;
    }
    const row = getRow(`SELECT
       id, domain_id, family, archetype, title, persona, imagery, symbolic_form, facial_expression, fear, burden, protective_job,
       origin_context, first_appearance_at, linked_pattern_ids_json, linked_behavior_ids_json, linked_value_ids_json, created_at, updated_at
     FROM mode_profiles
     WHERE id = ?`, modeId);
    return row ? decorateOwnedEntity("mode_profile", mapModeProfile(row)) : undefined;
}
export function createModeProfile(input, context) {
    const parsed = createModeProfileSchema.parse(input);
    const now = new Date().toISOString();
    const mode = modeProfileSchema.parse({
        id: buildId("mod"),
        domainId: PSYCHE_DOMAIN_ID,
        ...parsed,
        createdAt: now,
        updatedAt: now
    });
    getDatabase()
        .prepare(`INSERT INTO mode_profiles (
        id, domain_id, family, archetype, title, persona, imagery, symbolic_form, facial_expression, fear, burden, protective_job,
        origin_context, first_appearance_at, linked_pattern_ids_json, linked_behavior_ids_json, linked_value_ids_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(mode.id, mode.domainId, mode.family, mode.archetype, mode.title, mode.persona, mode.imagery, mode.symbolicForm, mode.facialExpression, mode.fear, mode.burden, mode.protectiveJob, mode.originContext, mode.firstAppearanceAt, JSON.stringify(mode.linkedPatternIds), JSON.stringify(mode.linkedBehaviorIds), JSON.stringify(mode.linkedValueIds), mode.createdAt, mode.updatedAt);
    assignOwnedEntity("mode_profile", mode.id, parsed.userId, context.actor);
    mapCreateUpdateContext({
        entityType: "mode_profile",
        entityId: mode.id,
        title: "Mode profile added",
        eventKind: "mode_profile.created",
        source: context.source,
        actor: context.actor ?? null,
        metadata: { family: mode.family }
    });
    recordPsycheClarityReward("mode_profile", mode.id, mode.title, "psyche_mode_named", context);
    return decorateOwnedEntity("mode_profile", mode);
}
export function updateModeProfile(modeId, patch, context) {
    const existing = getModeProfileById(modeId);
    if (!existing) {
        return undefined;
    }
    const parsed = updateModeProfileSchema.parse(patch);
    if (parsed.family) {
        modeFamilySchema.parse(parsed.family);
    }
    const updated = modeProfileSchema.parse({
        ...existing,
        ...parsed,
        updatedAt: new Date().toISOString()
    });
    getDatabase()
        .prepare(`UPDATE mode_profiles
       SET family = ?, archetype = ?, title = ?, persona = ?, imagery = ?, symbolic_form = ?, facial_expression = ?, fear = ?,
           burden = ?, protective_job = ?, origin_context = ?, first_appearance_at = ?, linked_pattern_ids_json = ?,
           linked_behavior_ids_json = ?, linked_value_ids_json = ?, updated_at = ?
       WHERE id = ?`)
        .run(updated.family, updated.archetype, updated.title, updated.persona, updated.imagery, updated.symbolicForm, updated.facialExpression, updated.fear, updated.burden, updated.protectiveJob, updated.originContext, updated.firstAppearanceAt, JSON.stringify(updated.linkedPatternIds), JSON.stringify(updated.linkedBehaviorIds), JSON.stringify(updated.linkedValueIds), updated.updatedAt, modeId);
    if (parsed.userId !== undefined) {
        assignOwnedEntity("mode_profile", modeId, parsed.userId, context.actor);
    }
    mapCreateUpdateContext({
        entityType: "mode_profile",
        entityId: modeId,
        title: "Mode profile updated",
        eventKind: "mode_profile.updated",
        source: context.source,
        actor: context.actor ?? null,
        metadata: { family: updated.family }
    });
    return decorateOwnedEntity("mode_profile", updated);
}
export function deleteModeProfile(modeId, context) {
    const existing = getModeProfileById(modeId);
    if (!existing) {
        return undefined;
    }
    return runInTransaction(() => {
        removeIdFromStringArrayColumn("behavior_patterns", "linked_mode_ids_json", modeId);
        removeIdFromStringArrayColumn("psyche_behaviors", "linked_mode_ids_json", modeId);
        removeIdFromStringArrayColumn("belief_entries", "linked_mode_ids_json", modeId);
        removeIdFromStringArrayColumn("trigger_reports", "linked_mode_ids_json", modeId);
        nullifyTriggerTimelineModeReferences(modeId);
        unlinkEntityNotes("mode_profile", modeId);
        clearEntityOwner("mode_profile", modeId);
        getDatabase()
            .prepare(`DELETE FROM mode_profiles WHERE id = ?`)
            .run(modeId);
        mapCreateUpdateContext({
            entityType: "mode_profile",
            entityId: modeId,
            title: "Mode profile deleted",
            eventKind: "mode_profile.deleted",
            source: context.source,
            actor: context.actor ?? null,
            metadata: { family: existing.family }
        });
        return existing;
    });
}
export function listModeGuideSessions(limit = 20) {
    const rows = getDatabase()
        .prepare(`SELECT id, summary, answers_json, results_json, created_at, updated_at
       FROM mode_guide_sessions
       ORDER BY created_at DESC
       LIMIT ?`)
        .all(limit);
    return filterDeletedEntities("mode_guide_session", rows.map(mapModeGuideSession));
}
export function getModeGuideSessionById(sessionId) {
    if (isEntityDeleted("mode_guide_session", sessionId)) {
        return undefined;
    }
    const row = getRow(`SELECT id, summary, answers_json, results_json, created_at, updated_at
     FROM mode_guide_sessions
     WHERE id = ?`, sessionId);
    return row
        ? decorateOwnedEntity("mode_guide_session", mapModeGuideSession(row))
        : undefined;
}
export function createModeGuideSession(input, context) {
    const parsed = createModeGuideSessionSchema.parse(input);
    const now = new Date().toISOString();
    const session = modeGuideSessionSchema.parse({
        id: buildId("mgs"),
        summary: parsed.summary,
        answers: parsed.answers,
        results: scoreModeGuideSession(parsed),
        createdAt: now,
        updatedAt: now
    });
    getDatabase()
        .prepare(`INSERT INTO mode_guide_sessions (id, summary, answers_json, results_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`)
        .run(session.id, session.summary, JSON.stringify(session.answers), JSON.stringify(session.results), session.createdAt, session.updatedAt);
    assignOwnedEntity("mode_guide_session", session.id, parsed.userId, context.actor);
    recordEventLog({
        eventKind: "mode_guide_session.created",
        entityType: "system",
        entityId: session.id,
        actor: context.actor ?? null,
        source: context.source,
        metadata: { summary: session.summary }
    });
    return decorateOwnedEntity("mode_guide_session", session);
}
export function updateModeGuideSession(sessionId, patch, context) {
    const existing = getModeGuideSessionById(sessionId);
    if (!existing) {
        return undefined;
    }
    const parsed = updateModeGuideSessionSchema.parse(patch);
    const summary = parsed.summary ?? existing.summary;
    const answers = parsed.answers ?? existing.answers;
    const updated = modeGuideSessionSchema.parse({
        ...existing,
        summary,
        answers,
        results: scoreModeGuideSession({ summary, answers }),
        updatedAt: new Date().toISOString()
    });
    getDatabase()
        .prepare(`UPDATE mode_guide_sessions
       SET summary = ?, answers_json = ?, results_json = ?, updated_at = ?
       WHERE id = ?`)
        .run(updated.summary, JSON.stringify(updated.answers), JSON.stringify(updated.results), updated.updatedAt, sessionId);
    if (parsed.userId !== undefined) {
        assignOwnedEntity("mode_guide_session", sessionId, parsed.userId, context.actor);
    }
    recordEventLog({
        eventKind: "mode_guide_session.updated",
        entityType: "system",
        entityId: sessionId,
        actor: context.actor ?? null,
        source: context.source,
        metadata: { summary: updated.summary }
    });
    return decorateOwnedEntity("mode_guide_session", updated);
}
export function deleteModeGuideSession(sessionId, context) {
    const existing = getModeGuideSessionById(sessionId);
    if (!existing) {
        return undefined;
    }
    return runInTransaction(() => {
        clearEntityOwner("mode_guide_session", sessionId);
        getDatabase()
            .prepare(`DELETE FROM mode_guide_sessions WHERE id = ?`)
            .run(sessionId);
        recordEventLog({
            eventKind: "mode_guide_session.deleted",
            entityType: "system",
            entityId: sessionId,
            actor: context.actor ?? null,
            source: context.source,
            metadata: { summary: existing.summary }
        });
        return existing;
    });
}
export function listTriggerReports(limit) {
    const limitSql = limit ? "LIMIT ?" : "";
    const rows = getDatabase()
        .prepare(`SELECT
         id, domain_id, title, status, event_type_id, custom_event_type, event_situation, occurred_at, emotions_json, thoughts_json,
         behaviors_json, consequences_json, linked_pattern_ids_json, linked_value_ids_json, linked_goal_ids_json, linked_project_ids_json,
         linked_task_ids_json, linked_behavior_ids_json, linked_belief_ids_json, linked_mode_ids_json, mode_overlays_json,
         schema_links_json, mode_timeline_json, next_moves_json, created_at, updated_at
       FROM trigger_reports
       WHERE domain_id = ?
       ORDER BY updated_at DESC
       ${limitSql}`)
        .all(...(limit ? [PSYCHE_DOMAIN_ID, limit] : [PSYCHE_DOMAIN_ID]));
    return filterDeletedEntities("trigger_report", rows.map(mapTriggerReport));
}
export function getTriggerReportById(reportId) {
    if (isEntityDeleted("trigger_report", reportId)) {
        return undefined;
    }
    const row = getRow(`SELECT
       id, domain_id, title, status, event_type_id, custom_event_type, event_situation, occurred_at, emotions_json, thoughts_json,
       behaviors_json, consequences_json, linked_pattern_ids_json, linked_value_ids_json, linked_goal_ids_json, linked_project_ids_json,
       linked_task_ids_json, linked_behavior_ids_json, linked_belief_ids_json, linked_mode_ids_json, mode_overlays_json,
       schema_links_json, mode_timeline_json, next_moves_json, created_at, updated_at
     FROM trigger_reports
     WHERE id = ?`, reportId);
    return row
        ? decorateOwnedEntity("trigger_report", mapTriggerReport(row))
        : undefined;
}
export function createTriggerReport(input, context) {
    const parsed = createTriggerReportSchema.parse(input);
    const now = new Date().toISOString();
    const report = triggerReportSchema.parse({
        id: buildId("trg"),
        domainId: PSYCHE_DOMAIN_ID,
        title: parsed.title,
        status: parsed.status,
        eventTypeId: parsed.eventTypeId,
        customEventType: parsed.customEventType,
        eventSituation: parsed.eventSituation,
        occurredAt: parsed.occurredAt,
        emotions: enrichTriggerItems(parsed.emotions, "emo"),
        thoughts: enrichTriggerItems(parsed.thoughts, "tht"),
        behaviors: enrichTriggerItems(parsed.behaviors, "beh"),
        consequences: parsed.consequences,
        linkedPatternIds: parsed.linkedPatternIds,
        linkedValueIds: parsed.linkedValueIds,
        linkedGoalIds: parsed.linkedGoalIds,
        linkedProjectIds: parsed.linkedProjectIds,
        linkedTaskIds: parsed.linkedTaskIds,
        linkedBehaviorIds: parsed.linkedBehaviorIds,
        linkedBeliefIds: parsed.linkedBeliefIds,
        linkedModeIds: parsed.linkedModeIds,
        modeOverlays: parsed.modeOverlays,
        schemaLinks: parsed.schemaLinks,
        modeTimeline: enrichTriggerItems(parsed.modeTimeline, "mdl").map((entry) => modeTimelineEntrySchema.parse(entry)),
        nextMoves: parsed.nextMoves,
        createdAt: now,
        updatedAt: now
    });
    getDatabase()
        .prepare(`INSERT INTO trigger_reports (
        id, domain_id, title, status, event_type_id, custom_event_type, event_situation, occurred_at, emotions_json, thoughts_json, behaviors_json, consequences_json,
        linked_pattern_ids_json, linked_value_ids_json, linked_goal_ids_json, linked_project_ids_json, linked_task_ids_json,
        linked_behavior_ids_json, linked_belief_ids_json, linked_mode_ids_json, mode_overlays_json, schema_links_json, mode_timeline_json,
        next_moves_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(report.id, report.domainId, report.title, report.status, report.eventTypeId, report.customEventType, report.eventSituation, report.occurredAt, JSON.stringify(report.emotions), JSON.stringify(report.thoughts), JSON.stringify(report.behaviors), JSON.stringify(report.consequences), JSON.stringify(report.linkedPatternIds), JSON.stringify(report.linkedValueIds), JSON.stringify(report.linkedGoalIds), JSON.stringify(report.linkedProjectIds), JSON.stringify(report.linkedTaskIds), JSON.stringify(report.linkedBehaviorIds), JSON.stringify(report.linkedBeliefIds), JSON.stringify(report.linkedModeIds), JSON.stringify(report.modeOverlays), JSON.stringify(report.schemaLinks), JSON.stringify(report.modeTimeline), JSON.stringify(report.nextMoves), report.createdAt, report.updatedAt);
    assignOwnedEntity("trigger_report", report.id, parsed.userId, context.actor);
    mapCreateUpdateContext({
        entityType: "trigger_report",
        entityId: report.id,
        title: "Trigger report captured",
        eventKind: "trigger_report.created",
        source: context.source,
        actor: context.actor ?? null,
        metadata: {
            domainId: report.domainId,
            status: report.status
        }
    });
    recordPsycheReflectionReward(report.id, report.title, { actor: context.actor ?? null, source: context.source });
    return decorateOwnedEntity("trigger_report", report);
}
export function updateTriggerReport(reportId, patch, context) {
    const existing = getTriggerReportById(reportId);
    if (!existing) {
        return undefined;
    }
    const parsed = updateTriggerReportSchema.parse(patch);
    const updated = triggerReportSchema.parse({
        ...existing,
        ...parsed,
        emotions: parsed.emotions ? enrichTriggerItems(parsed.emotions, "emo") : existing.emotions,
        thoughts: parsed.thoughts ? enrichTriggerItems(parsed.thoughts, "tht") : existing.thoughts,
        behaviors: parsed.behaviors ? enrichTriggerItems(parsed.behaviors, "beh") : existing.behaviors,
        modeTimeline: parsed.modeTimeline
            ? enrichTriggerItems(parsed.modeTimeline, "mdl").map((entry) => modeTimelineEntrySchema.parse(entry))
            : existing.modeTimeline,
        updatedAt: new Date().toISOString()
    });
    getDatabase()
        .prepare(`UPDATE trigger_reports
       SET title = ?, status = ?, event_type_id = ?, custom_event_type = ?, event_situation = ?, occurred_at = ?, emotions_json = ?, thoughts_json = ?, behaviors_json = ?,
           consequences_json = ?, linked_pattern_ids_json = ?, linked_value_ids_json = ?, linked_goal_ids_json = ?, linked_project_ids_json = ?, linked_task_ids_json = ?,
           linked_behavior_ids_json = ?, linked_belief_ids_json = ?, linked_mode_ids_json = ?, mode_overlays_json = ?, schema_links_json = ?, mode_timeline_json = ?,
           next_moves_json = ?, updated_at = ?
       WHERE id = ?`)
        .run(updated.title, updated.status, updated.eventTypeId, updated.customEventType, updated.eventSituation, updated.occurredAt, JSON.stringify(updated.emotions), JSON.stringify(updated.thoughts), JSON.stringify(updated.behaviors), JSON.stringify(updated.consequences), JSON.stringify(updated.linkedPatternIds), JSON.stringify(updated.linkedValueIds), JSON.stringify(updated.linkedGoalIds), JSON.stringify(updated.linkedProjectIds), JSON.stringify(updated.linkedTaskIds), JSON.stringify(updated.linkedBehaviorIds), JSON.stringify(updated.linkedBeliefIds), JSON.stringify(updated.linkedModeIds), JSON.stringify(updated.modeOverlays), JSON.stringify(updated.schemaLinks), JSON.stringify(updated.modeTimeline), JSON.stringify(updated.nextMoves), updated.updatedAt, reportId);
    if (parsed.userId !== undefined) {
        assignOwnedEntity("trigger_report", reportId, parsed.userId, context.actor);
    }
    mapCreateUpdateContext({
        entityType: "trigger_report",
        entityId: reportId,
        title: "Trigger report updated",
        eventKind: "trigger_report.updated",
        source: context.source,
        actor: context.actor ?? null,
        metadata: { status: updated.status }
    });
    return decorateOwnedEntity("trigger_report", updated);
}
export function deleteTriggerReport(reportId, context) {
    const existing = getTriggerReportById(reportId);
    if (!existing) {
        return undefined;
    }
    return runInTransaction(() => {
        removeIdFromStringArrayColumn("belief_entries", "linked_report_ids_json", reportId);
        unlinkEntityNotes("trigger_report", reportId);
        clearEntityOwner("trigger_report", reportId);
        getDatabase()
            .prepare(`DELETE FROM trigger_reports WHERE id = ?`)
            .run(reportId);
        mapCreateUpdateContext({
            entityType: "trigger_report",
            entityId: reportId,
            title: "Trigger report deleted",
            eventKind: "trigger_report.deleted",
            source: context.source,
            actor: context.actor ?? null,
            metadata: { status: existing.status }
        });
        return existing;
    });
}
