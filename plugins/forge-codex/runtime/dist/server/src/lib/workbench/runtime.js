function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : null;
}
export function buildWorkbenchOutputMap(text, json, keys) {
    const outputMap = {
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
            text: typeof value === "string"
                ? value
                : Array.isArray(value) || asRecord(value)
                    ? JSON.stringify(value, null, 2)
                    : String(value ?? ""),
            json: asRecord(value)
        };
    }
    return outputMap;
}
export function buildWorkbenchExecutionEnvelope(input, value) {
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
        outputMap: buildWorkbenchOutputMap(value.primaryText, payload, Object.keys(value.output ?? {}))
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
        limit
    };
}
export function buildSearchWorkbenchExecution(input, config) {
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
        output: asRecord(payload)
    });
}
export function buildSportsWorkbenchExecution(input) {
    const payload = input.context.services.health.getFitnessViewData?.() ?? null;
    return buildWorkbenchExecutionEnvelope(input, {
        primaryText: payload && typeof payload === "object"
            ? "Workout history and composition are available."
            : "No sports data is available.",
        output: asRecord(payload)
    });
}
export function mapWorkbenchTools(tools) {
    return tools.map(({ argsSchema: _argsSchema, ...tool }) => tool);
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
            sourcePath: "workbench",
            author: "Workbench"
        });
    }
    throw new Error(`Unsupported Workbench tool: ${toolKey}`);
}
