import { z, ZodError } from "zod";
import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import {
  createSleepSession,
  createSleepSessionSchema,
  createWorkoutSession,
  createWorkoutSessionSchema,
  deleteSleepSession,
  deleteWorkoutSession,
  getSleepSessionById,
  getWorkoutSessionById,
  listSleepSessions,
  listWorkoutSessions,
  updateSleepSession,
  updateSleepSessionSchema,
  updateWorkoutSession,
  updateWorkoutSessionSchema
} from "../health.js";
import {
  artifactMetadataCreateSchema,
  artifactMetadataPatchSchema,
  canAccessArtifact,
  createArtifactMetadata,
  deleteArtifactMetadata,
  getArtifactById,
  listArtifacts,
  searchArtifactsForEntityCrud,
  serializeArtifactPublicPayload,
  updateArtifactMetadata
} from "./artifacts.js";
import {
  createInsight,
  deleteInsight,
  getInsightById,
  listInsights,
  updateInsight
} from "../repositories/collaboration.js";
import {
  createCalendarEvent,
  createTaskTimebox,
  createWorkBlockTemplate,
  deleteCalendarEvent,
  deleteTaskTimebox,
  deleteWorkBlockTemplate,
  getCalendarEventById,
  getTaskTimeboxById,
  getTaskTimeboxByIdIncludingPendingDeletion,
  getWorkBlockTemplateById,
  listCalendarEvents,
  listTaskTimeboxesForEntityCrud,
  searchTaskTimeboxesForEntityCrud,
  listWorkBlockTemplates,
  updateCalendarEvent,
  updateTaskTimebox,
  updateWorkBlockTemplate
} from "../repositories/calendar.js";
import {
  createNote,
  createNoteWithinTransaction,
  deleteNote,
  getNoteById,
  getNoteByIdIncludingDeleted,
  isNoteVisibleToScope,
  listNotes,
  listNotesPage,
  noteMatchesSearchQuery,
  noteHasPsycheLink,
  resolveNoteMutationUserId,
  unlinkNotesForEntity,
  updateNote,
  type NoteReadScope
} from "../repositories/notes.js";
import {
  createPerson,
  getPersonByIdAcrossOwners,
  hardDeletePerson,
  listAuthorizedPersonLinks,
  replaceAuthorizedPersonLinks,
  restorePerson,
  searchPeopleAcrossOwners,
  softDeletePerson,
  updatePerson
} from "../repositories/people.js";
import {
  clearEntityOwner,
  filterOwnedEntities,
  getEntityOwnerId,
  setEntityOwner
} from "../repositories/entity-ownership.js";
import {
  deleteEntityLinksForEntity,
  listEntityLinksForEntity
} from "../repositories/entity-links.js";
import {
  createPreferenceCatalog,
  createPreferenceCatalogItem,
  createPreferenceContext,
  createPreferenceItem,
  archivePreferenceCatalog,
  archivePreferenceCatalogItem,
  deletePreferenceContext,
  deletePreferenceItem,
  getPreferenceCatalogById,
  getPreferenceCatalogItemById,
  getPreferenceContextById,
  getPreferenceItemById,
  getPreferenceProfileById,
  listPreferenceCatalogItems,
  listPreferenceCatalogHardDeleteDescendants,
  listPreferenceCatalogs,
  listPreferenceContexts,
  listPreferenceItems,
  hardDeletePreferenceCatalog,
  hardDeletePreferenceCatalogItem,
  restorePreferenceCatalog,
  restorePreferenceCatalogItem,
  updatePreferenceCatalog,
  updatePreferenceCatalogItem,
  updatePreferenceContext,
  updatePreferenceItem
} from "../repositories/preferences.js";
import {
  createBehaviorPatternSchema,
  createBehaviorSchema,
  createBeliefEntrySchema,
  createEmotionDefinitionSchema,
  createEventTypeSchema,
  createFlashcardSchema,
  createModeGuideSessionSchema,
  createModeProfileSchema,
  createPsycheValueSchema,
  createTriggerReportSchema,
  updateBehaviorPatternSchema,
  updateBehaviorSchema,
  updateBeliefEntrySchema,
  updateEmotionDefinitionSchema,
  updateEventTypeSchema,
  updateFlashcardSchema,
  updateModeGuideSessionSchema,
  updateModeProfileSchema,
  updatePsycheValueSchema,
  updateTriggerReportSchema
} from "../psyche-types.js";
import {
  buildSettingsBinPayload,
  cascadeSoftDeleteAnchoredCollaboration,
  clearDeletedEntityRecord,
  getDeletedEntityRecord,
  listDeletedEntities,
  restoreAnchoredCollaboration,
  restoreDeletedEntityRecord,
  upsertDeletedEntityRecord
} from "../repositories/deleted-entities.js";
import {
  createGoal,
  deleteGoal,
  getGoalById,
  listGoals,
  updateGoal
} from "../repositories/goals.js";
import {
  createHabit,
  deleteHabit,
  getHabitById,
  listHabits,
  updateHabit
} from "../repositories/habits.js";
import {
  createQuestionnaireInstrument,
  deleteQuestionnaireInstrument,
  getQuestionnaireInstrumentEntityById,
  listQuestionnaireInstrumentEntities,
  updateQuestionnaireInstrument,
  updateQuestionnaireInstrumentSchema
} from "../repositories/questionnaires.js";
import {
  createBehavior,
  createBehaviorPattern,
  createBeliefEntry,
  createEmotionDefinition,
  createEventType,
  createFlashcard,
  createModeGuideSession,
  createModeProfile,
  createPsycheValue,
  createTriggerReport,
  deleteBehavior,
  deleteBehaviorPattern,
  deleteBeliefEntry,
  deleteEmotionDefinition,
  deleteEventType,
  deleteFlashcard,
  deleteModeGuideSession,
  deleteModeProfile,
  deletePsycheValue,
  deleteTriggerReport,
  getBehaviorById,
  getBehaviorPatternById,
  getBeliefEntryById,
  getEmotionDefinitionById,
  getEventTypeById,
  getFlashcardById,
  getModeGuideSessionById,
  getModeProfileById,
  getPsycheValueById,
  getTriggerReportById,
  listBehaviors,
  listBehaviorPatterns,
  listBeliefEntries,
  listEmotionDefinitions,
  listEventTypes,
  listFlashcards,
  listModeGuideSessions,
  listModeProfiles,
  listPsycheValues,
  listTriggerReports,
  searchTriggerReports,
  updateBehavior,
  updateBehaviorPattern,
  updateBeliefEntry,
  updateEmotionDefinition,
  updateEventType,
  updateFlashcard,
  updateModeGuideSession,
  updateModeProfile,
  updatePsycheValue,
  updateTriggerReport
} from "../repositories/psyche.js";
import {
  createProject,
  deleteProject,
  getProjectById,
  listProjects,
  updateProject
} from "../repositories/projects.js";
import {
  createStrategy,
  deleteStrategy,
  getStrategyById,
  listStrategies,
  updateStrategy
} from "../repositories/strategies.js";
import {
  createTag,
  deleteTag,
  getTagById,
  listTags,
  updateTag
} from "../repositories/tags.js";
import {
  createTask,
  deleteTask,
  getTaskById,
  listTasks,
  updateTask
} from "../repositories/tasks.js";
import {
  createLifeEvent,
  deleteLifeEvent,
  getLifeEventById,
  listLifeEvents,
  updateLifeEvent
} from "../repositories/life-events.js";
import type {
  ActivitySource,
  BatchCreateEntitiesInput,
  BatchDeleteEntitiesInput,
  BatchRestoreEntitiesInput,
  BatchSearchEntitiesInput,
  BatchUpdateEntitiesInput,
  CrudEntityType,
  CreateNoteInput,
  DeleteMode,
  DeletedEntityRecord,
  Note,
  SettingsBinPayload
} from "../types.js";
import {
  createCalendarEventSchema,
  createGoalSchema,
  createHabitSchema,
  createInsightSchema,
  createLifeEventSchema,
  createNoteSchema,
  createProjectSchema,
  createStrategySchema,
  createTaskTimeboxSchema,
  createTagSchema,
  createTaskSchema,
  createWorkBlockTemplateSchema,
  updateCalendarEventSchema,
  updateGoalSchema,
  updateHabitSchema,
  updateInsightSchema,
  updateLifeEventSchema,
  updateNoteSchema,
  updateProjectSchema,
  updateStrategySchema,
  updateTaskTimeboxSchema,
  updateTagSchema,
  updateTaskSchema,
  updateWorkBlockTemplateSchema
} from "../types.js";
import {
  createPreferenceCatalogItemSchema,
  createPreferenceCatalogSchema,
  createPreferenceContextSchema,
  createPreferenceItemSchema,
  updatePreferenceCatalogItemSchema,
  updatePreferenceCatalogSchema,
  updatePreferenceContextSchema,
  updatePreferenceItemSchema
} from "../preferences-types.js";
import { createQuestionnaireInstrumentSchema } from "../questionnaire-types.js";
import { createPersonSchema, updatePersonSchema } from "../people-types.js";
import {
  canAccessWikiNote,
  filterAccessibleWikiNotes,
  listAccessibleWikiSpaces,
  requireWikiNoteAccess,
  requireWikiUserScope,
  resolveWikiMutationSpaceId
} from "./wiki-authorization.js";

const ENTITY_CALENDAR_LIST_RANGE = {
  from: "1970-01-01T00:00:00.000Z",
  to: "2100-01-01T00:00:00.000Z"
} as const;

export type CrudContext = {
  source: ActivitySource;
  actor?: string | null;
  userIds?: string[];
  projectIds?: string[];
  tagIds?: string[];
  idempotencyKey?: string | null;
};

type CrudSearchInput = BatchSearchEntitiesInput["searches"][number];

type EntitySearchContext = {
  includePsycheNotes?: boolean;
  taskScope?: Pick<CrudContext, "userIds" | "projectIds" | "tagIds">;
  artifactScope?: Pick<CrudContext, "userIds" | "projectIds" | "tagIds">;
  transformEntityForRead?: (
    entityType: CrudEntityType,
    entity: Record<string, unknown> & { id: string }
  ) => Record<string, unknown> & { id: string };
};

type CrudOperationType = "create" | "update" | "delete" | "restore" | "search";

type OperationValidationIssue = {
  path: string;
  message: string;
  code?: string;
  allowedValues?: unknown[];
};

type OperationErrorPayload = {
  code: string;
  message: string;
  operationType?: CrudOperationType;
  entityType?: CrudEntityType;
  clientRef?: string;
  routeHint?: string;
  toolHint?: string;
  summary?: string;
  issues?: OperationValidationIssue[];
  missingRequiredFields?: string[];
  invalidValueGuidance?: Array<{
    path: string;
    allowedValues: unknown[];
    message: string;
  }>;
  allowedTopLevelFields?: string[];
  minimalExamplePayload?: Record<string, unknown>;
};

type EntityOperationResult = {
  ok: boolean;
  entityType?: CrudEntityType;
  id?: string;
  clientRef?: string;
  entity?: unknown;
  matches?: unknown[];
  error?: OperationErrorPayload;
};

class AtomicBatchRollback extends Error {
  constructor(
    readonly index: number,
    readonly code: string,
    readonly messageText: string
  ) {
    super(messageText);
    this.name = "AtomicBatchRollback";
  }
}

type CrudEntityCapability = {
  entityType: CrudEntityType;
  routeBase: string;
  deleteMode: "soft_default" | "immediate";
  inBin: boolean;
  list: () => Array<Record<string, unknown>>;
  search?: (
    input: CrudSearchInput,
    context: EntitySearchContext
  ) => Array<Record<string, unknown>>;
  get: (id: string) => Record<string, unknown> | undefined;
  create: (
    data: Record<string, unknown>,
    context: CrudContext
  ) => Record<string, unknown>;
  update: (
    id: string,
    patch: Record<string, unknown>,
    context: CrudContext
  ) => Record<string, unknown> | undefined;
  hardDelete: (
    id: string,
    context: CrudContext
  ) => Record<string, unknown> | undefined;
  softDelete?: (
    id: string,
    context: CrudContext
  ) => Record<string, unknown> | undefined;
  restore?: (
    id: string,
    context: CrudContext
  ) => Record<string, unknown> | undefined;
};

function assertMutationUserScope(context: CrudContext, userId: string) {
  if (context.userIds?.length && !context.userIds.includes(userId)) {
    throw new HttpError(
      403,
      "user_scope_forbidden",
      "The requested user scope is outside this token's allowed users."
    );
  }
}

function taskMatchesCrudScope(
  task: Record<string, unknown>,
  context: Pick<CrudContext, "userIds" | "projectIds" | "tagIds">
) {
  const userIds = context.userIds ?? [];
  if (
    userIds.length > 0 &&
    filterOwnedEntities(
      "task",
      [task as Record<string, unknown> & { id: string }],
      userIds
    ).length === 0
  ) {
    return false;
  }
  const projectIds = context.projectIds ?? [];
  if (
    projectIds.length > 0 &&
    (typeof task.projectId !== "string" || !projectIds.includes(task.projectId))
  ) {
    return false;
  }
  const tagIds = context.tagIds ?? [];
  const taskTagIds = Array.isArray(task.tagIds)
    ? task.tagIds.filter((value): value is string => typeof value === "string")
    : [];
  return (
    tagIds.length === 0 || taskTagIds.some((tagId) => tagIds.includes(tagId))
  );
}

function assertTaskCrudResultScope(
  task: Record<string, unknown>,
  context: CrudContext
) {
  if (!taskMatchesCrudScope(task, context)) {
    throw new HttpError(
      403,
      "task_scope_forbidden",
      "The resulting task is outside this token's allowed task scope."
    );
  }
}

function wikiScopeForCrudContext(context: CrudContext) {
  return { userIds: context.userIds ?? [] };
}

function requireNoteMutationAccess(
  note: ReturnType<typeof getNoteByIdIncludingDeleted>,
  context: CrudContext
) {
  const userIds = context.userIds ?? [];
  if (
    !note ||
    (userIds.length > 0 &&
      filterOwnedEntities("note", [note], userIds).length === 0)
  ) {
    throw new HttpError(404, "note_not_found", "Note not found.");
  }
  return requireWikiNoteAccess(wikiScopeForCrudContext(context), note, "write");
}

function canMutateTriggerReport(
  id: string,
  snapshot: Record<string, unknown> | undefined,
  context: CrudContext
) {
  const allowedUserIds = context.userIds ?? [];
  if (allowedUserIds.length === 0) {
    return true;
  }
  const snapshotOwnerId =
    typeof snapshot?.ownerUserId === "string"
      ? snapshot.ownerUserId
      : typeof snapshot?.userId === "string"
        ? snapshot.userId
        : null;
  const knownOwnerIds = new Set(
    [getEntityOwnerId("trigger_report", id), snapshotOwnerId].filter(
      (ownerId): ownerId is string => ownerId !== null
    )
  );
  return (
    knownOwnerIds.size > 0 &&
    [...knownOwnerIds].every((ownerId) => allowedUserIds.includes(ownerId))
  );
}

function authorizeOwnedPersonLinkEndpoint(input: {
  userId: string;
  entityType: string;
  entityId: string;
}): boolean {
  return getEntityOwnerId(input.entityType, input.entityId) === input.userId;
}

function replacePersonBatchLinks(input: {
  personId: string;
  userId: string;
  links: Array<{
    entityType: string;
    entityId: string;
    anchorKey?: string | null;
    relationship?: string;
  }>;
  actor?: string | null;
}) {
  return replaceAuthorizedPersonLinks(
    {
      userId: input.userId,
      personId: input.personId,
      actor: input.actor,
      links: input.links.map((link) => ({
        targetEntityType: link.entityType,
        targetEntityId: link.entityId,
        anchorKey: link.anchorKey ?? "",
        relationship: link.relationship ?? "related_to"
      }))
    },
    authorizeOwnedPersonLinkEndpoint
  );
}

function attachAuthorizedPersonLinks(
  person: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!person) {
    return undefined;
  }
  const personId = String(person.id ?? "");
  const userId = String(person.userId ?? "");
  if (!personId || !userId) {
    return person;
  }
  return {
    ...person,
    links: listAuthorizedPersonLinks(
      { userId, personId, direction: "both" },
      authorizeOwnedPersonLinkEndpoint
    )
  };
}

function assertPreferenceCatalogItemScope(
  item: { catalogId: string } | undefined,
  context: CrudContext
) {
  if (!item) {
    return;
  }
  const catalog = getPreferenceCatalogById(item.catalogId, true);
  if (!catalog) {
    throw new HttpError(
      404,
      "preferences_catalog_not_found",
      `Preference catalog ${item.catalogId} was not found.`
    );
  }
  assertMutationUserScope(context, catalog.userId);
}

function assertPreferenceProfileScope(
  profileId: string | undefined,
  context: CrudContext
) {
  if (!profileId) {
    return;
  }
  const profile = getPreferenceProfileById(profileId);
  if (profile) {
    assertMutationUserScope(context, profile.userId);
  }
}

function requirePreferenceSourceReadAccess(
  sourceEntityType: CrudEntityType,
  sourceEntityId: string,
  context: CrudContext
) {
  if (sourceEntityType === "note") {
    requireWikiNoteAccess(
      wikiScopeForCrudContext(context),
      getNoteById(sourceEntityId),
      "read"
    );
    return;
  }
  const sourceEntity = getEntityById(sourceEntityType, sourceEntityId);
  const ownerUserId =
    getEntityOwnerId(sourceEntityType, sourceEntityId) ??
    (typeof sourceEntity?.userId === "string" ? sourceEntity.userId : null);
  if (
    !sourceEntity ||
    (context.userIds?.length &&
      (ownerUserId === null || !context.userIds.includes(ownerUserId)))
  ) {
    throw new HttpError(
      404,
      "preferences_source_entity_not_found",
      "Preference source entity not found."
    );
  }
}

function requireTaskTimeboxTaskScope(taskId: string, context: CrudContext) {
  const task = getTaskById(taskId);
  if (!task) {
    throw new HttpError(
      404,
      "calendar_timebox_task_not_found",
      "The task for this timebox does not exist."
    );
  }
  const ownerId =
    getEntityOwnerId("task", task.id) ??
    task.ownerUserId ??
    task.userId ??
    null;
  if (!ownerId) {
    throw new HttpError(
      409,
      "calendar_timebox_task_owner_missing",
      "The task must have an owner before it can be timeboxed."
    );
  }
  assertMutationUserScope(context, ownerId);
  return { task, ownerId };
}

function requireTaskTimeboxScope(timeboxId: string, context: CrudContext) {
  const timebox = getTaskTimeboxByIdIncludingPendingDeletion(timeboxId);
  if (!timebox) {
    return undefined;
  }
  const ownerId =
    getEntityOwnerId("task_timebox", timebox.id) ??
    timebox.ownerUserId ??
    timebox.userId ??
    null;
  if (!ownerId) {
    throw new HttpError(
      409,
      "calendar_timebox_owner_missing",
      "The task timebox has no owner and cannot be mutated safely."
    );
  }
  assertMutationUserScope(context, ownerId);
  requireTaskTimeboxTaskScope(timebox.taskId, context);
  return timebox;
}

function noteMatchesCrudIdentityAndQuery(
  note: Note,
  input: Pick<CrudSearchInput, "ids" | "query">
) {
  if (input.ids && input.ids.length > 0 && !input.ids.includes(note.id)) {
    return false;
  }
  return noteMatchesSearchQuery(note, input.query);
}

function searchNotesForEntityCrud(
  input: CrudSearchInput,
  context: EntitySearchContext
) {
  const includePsyche = context.includePsycheNotes ?? true;
  const wikiScope = { userIds: input.userIds ?? [] };
  const filterVisible = (notes: Note[]) =>
    filterAccessibleWikiNotes(wikiScope, notes).filter(
      (note) => includePsyche || !noteHasPsycheLink(note)
    );

  const accessibleSpaceIds = listAccessibleWikiSpaces(wikiScope, "read").map(
    (space) => space.id
  );
  const notes: Note[] = [];
  let cursor: string | undefined;
  do {
    const page = listNotesPage(
      {
        ids: input.ids,
        query: input.query,
        linkedTo: input.linkedTo
          ? [
              {
                entityType: input.linkedTo.entityType,
                entityId: input.linkedTo.id
              }
            ]
          : [],
        userIds: input.userIds ?? [],
        limit: Math.min(100, input.limit - notes.length),
        cursor
      },
      { accessibleSpaceIds, includePsyche }
    );
    notes.push(
      ...filterVisible(page.notes).filter((note) =>
        noteMatchesCrudIdentityAndQuery(note, input)
      )
    );
    cursor = page.nextCursor ?? undefined;
    if (!page.hasMore || !cursor || notes.length >= input.limit) {
      break;
    }
  } while (notes.length < input.limit);

  return notes as Array<Record<string, unknown>>;
}

const CRUD_ENTITY_CAPABILITIES: Record<CrudEntityType, CrudEntityCapability> = {
  goal: {
    entityType: "goal",
    routeBase: "/api/v1/goals",
    deleteMode: "soft_default",
    inBin: true,
    list: () => listGoals() as Array<Record<string, unknown>>,
    get: (id) => getGoalById(id) as Record<string, unknown> | undefined,
    create: (data, context) =>
      createGoal(data as never, context) as Record<string, unknown>,
    update: (id, patch, context) =>
      updateGoal(id, patch as never, context) as
        | Record<string, unknown>
        | undefined,
    hardDelete: (id, context) =>
      deleteGoal(id, context) as Record<string, unknown> | undefined
  },
  project: {
    entityType: "project",
    routeBase: "/api/v1/projects",
    deleteMode: "soft_default",
    inBin: true,
    list: () => listProjects() as Array<Record<string, unknown>>,
    get: (id) => getProjectById(id) as Record<string, unknown> | undefined,
    create: (data, context) =>
      createProject(data as never, context) as Record<string, unknown>,
    update: (id, patch, context) =>
      updateProject(id, patch as never, context) as
        | Record<string, unknown>
        | undefined,
    hardDelete: (id, context) =>
      deleteProject(id, context) as Record<string, unknown> | undefined
  },
  task: {
    entityType: "task",
    routeBase: "/api/v1/tasks",
    deleteMode: "soft_default",
    inBin: true,
    list: () => listTasks() as Array<Record<string, unknown>>,
    search: (_input, context) =>
      (listTasks() as Array<Record<string, unknown>>).filter((task) =>
        taskMatchesCrudScope(task, context.taskScope ?? {})
      ),
    get: (id) => getTaskById(id) as Record<string, unknown> | undefined,
    create: (data, context) =>
      runInTransaction(() => {
        const task = createTask(data as never, context) as Record<
          string,
          unknown
        >;
        assertTaskCrudResultScope(task, context);
        return task;
      }),
    update: (id, patch, context) =>
      runInTransaction(() => {
        const current = getTaskById(id) as Record<string, unknown> | undefined;
        if (!current || !taskMatchesCrudScope(current, context)) {
          return undefined;
        }
        const task = updateTask(id, patch as never, context) as
          | Record<string, unknown>
          | undefined;
        if (task) {
          assertTaskCrudResultScope(task, context);
        }
        return task;
      }),
    hardDelete: (id, context) => {
      const current = getTaskById(id) as Record<string, unknown> | undefined;
      if (!current || !taskMatchesCrudScope(current, context)) {
        return undefined;
      }
      return deleteTask(id, context) as Record<string, unknown> | undefined;
    }
  },
  strategy: {
    entityType: "strategy",
    routeBase: "/api/v1/strategies",
    deleteMode: "soft_default",
    inBin: true,
    list: () => listStrategies() as Array<Record<string, unknown>>,
    get: (id) => getStrategyById(id) as Record<string, unknown> | undefined,
    create: (data) => createStrategy(data as never) as Record<string, unknown>,
    update: (id, patch) =>
      updateStrategy(id, patch as never) as Record<string, unknown> | undefined,
    hardDelete: (id) =>
      deleteStrategy(id) as Record<string, unknown> | undefined
  },
  habit: {
    entityType: "habit",
    routeBase: "/api/v1/habits",
    deleteMode: "soft_default",
    inBin: true,
    list: () => listHabits() as Array<Record<string, unknown>>,
    get: (id) => getHabitById(id) as Record<string, unknown> | undefined,
    create: (data, context) =>
      createHabit(data as never, context) as Record<string, unknown>,
    update: (id, patch, context) =>
      updateHabit(id, patch as never, context) as
        | Record<string, unknown>
        | undefined,
    hardDelete: (id, context) =>
      deleteHabit(id, context) as Record<string, unknown> | undefined
  },
  tag: {
    entityType: "tag",
    routeBase: "/api/v1/tags",
    deleteMode: "soft_default",
    inBin: true,
    list: () => listTags() as Array<Record<string, unknown>>,
    get: (id) => getTagById(id) as Record<string, unknown> | undefined,
    create: (data, context) =>
      createTag(data as never, context) as Record<string, unknown>,
    update: (id, patch, context) =>
      updateTag(id, patch as never, context) as
        | Record<string, unknown>
        | undefined,
    hardDelete: (id, context) =>
      deleteTag(id, context) as Record<string, unknown> | undefined
  },
  note: {
    entityType: "note",
    routeBase: "/api/v1/notes",
    deleteMode: "soft_default",
    inBin: true,
    list: () => listNotes() as Array<Record<string, unknown>>,
    search: searchNotesForEntityCrud,
    get: (id) => getNoteById(id) as Record<string, unknown> | undefined,
    create: (data, context) => {
      const scope = wikiScopeForCrudContext(context);
      const userId = resolveNoteMutationUserId(
        typeof data.userId === "string" ? data.userId : null,
        context.userIds ?? []
      );
      const requestedSpaceId =
        typeof data.spaceId === "string" ? data.spaceId : undefined;
      requireWikiUserScope(scope, userId);
      const spaceId = resolveWikiMutationSpaceId(scope, {
        spaceId: requestedSpaceId,
        userId
      });
      return createContextualNote(
        { ...data, spaceId, userId } as never,
        context
      ) as Record<string, unknown>;
    },
    update: (id, patch, context) => {
      const scope = wikiScopeForCrudContext(context);
      const current = getNoteById(id);
      requireNoteMutationAccess(current, context);
      const userId =
        patch.userId === undefined
          ? undefined
          : resolveNoteMutationUserId(
              typeof patch.userId === "string" ? patch.userId : null,
              context.userIds ?? []
            );
      requireWikiUserScope(scope, userId ?? current?.userId);
      const spaceId =
        typeof patch.spaceId === "string"
          ? resolveWikiMutationSpaceId(scope, {
              spaceId: patch.spaceId,
              userId: userId ?? current?.userId
            })
          : current?.spaceId;
      return updateNote(
        id,
        {
          ...patch,
          ...(userId !== undefined ? { userId } : {}),
          ...(spaceId ? { spaceId } : {})
        } as never,
        context
      ) as Record<string, unknown> | undefined;
    },
    hardDelete: (id, context) => {
      requireNoteMutationAccess(getNoteByIdIncludingDeleted(id), context);
      return deleteNote(id, context) as Record<string, unknown> | undefined;
    }
  },
  person: {
    entityType: "person",
    routeBase: "/api/v1/people",
    deleteMode: "soft_default",
    inBin: true,
    list: () =>
      searchPeopleAcrossOwners({ limit: 500 }) as Array<
        Record<string, unknown>
      >,
    search: (input) =>
      searchPeopleAcrossOwners({
        userIds: input.userIds,
        ids: input.ids,
        query: input.query,
        limit: input.limit
      }) as Array<Record<string, unknown>>,
    get: (id) =>
      attachAuthorizedPersonLinks(
        getPersonByIdAcrossOwners(id) as Record<string, unknown> | undefined
      ),
    create: (data, context) => {
      assertMutationUserScope(context, String(data.userId ?? ""));
      return runInTransaction(() => {
        const person = createPerson(data as never) as Record<string, unknown>;
        replacePersonBatchLinks({
          personId: String(person.id),
          userId: String(person.userId),
          links: (data.links ?? []) as Array<{
            entityType: string;
            entityId: string;
            anchorKey?: string | null;
            relationship?: string;
          }>,
          actor: context.actor
        });
        return attachAuthorizedPersonLinks(person)!;
      });
    },
    update: (id, patch, context) => {
      const current = getPersonByIdAcrossOwners(id);
      if (current) {
        assertMutationUserScope(context, current.userId);
      }
      if (!current) {
        return undefined;
      }
      return runInTransaction(() => {
        const person = updatePerson(id, current.userId, patch as never) as
          | Record<string, unknown>
          | undefined;
        if (!person) {
          return undefined;
        }
        if (patch.links !== undefined) {
          replacePersonBatchLinks({
            personId: id,
            userId: current.userId,
            links: patch.links as Array<{
              entityType: string;
              entityId: string;
              anchorKey?: string | null;
              relationship?: string;
            }>,
            actor: context.actor
          });
        }
        return attachAuthorizedPersonLinks(person);
      });
    },
    softDelete: (id, context) => {
      const current = getPersonByIdAcrossOwners(id);
      if (current) {
        assertMutationUserScope(context, current.userId);
      }
      return current
        ? (softDeletePerson(id, current.userId) as
            | Record<string, unknown>
            | undefined)
        : undefined;
    },
    restore: (id, context) => {
      const current = getPersonByIdAcrossOwners(id, { includeDeleted: true });
      if (current) {
        assertMutationUserScope(context, current.userId);
      }
      return current
        ? (restorePerson(id, current.userId) as
            | Record<string, unknown>
            | undefined)
        : undefined;
    },
    hardDelete: (id, context) => {
      const current = getPersonByIdAcrossOwners(id, { includeDeleted: true });
      if (current) {
        assertMutationUserScope(context, current.userId);
      }
      return current
        ? (hardDeletePerson(id, current.userId) as
            | Record<string, unknown>
            | undefined)
        : undefined;
    }
  },
  insight: {
    entityType: "insight",
    routeBase: "/api/v1/insights",
    deleteMode: "soft_default",
    inBin: true,
    list: () => listInsights() as Array<Record<string, unknown>>,
    get: (id) => getInsightById(id) as Record<string, unknown> | undefined,
    create: (data, context) =>
      createInsight(data as never, context) as Record<string, unknown>,
    update: (id, patch, context) =>
      updateInsight(id, patch as never, context) as
        | Record<string, unknown>
        | undefined,
    hardDelete: (id, context) =>
      deleteInsight(id, context) as Record<string, unknown> | undefined
  },
  calendar_event: {
    entityType: "calendar_event",
    routeBase: "/api/v1/calendar/events",
    deleteMode: "immediate",
    inBin: false,
    list: () =>
      listCalendarEvents(ENTITY_CALENDAR_LIST_RANGE) as Array<
        Record<string, unknown>
      >,
    get: (id) =>
      getCalendarEventById(id) as Record<string, unknown> | undefined,
    create: (data) =>
      createCalendarEvent(data as never) as Record<string, unknown>,
    update: (id, patch) =>
      updateCalendarEvent(id, patch as never) as
        | Record<string, unknown>
        | undefined,
    hardDelete: (id) =>
      deleteCalendarEvent(id) as Record<string, unknown> | undefined
  },
  work_block_template: {
    entityType: "work_block_template",
    routeBase: "/api/v1/calendar/work-block-templates",
    deleteMode: "immediate",
    inBin: false,
    list: () => listWorkBlockTemplates() as Array<Record<string, unknown>>,
    get: (id) =>
      getWorkBlockTemplateById(id) as Record<string, unknown> | undefined,
    create: (data) =>
      createWorkBlockTemplate(data as never) as Record<string, unknown>,
    update: (id, patch) =>
      updateWorkBlockTemplate(id, patch as never) as
        | Record<string, unknown>
        | undefined,
    hardDelete: (id) =>
      deleteWorkBlockTemplate(id) as Record<string, unknown> | undefined
  },
  task_timebox: {
    entityType: "task_timebox",
    routeBase: "/api/v1/calendar/timeboxes",
    deleteMode: "immediate",
    inBin: false,
    list: () =>
      listTaskTimeboxesForEntityCrud() as Array<Record<string, unknown>>,
    search: (input) =>
      searchTaskTimeboxesForEntityCrud({
        ids: input.ids,
        query: input.query,
        status: input.status,
        userIds: input.userIds,
        limit: input.linkedTo ? undefined : input.limit
      }) as Array<Record<string, unknown>>,
    get: (id) => getTaskTimeboxById(id) as Record<string, unknown> | undefined,
    create: (data, context) => {
      const taskId = String(data.taskId ?? "");
      const { task, ownerId } = requireTaskTimeboxTaskScope(taskId, context);
      if (data.userId !== undefined && data.userId !== null) {
        assertMutationUserScope(context, String(data.userId));
      }
      return createTaskTimebox({
        ...data,
        projectId:
          data.projectId === undefined ? task.projectId : data.projectId,
        userId: data.userId ?? ownerId,
        idempotencyKey: context.idempotencyKey ?? null
      } as never) as Record<string, unknown>;
    },
    update: (id, patch, context) => {
      requireTaskTimeboxScope(id, context);
      if (patch.userId !== undefined && patch.userId !== null) {
        assertMutationUserScope(context, String(patch.userId));
      }
      return updateTaskTimebox(id, patch as never) as
        | Record<string, unknown>
        | undefined;
    },
    hardDelete: (id, context) => {
      requireTaskTimeboxScope(id, context);
      return deleteTaskTimebox(id) as Record<string, unknown> | undefined;
    }
  },
  life_event: {
    entityType: "life_event",
    routeBase: "/api/v1/life-events",
    deleteMode: "soft_default",
    inBin: true,
    list: () => listLifeEvents() as Array<Record<string, unknown>>,
    get: (id) => getLifeEventById(id) as Record<string, unknown> | undefined,
    create: (data, context) =>
      createLifeEvent(data as never, context) as Record<string, unknown>,
    update: (id, patch, context) =>
      updateLifeEvent(id, patch as never, context) as
        | Record<string, unknown>
        | undefined,
    hardDelete: (id, context) =>
      deleteLifeEvent(id, context) as Record<string, unknown> | undefined
  },
  artifact: {
    entityType: "artifact",
    routeBase: "/api/v1/artifacts",
    deleteMode: "soft_default",
    inBin: true,
    list: () =>
      listArtifacts().map((artifact) =>
        serializeArtifactPublicPayload(artifact)
      ) as Array<Record<string, unknown>>,
    search: (input, context) =>
      searchArtifactsForEntityCrud({
        ids: input.ids,
        query: input.query,
        linkedTo: input.linkedTo,
        userIds: input.userIds ?? context.artifactScope?.userIds,
        projectIds: context.artifactScope?.projectIds,
        tagIds: context.artifactScope?.tagIds,
        limit: input.limit
      }).map((artifact) => serializeArtifactPublicPayload(artifact)) as Array<
        Record<string, unknown>
      >,
    get: (id) => {
      const artifact = getArtifactById(id);
      return artifact
        ? (serializeArtifactPublicPayload(artifact) as Record<string, unknown>)
        : undefined;
    },
    create: () => createArtifactMetadata() as Record<string, unknown>,
    update: (id, patch, context) => {
      const artifact = updateArtifactMetadata(id, patch as never, context);
      return artifact
        ? (serializeArtifactPublicPayload(artifact) as Record<string, unknown>)
        : undefined;
    },
    softDelete: (id, context) => {
      const artifact = getArtifactById(id, context);
      return artifact
        ? (serializeArtifactPublicPayload(artifact) as Record<string, unknown>)
        : undefined;
    },
    restore: (id, context) => {
      const artifact = getArtifactById(id, context);
      return artifact
        ? (serializeArtifactPublicPayload(artifact) as Record<string, unknown>)
        : undefined;
    },
    hardDelete: (id, context) => {
      const artifact = deleteArtifactMetadata(id, context);
      return artifact
        ? (serializeArtifactPublicPayload(artifact) as Record<string, unknown>)
        : undefined;
    }
  },
  sleep_session: {
    entityType: "sleep_session",
    routeBase: "/api/v1/health/sleep",
    deleteMode: "immediate",
    inBin: false,
    list: () => listSleepSessions() as Array<Record<string, unknown>>,
    get: (id) => getSleepSessionById(id) as Record<string, unknown> | undefined,
    create: (data, context) =>
      createSleepSession(data as never, context) as Record<string, unknown>,
    update: (id, patch, context) =>
      updateSleepSession(id, patch as never, context) as
        | Record<string, unknown>
        | undefined,
    hardDelete: (id, context) =>
      deleteSleepSession(id, context) as Record<string, unknown> | undefined
  },
  workout_session: {
    entityType: "workout_session",
    routeBase: "/api/v1/health/workouts",
    deleteMode: "immediate",
    inBin: false,
    list: () => listWorkoutSessions() as Array<Record<string, unknown>>,
    get: (id) =>
      getWorkoutSessionById(id) as Record<string, unknown> | undefined,
    create: (data, context) =>
      createWorkoutSession(data as never, context) as Record<string, unknown>,
    update: (id, patch, context) =>
      updateWorkoutSession(id, patch as never, context) as
        | Record<string, unknown>
        | undefined,
    hardDelete: (id, context) =>
      deleteWorkoutSession(id, context) as Record<string, unknown> | undefined
  },
  psyche_value: {
    entityType: "psyche_value",
    routeBase: "/api/v1/psyche/values",
    deleteMode: "soft_default",
    inBin: true,
    list: () => listPsycheValues() as Array<Record<string, unknown>>,
    get: (id) => getPsycheValueById(id) as Record<string, unknown> | undefined,
    create: (data, context) =>
      createPsycheValue(data as never, context) as Record<string, unknown>,
    update: (id, patch, context) =>
      updatePsycheValue(id, patch as never, context) as
        | Record<string, unknown>
        | undefined,
    hardDelete: (id, context) =>
      deletePsycheValue(id, context) as Record<string, unknown> | undefined
  },
  behavior_pattern: {
    entityType: "behavior_pattern",
    routeBase: "/api/v1/psyche/patterns",
    deleteMode: "soft_default",
    inBin: true,
    list: () => listBehaviorPatterns() as Array<Record<string, unknown>>,
    get: (id) =>
      getBehaviorPatternById(id) as Record<string, unknown> | undefined,
    create: (data, context) =>
      createBehaviorPattern(data as never, context) as Record<string, unknown>,
    update: (id, patch, context) =>
      updateBehaviorPattern(id, patch as never, context) as
        | Record<string, unknown>
        | undefined,
    hardDelete: (id, context) =>
      deleteBehaviorPattern(id, context) as Record<string, unknown> | undefined
  },
  behavior: {
    entityType: "behavior",
    routeBase: "/api/v1/psyche/behaviors",
    deleteMode: "soft_default",
    inBin: true,
    list: () => listBehaviors() as Array<Record<string, unknown>>,
    get: (id) => getBehaviorById(id) as Record<string, unknown> | undefined,
    create: (data, context) =>
      createBehavior(data as never, context) as Record<string, unknown>,
    update: (id, patch, context) =>
      updateBehavior(id, patch as never, context) as
        | Record<string, unknown>
        | undefined,
    hardDelete: (id, context) =>
      deleteBehavior(id, context) as Record<string, unknown> | undefined
  },
  belief_entry: {
    entityType: "belief_entry",
    routeBase: "/api/v1/psyche/beliefs",
    deleteMode: "soft_default",
    inBin: true,
    list: () => listBeliefEntries() as Array<Record<string, unknown>>,
    get: (id) => getBeliefEntryById(id) as Record<string, unknown> | undefined,
    create: (data, context) =>
      createBeliefEntry(data as never, context) as Record<string, unknown>,
    update: (id, patch, context) =>
      updateBeliefEntry(id, patch as never, context) as
        | Record<string, unknown>
        | undefined,
    hardDelete: (id, context) =>
      deleteBeliefEntry(id, context) as Record<string, unknown> | undefined
  },
  mode_profile: {
    entityType: "mode_profile",
    routeBase: "/api/v1/psyche/modes",
    deleteMode: "soft_default",
    inBin: true,
    list: () => listModeProfiles() as Array<Record<string, unknown>>,
    get: (id) => getModeProfileById(id) as Record<string, unknown> | undefined,
    create: (data, context) =>
      createModeProfile(data as never, context) as Record<string, unknown>,
    update: (id, patch, context) =>
      updateModeProfile(id, patch as never, context) as
        | Record<string, unknown>
        | undefined,
    hardDelete: (id, context) =>
      deleteModeProfile(id, context) as Record<string, unknown> | undefined
  },
  mode_guide_session: {
    entityType: "mode_guide_session",
    routeBase: "/api/v1/psyche/mode-guides",
    deleteMode: "soft_default",
    inBin: true,
    list: () => listModeGuideSessions(200) as Array<Record<string, unknown>>,
    get: (id) =>
      getModeGuideSessionById(id) as Record<string, unknown> | undefined,
    create: (data, context) =>
      createModeGuideSession(data as never, context) as Record<string, unknown>,
    update: (id, patch, context) =>
      updateModeGuideSession(id, patch as never, context) as
        | Record<string, unknown>
        | undefined,
    hardDelete: (id, context) =>
      deleteModeGuideSession(id, context) as Record<string, unknown> | undefined
  },
  flashcard: {
    entityType: "flashcard",
    routeBase: "/api/v1/entities",
    deleteMode: "soft_default",
    inBin: true,
    list: () => listFlashcards() as Array<Record<string, unknown>>,
    get: (id) => getFlashcardById(id) as Record<string, unknown> | undefined,
    create: (data, context) =>
      createFlashcard(data as never, context) as Record<string, unknown>,
    update: (id, patch, context) =>
      updateFlashcard(id, patch as never, context) as
        | Record<string, unknown>
        | undefined,
    hardDelete: (id, context) =>
      deleteFlashcard(id, context) as Record<string, unknown> | undefined
  },
  event_type: {
    entityType: "event_type",
    routeBase: "/api/v1/psyche/event-types",
    deleteMode: "soft_default",
    inBin: true,
    list: () => listEventTypes() as Array<Record<string, unknown>>,
    get: (id) => getEventTypeById(id) as Record<string, unknown> | undefined,
    create: (data, context) =>
      createEventType(data as never, context) as Record<string, unknown>,
    update: (id, patch, context) =>
      updateEventType(id, patch as never, context) as
        | Record<string, unknown>
        | undefined,
    hardDelete: (id, context) =>
      deleteEventType(id, context) as Record<string, unknown> | undefined
  },
  emotion_definition: {
    entityType: "emotion_definition",
    routeBase: "/api/v1/psyche/emotions",
    deleteMode: "soft_default",
    inBin: true,
    list: () => listEmotionDefinitions() as Array<Record<string, unknown>>,
    get: (id) =>
      getEmotionDefinitionById(id) as Record<string, unknown> | undefined,
    create: (data, context) =>
      createEmotionDefinition(data as never, context) as Record<
        string,
        unknown
      >,
    update: (id, patch, context) =>
      updateEmotionDefinition(id, patch as never, context) as
        | Record<string, unknown>
        | undefined,
    hardDelete: (id, context) =>
      deleteEmotionDefinition(id, context) as
        | Record<string, unknown>
        | undefined
  },
  trigger_report: {
    entityType: "trigger_report",
    routeBase: "/api/v1/psyche/reports",
    deleteMode: "soft_default",
    inBin: true,
    list: () => listTriggerReports(200) as Array<Record<string, unknown>>,
    search: (input) =>
      searchTriggerReports({
        userIds: input.userIds,
        ids: input.ids,
        query: input.query,
        statuses: input.status,
        linkedTo: input.linkedTo,
        limit: input.limit
      }) as Array<Record<string, unknown>>,
    get: (id) =>
      getTriggerReportById(id) as Record<string, unknown> | undefined,
    create: (data, context) =>
      createTriggerReport(data as never, context) as Record<string, unknown>,
    update: (id, patch, context) =>
      updateTriggerReport(id, patch as never, context) as
        | Record<string, unknown>
        | undefined,
    hardDelete: (id, context) =>
      deleteTriggerReport(id, context) as Record<string, unknown> | undefined
  },
  preference_catalog: {
    entityType: "preference_catalog",
    routeBase: "/api/v1/preferences/catalogs",
    deleteMode: "soft_default",
    inBin: true,
    list: () => listPreferenceCatalogs() as Array<Record<string, unknown>>,
    search: (input) =>
      listPreferenceCatalogs({
        userIds: input.userIds,
        ids: input.ids,
        query: input.query,
        linkedTo: input.linkedTo,
        limit: input.limit
      }) as Array<Record<string, unknown>>,
    get: (id) =>
      getPreferenceCatalogById(id) as Record<string, unknown> | undefined,
    create: (data, context) => {
      assertMutationUserScope(context, String(data.userId ?? ""));
      return createPreferenceCatalog(
        data as never,
        context,
        context.idempotencyKey
      ) as Record<string, unknown>;
    },
    update: (id, patch, context) => {
      const current = getPreferenceCatalogById(id);
      if (current) {
        assertMutationUserScope(context, current.userId);
      }
      return updatePreferenceCatalog(id, patch as never, context) as
        | Record<string, unknown>
        | undefined;
    },
    softDelete: (id, context) => {
      const current = getPreferenceCatalogById(id);
      if (current) {
        assertMutationUserScope(context, current.userId);
      }
      return archivePreferenceCatalog(id) as Record<string, unknown>;
    },
    restore: (id, context) => {
      const current = getPreferenceCatalogById(id, true);
      if (current) {
        assertMutationUserScope(context, current.userId);
      }
      const restored = restorePreferenceCatalog(id);
      return restored as Record<string, unknown>;
    },
    hardDelete: (id, context) => {
      const current = getPreferenceCatalogById(id, true);
      if (current) {
        assertMutationUserScope(context, current.userId);
      }
      return runInTransaction(() => {
        getDatabase()
          .prepare(
            `DELETE FROM deleted_entities
             WHERE entity_type = 'preference_catalog_item'
               AND entity_id IN (
                 SELECT id
                 FROM preference_catalog_items
                 WHERE catalog_id = ?
               )`
          )
          .run(id);
        return hardDeletePreferenceCatalog(id) as Record<string, unknown>;
      });
    }
  },
  preference_catalog_item: {
    entityType: "preference_catalog_item",
    routeBase: "/api/v1/preferences/catalog-items",
    deleteMode: "soft_default",
    inBin: true,
    list: () => listPreferenceCatalogItems() as Array<Record<string, unknown>>,
    search: (input) =>
      listPreferenceCatalogItems({
        userIds: input.userIds,
        ids: input.ids,
        catalogIds:
          input.linkedTo?.entityType === "preference_catalog"
            ? [input.linkedTo.id]
            : undefined,
        query: input.query,
        limit: input.limit
      }) as Array<Record<string, unknown>>,
    get: (id) =>
      getPreferenceCatalogItemById(id) as Record<string, unknown> | undefined,
    create: (data, context) => {
      const catalog = getPreferenceCatalogById(String(data.catalogId ?? ""));
      if (catalog) {
        assertMutationUserScope(context, catalog.userId);
      }
      return createPreferenceCatalogItem(data as never) as Record<
        string,
        unknown
      >;
    },
    update: (id, patch, context) => {
      assertPreferenceCatalogItemScope(
        getPreferenceCatalogItemById(id),
        context
      );
      return updatePreferenceCatalogItem(id, patch as never) as
        | Record<string, unknown>
        | undefined;
    },
    softDelete: (id, context) => {
      assertPreferenceCatalogItemScope(
        getPreferenceCatalogItemById(id),
        context
      );
      return archivePreferenceCatalogItem(id) as
        | Record<string, unknown>
        | undefined;
    },
    restore: (id, context) => {
      assertPreferenceCatalogItemScope(
        getPreferenceCatalogItemById(id, true),
        context
      );
      return restorePreferenceCatalogItem(id) as
        | Record<string, unknown>
        | undefined;
    },
    hardDelete: (id, context) => {
      assertPreferenceCatalogItemScope(
        getPreferenceCatalogItemById(id, true),
        context
      );
      return hardDeletePreferenceCatalogItem(id) as
        | Record<string, unknown>
        | undefined;
    }
  },
  preference_context: {
    entityType: "preference_context",
    routeBase: "/api/v1/preferences/contexts",
    deleteMode: "immediate",
    inBin: false,
    list: () => listPreferenceContexts() as Array<Record<string, unknown>>,
    search: (input) =>
      listPreferenceContexts({
        userIds: input.userIds,
        ids: input.ids,
        query: input.query,
        limit: input.limit
      }) as Array<Record<string, unknown>>,
    get: (id) =>
      getPreferenceContextById(id) as Record<string, unknown> | undefined,
    create: (data, context) => {
      assertMutationUserScope(context, String(data.userId ?? ""));
      return createPreferenceContext(data as never) as Record<string, unknown>;
    },
    update: (id, patch, context) => {
      assertPreferenceProfileScope(
        getPreferenceContextById(id)?.profileId,
        context
      );
      return updatePreferenceContext(id, patch as never) as
        | Record<string, unknown>
        | undefined;
    },
    hardDelete: (id, context) => {
      assertPreferenceProfileScope(
        getPreferenceContextById(id)?.profileId,
        context
      );
      return deletePreferenceContext(id) as Record<string, unknown> | undefined;
    }
  },
  preference_item: {
    entityType: "preference_item",
    routeBase: "/api/v1/preferences/items",
    deleteMode: "immediate",
    inBin: false,
    list: () => listPreferenceItems() as Array<Record<string, unknown>>,
    search: (input) =>
      listPreferenceItems({
        userIds: input.userIds,
        ids: input.ids,
        query: input.query,
        limit: input.limit
      }) as Array<Record<string, unknown>>,
    get: (id) =>
      getPreferenceItemById(id) as Record<string, unknown> | undefined,
    create: (data, context) => {
      assertMutationUserScope(context, String(data.userId ?? ""));
      if (
        typeof data.sourceEntityType === "string" &&
        typeof data.sourceEntityId === "string"
      ) {
        requirePreferenceSourceReadAccess(
          data.sourceEntityType as CrudEntityType,
          data.sourceEntityId,
          context
        );
      }
      return createPreferenceItem(data as never) as Record<string, unknown>;
    },
    update: (id, patch, context) => {
      const current = getPreferenceItemById(id);
      assertPreferenceProfileScope(current?.profileId, context);
      if (
        current &&
        ("sourceEntityType" in patch || "sourceEntityId" in patch)
      ) {
        const sourceEntityType =
          typeof patch.sourceEntityType === "string"
            ? (patch.sourceEntityType as CrudEntityType)
            : patch.sourceEntityType === null
              ? null
              : current.sourceEntityType;
        const sourceEntityId =
          typeof patch.sourceEntityId === "string"
            ? patch.sourceEntityId
            : patch.sourceEntityId === null
              ? null
              : current.sourceEntityId;
        if (sourceEntityType && sourceEntityId) {
          requirePreferenceSourceReadAccess(
            sourceEntityType,
            sourceEntityId,
            context
          );
        }
      }
      return updatePreferenceItem(id, patch as never) as
        | Record<string, unknown>
        | undefined;
    },
    hardDelete: (id, context) => {
      assertPreferenceProfileScope(
        getPreferenceItemById(id)?.profileId,
        context
      );
      return deletePreferenceItem(id) as Record<string, unknown> | undefined;
    }
  },
  questionnaire_instrument: {
    entityType: "questionnaire_instrument",
    routeBase: "/api/v1/psyche/questionnaires",
    deleteMode: "immediate",
    inBin: false,
    list: () =>
      listQuestionnaireInstrumentEntities() as Array<Record<string, unknown>>,
    get: (id) =>
      getQuestionnaireInstrumentEntityById(id) as
        | Record<string, unknown>
        | undefined,
    create: (data, context) =>
      createQuestionnaireInstrument(data as never, context)
        .instrument as Record<string, unknown>,
    update: (id, patch, context) =>
      updateQuestionnaireInstrument(id, patch as never, context) as
        | Record<string, unknown>
        | undefined,
    hardDelete: (id, context) =>
      deleteQuestionnaireInstrument(id, context) as
        | Record<string, unknown>
        | undefined
  }
};

export function getCrudEntityCapabilityMatrix() {
  return Object.values(CRUD_ENTITY_CAPABILITIES).map((capability) => ({
    entityType: capability.entityType,
    routeBase: capability.routeBase,
    pluginExposed: true,
    deleteMode: capability.deleteMode,
    inBin: capability.inBin,
    minimalCreatePayload: buildMinimalExamplePayload(
      getCreateSchema(capability.entityType)
    )
  }));
}

function getCapability(entityType: CrudEntityType) {
  return CRUD_ENTITY_CAPABILITIES[entityType];
}

export const CRUD_OWNERSHIP_AUTHORIZATION_MATRIX = Object.freeze(
  (Object.keys(CRUD_ENTITY_CAPABILITIES) as CrudEntityType[]).map(
    (entityType) =>
      Object.freeze({
        entityType,
        routeBase: CRUD_ENTITY_CAPABILITIES[entityType].routeBase,
        collectionKey:
          (
            {
              goal: "goals",
              project: "projects",
              task: "tasks",
              strategy: "strategies",
              habit: "habits",
              tag: "tags",
              note: "notes",
              person: "people",
              insight: "insights",
              calendar_event: "events",
              work_block_template: "templates",
              task_timebox: "timeboxes",
              artifact: "artifacts",
              sleep_session: "sleep",
              psyche_value: "values",
              behavior_pattern: "patterns",
              behavior: "behaviors",
              belief_entry: "beliefs",
              mode_profile: "modes",
              mode_guide_session: "modeGuides",
              event_type: "eventTypes",
              emotion_definition: "emotions",
              trigger_report: "reports",
              preference_catalog: "catalogs",
              preference_catalog_item: "items",
              preference_context: "contexts",
              preference_item: "items",
              questionnaire_instrument: "questionnaires"
            } as Partial<Record<CrudEntityType, string>>
          )[entityType] ?? null,
        actions: Object.freeze([
          ...(entityType === "artifact" ? [] : (["create"] as const)),
          "read",
          "update",
          "delete",
          ...(CRUD_ENTITY_CAPABILITIES[entityType].inBin
            ? (["restore"] as const)
            : []),
          "search"
        ]),
        boundary: "entity_owner_and_scope_policy" as const
      })
  )
);

function stringValues(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function linkedEntityIds(
  entity: Record<string, unknown>,
  entityType: string
) {
  if (!Array.isArray(entity.links)) {
    return [];
  }
  return entity.links.flatMap((link) => {
    if (
      !link ||
      typeof link !== "object" ||
      Array.isArray(link) ||
      (link as Record<string, unknown>).entityType !== entityType &&
        (link as Record<string, unknown>).targetEntityType !== entityType
    ) {
      return [];
    }
    const entityId =
      typeof (link as Record<string, unknown>).entityId === "string"
        ? ((link as Record<string, unknown>).entityId as string)
        : typeof (link as Record<string, unknown>).targetEntityId === "string"
          ? ((link as Record<string, unknown>).targetEntityId as string)
          : null;
    return entityId ? [entityId] : [];
  });
}

export function entityMatchesCrudScope(
  entityType: CrudEntityType,
  entity: Record<string, unknown> & { id: string },
  context: Pick<CrudContext, "userIds" | "projectIds" | "tagIds">
) {
  const globallyVisibleSystemTaxonomy =
    (entityType === "event_type" ||
      entityType === "emotion_definition") &&
    entity.system === true;
  if (
    context.userIds?.length &&
    !globallyVisibleSystemTaxonomy &&
    filterOwnedEntities(entityType, [entity], context.userIds).length === 0
  ) {
    return false;
  }

  if (context.projectIds?.length) {
    const projectIds = new Set(context.projectIds);
    const linkedProjectIds = [
      ...(entityType === "project" ? [entity.id] : []),
      ...(typeof entity.projectId === "string" ? [entity.projectId] : []),
      ...stringValues(entity.projectIds),
      ...stringValues(entity.linkedProjectIds),
      ...linkedEntityIds(entity, "project")
    ];
    if (
      entityType === "goal" &&
      listProjects().some(
        (project) => project.goalId === entity.id && projectIds.has(project.id)
      )
    ) {
      linkedProjectIds.push(...context.projectIds);
    }
    if (!linkedProjectIds.some((projectId) => projectIds.has(projectId))) {
      return false;
    }
  }

  if (context.tagIds?.length) {
    const tagIds = new Set(context.tagIds);
    const linkedTagIds = [
      ...(entityType === "tag" ? [entity.id] : []),
      ...stringValues(entity.tagIds),
      ...stringValues(entity.linkedTagIds),
      ...linkedEntityIds(entity, "tag")
    ];
    if (!linkedTagIds.some((tagId) => tagIds.has(tagId))) {
      return false;
    }
  }
  return true;
}

function getScopedCrudEntity(
  entityType: CrudEntityType,
  id: string,
  context: Pick<CrudContext, "userIds" | "projectIds" | "tagIds">
) {
  const entity = getCapability(entityType).get(id) as
    | (Record<string, unknown> & { id: string })
    | undefined;
  return entity && entityMatchesCrudScope(entityType, entity, context)
    ? entity
    : undefined;
}

export function resolveCrudRouteOwnership(routePath: string) {
  const matches = CRUD_OWNERSHIP_AUTHORIZATION_MATRIX.filter(
    (entry) =>
      entry.routeBase !== "/api/v1/entities" &&
      (routePath === entry.routeBase ||
        routePath.startsWith(`${entry.routeBase}/`))
  ).sort((left, right) => right.routeBase.length - left.routeBase.length);
  return matches[0] ?? null;
}

export function crudEntityIsVisible(
  entityType: CrudEntityType,
  id: string,
  context: Pick<CrudContext, "userIds" | "projectIds" | "tagIds">
) {
  if (
    entityType === "artifact" &&
    !canAccessArtifact(id, { source: "system", ...context })
  ) {
    return false;
  }
  if (getScopedCrudEntity(entityType, id, context)) {
    return true;
  }
  const deleted = getDeletedEntityRecord(entityType, id);
  return Boolean(
    deleted &&
    entityMatchesCrudScope(entityType, { ...deleted.snapshot, id }, context)
  );
}

export function crudEntityIsLiveAndVisible(
  entityType: CrudEntityType,
  id: string,
  context: Pick<CrudContext, "userIds" | "projectIds" | "tagIds">
) {
  if (getDeletedEntityRecord(entityType, id)) {
    return false;
  }
  if (!context.projectIds?.length && !context.tagIds?.length) {
    const sourceTables: Partial<Record<CrudEntityType, string>> = {
      goal: "goals",
      project: "projects",
      task: "tasks",
      strategy: "strategies",
      habit: "habits",
      trigger_report: "trigger_reports"
    };
    const sourceTable = sourceTables[entityType];
    if (sourceTable) {
      const userIds = context.userIds ?? [];
      if (userIds.length === 0) {
        return Boolean(
          getDatabase()
            .prepare(`SELECT 1 FROM ${sourceTable} WHERE id = ? LIMIT 1`)
            .get(id)
        );
      }
      const userPlaceholders = userIds.map(() => "?").join(", ");
      return Boolean(
        getDatabase()
          .prepare(
            `SELECT 1
             FROM ${sourceTable}
             WHERE id = ?
               AND (
                 EXISTS (
                   SELECT 1 FROM entity_owners
                   WHERE entity_type = ?
                     AND entity_id = ?
                     AND user_id IN (${userPlaceholders})
                 )
                 OR EXISTS (
                   SELECT 1 FROM entity_assignments
                   WHERE entity_type = ?
                     AND entity_id = ?
                     AND role = 'assignee'
                     AND user_id IN (${userPlaceholders})
                 )
               )
             LIMIT 1`
          )
          .get(
            id,
            entityType,
            id,
            ...userIds,
            entityType,
            id,
            ...userIds
          )
      );
    }
  }
  if (
    entityType === "artifact" &&
    !canAccessArtifact(id, { source: "system", ...context })
  ) {
    return false;
  }
  return Boolean(getScopedCrudEntity(entityType, id, context));
}

export function createContextualNote(
  input: CreateNoteInput,
  context: CrudContext
): Note {
  const createContext = input.createContext;
  if (!createContext) {
    return createNote(input, context);
  }

  return runInTransaction(() => {
    const sourceLinks = input.links.filter(
      (link) =>
        link.entityType === createContext.sourceEntityType &&
        link.entityId === createContext.sourceEntityId
    );
    if (
      sourceLinks.length !== 1 ||
      (sourceLinks[0]?.anchorKey ?? null) !== createContext.anchorKey
    ) {
      throw new HttpError(
        400,
        "note_create_context_ambiguous",
        "The related note must contain one exact link to its source record."
      );
    }
    if (
      !crudEntityIsLiveAndVisible(
        createContext.sourceEntityType,
        createContext.sourceEntityId,
        context
      )
    ) {
      throw new HttpError(
        404,
        "note_create_context_not_found",
        "The source record is unavailable. The note was not created."
      );
    }

    const { createContext: _createContext, ...noteInput } = input;
    return createNoteWithinTransaction(noteInput, context);
  });
}

export function getEntityById(
  entityType: CrudEntityType,
  id: string
): Record<string, unknown> | undefined {
  return getCapability(entityType).get(id);
}

const CREATE_ENTITY_SCHEMAS: Record<
  CrudEntityType,
  { parse: (value: unknown) => Record<string, unknown> }
> = {
  goal: createGoalSchema,
  project: createProjectSchema,
  task: createTaskSchema,
  strategy: createStrategySchema,
  habit: createHabitSchema,
  tag: createTagSchema,
  note: createNoteSchema,
  person: createPersonSchema,
  insight: createInsightSchema,
  calendar_event: createCalendarEventSchema,
  work_block_template: createWorkBlockTemplateSchema,
  task_timebox: createTaskTimeboxSchema,
  life_event: createLifeEventSchema,
  artifact: artifactMetadataCreateSchema,
  sleep_session: createSleepSessionSchema,
  workout_session: createWorkoutSessionSchema,
  psyche_value: createPsycheValueSchema,
  behavior_pattern: createBehaviorPatternSchema,
  behavior: createBehaviorSchema,
  belief_entry: createBeliefEntrySchema,
  mode_profile: createModeProfileSchema,
  mode_guide_session: createModeGuideSessionSchema,
  flashcard: createFlashcardSchema,
  event_type: createEventTypeSchema,
  emotion_definition: createEmotionDefinitionSchema,
  trigger_report: createTriggerReportSchema,
  preference_catalog: createPreferenceCatalogSchema,
  preference_catalog_item: createPreferenceCatalogItemSchema,
  preference_context: createPreferenceContextSchema,
  preference_item: createPreferenceItemSchema,
  questionnaire_instrument: createQuestionnaireInstrumentSchema
};

const UPDATE_ENTITY_SCHEMAS: Record<
  CrudEntityType,
  { parse: (value: unknown) => Record<string, unknown> }
> = {
  goal: updateGoalSchema,
  project: updateProjectSchema,
  task: updateTaskSchema,
  strategy: updateStrategySchema,
  habit: updateHabitSchema,
  tag: updateTagSchema,
  note: updateNoteSchema,
  person: updatePersonSchema,
  insight: updateInsightSchema,
  calendar_event: updateCalendarEventSchema,
  work_block_template: updateWorkBlockTemplateSchema,
  task_timebox: updateTaskTimeboxSchema,
  life_event: updateLifeEventSchema,
  artifact: artifactMetadataPatchSchema,
  sleep_session: updateSleepSessionSchema,
  workout_session: updateWorkoutSessionSchema,
  psyche_value: updatePsycheValueSchema,
  behavior_pattern: updateBehaviorPatternSchema,
  behavior: updateBehaviorSchema,
  belief_entry: updateBeliefEntrySchema,
  mode_profile: updateModeProfileSchema,
  mode_guide_session: updateModeGuideSessionSchema,
  flashcard: updateFlashcardSchema,
  event_type: updateEventTypeSchema,
  emotion_definition: updateEmotionDefinitionSchema,
  trigger_report: updateTriggerReportSchema,
  preference_catalog: updatePreferenceCatalogSchema,
  preference_catalog_item: updatePreferenceCatalogItemSchema,
  preference_context: updatePreferenceContextSchema,
  preference_item: updatePreferenceItemSchema,
  questionnaire_instrument: updateQuestionnaireInstrumentSchema
};

type CrudEntitySchema = z.ZodObject<z.ZodRawShape>;

function getCreateSchema(entityType: CrudEntityType) {
  return CREATE_ENTITY_SCHEMAS[entityType] as CrudEntitySchema;
}

function getUpdateSchema(entityType: CrudEntityType) {
  return UPDATE_ENTITY_SCHEMAS[entityType] as CrudEntitySchema;
}

function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
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

function isRequiredField(schema: z.ZodTypeAny) {
  if (schema instanceof z.ZodOptional) {
    return false;
  }
  if (schema instanceof z.ZodDefault) {
    return false;
  }
  return true;
}

function collectRequiredTopLevelFields(schema: CrudEntitySchema) {
  const unwrapped = unwrapSchema(schema);
  if (!(unwrapped instanceof z.ZodObject)) {
    return [];
  }
  return Object.entries(unwrapped.shape as z.ZodRawShape)
    .filter(([, fieldSchema]) => isRequiredField(fieldSchema))
    .map(([key]) => key)
    .sort();
}

function extractAllowedTopLevelFields(schema: CrudEntitySchema) {
  const unwrapped = unwrapSchema(schema);
  if (!(unwrapped instanceof z.ZodObject)) {
    return [];
  }
  return Object.keys(unwrapped.shape as z.ZodRawShape).sort();
}

function buildExampleValue(schema: z.ZodTypeAny): unknown {
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
    const objectValue: Record<string, unknown> = {};
    for (const [key, fieldSchema] of Object.entries(
      unwrapped.shape as z.ZodRawShape
    )) {
      if (!isRequiredField(fieldSchema)) {
        continue;
      }
      objectValue[key] = buildExampleValue(fieldSchema);
    }
    return objectValue;
  }
  return "value";
}

function buildMinimalExamplePayload(schema: CrudEntitySchema) {
  const unwrapped = unwrapSchema(schema);
  if (!(unwrapped instanceof z.ZodObject)) {
    return {};
  }
  const requiredFields = collectRequiredTopLevelFields(schema);
  const example: Record<string, unknown> = {};
  const shape = unwrapped.shape as z.ZodRawShape;
  for (const field of requiredFields) {
    example[field] = buildExampleValue(shape[field]!);
  }
  return example;
}

function formatIssuePath(path: PropertyKey[]) {
  return path.length > 0 ? path.map(String).join(".") : "body";
}

function buildValidationOperationError(input: {
  code: string;
  message: string;
  operationType: CrudOperationType;
  entityType: CrudEntityType;
  clientRef?: string;
  schema: CrudEntitySchema;
  error: ZodError;
}) {
  const issues: OperationValidationIssue[] = input.error.issues.map((issue) => {
    const allowedValues =
      "options" in issue && Array.isArray(issue.options)
        ? [...issue.options]
        : undefined;
    return {
      path: formatIssuePath(issue.path),
      message: issue.message,
      code: issue.code,
      ...(allowedValues ? { allowedValues } : {})
    };
  });
  const missingRequiredFields = Array.from(
    new Set(
      input.error.issues
        .filter(
          (issue) =>
            issue.code === "invalid_type" &&
            "received" in issue &&
            issue.received === "undefined" &&
            issue.path.length > 0
        )
        .map((issue) => formatIssuePath(issue.path))
    )
  ).sort();
  const invalidValueGuidance = input.error.issues
    .filter(
      (issue) =>
        "options" in issue &&
        Array.isArray((issue as { options?: unknown[] }).options)
    )
    .map((issue) => ({
      path: formatIssuePath(issue.path),
      allowedValues: [...((issue as { options: unknown[] }).options ?? [])],
      message: issue.message
    }));
  return {
    code: input.code,
    message: input.message,
    operationType: input.operationType,
    entityType: input.entityType,
    clientRef: input.clientRef,
    routeHint: `/api/v1/entities/${input.operationType}`,
    toolHint:
      input.operationType === "search"
        ? "forge_search_entities"
        : `forge_${input.operationType}_entities`,
    summary: `${input.entityType} ${input.operationType} payload failed validation.`,
    issues,
    missingRequiredFields,
    invalidValueGuidance,
    allowedTopLevelFields: extractAllowedTopLevelFields(input.schema),
    minimalExamplePayload: buildMinimalExamplePayload(input.schema)
  } satisfies OperationErrorPayload;
}

function parseCreateInput(
  entityType: CrudEntityType,
  data: Record<string, unknown>
) {
  return getCreateSchema(entityType).parse(data);
}

function parseUpdatePatch(
  entityType: CrudEntityType,
  patch: Record<string, unknown>
) {
  return getUpdateSchema(entityType).parse(patch);
}

function toOperationError(code: string, message: string) {
  return {
    code,
    message
  };
}

function markRolledBack(result: EntityOperationResult): EntityOperationResult {
  if (!result.ok) {
    return result;
  }
  return {
    ok: false,
    entityType: result.entityType,
    id: result.id,
    clientRef: result.clientRef,
    error: toOperationError(
      "rolled_back",
      "Rolled back because an earlier atomic batch operation failed."
    )
  };
}

function markNotExecuted(entry: {
  entityType: CrudEntityType;
  id?: string;
  clientRef?: string;
}): EntityOperationResult {
  return {
    ok: false,
    entityType: entry.entityType,
    id: entry.id,
    clientRef: entry.clientRef,
    error: toOperationError(
      "not_executed",
      "Skipped because an earlier atomic batch operation failed."
    )
  };
}

function finalizeAtomicRollbackResults<
  TEntry extends {
    entityType: CrudEntityType;
    id?: string;
    clientRef?: string;
  }
>(
  entries: TEntry[],
  partialResults: EntityOperationResult[],
  rollback: AtomicBatchRollback
) {
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
      } satisfies EntityOperationResult;
    }
    return markNotExecuted(entry);
  });
}

function executeBatchOperation<
  TEntry extends {
    entityType: CrudEntityType;
    id?: string;
    clientRef?: string;
  }
>(
  entries: TEntry[],
  atomic: boolean,
  execute: (entry: TEntry) => EntityOperationResult
) {
  if (!atomic) {
    return { results: entries.map((entry) => execute(entry)) };
  }

  const partialResults: EntityOperationResult[] = [];

  try {
    runInTransaction(() => {
      entries.forEach((entry, index) => {
        const result = execute(entry);
        partialResults[index] = result;
        if (!result.ok) {
          throw new AtomicBatchRollback(
            index,
            result.error?.code ?? "batch_failed",
            result.error?.message ?? "Atomic batch failed."
          );
        }
      });
      return partialResults;
    });
    return { results: partialResults };
  } catch (error) {
    if (error instanceof AtomicBatchRollback) {
      return {
        results: finalizeAtomicRollbackResults(entries, partialResults, error)
      };
    }
    throw error;
  }
}

function describeEntity(
  entityType: CrudEntityType,
  entity: Record<string, unknown>
) {
  const title =
    typeof entity.title === "string" && entity.title.trim().length > 0
      ? entity.title
      : typeof entity.name === "string" && entity.name.trim().length > 0
        ? entity.name
        : typeof entity.displayName === "string" &&
            entity.displayName.trim().length > 0
          ? entity.displayName
          : typeof entity.label === "string" && entity.label.trim().length > 0
            ? entity.label
            : typeof entity.summary === "string" &&
                entity.summary.trim().length > 0
              ? entity.summary
              : typeof entity.message === "string" &&
                  entity.message.trim().length > 0
                ? entity.message.slice(0, 72)
                : typeof entity.body === "string" &&
                    entity.body.trim().length > 0
                  ? entity.body.slice(0, 72)
                  : entityType.replaceAll("_", " ");

  const subtitle =
    typeof entity.description === "string" &&
    entity.description.trim().length > 0
      ? entity.description
      : typeof entity.summary === "string" && entity.summary.trim().length > 0
        ? entity.summary
        : typeof entity.body === "string" && entity.body.trim().length > 0
          ? entity.body
          : "";

  return { title, subtitle };
}

function linkMatchesTarget(
  link: unknown,
  linkedTo: { entityType: CrudEntityType; id: string }
) {
  if (typeof link !== "object" || link === null) {
    return false;
  }
  const candidate = link as Record<string, unknown>;
  return (
    (candidate.entityType === linkedTo.entityType &&
      candidate.entityId === linkedTo.id) ||
    (candidate.targetEntityType === linkedTo.entityType &&
      candidate.targetEntityId === linkedTo.id)
  );
}

function matchesLinkedTo(
  entityType: CrudEntityType,
  entity: Record<string, unknown>,
  linkedTo: { entityType: CrudEntityType; id: string }
) {
  switch (entityType) {
    case "project":
      return linkedTo.entityType === "goal" && entity.goalId === linkedTo.id;
    case "task":
      return (
        (linkedTo.entityType === "goal" && entity.goalId === linkedTo.id) ||
        (linkedTo.entityType === "project" && entity.projectId === linkedTo.id)
      );
    case "habit":
      return (
        (linkedTo.entityType === "goal" &&
          Array.isArray(entity.linkedGoalIds) &&
          entity.linkedGoalIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "project" &&
          Array.isArray(entity.linkedProjectIds) &&
          entity.linkedProjectIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "task" &&
          Array.isArray(entity.linkedTaskIds) &&
          entity.linkedTaskIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "psyche_value" &&
          Array.isArray(entity.linkedValueIds) &&
          entity.linkedValueIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "behavior_pattern" &&
          Array.isArray(entity.linkedPatternIds) &&
          entity.linkedPatternIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "behavior" &&
          Array.isArray(entity.linkedBehaviorIds) &&
          entity.linkedBehaviorIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "belief_entry" &&
          Array.isArray(entity.linkedBeliefIds) &&
          entity.linkedBeliefIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "mode_profile" &&
          Array.isArray(entity.linkedModeIds) &&
          entity.linkedModeIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "trigger_report" &&
          Array.isArray(entity.linkedReportIds) &&
          entity.linkedReportIds.includes(linkedTo.id))
      );
    case "note":
      return (
        Array.isArray(entity.links) &&
        entity.links.some((link) => linkMatchesTarget(link, linkedTo))
      );
    case "insight":
      return (
        entity.entityType === linkedTo.entityType &&
        entity.entityId === linkedTo.id
      );
    case "calendar_event":
    case "life_event":
    case "sleep_session":
    case "workout_session":
      return (
        Array.isArray(entity.links) &&
        entity.links.some((link) => linkMatchesTarget(link, linkedTo))
      );
    case "task_timebox":
      return (
        (linkedTo.entityType === "task" && entity.taskId === linkedTo.id) ||
        (linkedTo.entityType === "project" && entity.projectId === linkedTo.id)
      );
    case "artifact":
      return (
        Array.isArray(entity.links) &&
        entity.links.some((link) => linkMatchesTarget(link, linkedTo))
      );
    case "psyche_value":
      return (
        (linkedTo.entityType === "goal" &&
          Array.isArray(entity.linkedGoalIds) &&
          entity.linkedGoalIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "project" &&
          Array.isArray(entity.linkedProjectIds) &&
          entity.linkedProjectIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "task" &&
          Array.isArray(entity.linkedTaskIds) &&
          entity.linkedTaskIds.includes(linkedTo.id))
      );
    case "behavior_pattern":
      return (
        (linkedTo.entityType === "psyche_value" &&
          Array.isArray(entity.linkedValueIds) &&
          entity.linkedValueIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "mode_profile" &&
          Array.isArray(entity.linkedModeIds) &&
          entity.linkedModeIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "belief_entry" &&
          Array.isArray(entity.linkedBeliefIds) &&
          entity.linkedBeliefIds.includes(linkedTo.id))
      );
    case "behavior":
      return (
        (linkedTo.entityType === "behavior_pattern" &&
          Array.isArray(entity.linkedPatternIds) &&
          entity.linkedPatternIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "psyche_value" &&
          Array.isArray(entity.linkedValueIds) &&
          entity.linkedValueIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "mode_profile" &&
          Array.isArray(entity.linkedModeIds) &&
          entity.linkedModeIds.includes(linkedTo.id))
      );
    case "belief_entry":
      return (
        (linkedTo.entityType === "psyche_value" &&
          Array.isArray(entity.linkedValueIds) &&
          entity.linkedValueIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "behavior" &&
          Array.isArray(entity.linkedBehaviorIds) &&
          entity.linkedBehaviorIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "mode_profile" &&
          Array.isArray(entity.linkedModeIds) &&
          entity.linkedModeIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "trigger_report" &&
          Array.isArray(entity.linkedReportIds) &&
          entity.linkedReportIds.includes(linkedTo.id))
      );
    case "mode_profile":
      return (
        (linkedTo.entityType === "behavior_pattern" &&
          Array.isArray(entity.linkedPatternIds) &&
          entity.linkedPatternIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "behavior" &&
          Array.isArray(entity.linkedBehaviorIds) &&
          entity.linkedBehaviorIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "psyche_value" &&
          Array.isArray(entity.linkedValueIds) &&
          entity.linkedValueIds.includes(linkedTo.id))
      );
    case "flashcard":
      return (
        (linkedTo.entityType === "psyche_value" &&
          Array.isArray(entity.linkedValueIds) &&
          entity.linkedValueIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "behavior" &&
          Array.isArray(entity.linkedBehaviorIds) &&
          entity.linkedBehaviorIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "behavior_pattern" &&
          Array.isArray(entity.linkedPatternIds) &&
          entity.linkedPatternIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "belief_entry" &&
          Array.isArray(entity.linkedBeliefIds) &&
          entity.linkedBeliefIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "mode_profile" &&
          Array.isArray(entity.linkedModeIds) &&
          entity.linkedModeIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "trigger_report" &&
          Array.isArray(entity.linkedReportIds) &&
          entity.linkedReportIds.includes(linkedTo.id))
      );
    case "trigger_report":
      return (
        (linkedTo.entityType === "behavior_pattern" &&
          Array.isArray(entity.linkedPatternIds) &&
          entity.linkedPatternIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "psyche_value" &&
          Array.isArray(entity.linkedValueIds) &&
          entity.linkedValueIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "goal" &&
          Array.isArray(entity.linkedGoalIds) &&
          entity.linkedGoalIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "project" &&
          Array.isArray(entity.linkedProjectIds) &&
          entity.linkedProjectIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "task" &&
          Array.isArray(entity.linkedTaskIds) &&
          entity.linkedTaskIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "behavior" &&
          Array.isArray(entity.linkedBehaviorIds) &&
          entity.linkedBehaviorIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "belief_entry" &&
          Array.isArray(entity.linkedBeliefIds) &&
          entity.linkedBeliefIds.includes(linkedTo.id)) ||
        (linkedTo.entityType === "mode_profile" &&
          Array.isArray(entity.linkedModeIds) &&
          entity.linkedModeIds.includes(linkedTo.id))
      );
    case "preference_catalog_item":
      return (
        linkedTo.entityType === "preference_catalog" &&
        entity.catalogId === linkedTo.id
      );
    case "preference_item":
      return (
        typeof entity.sourceEntityType === "string" &&
        typeof entity.sourceEntityId === "string" &&
        entity.sourceEntityType === linkedTo.entityType &&
        entity.sourceEntityId === linkedTo.id
      );
    case "questionnaire_instrument":
      return false;
    default:
      return false;
  }
}

function listGenericLinkedEntityKeys(linkedTo: {
  entityType: CrudEntityType;
  id: string;
}) {
  return new Set(
    listEntityLinksForEntity(linkedTo.entityType, linkedTo.id).map((link) => {
      if (
        link.sourceEntityType === linkedTo.entityType &&
        link.sourceEntityId === linkedTo.id
      ) {
        return `${link.targetEntityType}:${link.targetEntityId}`;
      }
      return `${link.sourceEntityType}:${link.sourceEntityId}`;
    })
  );
}

function matchesQuery(entity: Record<string, unknown>, query?: string) {
  if (!query || query.trim().length === 0) {
    return true;
  }
  const haystack = JSON.stringify(entity).toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

function matchesStatus(entity: Record<string, unknown>, statuses?: string[]) {
  if (!statuses || statuses.length === 0) {
    return true;
  }
  return typeof entity.status === "string"
    ? statuses.includes(entity.status)
    : false;
}

function purgeAnchoredCollaboration(
  entityType: CrudEntityType,
  entityId: string
) {
  const insightIds = getDatabase()
    .prepare(`SELECT id FROM insights WHERE entity_type = ? AND entity_id = ?`)
    .all(entityType, entityId) as Array<{ id: string }>;
  if (insightIds.length > 0) {
    const placeholders = insightIds.map(() => "?").join(", ");
    getDatabase()
      .prepare(
        `DELETE FROM insight_feedback WHERE insight_id IN (${placeholders})`
      )
      .run(...insightIds.map((row) => row.id));
    getDatabase()
      .prepare(`DELETE FROM insights WHERE id IN (${placeholders})`)
      .run(...insightIds.map((row) => row.id));
    getDatabase()
      .prepare(
        `DELETE FROM deleted_entities WHERE entity_type = 'insight' AND entity_id IN (${placeholders})`
      )
      .run(...insightIds.map((row) => row.id));
  }

  unlinkNotesForEntity(entityType, entityId, { source: "system", actor: null });
}

class HardDeleteMissingEntityError extends Error {}

function runHardDeleteTransaction(
  operation: () => Record<string, unknown> | undefined
) {
  try {
    return runInTransaction(() => {
      const deleted = operation();
      if (!deleted) {
        throw new HardDeleteMissingEntityError();
      }
      return deleted;
    });
  } catch (error) {
    if (error instanceof HardDeleteMissingEntityError) {
      return undefined;
    }
    throw error;
  }
}

export function deleteEntity(
  entityType: CrudEntityType,
  id: string,
  options: { mode?: DeleteMode; reason?: string },
  context: CrudContext
) {
  const capability = getCapability(entityType);
  const mode = options.mode ?? "soft";
  const live = (
    entityType === "task_timebox"
      ? getTaskTimeboxByIdIncludingPendingDeletion(id)
      : capability.get(id)
  ) as (Record<string, unknown> & { id: string }) | undefined;
  const deletedForScope = live ? null : getDeletedEntityRecord(entityType, id);
  const liveOrDeleted =
    live ??
    (deletedForScope
      ? ({ ...deletedForScope.snapshot, id } as Record<string, unknown> & {
          id: string;
        })
      : undefined);
  if (
    !liveOrDeleted ||
    !entityMatchesCrudScope(entityType, liveOrDeleted, context)
  ) {
    return undefined;
  }
  if (entityType === "artifact" && !canAccessArtifact(id, context)) {
    return undefined;
  }
  if (entityType === "task") {
    const task = getTaskById(id) as Record<string, unknown> | undefined;
    const deletedTask = task ? undefined : getDeletedEntityRecord("task", id);
    if (
      !(task ?? deletedTask?.snapshot) ||
      !taskMatchesCrudScope((task ?? deletedTask?.snapshot)!, context)
    ) {
      return undefined;
    }
  }
  if (capability.deleteMode === "immediate") {
    return runHardDeleteTransaction(() => {
      const deleted = capability.hardDelete(id, context);
      if (!deleted) {
        return undefined;
      }
      clearDeletedEntityRecord(entityType, id);
      deleteEntityLinksForEntity(entityType, id);
      const waitsForProviderDeletion =
        entityType === "task_timebox" &&
        getTaskTimeboxByIdIncludingPendingDeletion(id) !== undefined;
      if (!waitsForProviderDeletion) {
        clearEntityOwner(entityType, id);
      }
      clearDeletedEntityRecord(entityType, id);
      return deleted;
    });
  }
  const existing = capability.get(id);
  const deleted = existing ? null : getDeletedEntityRecord(entityType, id);
  if (!existing) {
    if (!deleted || mode !== "hard") {
      return undefined;
    }
  }
  if (
    entityType === "trigger_report" &&
    !canMutateTriggerReport(id, existing ?? deleted?.snapshot, context)
  ) {
    return undefined;
  }
  if (entityType === "note") {
    requireNoteMutationAccess(
      (existing ?? deleted?.snapshot) as ReturnType<
        typeof getNoteByIdIncludingDeleted
      >,
      context
    );
  }

  const transaction =
    mode === "hard" ? runHardDeleteTransaction : runInTransaction;
  return transaction(() => {
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
        cascadeSoftDeleteAnchoredCollaboration(
          entityType,
          id,
          context,
          options.reason ?? ""
        );
      }
      return capability.softDelete?.(id, context) ?? entity;
    }

    const preferenceCatalogDescendants =
      entityType === "preference_catalog"
        ? listPreferenceCatalogHardDeleteDescendants(id)
        : [];
    clearDeletedEntityRecord(entityType, id);
    const deleted = capability.hardDelete(id, context);
    if (!deleted) {
      return undefined;
    }
    if (entityType !== "note" && entityType !== "insight") {
      purgeAnchoredCollaboration(entityType, id);
    }
    deleteEntityLinksForEntity(entityType, id);
    for (const descendant of preferenceCatalogDescendants) {
      clearDeletedEntityRecord(descendant.entityType, descendant.entityId);
    }
    clearEntityOwner(entityType, id);
    clearDeletedEntityRecord(entityType, id);
    return deleted;
  });
}

export function restoreEntity(
  entityType: CrudEntityType,
  id: string,
  context: CrudContext
) {
  const deletedForScope = getDeletedEntityRecord(entityType, id);
  if (
    !deletedForScope ||
    !entityMatchesCrudScope(
      entityType,
      { ...deletedForScope.snapshot, id },
      context
    )
  ) {
    return undefined;
  }
  if (entityType === "artifact" && !canAccessArtifact(id, context)) {
    return undefined;
  }
  const deletedBeforeRestore = getDeletedEntityRecord(entityType, id);
  if (
    entityType === "task" &&
    (!deletedBeforeRestore ||
      !taskMatchesCrudScope(deletedBeforeRestore.snapshot, context))
  ) {
    return undefined;
  }
  if (
    entityType === "trigger_report" &&
    deletedBeforeRestore &&
    !canMutateTriggerReport(id, deletedBeforeRestore.snapshot, context)
  ) {
    return undefined;
  }
  if (entityType === "note" && deletedBeforeRestore) {
    requireNoteMutationAccess(
      deletedBeforeRestore.snapshot as ReturnType<
        typeof getNoteByIdIncludingDeleted
      >,
      context
    );
  }
  return runInTransaction(() => {
    const deleted = restoreDeletedEntityRecord(entityType, id);
    if (!deleted) {
      return undefined;
    }
    const capability = getCapability(entityType);
    const restored = capability.restore?.(id, context);
    if (entityType !== "note" && entityType !== "insight") {
      restoreAnchoredCollaboration(entityType, id);
    }
    const entity = restored ?? capability.get(id) ?? deleted.snapshot;
    if (entityType === "task") {
      assertTaskCrudResultScope(entity, context);
    }
    return entity;
  });
}

export function createEntities(
  input: BatchCreateEntitiesInput,
  context: CrudContext
): { results: EntityOperationResult[] } {
  return executeBatchOperation(input.operations, input.atomic, (entry) => {
    try {
      const entity = runInTransaction(() => {
        const created = getCapability(entry.entityType).create(
          parseCreateInput(entry.entityType, entry.data),
          { ...context, idempotencyKey: entry.idempotencyKey ?? null }
        ) as Record<string, unknown> & { id: string };
        if (
          !getEntityOwnerId(entry.entityType, created.id) &&
          context.userIds?.length === 1
        ) {
          setEntityOwner(entry.entityType, created.id, context.userIds[0]);
        }
        if (!entityMatchesCrudScope(entry.entityType, created, context)) {
          throw new HttpError(
            403,
            "entity_scope_forbidden",
            "The created entity is outside this credential's owner scope."
          );
        }
        return created;
      });
      return {
        ok: true,
        entityType: entry.entityType,
        clientRef: entry.clientRef,
        id: String(entity.id ?? ""),
        entity
      } satisfies EntityOperationResult;
    } catch (error) {
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
        } satisfies EntityOperationResult;
      }
      return {
        ok: false,
        entityType: entry.entityType,
        clientRef: entry.clientRef,
        error: toOperationError(
          error instanceof HttpError ? error.code : "create_failed",
          error instanceof Error ? error.message : String(error)
        )
      } satisfies EntityOperationResult;
    }
  });
}

export function updateEntities(
  input: BatchUpdateEntitiesInput,
  context: CrudContext
): { results: EntityOperationResult[] } {
  return executeBatchOperation(input.operations, input.atomic, (entry) => {
    try {
      const entity = runInTransaction(() => {
        if (!getScopedCrudEntity(entry.entityType, entry.id, context)) {
          return undefined;
        }
        const updated = getCapability(entry.entityType).update(
          entry.id,
          parseUpdatePatch(entry.entityType, entry.patch),
          context
        ) as (Record<string, unknown> & { id: string }) | undefined;
        if (
          updated &&
          !entityMatchesCrudScope(entry.entityType, updated, context)
        ) {
          throw new HttpError(
            403,
            "entity_scope_forbidden",
            "The update would move the entity outside this credential's owner scope."
          );
        }
        return updated;
      });
      if (!entity) {
        return {
          ok: false,
          entityType: entry.entityType,
          id: entry.id,
          clientRef: entry.clientRef,
          error: toOperationError(
            "not_found",
            `${entry.entityType} ${entry.id} was not found.`
          )
        } satisfies EntityOperationResult;
      }
      return {
        ok: true,
        entityType: entry.entityType,
        id: entry.id,
        clientRef: entry.clientRef,
        entity
      } satisfies EntityOperationResult;
    } catch (error) {
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
        } satisfies EntityOperationResult;
      }
      return {
        ok: false,
        entityType: entry.entityType,
        id: entry.id,
        clientRef: entry.clientRef,
        error: toOperationError(
          error instanceof HttpError ? error.code : "update_failed",
          error instanceof Error ? error.message : String(error)
        )
      } satisfies EntityOperationResult;
    }
  });
}

export function deleteEntities(
  input: BatchDeleteEntitiesInput,
  context: CrudContext
): { results: EntityOperationResult[] } {
  return executeBatchOperation(input.operations, input.atomic, (entry) => {
    try {
      const entity = deleteEntity(
        entry.entityType,
        entry.id,
        { mode: entry.mode, reason: entry.reason },
        context
      );
      if (!entity) {
        return {
          ok: false,
          entityType: entry.entityType,
          id: entry.id,
          clientRef: entry.clientRef,
          error: toOperationError(
            "not_found",
            `${entry.entityType} ${entry.id} was not found.`
          )
        } satisfies EntityOperationResult;
      }
      return {
        ok: true,
        entityType: entry.entityType,
        id: entry.id,
        clientRef: entry.clientRef,
        entity
      } satisfies EntityOperationResult;
    } catch (error) {
      return {
        ok: false,
        entityType: entry.entityType,
        id: entry.id,
        clientRef: entry.clientRef,
        error: toOperationError(
          error instanceof HttpError ? error.code : "delete_failed",
          error instanceof Error ? error.message : String(error)
        )
      } satisfies EntityOperationResult;
    }
  });
}

export function restoreEntities(
  input: BatchRestoreEntitiesInput,
  context: CrudContext
): {
  results: EntityOperationResult[];
} {
  return executeBatchOperation(input.operations, input.atomic, (entry) => {
    try {
      const entity = restoreEntity(entry.entityType, entry.id, context);
      if (!entity) {
        return {
          ok: false,
          entityType: entry.entityType,
          id: entry.id,
          clientRef: entry.clientRef,
          error: toOperationError(
            "not_found",
            `${entry.entityType} ${entry.id} was not found in the bin.`
          )
        } satisfies EntityOperationResult;
      }
      return {
        ok: true,
        entityType: entry.entityType,
        id: entry.id,
        clientRef: entry.clientRef,
        entity
      } satisfies EntityOperationResult;
    } catch (error) {
      return {
        ok: false,
        entityType: entry.entityType,
        id: entry.id,
        clientRef: entry.clientRef,
        error: toOperationError(
          error instanceof HttpError ? error.code : "restore_failed",
          error instanceof Error ? error.message : String(error)
        )
      } satisfies EntityOperationResult;
    }
  });
}

export function searchEntities(
  input: BatchSearchEntitiesInput,
  context: EntitySearchContext = {}
): {
  results: EntityOperationResult[];
} {
  const deleted = listDeletedEntities();
  const defaultEntityTypes = Object.keys(
    CRUD_ENTITY_CAPABILITIES
  ) as CrudEntityType[];
  return {
    results: input.searches.map((search) => {
      const entityTypes =
        search.entityTypes && search.entityTypes.length > 0
          ? search.entityTypes
          : defaultEntityTypes;
      const artifactUserIds = search.userIds ?? context.artifactScope?.userIds;
      const genericLinkedEntityKeys = search.linkedTo
        ? listGenericLinkedEntityKeys(search.linkedTo)
        : null;
      const deletedForSearch = deleted.map((item) => ({
        ...item,
        snapshot: context.transformEntityForRead
          ? context.transformEntityForRead(item.entityType, {
              ...item.snapshot,
              id: item.entityId
            })
          : item.snapshot
      }));
      const visibleDeletedEntityKeys = new Set(
        entityTypes.flatMap((entityType) =>
          entityType === "artifact"
            ? []
            : filterOwnedEntities(
                entityType,
                deletedForSearch
                  .filter((item) => item.entityType === entityType)
                  .map((item) => ({ ...item.snapshot, id: item.entityId })),
                search.userIds
              )
                .filter(
                  (entity) =>
                    entityType !== "task" ||
                    taskMatchesCrudScope(entity, context.taskScope ?? {})
                )
                .map((entity) => `${entityType}:${entity.id}`)
        )
      );
      const liveMatches = entityTypes.flatMap((entityType) => {
        const capability = getCapability(entityType);
        const candidates = capability.search
          ? capability.search(search, context)
          : capability.list();
        return filterOwnedEntities(
          entityType,
          candidates as Array<Record<string, unknown> & { id: string }>,
          search.userIds
        )
          .filter((entity) =>
            entityMatchesCrudScope(entityType, entity, {
              userIds: search.userIds,
              projectIds:
                entityType === "artifact"
                  ? context.artifactScope?.projectIds
                  : context.taskScope?.projectIds,
              tagIds:
                entityType === "artifact"
                  ? context.artifactScope?.tagIds
                  : context.taskScope?.tagIds
            })
          )
          .map((entity) =>
            context.transformEntityForRead
              ? context.transformEntityForRead(entityType, entity)
              : entity
          )
          .filter((entity) =>
            search.ids && search.ids.length > 0
              ? search.ids.includes(String(entity.id ?? ""))
              : true
          )
          .filter((entity) =>
            entityType === "note" && capability.search
              ? true
              : matchesQuery(entity, search.query)
          )
          .filter((entity) => matchesStatus(entity, search.status))
          .filter((entity) =>
            search.linkedTo
              ? matchesLinkedTo(entityType, entity, search.linkedTo) ||
                genericLinkedEntityKeys?.has(`${entityType}:${entity.id}`)
              : true
          )
          .slice(0, search.limit)
          .map((entity) => ({
            deleted: false,
            entityType,
            id: String(entity.id ?? ""),
            entity
          }));
      });

      const deletedMatches = search.includeDeleted
        ? deletedForSearch
            .filter((item) => entityTypes.includes(item.entityType))
            .filter((item) =>
              entityMatchesCrudScope(
                item.entityType,
                { ...item.snapshot, id: item.entityId },
                {
                  userIds: search.userIds,
                  projectIds:
                    item.entityType === "artifact"
                      ? context.artifactScope?.projectIds
                      : context.taskScope?.projectIds,
                  tagIds:
                    item.entityType === "artifact"
                      ? context.artifactScope?.tagIds
                      : context.taskScope?.tagIds
                }
              )
            )
            .filter(
              (item) =>
                item.entityType !== "task" ||
                taskMatchesCrudScope(
                  { ...item.snapshot, id: item.entityId },
                  context.taskScope ?? {}
                )
            )
            .filter(
              (item) =>
                item.entityType !== "note" ||
                (canAccessWikiNote(
                  { userIds: search.userIds ?? [] },
                  item.snapshot as Note,
                  "read"
                ) &&
                  ((context.includePsycheNotes ?? true) ||
                    !noteHasPsycheLink(item.snapshot as Note)))
            )
            .filter((item) =>
              item.entityType === "note"
                ? noteMatchesCrudIdentityAndQuery(
                    { ...item.snapshot, id: item.entityId } as Note,
                    search
                  )
                : search.ids && search.ids.length > 0
                  ? search.ids.includes(item.entityId)
                  : true
            )
            .filter((item) =>
              item.entityType === "artifact"
                ? canAccessArtifact(item.entityId, {
                    source: "system",
                    userIds: artifactUserIds,
                    projectIds: context.artifactScope?.projectIds,
                    tagIds: context.artifactScope?.tagIds
                  })
                : !search.userIds || search.userIds.length === 0
                  ? true
                  : visibleDeletedEntityKeys.has(
                      `${item.entityType}:${item.entityId}`
                    )
            )
            .filter((item) =>
              item.entityType === "note"
                ? true
                : matchesQuery(item.snapshot, search.query) ||
                  matchesQuery(item, search.query)
            )
            .filter((item) => matchesStatus(item.snapshot, search.status))
            .filter((item) =>
              search.linkedTo
                ? matchesLinkedTo(
                    item.entityType,
                    item.snapshot,
                    search.linkedTo
                  ) ||
                  genericLinkedEntityKeys?.has(
                    `${item.entityType}:${item.entityId}`
                  )
                : true
            )
            .slice(0, search.limit)
            .map((item) =>
              item.entityType === "artifact"
                ? serializeArtifactPublicPayload({
                    deleted: true,
                    entityType: item.entityType,
                    id: item.entityId,
                    entity: item.snapshot,
                    deletedRecord: item
                  })
                : {
                    deleted: true,
                    entityType: item.entityType,
                    id: item.entityId,
                    entity: item.snapshot,
                    deletedRecord: item
                  }
            )
        : [];

      return {
        ok: true,
        clientRef: search.clientRef,
        matches: [...liveMatches, ...deletedMatches].slice(0, search.limit)
      } satisfies EntityOperationResult;
    })
  };
}

export function getSettingsBinPayload(
  noteScope: NoteReadScope = {}
): SettingsBinPayload {
  const payload = buildSettingsBinPayload();
  const userIds = noteScope.userIds ?? [];
  if (
    userIds.length === 0 &&
    noteScope.accessibleSpaceIds === undefined &&
    noteScope.includePsyche !== false
  ) {
    return payload;
  }

  const allowedUserIds = new Set(userIds);
  const records = payload.records.filter((record) => {
    if (record.entityType === "note") {
      return isNoteVisibleToScope(record.snapshot as Note, noteScope);
    }
    if (record.entityType === "preference_catalog") {
      const snapshotUserId = (record.snapshot as Record<string, unknown>)
        .userId;
      const ownerUserId =
        getEntityOwnerId(record.entityType, record.entityId) ??
        (typeof snapshotUserId === "string" ? snapshotUserId : null) ??
        (
          getDatabase()
            .prepare(
              `SELECT preference_profiles.user_id
               FROM preference_catalogs
               INNER JOIN preference_profiles
                 ON preference_profiles.id = preference_catalogs.profile_id
               WHERE preference_catalogs.id = ?`
            )
            .get(record.entityId) as { user_id: string } | undefined
        )?.user_id ??
        null;
      return ownerUserId !== null && allowedUserIds.has(ownerUserId);
    }
    if (record.entityType === "preference_catalog_item") {
      const snapshotUserId = (record.snapshot as Record<string, unknown>)
        .userId;
      const ownerUserId =
        getEntityOwnerId(record.entityType, record.entityId) ??
        (typeof snapshotUserId === "string" ? snapshotUserId : null) ??
        (
          getDatabase()
            .prepare(
              `SELECT preference_profiles.user_id
               FROM preference_catalog_items
               INNER JOIN preference_catalogs
                 ON preference_catalogs.id = preference_catalog_items.catalog_id
               INNER JOIN preference_profiles
                 ON preference_profiles.id = preference_catalogs.profile_id
               WHERE preference_catalog_items.id = ?`
            )
            .get(record.entityId) as { user_id: string } | undefined
        )?.user_id ??
        null;
      return ownerUserId !== null && allowedUserIds.has(ownerUserId);
    }
    return true;
  });
  const countsByEntityType = records.reduce<Record<string, number>>(
    (counts, record) => {
      counts[record.entityType] = (counts[record.entityType] ?? 0) + 1;
      return counts;
    },
    {}
  );
  return {
    ...payload,
    totalCount: records.length,
    countsByEntityType,
    records
  };
}

export function getDeletedEntityRecords(): DeletedEntityRecord[] {
  return listDeletedEntities();
}
