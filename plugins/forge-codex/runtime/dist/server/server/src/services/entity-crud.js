import { z, ZodError } from "zod";
import { getDatabase, runInTransaction } from "../db.js";
import { createSleepSession, createSleepSessionSchema, createWorkoutSession, createWorkoutSessionSchema, deleteSleepSession, deleteWorkoutSession, getSleepSessionById, getWorkoutSessionById, listSleepSessions, listWorkoutSessions, updateSleepSession, updateSleepSessionSchema, updateWorkoutSession, updateWorkoutSessionSchema } from "../health.js";
import { createInsight, deleteInsight, getInsightById, listInsights, updateInsight } from "../repositories/collaboration.js";
import { createCalendarEvent, createTaskTimebox, createWorkBlockTemplate, deleteCalendarEvent, deleteTaskTimebox, deleteWorkBlockTemplate, getCalendarEventById, getTaskTimeboxById, getWorkBlockTemplateById, listCalendarEvents, listTaskTimeboxes, listWorkBlockTemplates, updateCalendarEvent, updateTaskTimebox, updateWorkBlockTemplate } from "../repositories/calendar.js";
import { createNote, deleteNote, getNoteById, listNotes, unlinkNotesForEntity, updateNote } from "../repositories/notes.js";
import { clearEntityOwner, filterOwnedEntities } from "../repositories/entity-ownership.js";
import { createPreferenceCatalog, createPreferenceCatalogItem, createPreferenceContext, createPreferenceItem, deletePreferenceCatalog, deletePreferenceCatalogItem, deletePreferenceContext, deletePreferenceItem, getPreferenceCatalogById, getPreferenceCatalogItemById, getPreferenceContextById, getPreferenceItemById, listPreferenceCatalogItems, listPreferenceCatalogs, listPreferenceContexts, listPreferenceItems, updatePreferenceCatalog, updatePreferenceCatalogItem, updatePreferenceContext, updatePreferenceItem } from "../repositories/preferences.js";
import { createBehaviorPatternSchema, createBehaviorSchema, createBeliefEntrySchema, createEmotionDefinitionSchema, createEventTypeSchema, createModeGuideSessionSchema, createModeProfileSchema, createPsycheValueSchema, createTriggerReportSchema, updateBehaviorPatternSchema, updateBehaviorSchema, updateBeliefEntrySchema, updateEmotionDefinitionSchema, updateEventTypeSchema, updateModeGuideSessionSchema, updateModeProfileSchema, updatePsycheValueSchema, updateTriggerReportSchema } from "../psyche-types.js";
import { buildSettingsBinPayload, cascadeSoftDeleteAnchoredCollaboration, clearDeletedEntityRecord, getDeletedEntityRecord, listDeletedEntities, restoreAnchoredCollaboration, restoreDeletedEntityRecord, upsertDeletedEntityRecord } from "../repositories/deleted-entities.js";
import { createGoal, deleteGoal, getGoalById, listGoals, updateGoal } from "../repositories/goals.js";
import { createHabit, deleteHabit, getHabitById, listHabits, updateHabit } from "../repositories/habits.js";
import { createQuestionnaireInstrument, deleteQuestionnaireInstrument, getQuestionnaireInstrumentEntityById, listQuestionnaireInstrumentEntities, updateQuestionnaireInstrument, updateQuestionnaireInstrumentSchema } from "../repositories/questionnaires.js";
import { createBehavior, createBehaviorPattern, createBeliefEntry, createEmotionDefinition, createEventType, createModeGuideSession, createModeProfile, createPsycheValue, createTriggerReport, deleteBehavior, deleteBehaviorPattern, deleteBeliefEntry, deleteEmotionDefinition, deleteEventType, deleteModeGuideSession, deleteModeProfile, deletePsycheValue, deleteTriggerReport, getBehaviorById, getBehaviorPatternById, getBeliefEntryById, getEmotionDefinitionById, getEventTypeById, getModeGuideSessionById, getModeProfileById, getPsycheValueById, getTriggerReportById, listBehaviors, listBehaviorPatterns, listBeliefEntries, listEmotionDefinitions, listEventTypes, listModeGuideSessions, listModeProfiles, listPsycheValues, listTriggerReports, updateBehavior, updateBehaviorPattern, updateBeliefEntry, updateEmotionDefinition, updateEventType, updateModeGuideSession, updateModeProfile, updatePsycheValue, updateTriggerReport } from "../repositories/psyche.js";
import { createProject, deleteProject, getProjectById, listProjects, updateProject } from "../repositories/projects.js";
import { createStrategy, deleteStrategy, getStrategyById, listStrategies, updateStrategy } from "../repositories/strategies.js";
import { createTag, deleteTag, getTagById, listTags, updateTag } from "../repositories/tags.js";
import { createTask, deleteTask, getTaskById, listTasks, updateTask } from "../repositories/tasks.js";
import { createCalendarEventSchema, createGoalSchema, createHabitSchema, createInsightSchema, createNoteSchema, createProjectSchema, createStrategySchema, createTaskTimeboxSchema, createTagSchema, createTaskSchema, createWorkBlockTemplateSchema, updateCalendarEventSchema, updateGoalSchema, updateHabitSchema, updateInsightSchema, updateNoteSchema, updateProjectSchema, updateStrategySchema, updateTaskTimeboxSchema, updateTagSchema, updateTaskSchema, updateWorkBlockTemplateSchema } from "../types.js";
import { createPreferenceCatalogItemSchema, createPreferenceCatalogSchema, createPreferenceContextSchema, createPreferenceItemSchema, updatePreferenceCatalogItemSchema, updatePreferenceCatalogSchema, updatePreferenceContextSchema, updatePreferenceItemSchema } from "../preferences-types.js";
import { createQuestionnaireInstrumentSchema } from "../questionnaire-types.js";
const ENTITY_CALENDAR_LIST_RANGE = {
    from: "1970-01-01T00:00:00.000Z",
    to: "2100-01-01T00:00:00.000Z"
};
class AtomicBatchRollback extends Error {
    index;
    code;
    messageText;
    constructor(index, code, messageText) {
        super(messageText);
        this.index = index;
        this.code = code;
        this.messageText = messageText;
        this.name = "AtomicBatchRollback";
    }
}
const CRUD_ENTITY_CAPABILITIES = {
    goal: {
        entityType: "goal",
        routeBase: "/api/v1/goals",
        deleteMode: "soft_default",
        inBin: true,
        list: () => listGoals(),
        get: (id) => getGoalById(id),
        create: (data, context) => createGoal(data, context),
        update: (id, patch, context) => updateGoal(id, patch, context),
        hardDelete: (id, context) => deleteGoal(id, context)
    },
    project: {
        entityType: "project",
        routeBase: "/api/v1/projects",
        deleteMode: "soft_default",
        inBin: true,
        list: () => listProjects(),
        get: (id) => getProjectById(id),
        create: (data, context) => createProject(data, context),
        update: (id, patch, context) => updateProject(id, patch, context),
        hardDelete: (id, context) => deleteProject(id, context)
    },
    task: {
        entityType: "task",
        routeBase: "/api/v1/tasks",
        deleteMode: "soft_default",
        inBin: true,
        list: () => listTasks(),
        get: (id) => getTaskById(id),
        create: (data, context) => createTask(data, context),
        update: (id, patch, context) => updateTask(id, patch, context),
        hardDelete: (id, context) => deleteTask(id, context)
    },
    strategy: {
        entityType: "strategy",
        routeBase: "/api/v1/strategies",
        deleteMode: "soft_default",
        inBin: true,
        list: () => listStrategies(),
        get: (id) => getStrategyById(id),
        create: (data) => createStrategy(data),
        update: (id, patch) => updateStrategy(id, patch),
        hardDelete: (id) => deleteStrategy(id)
    },
    habit: {
        entityType: "habit",
        routeBase: "/api/v1/habits",
        deleteMode: "soft_default",
        inBin: true,
        list: () => listHabits(),
        get: (id) => getHabitById(id),
        create: (data, context) => createHabit(data, context),
        update: (id, patch, context) => updateHabit(id, patch, context),
        hardDelete: (id, context) => deleteHabit(id, context)
    },
    tag: {
        entityType: "tag",
        routeBase: "/api/v1/tags",
        deleteMode: "soft_default",
        inBin: true,
        list: () => listTags(),
        get: (id) => getTagById(id),
        create: (data, context) => createTag(data, context),
        update: (id, patch, context) => updateTag(id, patch, context),
        hardDelete: (id, context) => deleteTag(id, context)
    },
    note: {
        entityType: "note",
        routeBase: "/api/v1/notes",
        deleteMode: "soft_default",
        inBin: true,
        list: () => listNotes(),
        get: (id) => getNoteById(id),
        create: (data, context) => createNote(data, context),
        update: (id, patch, context) => updateNote(id, patch, context),
        hardDelete: (id, context) => deleteNote(id, context)
    },
    insight: {
        entityType: "insight",
        routeBase: "/api/v1/insights",
        deleteMode: "soft_default",
        inBin: true,
        list: () => listInsights(),
        get: (id) => getInsightById(id),
        create: (data, context) => createInsight(data, context),
        update: (id, patch, context) => updateInsight(id, patch, context),
        hardDelete: (id, context) => deleteInsight(id, context)
    },
    calendar_event: {
        entityType: "calendar_event",
        routeBase: "/api/v1/calendar/events",
        deleteMode: "immediate",
        inBin: false,
        list: () => listCalendarEvents(ENTITY_CALENDAR_LIST_RANGE),
        get: (id) => getCalendarEventById(id),
        create: (data) => createCalendarEvent(data),
        update: (id, patch) => updateCalendarEvent(id, patch),
        hardDelete: (id) => deleteCalendarEvent(id)
    },
    work_block_template: {
        entityType: "work_block_template",
        routeBase: "/api/v1/calendar/work-block-templates",
        deleteMode: "immediate",
        inBin: false,
        list: () => listWorkBlockTemplates(),
        get: (id) => getWorkBlockTemplateById(id),
        create: (data) => createWorkBlockTemplate(data),
        update: (id, patch) => updateWorkBlockTemplate(id, patch),
        hardDelete: (id) => deleteWorkBlockTemplate(id)
    },
    task_timebox: {
        entityType: "task_timebox",
        routeBase: "/api/v1/calendar/timeboxes",
        deleteMode: "immediate",
        inBin: false,
        list: () => listTaskTimeboxes(ENTITY_CALENDAR_LIST_RANGE),
        get: (id) => getTaskTimeboxById(id),
        create: (data) => createTaskTimebox(data),
        update: (id, patch) => updateTaskTimebox(id, patch),
        hardDelete: (id) => deleteTaskTimebox(id)
    },
    sleep_session: {
        entityType: "sleep_session",
        routeBase: "/api/v1/health/sleep",
        deleteMode: "immediate",
        inBin: false,
        list: () => listSleepSessions(),
        get: (id) => getSleepSessionById(id),
        create: (data, context) => createSleepSession(data, context),
        update: (id, patch, context) => updateSleepSession(id, patch, context),
        hardDelete: (id, context) => deleteSleepSession(id, context)
    },
    workout_session: {
        entityType: "workout_session",
        routeBase: "/api/v1/health/workouts",
        deleteMode: "immediate",
        inBin: false,
        list: () => listWorkoutSessions(),
        get: (id) => getWorkoutSessionById(id),
        create: (data, context) => createWorkoutSession(data, context),
        update: (id, patch, context) => updateWorkoutSession(id, patch, context),
        hardDelete: (id, context) => deleteWorkoutSession(id, context)
    },
    psyche_value: {
        entityType: "psyche_value",
        routeBase: "/api/v1/psyche/values",
        deleteMode: "soft_default",
        inBin: true,
        list: () => listPsycheValues(),
        get: (id) => getPsycheValueById(id),
        create: (data, context) => createPsycheValue(data, context),
        update: (id, patch, context) => updatePsycheValue(id, patch, context),
        hardDelete: (id, context) => deletePsycheValue(id, context)
    },
    behavior_pattern: {
        entityType: "behavior_pattern",
        routeBase: "/api/v1/psyche/patterns",
        deleteMode: "soft_default",
        inBin: true,
        list: () => listBehaviorPatterns(),
        get: (id) => getBehaviorPatternById(id),
        create: (data, context) => createBehaviorPattern(data, context),
        update: (id, patch, context) => updateBehaviorPattern(id, patch, context),
        hardDelete: (id, context) => deleteBehaviorPattern(id, context)
    },
    behavior: {
        entityType: "behavior",
        routeBase: "/api/v1/psyche/behaviors",
        deleteMode: "soft_default",
        inBin: true,
        list: () => listBehaviors(),
        get: (id) => getBehaviorById(id),
        create: (data, context) => createBehavior(data, context),
        update: (id, patch, context) => updateBehavior(id, patch, context),
        hardDelete: (id, context) => deleteBehavior(id, context)
    },
    belief_entry: {
        entityType: "belief_entry",
        routeBase: "/api/v1/psyche/beliefs",
        deleteMode: "soft_default",
        inBin: true,
        list: () => listBeliefEntries(),
        get: (id) => getBeliefEntryById(id),
        create: (data, context) => createBeliefEntry(data, context),
        update: (id, patch, context) => updateBeliefEntry(id, patch, context),
        hardDelete: (id, context) => deleteBeliefEntry(id, context)
    },
    mode_profile: {
        entityType: "mode_profile",
        routeBase: "/api/v1/psyche/modes",
        deleteMode: "soft_default",
        inBin: true,
        list: () => listModeProfiles(),
        get: (id) => getModeProfileById(id),
        create: (data, context) => createModeProfile(data, context),
        update: (id, patch, context) => updateModeProfile(id, patch, context),
        hardDelete: (id, context) => deleteModeProfile(id, context)
    },
    mode_guide_session: {
        entityType: "mode_guide_session",
        routeBase: "/api/v1/psyche/mode-guides",
        deleteMode: "soft_default",
        inBin: true,
        list: () => listModeGuideSessions(200),
        get: (id) => getModeGuideSessionById(id),
        create: (data, context) => createModeGuideSession(data, context),
        update: (id, patch, context) => updateModeGuideSession(id, patch, context),
        hardDelete: (id, context) => deleteModeGuideSession(id, context)
    },
    event_type: {
        entityType: "event_type",
        routeBase: "/api/v1/psyche/event-types",
        deleteMode: "soft_default",
        inBin: true,
        list: () => listEventTypes(),
        get: (id) => getEventTypeById(id),
        create: (data, context) => createEventType(data, context),
        update: (id, patch, context) => updateEventType(id, patch, context),
        hardDelete: (id, context) => deleteEventType(id, context)
    },
    emotion_definition: {
        entityType: "emotion_definition",
        routeBase: "/api/v1/psyche/emotions",
        deleteMode: "soft_default",
        inBin: true,
        list: () => listEmotionDefinitions(),
        get: (id) => getEmotionDefinitionById(id),
        create: (data, context) => createEmotionDefinition(data, context),
        update: (id, patch, context) => updateEmotionDefinition(id, patch, context),
        hardDelete: (id, context) => deleteEmotionDefinition(id, context)
    },
    trigger_report: {
        entityType: "trigger_report",
        routeBase: "/api/v1/psyche/reports",
        deleteMode: "soft_default",
        inBin: true,
        list: () => listTriggerReports(200),
        get: (id) => getTriggerReportById(id),
        create: (data, context) => createTriggerReport(data, context),
        update: (id, patch, context) => updateTriggerReport(id, patch, context),
        hardDelete: (id, context) => deleteTriggerReport(id, context)
    },
    preference_catalog: {
        entityType: "preference_catalog",
        routeBase: "/api/v1/preferences/catalogs",
        deleteMode: "immediate",
        inBin: false,
        list: () => listPreferenceCatalogs(),
        get: (id) => getPreferenceCatalogById(id),
        create: (data) => createPreferenceCatalog(data),
        update: (id, patch) => updatePreferenceCatalog(id, patch),
        hardDelete: (id) => deletePreferenceCatalog(id)
    },
    preference_catalog_item: {
        entityType: "preference_catalog_item",
        routeBase: "/api/v1/preferences/catalog-items",
        deleteMode: "immediate",
        inBin: false,
        list: () => listPreferenceCatalogItems(),
        get: (id) => getPreferenceCatalogItemById(id),
        create: (data) => createPreferenceCatalogItem(data),
        update: (id, patch) => updatePreferenceCatalogItem(id, patch),
        hardDelete: (id) => deletePreferenceCatalogItem(id)
    },
    preference_context: {
        entityType: "preference_context",
        routeBase: "/api/v1/preferences/contexts",
        deleteMode: "immediate",
        inBin: false,
        list: () => listPreferenceContexts(),
        get: (id) => getPreferenceContextById(id),
        create: (data) => createPreferenceContext(data),
        update: (id, patch) => updatePreferenceContext(id, patch),
        hardDelete: (id) => deletePreferenceContext(id)
    },
    preference_item: {
        entityType: "preference_item",
        routeBase: "/api/v1/preferences/items",
        deleteMode: "immediate",
        inBin: false,
        list: () => listPreferenceItems(),
        get: (id) => getPreferenceItemById(id),
        create: (data) => createPreferenceItem(data),
        update: (id, patch) => updatePreferenceItem(id, patch),
        hardDelete: (id) => deletePreferenceItem(id)
    },
    questionnaire_instrument: {
        entityType: "questionnaire_instrument",
        routeBase: "/api/v1/psyche/questionnaires",
        deleteMode: "immediate",
        inBin: false,
        list: () => listQuestionnaireInstrumentEntities(),
        get: (id) => getQuestionnaireInstrumentEntityById(id),
        create: (data, context) => createQuestionnaireInstrument(data, context)
            .instrument,
        update: (id, patch, context) => updateQuestionnaireInstrument(id, patch, context),
        hardDelete: (id, context) => deleteQuestionnaireInstrument(id, context)
    }
};
export function getCrudEntityCapabilityMatrix() {
    return Object.values(CRUD_ENTITY_CAPABILITIES).map((capability) => ({
        entityType: capability.entityType,
        routeBase: capability.routeBase,
        pluginExposed: true,
        deleteMode: capability.deleteMode,
        inBin: capability.inBin
    }));
}
function getCapability(entityType) {
    return CRUD_ENTITY_CAPABILITIES[entityType];
}
const CREATE_ENTITY_SCHEMAS = {
    goal: createGoalSchema,
    project: createProjectSchema,
    task: createTaskSchema,
    strategy: createStrategySchema,
    habit: createHabitSchema,
    tag: createTagSchema,
    note: createNoteSchema,
    insight: createInsightSchema,
    calendar_event: createCalendarEventSchema,
    work_block_template: createWorkBlockTemplateSchema,
    task_timebox: createTaskTimeboxSchema,
    sleep_session: createSleepSessionSchema,
    workout_session: createWorkoutSessionSchema,
    psyche_value: createPsycheValueSchema,
    behavior_pattern: createBehaviorPatternSchema,
    behavior: createBehaviorSchema,
    belief_entry: createBeliefEntrySchema,
    mode_profile: createModeProfileSchema,
    mode_guide_session: createModeGuideSessionSchema,
    event_type: createEventTypeSchema,
    emotion_definition: createEmotionDefinitionSchema,
    trigger_report: createTriggerReportSchema,
    preference_catalog: createPreferenceCatalogSchema,
    preference_catalog_item: createPreferenceCatalogItemSchema,
    preference_context: createPreferenceContextSchema,
    preference_item: createPreferenceItemSchema,
    questionnaire_instrument: createQuestionnaireInstrumentSchema
};
const UPDATE_ENTITY_SCHEMAS = {
    goal: updateGoalSchema,
    project: updateProjectSchema,
    task: updateTaskSchema,
    strategy: updateStrategySchema,
    habit: updateHabitSchema,
    tag: updateTagSchema,
    note: updateNoteSchema,
    insight: updateInsightSchema,
    calendar_event: updateCalendarEventSchema,
    work_block_template: updateWorkBlockTemplateSchema,
    task_timebox: updateTaskTimeboxSchema,
    sleep_session: updateSleepSessionSchema,
    workout_session: updateWorkoutSessionSchema,
    psyche_value: updatePsycheValueSchema,
    behavior_pattern: updateBehaviorPatternSchema,
    behavior: updateBehaviorSchema,
    belief_entry: updateBeliefEntrySchema,
    mode_profile: updateModeProfileSchema,
    mode_guide_session: updateModeGuideSessionSchema,
    event_type: updateEventTypeSchema,
    emotion_definition: updateEmotionDefinitionSchema,
    trigger_report: updateTriggerReportSchema,
    preference_catalog: updatePreferenceCatalogSchema,
    preference_catalog_item: updatePreferenceCatalogItemSchema,
    preference_context: updatePreferenceContextSchema,
    preference_item: updatePreferenceItemSchema,
    questionnaire_instrument: updateQuestionnaireInstrumentSchema
};
function getCreateSchema(entityType) {
    return CREATE_ENTITY_SCHEMAS[entityType];
}
function getUpdateSchema(entityType) {
    return UPDATE_ENTITY_SCHEMAS[entityType];
}
function unwrapSchema(schema) {
    if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
        return unwrapSchema(schema.unwrap());
    }
    if (schema instanceof z.ZodDefault) {
        return unwrapSchema(schema.removeDefault());
    }
    if (schema instanceof z.ZodEffects) {
        return unwrapSchema(schema.innerType());
    }
    return schema;
}
function isRequiredField(schema) {
    if (schema instanceof z.ZodOptional) {
        return false;
    }
    if (schema instanceof z.ZodDefault) {
        return false;
    }
    return true;
}
function collectRequiredTopLevelFields(schema) {
    const unwrapped = unwrapSchema(schema);
    if (!(unwrapped instanceof z.ZodObject)) {
        return [];
    }
    return Object.entries(unwrapped.shape)
        .filter(([, fieldSchema]) => isRequiredField(fieldSchema))
        .map(([key]) => key)
        .sort();
}
function extractAllowedTopLevelFields(schema) {
    const unwrapped = unwrapSchema(schema);
    if (!(unwrapped instanceof z.ZodObject)) {
        return [];
    }
    return Object.keys(unwrapped.shape).sort();
}
function buildExampleValue(schema) {
    const unwrapped = unwrapSchema(schema);
    if (unwrapped instanceof z.ZodString) {
        return "string";
    }
    if (unwrapped instanceof z.ZodNumber) {
        return 0;
    }
    if (unwrapped instanceof z.ZodBoolean) {
        return false;
    }
    if (unwrapped instanceof z.ZodArray) {
        return [];
    }
    if (unwrapped instanceof z.ZodRecord) {
        return {};
    }
    if (unwrapped instanceof z.ZodEnum) {
        return unwrapped.options[0];
    }
    if (unwrapped instanceof z.ZodLiteral) {
        return unwrapped.value;
    }
    if (unwrapped instanceof z.ZodUnion) {
        return buildExampleValue(unwrapped.options[0] ?? z.string());
    }
    if (unwrapped instanceof z.ZodObject) {
        const objectValue = {};
        for (const [key, fieldSchema] of Object.entries(unwrapped.shape)) {
            if (!isRequiredField(fieldSchema)) {
                continue;
            }
            objectValue[key] = buildExampleValue(fieldSchema);
        }
        return objectValue;
    }
    return "value";
}
function buildMinimalExamplePayload(schema) {
    const unwrapped = unwrapSchema(schema);
    if (!(unwrapped instanceof z.ZodObject)) {
        return {};
    }
    const requiredFields = collectRequiredTopLevelFields(schema);
    const example = {};
    const shape = unwrapped.shape;
    for (const field of requiredFields) {
        example[field] = buildExampleValue(shape[field]);
    }
    return example;
}
function formatIssuePath(path) {
    return path.length > 0 ? path.map(String).join(".") : "body";
}
function buildValidationOperationError(input) {
    const issues = input.error.issues.map((issue) => {
        const allowedValues = "options" in issue && Array.isArray(issue.options)
            ? [...issue.options]
            : undefined;
        return {
            path: formatIssuePath(issue.path),
            message: issue.message,
            code: issue.code,
            ...(allowedValues ? { allowedValues } : {})
        };
    });
    const missingRequiredFields = Array.from(new Set(input.error.issues
        .filter((issue) => issue.code === "invalid_type" &&
        "received" in issue &&
        issue.received === "undefined" &&
        issue.path.length > 0)
        .map((issue) => formatIssuePath(issue.path)))).sort();
    const invalidValueGuidance = input.error.issues
        .filter((issue) => "options" in issue && Array.isArray(issue.options))
        .map((issue) => ({
        path: formatIssuePath(issue.path),
        allowedValues: [...(issue.options ?? [])],
        message: issue.message
    }));
    return {
        code: input.code,
        message: input.message,
        operationType: input.operationType,
        entityType: input.entityType,
        clientRef: input.clientRef,
        routeHint: `/api/v1/entities/${input.operationType}`,
        toolHint: input.operationType === "search"
            ? "forge_search_entities"
            : `forge_${input.operationType}_entities`,
        summary: `${input.entityType} ${input.operationType} payload failed validation.`,
        issues,
        missingRequiredFields,
        invalidValueGuidance,
        allowedTopLevelFields: extractAllowedTopLevelFields(input.schema),
        minimalExamplePayload: buildMinimalExamplePayload(input.schema)
    };
}
function parseCreateInput(entityType, data) {
    return getCreateSchema(entityType).parse(data);
}
function parseUpdatePatch(entityType, patch) {
    return getUpdateSchema(entityType).parse(patch);
}
function toOperationError(code, message) {
    return {
        code,
        message
    };
}
function markRolledBack(result) {
    if (!result.ok) {
        return result;
    }
    return {
        ok: false,
        entityType: result.entityType,
        id: result.id,
        clientRef: result.clientRef,
        error: toOperationError("rolled_back", "Rolled back because an earlier atomic batch operation failed.")
    };
}
function markNotExecuted(entry) {
    return {
        ok: false,
        entityType: entry.entityType,
        id: entry.id,
        clientRef: entry.clientRef,
        error: toOperationError("not_executed", "Skipped because an earlier atomic batch operation failed.")
    };
}
function finalizeAtomicRollbackResults(entries, partialResults, rollback) {
    return entries.map((entry, index) => {
        if (index < rollback.index) {
            return markRolledBack(partialResults[index] ?? markNotExecuted(entry));
        }
        if (index === rollback.index) {
            const failedResult = partialResults[index];
            if (failedResult) {
                return failedResult.ok ? markRolledBack(failedResult) : failedResult;
            }
            return {
                ok: false,
                entityType: entry.entityType,
                id: entry.id,
                clientRef: entry.clientRef,
                error: toOperationError(rollback.code, rollback.messageText)
            };
        }
        return markNotExecuted(entry);
    });
}
function executeBatchOperation(entries, atomic, execute) {
    if (!atomic) {
        return { results: entries.map((entry) => execute(entry)) };
    }
    const partialResults = [];
    try {
        runInTransaction(() => {
            entries.forEach((entry, index) => {
                const result = execute(entry);
                partialResults[index] = result;
                if (!result.ok) {
                    throw new AtomicBatchRollback(index, result.error?.code ?? "batch_failed", result.error?.message ?? "Atomic batch failed.");
                }
            });
            return partialResults;
        });
        return { results: partialResults };
    }
    catch (error) {
        if (error instanceof AtomicBatchRollback) {
            return {
                results: finalizeAtomicRollbackResults(entries, partialResults, error)
            };
        }
        throw error;
    }
}
function describeEntity(entityType, entity) {
    const title = typeof entity.title === "string" && entity.title.trim().length > 0
        ? entity.title
        : typeof entity.name === "string" && entity.name.trim().length > 0
            ? entity.name
            : typeof entity.label === "string" && entity.label.trim().length > 0
                ? entity.label
                : typeof entity.summary === "string" && entity.summary.trim().length > 0
                    ? entity.summary
                    : typeof entity.body === "string" && entity.body.trim().length > 0
                        ? entity.body.slice(0, 72)
                        : entityType.replaceAll("_", " ");
    const subtitle = typeof entity.description === "string" && entity.description.trim().length > 0
        ? entity.description
        : typeof entity.summary === "string" && entity.summary.trim().length > 0
            ? entity.summary
            : typeof entity.body === "string" && entity.body.trim().length > 0
                ? entity.body
                : "";
    return { title, subtitle };
}
function matchesLinkedTo(entityType, entity, linkedTo) {
    switch (entityType) {
        case "project":
            return linkedTo.entityType === "goal" && entity.goalId === linkedTo.id;
        case "task":
            return (linkedTo.entityType === "goal" && entity.goalId === linkedTo.id) || (linkedTo.entityType === "project" && entity.projectId === linkedTo.id);
        case "habit":
            return ((linkedTo.entityType === "goal" && Array.isArray(entity.linkedGoalIds) && entity.linkedGoalIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "project" && Array.isArray(entity.linkedProjectIds) && entity.linkedProjectIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "task" && Array.isArray(entity.linkedTaskIds) && entity.linkedTaskIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "psyche_value" && Array.isArray(entity.linkedValueIds) && entity.linkedValueIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "behavior_pattern" && Array.isArray(entity.linkedPatternIds) && entity.linkedPatternIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "behavior" && Array.isArray(entity.linkedBehaviorIds) && entity.linkedBehaviorIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "belief_entry" && Array.isArray(entity.linkedBeliefIds) && entity.linkedBeliefIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "mode_profile" && Array.isArray(entity.linkedModeIds) && entity.linkedModeIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "trigger_report" && Array.isArray(entity.linkedReportIds) && entity.linkedReportIds.includes(linkedTo.id)));
        case "note":
            return (Array.isArray(entity.links) &&
                entity.links.some((link) => typeof link === "object" &&
                    link !== null &&
                    "entityType" in link &&
                    "entityId" in link &&
                    link.entityType === linkedTo.entityType &&
                    link.entityId === linkedTo.id));
        case "insight":
            return entity.entityType === linkedTo.entityType && entity.entityId === linkedTo.id;
        case "calendar_event":
        case "sleep_session":
        case "workout_session":
            return (Array.isArray(entity.links) &&
                entity.links.some((link) => typeof link === "object" &&
                    link !== null &&
                    "entityType" in link &&
                    "entityId" in link &&
                    link.entityType === linkedTo.entityType &&
                    link.entityId === linkedTo.id));
        case "task_timebox":
            return ((linkedTo.entityType === "task" && entity.taskId === linkedTo.id) ||
                (linkedTo.entityType === "project" && entity.projectId === linkedTo.id));
        case "psyche_value":
            return ((linkedTo.entityType === "goal" && Array.isArray(entity.linkedGoalIds) && entity.linkedGoalIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "project" && Array.isArray(entity.linkedProjectIds) && entity.linkedProjectIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "task" && Array.isArray(entity.linkedTaskIds) && entity.linkedTaskIds.includes(linkedTo.id)));
        case "behavior_pattern":
            return ((linkedTo.entityType === "psyche_value" && Array.isArray(entity.linkedValueIds) && entity.linkedValueIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "mode_profile" && Array.isArray(entity.linkedModeIds) && entity.linkedModeIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "belief_entry" && Array.isArray(entity.linkedBeliefIds) && entity.linkedBeliefIds.includes(linkedTo.id)));
        case "behavior":
            return ((linkedTo.entityType === "behavior_pattern" && Array.isArray(entity.linkedPatternIds) && entity.linkedPatternIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "psyche_value" && Array.isArray(entity.linkedValueIds) && entity.linkedValueIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "mode_profile" && Array.isArray(entity.linkedModeIds) && entity.linkedModeIds.includes(linkedTo.id)));
        case "belief_entry":
            return ((linkedTo.entityType === "psyche_value" && Array.isArray(entity.linkedValueIds) && entity.linkedValueIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "behavior" && Array.isArray(entity.linkedBehaviorIds) && entity.linkedBehaviorIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "mode_profile" && Array.isArray(entity.linkedModeIds) && entity.linkedModeIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "trigger_report" && Array.isArray(entity.linkedReportIds) && entity.linkedReportIds.includes(linkedTo.id)));
        case "mode_profile":
            return ((linkedTo.entityType === "behavior_pattern" && Array.isArray(entity.linkedPatternIds) && entity.linkedPatternIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "behavior" && Array.isArray(entity.linkedBehaviorIds) && entity.linkedBehaviorIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "psyche_value" && Array.isArray(entity.linkedValueIds) && entity.linkedValueIds.includes(linkedTo.id)));
        case "trigger_report":
            return ((linkedTo.entityType === "behavior_pattern" && Array.isArray(entity.linkedPatternIds) && entity.linkedPatternIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "psyche_value" && Array.isArray(entity.linkedValueIds) && entity.linkedValueIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "goal" && Array.isArray(entity.linkedGoalIds) && entity.linkedGoalIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "project" && Array.isArray(entity.linkedProjectIds) && entity.linkedProjectIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "task" && Array.isArray(entity.linkedTaskIds) && entity.linkedTaskIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "behavior" && Array.isArray(entity.linkedBehaviorIds) && entity.linkedBehaviorIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "belief_entry" && Array.isArray(entity.linkedBeliefIds) && entity.linkedBeliefIds.includes(linkedTo.id)) ||
                (linkedTo.entityType === "mode_profile" && Array.isArray(entity.linkedModeIds) && entity.linkedModeIds.includes(linkedTo.id)));
        case "preference_catalog_item":
            return linkedTo.entityType === "preference_catalog" && entity.catalogId === linkedTo.id;
        case "preference_item":
            return (typeof entity.sourceEntityType === "string" &&
                typeof entity.sourceEntityId === "string" &&
                entity.sourceEntityType === linkedTo.entityType &&
                entity.sourceEntityId === linkedTo.id);
        case "questionnaire_instrument":
            return false;
        default:
            return false;
    }
}
function matchesQuery(entity, query) {
    if (!query || query.trim().length === 0) {
        return true;
    }
    const haystack = JSON.stringify(entity).toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
}
function matchesStatus(entity, statuses) {
    if (!statuses || statuses.length === 0) {
        return true;
    }
    return typeof entity.status === "string" ? statuses.includes(entity.status) : false;
}
function purgeAnchoredCollaboration(entityType, entityId) {
    const insightIds = getDatabase()
        .prepare(`SELECT id FROM insights WHERE entity_type = ? AND entity_id = ?`)
        .all(entityType, entityId);
    if (insightIds.length > 0) {
        const placeholders = insightIds.map(() => "?").join(", ");
        getDatabase()
            .prepare(`DELETE FROM insight_feedback WHERE insight_id IN (${placeholders})`)
            .run(...insightIds.map((row) => row.id));
        getDatabase()
            .prepare(`DELETE FROM insights WHERE id IN (${placeholders})`)
            .run(...insightIds.map((row) => row.id));
        getDatabase()
            .prepare(`DELETE FROM deleted_entities WHERE entity_type = 'insight' AND entity_id IN (${placeholders})`)
            .run(...insightIds.map((row) => row.id));
    }
    unlinkNotesForEntity(entityType, entityId, { source: "system", actor: null });
}
export function deleteEntity(entityType, id, options, context) {
    const capability = getCapability(entityType);
    const mode = options.mode ?? "soft";
    if (capability.deleteMode === "immediate") {
        clearDeletedEntityRecord(entityType, id);
        return capability.hardDelete(id, context);
    }
    const existing = capability.get(id);
    if (!existing) {
        const deleted = getDeletedEntityRecord(entityType, id);
        if (!deleted || mode !== "hard") {
            return undefined;
        }
    }
    return runInTransaction(() => {
        if (mode === "soft") {
            const entity = capability.get(id);
            if (!entity) {
                return undefined;
            }
            const details = describeEntity(entityType, entity);
            upsertDeletedEntityRecord({
                entityType,
                entityId: id,
                title: details.title,
                subtitle: details.subtitle,
                snapshot: entity,
                deleteReason: options.reason ?? "",
                context
            });
            if (entityType !== "note" && entityType !== "insight") {
                cascadeSoftDeleteAnchoredCollaboration(entityType, id, context, options.reason ?? "");
            }
            return entity;
        }
        clearDeletedEntityRecord(entityType, id);
        if (entityType !== "note" && entityType !== "insight") {
            purgeAnchoredCollaboration(entityType, id);
        }
        const deleted = capability.hardDelete(id, context);
        clearEntityOwner(entityType, id);
        clearDeletedEntityRecord(entityType, id);
        return deleted;
    });
}
export function restoreEntity(entityType, id) {
    return runInTransaction(() => {
        const deleted = restoreDeletedEntityRecord(entityType, id);
        if (!deleted) {
            return undefined;
        }
        if (entityType !== "note" && entityType !== "insight") {
            restoreAnchoredCollaboration(entityType, id);
        }
        return getCapability(entityType).get(id) ?? deleted.snapshot;
    });
}
export function createEntities(input, context) {
    return executeBatchOperation(input.operations, input.atomic, (entry) => {
        try {
            const entity = getCapability(entry.entityType).create(parseCreateInput(entry.entityType, entry.data), context);
            return { ok: true, entityType: entry.entityType, clientRef: entry.clientRef, id: String(entity.id ?? ""), entity };
        }
        catch (error) {
            if (error instanceof ZodError) {
                return {
                    ok: false,
                    entityType: entry.entityType,
                    clientRef: entry.clientRef,
                    error: buildValidationOperationError({
                        code: "validation_failed",
                        message: "Entity create payload validation failed.",
                        operationType: "create",
                        entityType: entry.entityType,
                        clientRef: entry.clientRef,
                        schema: getCreateSchema(entry.entityType),
                        error
                    })
                };
            }
            return {
                ok: false,
                entityType: entry.entityType,
                clientRef: entry.clientRef,
                error: toOperationError("create_failed", error instanceof Error ? error.message : String(error))
            };
        }
    });
}
export function updateEntities(input, context) {
    return executeBatchOperation(input.operations, input.atomic, (entry) => {
        try {
            const entity = getCapability(entry.entityType).update(entry.id, parseUpdatePatch(entry.entityType, entry.patch), context);
            if (!entity) {
                return {
                    ok: false,
                    entityType: entry.entityType,
                    id: entry.id,
                    clientRef: entry.clientRef,
                    error: toOperationError("not_found", `${entry.entityType} ${entry.id} was not found.`)
                };
            }
            return { ok: true, entityType: entry.entityType, id: entry.id, clientRef: entry.clientRef, entity };
        }
        catch (error) {
            if (error instanceof ZodError) {
                return {
                    ok: false,
                    entityType: entry.entityType,
                    id: entry.id,
                    clientRef: entry.clientRef,
                    error: buildValidationOperationError({
                        code: "validation_failed",
                        message: "Entity update payload validation failed.",
                        operationType: "update",
                        entityType: entry.entityType,
                        clientRef: entry.clientRef,
                        schema: getUpdateSchema(entry.entityType),
                        error
                    })
                };
            }
            return {
                ok: false,
                entityType: entry.entityType,
                id: entry.id,
                clientRef: entry.clientRef,
                error: toOperationError("update_failed", error instanceof Error ? error.message : String(error))
            };
        }
    });
}
export function deleteEntities(input, context) {
    return executeBatchOperation(input.operations, input.atomic, (entry) => {
        try {
            const entity = deleteEntity(entry.entityType, entry.id, { mode: entry.mode, reason: entry.reason }, context);
            if (!entity) {
                return {
                    ok: false,
                    entityType: entry.entityType,
                    id: entry.id,
                    clientRef: entry.clientRef,
                    error: toOperationError("not_found", `${entry.entityType} ${entry.id} was not found.`)
                };
            }
            return { ok: true, entityType: entry.entityType, id: entry.id, clientRef: entry.clientRef, entity };
        }
        catch (error) {
            return {
                ok: false,
                entityType: entry.entityType,
                id: entry.id,
                clientRef: entry.clientRef,
                error: toOperationError("delete_failed", error instanceof Error ? error.message : String(error))
            };
        }
    });
}
export function restoreEntities(input) {
    return executeBatchOperation(input.operations, input.atomic, (entry) => {
        try {
            const entity = restoreEntity(entry.entityType, entry.id);
            if (!entity) {
                return {
                    ok: false,
                    entityType: entry.entityType,
                    id: entry.id,
                    clientRef: entry.clientRef,
                    error: toOperationError("not_found", `${entry.entityType} ${entry.id} was not found in the bin.`)
                };
            }
            return { ok: true, entityType: entry.entityType, id: entry.id, clientRef: entry.clientRef, entity };
        }
        catch (error) {
            return {
                ok: false,
                entityType: entry.entityType,
                id: entry.id,
                clientRef: entry.clientRef,
                error: toOperationError("restore_failed", error instanceof Error ? error.message : String(error))
            };
        }
    });
}
export function searchEntities(input) {
    const deleted = listDeletedEntities();
    const defaultEntityTypes = Object.keys(CRUD_ENTITY_CAPABILITIES);
    return {
        results: input.searches.map((search) => {
            const entityTypes = search.entityTypes && search.entityTypes.length > 0 ? search.entityTypes : defaultEntityTypes;
            const liveMatches = entityTypes.flatMap((entityType) => filterOwnedEntities(entityType, getCapability(entityType).list(), search.userIds)
                .filter((entity) => (search.ids && search.ids.length > 0 ? search.ids.includes(String(entity.id ?? "")) : true))
                .filter((entity) => matchesQuery(entity, search.query))
                .filter((entity) => matchesStatus(entity, search.status))
                .filter((entity) => (search.linkedTo ? matchesLinkedTo(entityType, entity, search.linkedTo) : true))
                .slice(0, search.limit)
                .map((entity) => ({ deleted: false, entityType, id: String(entity.id ?? ""), entity })));
            const deletedMatches = search.includeDeleted
                ? deleted
                    .filter((item) => entityTypes.includes(item.entityType))
                    .filter((item) => (search.ids && search.ids.length > 0 ? search.ids.includes(item.entityId) : true))
                    .filter((item) => !search.userIds || search.userIds.length === 0
                    ? true
                    : search.userIds.includes(String(item.snapshot.userId ?? "")))
                    .filter((item) => matchesQuery(item.snapshot, search.query) || matchesQuery(item, search.query))
                    .filter((item) => matchesStatus(item.snapshot, search.status))
                    .filter((item) => (search.linkedTo ? matchesLinkedTo(item.entityType, item.snapshot, search.linkedTo) : true))
                    .slice(0, search.limit)
                    .map((item) => ({ deleted: true, entityType: item.entityType, id: item.entityId, entity: item.snapshot, deletedRecord: item }))
                : [];
            return {
                ok: true,
                clientRef: search.clientRef,
                matches: [...liveMatches, ...deletedMatches].slice(0, search.limit)
            };
        })
    };
}
export function getSettingsBinPayload() {
    return buildSettingsBinPayload();
}
export function getDeletedEntityRecords() {
    return listDeletedEntities();
}
