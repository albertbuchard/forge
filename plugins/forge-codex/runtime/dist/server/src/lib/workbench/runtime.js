function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : null;
}
function readTextValue(...values) {
    for (const value of values) {
        if (typeof value === "string") {
            return value;
        }
    }
    return "";
}
function readNumberValue(...values) {
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === "string") {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
    }
    return null;
}
function readStringArrayValue(...values) {
    for (const value of values) {
        if (Array.isArray(value)) {
            const normalized = value.filter((entry) => typeof entry === "string" && entry.trim().length > 0);
            if (normalized.length > 0) {
                return normalized;
            }
            continue;
        }
        if (typeof value === "string") {
            const trimmed = value.trim();
            if (!trimmed) {
                continue;
            }
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) {
                    const normalized = parsed.filter((entry) => typeof entry === "string" && entry.trim().length > 0);
                    if (normalized.length > 0) {
                        return normalized;
                    }
                }
            }
            catch {
                const normalized = trimmed
                    .split(",")
                    .map((entry) => entry.trim())
                    .filter((entry) => entry.length > 0);
                if (normalized.length > 0) {
                    return normalized;
                }
            }
        }
    }
    return [];
}
export function buildWorkbenchOutputMap(text, json, outputs) {
    const outputMap = {};
    const declaredOutputs = outputs.length > 0 ? outputs : [{ key: "summary" }];
    declaredOutputs.forEach((output, index) => {
        const rawValue = json && output.key in json
            ? json[output.key]
            : index === 0 || output.key === "summary"
                ? text
                : null;
        outputMap[output.key] = {
            text: typeof rawValue === "string"
                ? rawValue
                : Array.isArray(rawValue) || asRecord(rawValue)
                    ? JSON.stringify(rawValue, null, 2)
                    : String(rawValue ?? ""),
            json: asRecord(rawValue)
        };
    });
    return outputMap;
}
function normalizeWorkbenchOutputPayload(definition, output, primaryText) {
    const declaredOutputs = definition.output ?? [];
    if (!output && declaredOutputs.length === 0) {
        return null;
    }
    const normalized = output ? { ...output } : {};
    if (declaredOutputs.length > 0) {
        const leadKey = declaredOutputs[0]?.key;
        if (leadKey && !(leadKey in normalized)) {
            normalized[leadKey] = primaryText;
        }
        if (declaredOutputs.some((entry) => entry.key === "summary") &&
            !("summary" in normalized)) {
            normalized.summary = primaryText;
        }
    }
    return normalized;
}
export function buildWorkbenchExecutionEnvelope(input, value) {
    const payload = normalizeWorkbenchOutputPayload(input.definition, value.output, value.primaryText);
    return {
        primaryText: value.primaryText,
        payload,
        logs: value.logs ?? [],
        outputMap: buildWorkbenchOutputMap(value.primaryText, payload, input.definition.output)
    };
}
export function buildStaticWorkbenchExecution(input, output, primaryText, logs) {
    return buildWorkbenchExecutionEnvelope(input, {
        primaryText: primaryText ??
            `${input.definition.title}\n${input.definition.description}\nRoute: ${input.definition.routePath ?? "n/a"}`,
        output,
        logs
    });
}
export function searchWorkbenchEntities(context, definition, input) {
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
        .map((match) => {
        const title = typeof match.title === "string"
            ? match.title
            : typeof match.name === "string"
                ? match.name
                : typeof match.id === "string"
                    ? match.id
                    : "Untitled";
        const entityType = typeof match.entityType === "string" ? match.entityType : "entity";
        return `${entityType}: ${title}`;
    });
    return {
        title: definition.title,
        matches,
        summaryText: summaryLines.length > 0
            ? summaryLines.join("\n")
            : `No ${definition.title.toLowerCase()} matches found.`,
        limit,
        query: input.query
    };
}
export function buildSearchWorkbenchExecution(input, config) {
    const query = readTextValue(input.inputs.query, input.params.query, config.query).trim();
    const entityTypes = readStringArrayValue(input.inputs.entityTypes, input.params.entityTypes, config.entityTypes);
    const limit = readNumberValue(input.inputs.limit, input.params.limit, config.limit) ?? config.limit ?? 12;
    const summary = searchWorkbenchEntities(input.context, input.definition, {
        query,
        entityTypes,
        limit
    });
    return buildWorkbenchExecutionEnvelope(input, {
        primaryText: summary.summaryText,
        output: {
            summary: summary.summaryText,
            matches: summary.matches,
            matchCount: summary.matches.length
        }
    });
}
export function buildMovementPlacesExecution(input) {
    const places = input.context.services.movement.listPlaces?.() ?? [];
    return buildWorkbenchExecutionEnvelope(input, {
        primaryText: places.length > 0
            ? places
                .slice(0, 24)
                .map((place) => typeof place.label === "string"
                ? place.label
                : typeof place.name === "string"
                    ? place.name
                    : typeof place.id === "string"
                        ? place.id
                        : "Place")
                .join("\n")
            : "No known places are stored yet.",
        output: {
            summary: places.length > 0
                ? `${places.length} place${places.length === 1 ? "" : "s"} available.`
                : "No known places are stored yet.",
            places
        }
    });
}
export function buildSleepWorkbenchExecution(input) {
    const payload = input.context.services.health.getSleepViewData?.() ?? null;
    return buildWorkbenchExecutionEnvelope(input, {
        primaryText: payload && typeof payload === "object"
            ? "Sleep history and derived patterns are available."
            : "No sleep data is available.",
        output: payload && typeof payload === "object"
            ? {
                summary: "Sleep history and derived patterns are available.",
                sleepView: payload
            }
            : {
                summary: "No sleep data is available."
            }
    });
}
export function buildSportsWorkbenchExecution(input) {
    const payload = input.context.services.health.getFitnessViewData?.() ?? null;
    return buildWorkbenchExecutionEnvelope(input, {
        primaryText: payload && typeof payload === "object"
            ? "Workout history and composition are available."
            : "No sports data is available.",
        output: payload && typeof payload === "object"
            ? {
                summary: "Workout history and composition are available.",
                sportsView: payload
            }
            : {
                summary: "No sports data is available."
            }
    });
}
export function buildOverviewWorkbenchExecution(input) {
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
            ? {
                summary,
                context: record
            }
            : {
                summary
            }
    });
}
export function buildInsightsWorkbenchExecution(input) {
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
            ? {
                summary,
                insights: record
            }
            : {
                summary
            }
    });
}
export function buildWeeklyReviewWorkbenchExecution(input) {
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
            ? {
                summary,
                weeklyReview: record
            }
            : {
                summary
            }
    });
}
export function buildWikiPagesWorkbenchExecution(input) {
    const pages = input.context.services.wiki.listPages?.() ?? [];
    const summary = pages.length > 0
        ? pages
            .slice(0, 12)
            .map((page) => typeof page.title === "string"
            ? page.title
            : typeof page.slug === "string"
                ? page.slug
                : typeof page.id === "string"
                    ? page.id
                    : "Wiki page")
            .join("\n")
        : "No wiki pages are available.";
    return buildWorkbenchExecutionEnvelope(input, {
        primaryText: summary,
        output: {
            summary,
            pages
        }
    });
}
export function buildWikiHealthWorkbenchExecution(input) {
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
            ? {
                summary,
                health: record
            }
            : {
                summary
            }
    });
}
export function mapWorkbenchTools(tools) {
    return tools.map((tool) => tool);
}
export function executeCommonWorkbenchTool(context, definition, toolKey, args) {
    if (toolKey === "forge.search_entities") {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        const entityTypes = Array.isArray(args.entityTypes)
            ? args.entityTypes.filter((entry) => typeof entry === "string" && entry.length > 0)
            : [];
        const limit = typeof args.limit === "number" && Number.isFinite(args.limit)
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
            contentMarkdown: typeof args.markdown === "string" ? args.markdown : "",
            summary: typeof args.summary === "string" ? args.summary : "",
            links: [],
            tags: [],
            sourcePath: "workbench",
            author: "Workbench"
        });
    }
    throw new Error(`Unsupported Workbench tool: ${toolKey}`);
}
