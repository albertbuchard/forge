import type {
  WorkbenchNodeDefinition,
  WorkbenchNodeExecutionInput,
  WorkbenchNodeExecutionValue,
  WorkbenchRuntimeContext,
  WorkbenchToolDefinition
} from "./nodes.js";

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function buildWorkbenchOutputMap(
  text: string,
  json: Record<string, unknown> | null,
  keys: string[]
) {
  const outputMap: Record<
    string,
    {
      text: string;
      json: Record<string, unknown> | null;
    }
  > = {
    primary: {
      text,
      json
    }
  };
  for (const key of keys) {
    if (!json || !(key in json)) {
      outputMap[key] = {
        text,
        json
      };
      continue;
    }
    const value = json[key];
    outputMap[key] = {
      text:
        typeof value === "string"
          ? value
          : Array.isArray(value) || asRecord(value)
            ? JSON.stringify(value, null, 2)
            : String(value ?? ""),
      json: asRecord(value)
    };
  }
  return outputMap;
}

export function buildWorkbenchExecutionEnvelope(
  input: WorkbenchNodeExecutionInput,
  value: {
    primaryText: string;
    output: Record<string, unknown> | null;
    logs?: string[];
  }
): WorkbenchNodeExecutionValue {
  const payload = {
    nodeId: input.nodeId,
    nodeType: input.definition.id,
    title: input.definition.title,
    inputs: input.inputs,
    params: input.params,
    output: value.output,
    logs: value.logs ?? []
  };
  return {
    primaryText: value.primaryText,
    payload,
    logs: value.logs ?? [],
    outputMap: buildWorkbenchOutputMap(
      value.primaryText,
      payload,
      Object.keys(value.output ?? {})
    )
  };
}

export function buildStaticWorkbenchExecution(
  input: WorkbenchNodeExecutionInput,
  output: Record<string, unknown> | null,
  primaryText?: string,
  logs?: string[]
) {
  return buildWorkbenchExecutionEnvelope(input, {
    primaryText:
      primaryText ??
      `${input.definition.title}\n${input.definition.description}\nRoute: ${input.definition.routePath ?? "n/a"}`,
    output,
    logs
  });
}

export function searchWorkbenchEntities(
  context: WorkbenchRuntimeContext,
  definition: WorkbenchNodeDefinition,
  input: {
    query: string;
    entityTypes: string[];
    limit?: number;
  }
) {
  const limit = Math.max(1, Math.min(50, Math.round(input.limit ?? 12)));
  const result = context.services.entities.search({
    searches: [
      {
        query: input.query,
        entityTypes: input.entityTypes,
        limit
      }
    ]
  }).results[0];
  const matches = result?.ok ? result.matches ?? [] : [];
  const summaryLines = matches
    .slice(0, limit)
    .map((match: Record<string, unknown>) => {
    const title =
      typeof match.title === "string"
        ? match.title
        : typeof match.name === "string"
          ? match.name
          : typeof match.id === "string"
            ? match.id
            : "Untitled";
    const entityType =
      typeof match.entityType === "string" ? match.entityType : "entity";
    return `${entityType}: ${title}`;
    });
  return {
    title: definition.title,
    matches,
    summaryText:
      summaryLines.length > 0
        ? summaryLines.join("\n")
        : `No ${definition.title.toLowerCase()} matches found.`,
    limit
  };
}

export function buildSearchWorkbenchExecution(
  input: WorkbenchNodeExecutionInput,
  config: {
    query: string;
    entityTypes: string[];
    limit?: number;
  }
) {
  const summary = searchWorkbenchEntities(input.context, input.definition, config);
  return buildWorkbenchExecutionEnvelope(input, {
    primaryText: summary.summaryText,
    output: {
      matches: summary.matches,
      limit: summary.limit,
      entityTypes: config.entityTypes
    }
  });
}

export function buildMovementPlacesExecution(input: WorkbenchNodeExecutionInput) {
  const places = input.context.services.movement.listPlaces?.() ?? [];
  return buildWorkbenchExecutionEnvelope(input, {
    primaryText:
      places.length > 0
        ? places
            .slice(0, 24)
            .map((place: Record<string, unknown>) =>
              typeof place.label === "string"
                ? place.label
                : typeof place.name === "string"
                  ? place.name
                  : typeof place.id === "string"
                    ? place.id
                    : "Place"
            )
            .join("\n")
        : "No known places are stored yet.",
    output: {
      places
    }
  });
}

export function buildSleepWorkbenchExecution(input: WorkbenchNodeExecutionInput) {
  const payload = input.context.services.health.getSleepViewData?.() ?? null;
  return buildWorkbenchExecutionEnvelope(input, {
    primaryText:
      payload && typeof payload === "object"
        ? "Sleep history and derived patterns are available."
        : "No sleep data is available.",
    output: asRecord(payload)
  });
}

export function buildSportsWorkbenchExecution(input: WorkbenchNodeExecutionInput) {
  const payload = input.context.services.health.getFitnessViewData?.() ?? null;
  return buildWorkbenchExecutionEnvelope(input, {
    primaryText:
      payload && typeof payload === "object"
        ? "Workout history and composition are available."
        : "No sports data is available.",
    output: asRecord(payload)
  });
}

export function buildOverviewWorkbenchExecution(input: WorkbenchNodeExecutionInput) {
  const payload = input.context.services.overview.getContext?.() ?? null;
  const record = asRecord(payload);
  const summary = record
    ? [
        `Projects: ${Array.isArray(record.projects) ? record.projects.length : 0}`,
        `Goals: ${Array.isArray(record.activeGoals) ? record.activeGoals.length : 0}`,
        `Top tasks: ${Array.isArray(record.topTasks) ? record.topTasks.length : 0}`,
        `Due habits: ${Array.isArray(record.dueHabits) ? record.dueHabits.length : 0}`
      ].join("\n")
    : "No overview context is available.";
  return buildWorkbenchExecutionEnvelope(input, {
    primaryText: summary,
    output: record
  });
}

export function buildInsightsWorkbenchExecution(input: WorkbenchNodeExecutionInput) {
  const payload = input.context.services.overview.getInsights?.() ?? null;
  const record = asRecord(payload);
  const status = asRecord(record?.status);
  const coaching = asRecord(record?.coaching);
  const summary = record
    ? [
        typeof status?.systemStatus === "string" ? status.systemStatus : "Insights ready",
        typeof coaching?.title === "string" ? coaching.title : null,
        typeof coaching?.summary === "string" ? coaching.summary : null
      ]
        .filter(Boolean)
        .join("\n")
    : "No insights payload is available.";
  return buildWorkbenchExecutionEnvelope(input, {
    primaryText: summary,
    output: record
  });
}

export function buildWeeklyReviewWorkbenchExecution(input: WorkbenchNodeExecutionInput) {
  const payload = input.context.services.overview.getWeeklyReview?.() ?? null;
  const record = asRecord(payload);
  const momentum = asRecord(record?.momentumSummary);
  const summary = record
    ? [
        typeof record.windowLabel === "string" ? record.windowLabel : "Weekly review",
        typeof momentum?.totalXp === "number" ? `${momentum.totalXp} XP` : null,
        typeof momentum?.focusHours === "number"
          ? `${momentum.focusHours} focus hours`
          : null
      ]
        .filter(Boolean)
        .join("\n")
    : "No weekly review payload is available.";
  return buildWorkbenchExecutionEnvelope(input, {
    primaryText: summary,
    output: record
  });
}

export function buildWikiPagesWorkbenchExecution(input: WorkbenchNodeExecutionInput) {
  const pages = input.context.services.wiki.listPages?.() ?? [];
  const summary =
    pages.length > 0
      ? pages
          .slice(0, 12)
          .map((page) =>
            typeof page.title === "string"
              ? page.title
              : typeof page.slug === "string"
                ? page.slug
                : typeof page.id === "string"
                  ? page.id
                  : "Wiki page"
          )
          .join("\n")
      : "No wiki pages are available.";
  return buildWorkbenchExecutionEnvelope(input, {
    primaryText: summary,
    output: {
      pages
    }
  });
}

export function buildWikiHealthWorkbenchExecution(input: WorkbenchNodeExecutionInput) {
  const payload = input.context.services.wiki.getHealth?.() ?? null;
  const record = asRecord(payload);
  const unresolvedLinks = Array.isArray(record?.unresolvedLinks)
    ? record.unresolvedLinks.length
    : null;
  const orphanPages = Array.isArray(record?.orphanPages)
    ? record.orphanPages.length
    : null;
  const summary = record
    ? [
        "Wiki health summary",
        unresolvedLinks !== null ? `${unresolvedLinks} unresolved links` : null,
        orphanPages !== null ? `${orphanPages} orphan pages` : null
      ]
        .filter(Boolean)
        .join("\n")
    : "No wiki health payload is available.";
  return buildWorkbenchExecutionEnvelope(input, {
    primaryText: summary,
    output: record
  });
}

export function mapWorkbenchTools(
  tools: WorkbenchToolDefinition[]
) {
  return tools.map(({ argsSchema: _argsSchema, ...tool }) => tool);
}

export function executeCommonWorkbenchTool(
  context: WorkbenchRuntimeContext,
  definition: WorkbenchNodeDefinition,
  toolKey: string,
  args: Record<string, unknown>
) {
  if (toolKey === "forge.search_entities") {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    const entityTypes = Array.isArray(args.entityTypes)
      ? args.entityTypes.filter(
          (entry): entry is string => typeof entry === "string" && entry.length > 0
        )
      : [];
    const limit =
      typeof args.limit === "number" && Number.isFinite(args.limit)
        ? args.limit
        : 12;
    return searchWorkbenchEntities(context, definition, {
      query,
      entityTypes,
      limit
    });
  }

  if (toolKey === "forge.update_task_status") {
    const taskId = typeof args.taskId === "string" ? args.taskId : "";
    const status = typeof args.status === "string" ? args.status : "";
    if (!context.services.tasks.update) {
      throw new Error("Task update service is not available.");
    }
    return context.services.tasks.update(taskId, { status });
  }

  if (toolKey === "forge.create_note") {
    if (!context.services.notes.create) {
      throw new Error("Note creation service is not available.");
    }
    return context.services.notes.create({
      kind: "evidence",
      title: typeof args.title === "string" ? args.title : "Workbench note",
      contentMarkdown:
        typeof args.markdown === "string" ? args.markdown : "",
      summary:
        typeof args.summary === "string" ? args.summary : "",
      sourcePath: "workbench",
      author: "Workbench"
    });
  }

  throw new Error(`Unsupported Workbench tool: ${toolKey}`);
}
