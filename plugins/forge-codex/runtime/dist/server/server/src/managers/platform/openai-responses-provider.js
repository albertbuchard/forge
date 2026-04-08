function emitDiagnostic(logger, input) {
    logger?.(input);
}
function truncate(value, limit = 1_600) {
    return value.length > limit ? `${value.slice(0, limit)}…` : value;
}
const SUPPORTED_INGEST_ENTITY_TYPES = [
    "goal",
    "project",
    "task",
    "habit",
    "strategy",
    "psyche_value",
    "note"
];
const MODEL_CONTEXT_WINDOWS = {
    "gpt-5.4": 1_050_000,
    "gpt-5.4-mini": 400_000,
    "gpt-5.4-nano": 400_000
};
const DEFAULT_CONTEXT_WINDOW = 400_000;
const RESERVED_RESPONSE_TOKENS = 140_000;
const APPROX_CHARS_PER_TOKEN = 4;
const REQUEST_TIMEOUT_MS = 90_000;
const BACKGROUND_POLL_INTERVAL_MS = 2_000;
const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const CODEX_JWT_CLAIM_PATH = "https://api.openai.com/auth";
function closedObject(properties) {
    return {
        type: "object",
        additionalProperties: false,
        properties,
        required: Object.keys(properties)
    };
}
function stringArraySchema() {
    return {
        type: "array",
        items: { type: "string" }
    };
}
function integerArraySchema() {
    return {
        type: "array",
        items: { type: "integer" }
    };
}
function nullableStringSchema() {
    return {
        type: ["string", "null"]
    };
}
function nullableNumberSchema() {
    return {
        type: ["number", "null"]
    };
}
function buildWikiIngestSchema() {
    const linkedEntitySchema = closedObject({
        entityType: {
            type: "string",
            enum: ["goal", "project", "task", "habit", "strategy", "psyche_value"]
        },
        entityId: { type: "string" },
        rationale: nullableStringSchema()
    });
    const suggestedFieldsSchema = closedObject({
        goalId: nullableStringSchema(),
        projectId: nullableStringSchema(),
        horizon: nullableStringSchema(),
        status: nullableStringSchema(),
        priority: nullableStringSchema(),
        dueDate: nullableStringSchema(),
        themeColor: nullableStringSchema(),
        polarity: nullableStringSchema(),
        frequency: nullableStringSchema(),
        endStateDescription: nullableStringSchema(),
        valuedDirection: nullableStringSchema(),
        whyItMatters: nullableStringSchema(),
        userId: nullableStringSchema(),
        targetPoints: nullableNumberSchema(),
        estimatedMinutes: nullableNumberSchema(),
        targetCount: nullableNumberSchema(),
        rewardXp: nullableNumberSchema(),
        penaltyXp: nullableNumberSchema(),
        linkedGoalIds: stringArraySchema(),
        linkedProjectIds: stringArraySchema(),
        linkedTaskIds: stringArraySchema(),
        linkedValueIds: stringArraySchema(),
        targetGoalIds: stringArraySchema(),
        targetProjectIds: stringArraySchema(),
        weekDays: integerArraySchema(),
        linkedEntities: {
            type: "array",
            items: linkedEntitySchema
        },
        committedActions: stringArraySchema(),
        notes: stringArraySchema(),
        tags: stringArraySchema()
    });
    return closedObject({
        title: { type: "string" },
        summary: { type: "string" },
        markdown: { type: "string" },
        tags: stringArraySchema(),
        entityProposals: {
            type: "array",
            items: closedObject({
                entityType: {
                    type: "string",
                    enum: [...SUPPORTED_INGEST_ENTITY_TYPES]
                },
                title: { type: "string" },
                summary: { type: "string" },
                rationale: { type: "string" },
                confidence: { type: "number" },
                suggestedFields: suggestedFieldsSchema
            })
        },
        pageUpdateSuggestions: {
            type: "array",
            items: closedObject({
                targetSlug: { type: "string" },
                rationale: { type: "string" },
                patchSummary: { type: "string" }
            })
        },
        articleCandidates: {
            type: "array",
            items: closedObject({
                title: { type: "string" },
                slug: { type: "string" },
                parentSlug: nullableStringSchema(),
                rationale: { type: "string" },
                summary: { type: "string" },
                markdown: { type: "string" },
                tags: stringArraySchema(),
                aliases: stringArraySchema()
            })
        }
    });
}
function isOutputTextPart(part) {
    return (part !== null &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "output_text" &&
        typeof part.text === "string");
}
function parseOutputText(payload) {
    const output = Array.isArray(payload.output) ? payload.output : [];
    for (const item of output) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const content = Array.isArray(item.content)
            ? item.content
            : [];
        for (const part of content) {
            if (isOutputTextPart(part)) {
                return part.text;
            }
        }
    }
    return null;
}
function readReasoningEffort(profile) {
    return typeof profile.metadata.reasoningEffort === "string"
        ? profile.metadata.reasoningEffort
        : null;
}
function readVerbosity(profile) {
    return typeof profile.metadata.verbosity === "string"
        ? profile.metadata.verbosity
        : null;
}
function isCodexProfile(profile) {
    return profile.provider === "openai-codex";
}
function normalizeBaseUrl(profile) {
    const trimmed = profile.baseUrl.trim();
    if (trimmed.length > 0) {
        return trimmed.replace(/\/$/, "");
    }
    return isCodexProfile(profile)
        ? DEFAULT_CODEX_BASE_URL
        : "https://api.openai.com/v1";
}
function buildResponsesUrl(profile, responseId) {
    const baseUrl = normalizeBaseUrl(profile);
    const root = isCodexProfile(profile)
        ? baseUrl.endsWith("/codex/responses")
            ? baseUrl
            : baseUrl.endsWith("/codex")
                ? `${baseUrl}/responses`
                : `${baseUrl}/codex/responses`
        : baseUrl.endsWith("/responses")
            ? baseUrl
            : `${baseUrl}/responses`;
    return responseId ? `${root}/${responseId}` : root;
}
function extractCodexAccountId(accessToken) {
    try {
        const parts = accessToken.split(".");
        if (parts.length !== 3) {
            throw new Error("Invalid token");
        }
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
        const auth = payload[CODEX_JWT_CLAIM_PATH];
        if (!auth || typeof auth !== "object") {
            throw new Error("Missing auth claim");
        }
        const accountId = auth.chatgpt_account_id;
        if (typeof accountId !== "string" || accountId.trim().length === 0) {
            throw new Error("Missing account id");
        }
        return accountId;
    }
    catch {
        throw new Error("Failed to extract accountId from OpenAI Codex token.");
    }
}
function buildRequestHeaders(profile, apiKey, options = {}) {
    const headers = {
        authorization: `Bearer ${apiKey}`
    };
    if (options.includeJsonContentType) {
        headers["content-type"] = "application/json";
    }
    if (!isCodexProfile(profile)) {
        return headers;
    }
    headers["OpenAI-Beta"] = "responses=experimental";
    headers.originator = "pi";
    headers["chatgpt-account-id"] = extractCodexAccountId(apiKey);
    return headers;
}
function buildReasoningConfiguration(profile) {
    const effort = readReasoningEffort(profile);
    return effort ? { effort } : undefined;
}
function buildTextConfiguration(options) {
    const text = {};
    const verbosity = readVerbosity(options.profile);
    if (verbosity) {
        text.verbosity = verbosity;
    }
    if (options.format) {
        text.format = options.format;
    }
    return Object.keys(text).length > 0 ? text : undefined;
}
function estimateTokens(text) {
    return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}
function computeSourceExcerpt(profile, sourceText) {
    const contextWindow = MODEL_CONTEXT_WINDOWS[profile.model] ?? DEFAULT_CONTEXT_WINDOW;
    const inputBudget = Math.max(16_000, contextWindow - RESERVED_RESPONSE_TOKENS);
    const estimatedTokens = estimateTokens(sourceText);
    if (estimatedTokens <= inputBudget) {
        return {
            sourceExcerpt: sourceText,
            estimatedTokens,
            contextWindow,
            inputBudget,
            truncated: false
        };
    }
    const allowedChars = Math.max(8_000, Math.floor(inputBudget * APPROX_CHARS_PER_TOKEN));
    return {
        sourceExcerpt: sourceText.slice(0, allowedChars),
        estimatedTokens,
        contextWindow,
        inputBudget,
        truncated: true
    };
}
async function readJsonPayload(response) {
    const payload = (await response.json());
    return payload;
}
function readResponseStatus(payload) {
    return typeof payload.status === "string" ? payload.status : null;
}
function readResponseId(payload) {
    return typeof payload.id === "string" ? payload.id : null;
}
function readResponseError(payload) {
    const error = payload.error;
    if (!error || typeof error !== "object") {
        return null;
    }
    const message = typeof error.message === "string"
        ? error.message
        : null;
    return message;
}
function isTerminalBackgroundStatus(status) {
    return (status === "completed" ||
        status === "failed" ||
        status === "cancelled" ||
        status === "incomplete");
}
function normalizeResult(content, input) {
    if (!content) {
        return null;
    }
    try {
        const parsed = JSON.parse(content);
        return {
            title: parsed.title?.trim() || input.titleHint || "Imported source",
            summary: parsed.summary?.trim() || "",
            markdown: parsed.markdown?.trim() ||
                `# ${parsed.title?.trim() || input.titleHint || "Imported source"}\n\n${parsed.summary?.trim() || "Imported source prepared for Forge review."}\n`,
            tags: Array.isArray(parsed.tags)
                ? parsed.tags.filter((tag) => typeof tag === "string")
                : [],
            entityProposals: Array.isArray(parsed.entityProposals)
                ? parsed.entityProposals.filter((entry) => entry !== null && typeof entry === "object")
                : [],
            pageUpdateSuggestions: Array.isArray(parsed.pageUpdateSuggestions)
                ? parsed.pageUpdateSuggestions.filter((entry) => entry !== null && typeof entry === "object")
                : [],
            articleCandidates: Array.isArray(parsed.articleCandidates)
                ? parsed.articleCandidates.filter((entry) => entry !== null && typeof entry === "object")
                : []
        };
    }
    catch {
        return null;
    }
}
export class OpenAiResponsesProvider {
    providerNames = [
        "openai",
        "openai-api",
        "openai-codex",
        "openai-responses",
        "openai-compatible"
    ];
    async testConnection({ apiKey, profile, logger }) {
        emitDiagnostic(logger, {
            level: "info",
            message: "Testing OpenAI wiki connection.",
            details: {
                scope: "wiki_llm",
                eventKey: "llm_connection_test_start",
                provider: profile.provider,
                baseUrl: profile.baseUrl,
                model: profile.model
            }
        });
        let response;
        try {
            response = await fetch(buildResponsesUrl(profile), {
                method: "POST",
                headers: buildRequestHeaders(profile, apiKey, {
                    includeJsonContentType: true
                }),
                body: JSON.stringify({
                    model: profile.model,
                    input: "Reply with the single word ok.",
                    max_output_tokens: 24,
                    reasoning: buildReasoningConfiguration(profile),
                    text: buildTextConfiguration({ profile })
                })
            });
        }
        catch (error) {
            emitDiagnostic(logger, {
                level: "error",
                message: "OpenAI connection test could not reach the provider.",
                details: {
                    scope: "wiki_llm",
                    eventKey: "llm_connection_test_transport_error",
                    provider: profile.provider,
                    baseUrl: profile.baseUrl,
                    model: profile.model,
                    error: error instanceof Error
                        ? {
                            name: error.name,
                            message: error.message,
                            stack: error.stack ?? null
                        }
                        : String(error)
                }
            });
            throw error;
        }
        if (!response.ok) {
            const message = await response.text();
            emitDiagnostic(logger, {
                level: "error",
                message: `OpenAI connection test failed (${response.status}).`,
                details: {
                    scope: "wiki_llm",
                    eventKey: "llm_connection_test_failed",
                    provider: profile.provider,
                    baseUrl: profile.baseUrl,
                    model: profile.model,
                    status: response.status,
                    responseBody: truncate(message)
                }
            });
            throw new Error(`OpenAI connection test failed (${response.status})${message ? `: ${message}` : ""}`);
        }
        const payload = await readJsonPayload(response);
        emitDiagnostic(logger, {
            level: "info",
            message: "OpenAI connection test completed.",
            details: {
                scope: "wiki_llm",
                eventKey: "llm_connection_test_success",
                provider: profile.provider,
                baseUrl: profile.baseUrl,
                model: profile.model,
                outputPreview: truncate(parseOutputText(payload)?.trim() || "ok", 240)
            }
        });
        return {
            outputPreview: parseOutputText(payload)?.trim() || "ok"
        };
    }
    async runText({ apiKey, profile, systemPrompt, prompt, logger }) {
        emitDiagnostic(logger, {
            level: "info",
            message: "Running OpenAI text prompt.",
            details: {
                scope: "ai_processor",
                eventKey: "prompt_run_start",
                provider: profile.provider,
                baseUrl: profile.baseUrl,
                model: profile.model
            }
        });
        const response = await fetch(buildResponsesUrl(profile), {
            method: "POST",
            headers: buildRequestHeaders(profile, apiKey, {
                includeJsonContentType: true
            }),
            body: JSON.stringify({
                model: profile.model,
                input: [
                    ...(systemPrompt?.trim()
                        ? [
                            {
                                role: "system",
                                content: [{ type: "input_text", text: systemPrompt.trim() }]
                            }
                        ]
                        : []),
                    {
                        role: "user",
                        content: [{ type: "input_text", text: prompt }]
                    }
                ],
                reasoning: buildReasoningConfiguration(profile),
                text: buildTextConfiguration({ profile }),
                max_output_tokens: 1200
            })
        });
        if (!response.ok) {
            const message = await response.text();
            throw new Error(`OpenAI text prompt failed (${response.status})${message ? `: ${message}` : ""}`);
        }
        const payload = await readJsonPayload(response);
        return {
            outputText: parseOutputText(payload)?.trim() || ""
        };
    }
    async compile({ apiKey, profile, input, resumeResponseId, logger }) {
        const sourceText = input.rawText.trim();
        const prompt = [
            "You convert user-provided source material into reviewable Forge wiki drafts.",
            "You are preparing candidates for human review. Do not publish anything directly.",
            "Return strict JSON with exactly these top-level keys: title, summary, markdown, tags, entityProposals, pageUpdateSuggestions, articleCandidates.",
            "Goal:",
            "- Produce one main overview page in markdown.",
            "- Split durable subtopics into articleCandidates with full draft markdown.",
            "- Propose Forge entities only when the source clearly supports a durable record.",
            "- Suggest page updates only when the source clearly belongs in an existing page instead of a new page.",
            "What Forge expects:",
            "- The main markdown should be a readable overview or anchor page, not a raw source dump.",
            "- articleCandidates should contain real draft wiki pages with their own markdown, not just titles.",
            "- entityProposals must use one of these entityType values only: goal, project, task, habit, strategy, psyche_value, note.",
            "- Use suggestedFields only for fields that truly fit the entity type. Use null for unknown scalar fields and [] for unknown list fields.",
            "- Keep entity proposals conservative. Prefer wiki pages when the source is informative but not actionable enough for a Forge entity.",
            "Forge ontology:",
            "- Forge has two durable knowledge surfaces: wiki pages and structured entities.",
            "- Use wiki pages for rich context, summaries, explanations, relationships, timelines, source synthesis, and themes that are broader than one action item.",
            "- Use entities for operational objects that Forge can track directly: goals, projects, tasks, habits, strategies, psyche values, and durable notes.",
            "- When the same topic needs both explanation and operations, create both: a wiki page for context and an entity proposal for the operational record.",
            "Forge wiki writing rules:",
            "- Use clean Markdown headings and short sections.",
            "- Use [[wiki links]] only for durable concepts, people, projects, places, or pages that should exist in the wiki.",
            "- Prefer factual, compressed, agent-usable writing over decorative prose.",
            "- When the source is a chat, transcript, or message log, do not reproduce turn-by-turn conversation unless the exact wording is the durable artifact.",
            "- For chats and transcripts, extract the durable parts: people, relationships, ongoing projects, commitments, habits, values, decisions, questions, sources, and evidence.",
            "- Merge repetitive back-and-forth into concise summaries.",
            "- Use short quotes only when the exact phrase matters.",
            "How to split pages:",
            "- Keep markdown as the overview page for this source.",
            "- If one topic deserves its own page, put it in articleCandidates with title, slug, summary, rationale, markdown, tags, aliases, and parentSlug.",
            "- Use parentSlug when the draft page clearly belongs under an existing Forge wiki branch such as people, projects, concepts, sources, or chronicle.",
            "- Do not create articleCandidates for every minor mention; only create pages that would be useful to reopen later.",
            "Useful high-level wiki themes:",
            "- people: people, collaborators, family, teams, roles, relationship context.",
            "- projects: bounded initiatives, active efforts, plans, milestones, workstreams.",
            "- concepts: ideas, beliefs, frameworks, principles, definitions, recurring themes.",
            "- sources: books, papers, links, chats, files, interviews, meetings, datasets, media.",
            "- chronicle: dated notes, decisions, turning points, retrospectives, timelines, event sequences.",
            "- values: valued directions, principles, motives, what matters, meaning, purpose.",
            "- practices: routines, rituals, habits, protocols, checklists, playbooks, recipes, methods.",
            "- health: sleep, sport, recovery, symptoms, treatments, biometrics, body-related observations.",
            "- places: homes, cities, venues, clinics, schools, travel locations, recurring environments.",
            "- areas: enduring life domains such as relationships, work, learning, finances, home, family, and community.",
            "- decisions: important choices, tradeoffs, commitments, rules, criteria, and open questions.",
            "- Use these themes as clustering lenses. They are inspired by recurring dimensions in well-being and self-reflection literature: relationships, meaning, accomplishment, growth, health, environment, and life context.",
            "- If the source strongly fits one of these themes but does not justify a Forge entity, create a wiki page draft instead of forcing an entity.",
            "How to propose entities:",
            "- goal: a durable desired outcome with an explicit direction or finish line.",
            "- project: a bounded initiative with a concrete scope, usually linked to a goal.",
            "- task: a single actionable work item, not a broad initiative.",
            "- habit: repeated behavior with a cadence or rule.",
            "- strategy: a repeatable or structured approach linked to a goal, project, or task.",
            "- psyche_value: a durable value, principle, or valued direction that explains what matters to the user.",
            "- note: only when the source implies a durable evidence note that should exist as a record outside the wiki page itself.",
            "Entity proposal rules:",
            "- Never invent IDs.",
            "- Do not propose an entity just because it is mentioned once without durable importance.",
            "- People, concepts, sources, places, and broad life areas are usually wiki pages, not Forge entities.",
            "- Goals should be outcomes, not chores.",
            "- Projects should group multiple steps or phases, not a single errand.",
            "- Tasks should be concrete and actionable enough to do soon.",
            "- Habits should represent repeated behaviors, routines, or standing rules.",
            "- Strategies should represent reusable plans, heuristics, protocols, or decision patterns.",
            "- Psyche values should capture what matters and why, not merely preferences or moods.",
            "- Notes should be evidence-like records, observations, excerpts, or source captures that deserve their own durable object.",
            "- If a project is proposed, include a plausible goal linkage in suggestedFields when the source makes that relationship clear.",
            "- If a habit is proposed, include polarity, frequency, linked goals/projects/tasks, and cadence details when present.",
            "- If a psyche_value is proposed, use valuedDirection, whyItMatters, and linked goals/projects/tasks when present.",
            "- If the source mentions an existing Forge-like object but only adds background context, prefer a pageUpdateSuggestion or wiki page rather than creating a duplicate entity.",
            "What to capture from common source types:",
            "- Chats and message logs: relationship facts, plans, promises, recurring activities, values, concerns, decisions, and candidate projects or habits.",
            "- Articles, books, and notes: concepts, sources, claims, frameworks, quotes worth preserving, and related projects or values.",
            "- Personal logs and journals: chronology, patterns, self-observations, decisions, practices, health notes, relationship dynamics, and values under tension.",
            "- Meeting notes: decisions, owners, projects, tasks, open questions, and source evidence.",
            "Page update rules:",
            "- Only emit pageUpdateSuggestions when the source clearly belongs in an existing page.",
            "- Keep patchSummary concise and specific so Forge can append it safely.",
            "Output discipline:",
            "- Always return every top-level key.",
            "- Always return every nested object field required by the schema.",
            "- Use empty arrays instead of omitting lists.",
            "- Use null instead of omitting unknown scalar fields inside suggestedFields.",
            "- Do not wrap the JSON in markdown fences or prose.",
            profile.systemPrompt.trim()
        ]
            .filter(Boolean)
            .join("\n");
        const sourcePlan = computeSourceExcerpt(profile, sourceText);
        emitDiagnostic(logger, {
            level: "info",
            message: "Started OpenAI wiki compilation request.",
            details: {
                scope: "wiki_llm",
                eventKey: "llm_compile_start",
                provider: profile.provider,
                baseUrl: profile.baseUrl,
                model: profile.model,
                mimeType: input.mimeType,
                parseStrategy: input.parseStrategy,
                titleHint: input.titleHint,
                rawTextLength: input.rawText.length,
                includesBinary: Boolean(input.binary),
                estimatedInputTokens: sourcePlan.estimatedTokens,
                contextWindow: sourcePlan.contextWindow,
                inputBudget: sourcePlan.inputBudget,
                truncated: sourcePlan.truncated
            }
        });
        const inputs = [
            {
                role: "system",
                content: [{ type: "input_text", text: prompt }]
            }
        ];
        const userContent = [
            {
                type: "input_text",
                text: [
                    `Title hint: ${input.titleHint || "none"}`,
                    `Mime type: ${input.mimeType}`,
                    `Parse strategy: ${input.parseStrategy}`,
                    `Source length: ${sourceText.length} characters`,
                    sourcePlan.truncated
                        ? `Source was truncated to fit the model context budget (${sourcePlan.inputBudget} estimated input tokens). Focus on durable structure, not verbatim reproduction.`
                        : "Source was sent in full."
                ].join("\n")
            }
        ];
        if (sourceText) {
            userContent.push({
                type: "input_text",
                text: `Source:\n${sourcePlan.sourceExcerpt}`
            });
        }
        if (input.binary &&
            input.parseStrategy !== "text_only" &&
            input.mimeType.startsWith("image/")) {
            userContent.push({
                type: "input_image",
                image_url: `data:${input.mimeType};base64,${input.binary.toString("base64")}`
            });
        }
        inputs.push({
            role: "user",
            content: userContent
        });
        let payload;
        let responseId = resumeResponseId?.trim() || null;
        if (responseId) {
            emitDiagnostic(logger, {
                level: "info",
                message: "Resuming OpenAI wiki compilation from an existing background response.",
                details: {
                    scope: "wiki_llm",
                    eventKey: "llm_compile_background_resuming",
                    provider: profile.provider,
                    baseUrl: profile.baseUrl,
                    model: profile.model,
                    responseId
                }
            });
            const resumeResponse = await fetch(buildResponsesUrl(profile, responseId), {
                method: "GET",
                headers: buildRequestHeaders(profile, apiKey),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
            });
            if (!resumeResponse.ok) {
                const message = await resumeResponse.text();
                throw new Error(`OpenAI background wiki compilation resume failed: ${resumeResponse.status}${message ? `: ${message}` : ""}`);
            }
            payload = await readJsonPayload(resumeResponse);
            emitDiagnostic(logger, {
                level: "info",
                message: "Forge reattached to the existing OpenAI background wiki compilation job.",
                details: {
                    scope: "wiki_llm",
                    eventKey: "llm_compile_background_started",
                    provider: profile.provider,
                    baseUrl: profile.baseUrl,
                    model: profile.model,
                    responseId,
                    status: readResponseStatus(payload),
                    resumed: true
                }
            });
        }
        else {
            let createResponse;
            try {
                createResponse = await fetch(buildResponsesUrl(profile), {
                    method: "POST",
                    headers: buildRequestHeaders(profile, apiKey, {
                        includeJsonContentType: true
                    }),
                    body: JSON.stringify({
                        model: profile.model,
                        input: inputs,
                        store: true,
                        background: true,
                        prompt_cache_retention: profile.model === "gpt-5.4" ? "24h" : "in_memory",
                        prompt_cache_key: `forge-wiki-ingest:${profile.model}:${input.parseStrategy}:${input.mimeType}`,
                        reasoning: buildReasoningConfiguration(profile),
                        text: buildTextConfiguration({
                            profile,
                            format: {
                                type: "json_schema",
                                name: "forge_wiki_ingest_compilation",
                                strict: true,
                                schema: buildWikiIngestSchema()
                            }
                        })
                    }),
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
                });
            }
            catch (error) {
                const finalError = error instanceof Error ? error : new Error(String(error));
                emitDiagnostic(logger, {
                    level: "error",
                    message: "OpenAI wiki compilation could not reach the provider.",
                    details: {
                        scope: "wiki_llm",
                        eventKey: "llm_compile_transport_error",
                        provider: profile.provider,
                        baseUrl: profile.baseUrl,
                        model: profile.model,
                        mimeType: input.mimeType,
                        parseStrategy: input.parseStrategy,
                        rawTextLength: input.rawText.length,
                        estimatedInputTokens: sourcePlan.estimatedTokens,
                        truncated: sourcePlan.truncated,
                        error: {
                            name: finalError.name,
                            message: finalError.message,
                            stack: finalError.stack ?? null
                        }
                    }
                });
                throw finalError;
            }
            if (!createResponse.ok) {
                const message = await createResponse.text();
                emitDiagnostic(logger, {
                    level: "error",
                    message: `LLM compilation failed: ${createResponse.status}`,
                    details: {
                        scope: "wiki_llm",
                        eventKey: "llm_compile_failed",
                        provider: profile.provider,
                        baseUrl: profile.baseUrl,
                        model: profile.model,
                        mimeType: input.mimeType,
                        parseStrategy: input.parseStrategy,
                        rawTextLength: input.rawText.length,
                        estimatedInputTokens: sourcePlan.estimatedTokens,
                        truncated: sourcePlan.truncated,
                        status: createResponse.status,
                        responseBody: truncate(message)
                    }
                });
                throw new Error(`LLM compilation failed: ${createResponse.status}${message ? `: ${message}` : ""}`);
            }
            payload = await readJsonPayload(createResponse);
            responseId = readResponseId(payload);
            if (!responseId) {
                throw new Error("OpenAI background response did not include an id for polling.");
            }
            emitDiagnostic(logger, {
                level: "info",
                message: "OpenAI accepted the wiki compilation job for background processing.",
                details: {
                    scope: "wiki_llm",
                    eventKey: "llm_compile_background_started",
                    provider: profile.provider,
                    baseUrl: profile.baseUrl,
                    model: profile.model,
                    responseId,
                    status: readResponseStatus(payload),
                    resumed: false
                }
            });
        }
        let pollCount = 0;
        let consecutivePollFailures = 0;
        while (!isTerminalBackgroundStatus(readResponseStatus(payload))) {
            await new Promise((resolve) => setTimeout(resolve, BACKGROUND_POLL_INTERVAL_MS));
            try {
                const pollResponse = await fetch(buildResponsesUrl(profile, responseId), {
                    method: "GET",
                    headers: buildRequestHeaders(profile, apiKey),
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
                });
                if (!pollResponse.ok) {
                    const message = await pollResponse.text();
                    if (pollResponse.status >= 500) {
                        consecutivePollFailures += 1;
                        emitDiagnostic(logger, {
                            level: "warning",
                            message: "OpenAI background wiki compilation polling hit a server error. Forge will keep retrying.",
                            details: {
                                scope: "wiki_llm",
                                eventKey: "llm_compile_background_poll_retry",
                                provider: profile.provider,
                                baseUrl: profile.baseUrl,
                                model: profile.model,
                                responseId,
                                pollCount,
                                consecutivePollFailures,
                                status: pollResponse.status,
                                responseBody: truncate(message)
                            }
                        });
                        continue;
                    }
                    throw new Error(`OpenAI background wiki compilation polling failed: ${pollResponse.status}${message ? `: ${message}` : ""}`);
                }
                payload = await readJsonPayload(pollResponse);
                pollCount += 1;
                consecutivePollFailures = 0;
                emitDiagnostic(logger, {
                    level: "info",
                    message: "Polled OpenAI background wiki compilation status.",
                    details: {
                        scope: "wiki_llm",
                        eventKey: "llm_compile_background_polled",
                        provider: profile.provider,
                        baseUrl: profile.baseUrl,
                        model: profile.model,
                        responseId,
                        pollCount,
                        status: readResponseStatus(payload)
                    }
                });
            }
            catch (error) {
                const finalError = error instanceof Error ? error : new Error(String(error));
                const isRetriableTransport = finalError.name === "TypeError" ||
                    finalError.name === "TimeoutError" ||
                    /fetch failed/i.test(finalError.message) ||
                    /network/i.test(finalError.message) ||
                    /timeout/i.test(finalError.message);
                if (!isRetriableTransport) {
                    throw finalError;
                }
                consecutivePollFailures += 1;
                emitDiagnostic(logger, {
                    level: "warning",
                    message: "OpenAI background wiki compilation polling lost connectivity. Forge will keep retrying.",
                    details: {
                        scope: "wiki_llm",
                        eventKey: "llm_compile_background_poll_retry",
                        provider: profile.provider,
                        baseUrl: profile.baseUrl,
                        model: profile.model,
                        responseId,
                        pollCount,
                        consecutivePollFailures,
                        error: {
                            name: finalError.name,
                            message: finalError.message,
                            stack: finalError.stack ?? null
                        }
                    }
                });
            }
        }
        const finalStatus = readResponseStatus(payload);
        if (finalStatus !== "completed") {
            const errorMessage = readResponseError(payload) ??
                `OpenAI background wiki compilation ended with status ${finalStatus}.`;
            emitDiagnostic(logger, {
                level: "error",
                message: errorMessage,
                details: {
                    scope: "wiki_llm",
                    eventKey: "llm_compile_background_terminal_error",
                    provider: profile.provider,
                    baseUrl: profile.baseUrl,
                    model: profile.model,
                    responseId,
                    status: finalStatus
                }
            });
            throw new Error(errorMessage);
        }
        const content = parseOutputText(payload);
        const result = normalizeResult(content, input);
        emitDiagnostic(logger, {
            level: result ? "info" : "warning",
            message: result
                ? "OpenAI wiki compilation returned structured output."
                : "OpenAI wiki compilation returned output that could not be normalized.",
            details: {
                scope: "wiki_llm",
                eventKey: result ? "llm_compile_success" : "llm_compile_unparseable",
                provider: profile.provider,
                baseUrl: profile.baseUrl,
                model: profile.model,
                responseId,
                estimatedInputTokens: sourcePlan.estimatedTokens,
                truncated: sourcePlan.truncated,
                responsePreview: truncate(content ?? "", 600),
                articleCandidateCount: result?.articleCandidates.length ?? 0,
                entityProposalCount: result?.entityProposals.length ?? 0,
                pageUpdateSuggestionCount: result?.pageUpdateSuggestions.length ?? 0
            }
        });
        return result;
    }
}
