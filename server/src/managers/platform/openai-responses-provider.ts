import type {
  WikiCompileInput,
  WikiCompileResult,
  WikiLlmDiagnosticLogger,
  WikiLlmProfileLike,
  WikiLlmProvider
} from "./llm-manager.js";

function emitDiagnostic(
  logger: WikiLlmDiagnosticLogger | undefined,
  input: Parameters<WikiLlmDiagnosticLogger>[0]
) {
  logger?.(input);
}

function truncate(value: string, limit = 1_600) {
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
] as const;

const MAX_SOURCE_TEXT_CHARS = 120_000;

type JsonSchema = Record<string, unknown>;

function closedObject(properties: Record<string, JsonSchema>): JsonSchema {
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
  } satisfies JsonSchema;
}

function integerArraySchema() {
  return {
    type: "array",
    items: { type: "integer" }
  } satisfies JsonSchema;
}

function nullableStringSchema() {
  return {
    type: ["string", "null"]
  } satisfies JsonSchema;
}

function nullableNumberSchema() {
  return {
    type: ["number", "null"]
  } satisfies JsonSchema;
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

function isOutputTextPart(
  part: unknown
): part is { type: "output_text"; text: string } {
  return (
    part !== null &&
    typeof part === "object" &&
    "type" in part &&
    (part as { type?: unknown }).type === "output_text" &&
    typeof (part as { text?: unknown }).text === "string"
  );
}

function parseOutputText(payload: Record<string, unknown>) {
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const content = Array.isArray((item as { content?: unknown }).content)
      ? ((item as { content?: unknown }).content as Array<unknown>)
      : [];
    for (const part of content) {
      if (isOutputTextPart(part)) {
        return part.text;
      }
    }
  }
  return null;
}

function readReasoningEffort(profile: WikiLlmProfileLike) {
  return typeof profile.metadata.reasoningEffort === "string"
    ? profile.metadata.reasoningEffort
    : null;
}

function readVerbosity(profile: WikiLlmProfileLike) {
  return typeof profile.metadata.verbosity === "string"
    ? profile.metadata.verbosity
    : null;
}

function buildReasoningConfiguration(profile: WikiLlmProfileLike) {
  const effort = readReasoningEffort(profile);
  return effort ? { effort } : undefined;
}

function buildTextConfiguration(options: {
  profile: WikiLlmProfileLike;
  format?: Record<string, unknown>;
}) {
  const text: Record<string, unknown> = {};
  const verbosity = readVerbosity(options.profile);
  if (verbosity) {
    text.verbosity = verbosity;
  }
  if (options.format) {
    text.format = options.format;
  }
  return Object.keys(text).length > 0 ? text : undefined;
}

async function readJsonPayload(response: Response) {
  const payload = (await response.json()) as Record<string, unknown>;
  return payload;
}

function normalizeResult(
  content: string | null,
  input: WikiCompileInput
): WikiCompileResult | null {
  if (!content) {
    return null;
  }
  try {
    const parsed = JSON.parse(content) as Partial<WikiCompileResult>;
    return {
      title: parsed.title?.trim() || input.titleHint || "Imported source",
      summary: parsed.summary?.trim() || "",
      markdown:
        parsed.markdown?.trim() ||
        `# ${parsed.title?.trim() || input.titleHint || "Imported source"}\n\n${
          parsed.summary?.trim() || "Imported source prepared for Forge review."
        }\n`,
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
      entityProposals: Array.isArray(parsed.entityProposals)
        ? parsed.entityProposals.filter(
            (entry): entry is Record<string, unknown> =>
              entry !== null && typeof entry === "object"
          )
        : [],
      pageUpdateSuggestions: Array.isArray(parsed.pageUpdateSuggestions)
        ? parsed.pageUpdateSuggestions.filter(
            (entry): entry is Record<string, unknown> =>
              entry !== null && typeof entry === "object"
          )
        : [],
      articleCandidates: Array.isArray(parsed.articleCandidates)
        ? parsed.articleCandidates.filter(
            (entry): entry is Record<string, unknown> =>
              entry !== null && typeof entry === "object"
          )
        : []
    };
  } catch {
    return null;
  }
}

export class OpenAiResponsesProvider implements WikiLlmProvider {
  readonly providerNames = ["openai", "openai-responses", "openai-compatible"];

  async testConnection({
    apiKey,
    profile,
    logger
  }: Parameters<WikiLlmProvider["testConnection"]>[0]) {
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
    let response: Response;
    try {
      response = await fetch(
        `${profile.baseUrl.replace(/\/$/, "")}/responses`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: profile.model,
            input: "Reply with the single word ok.",
            max_output_tokens: 24,
            reasoning: buildReasoningConfiguration(profile),
            text: buildTextConfiguration({ profile })
          })
        }
      );
    } catch (error) {
      emitDiagnostic(logger, {
        level: "error",
        message: "OpenAI connection test could not reach the provider.",
        details: {
          scope: "wiki_llm",
          eventKey: "llm_connection_test_transport_error",
          provider: profile.provider,
          baseUrl: profile.baseUrl,
          model: profile.model,
          error:
            error instanceof Error
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
      throw new Error(
        `OpenAI connection test failed (${response.status})${
          message ? `: ${message}` : ""
        }`
      );
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

  async compile({
    apiKey,
    profile,
    input,
    logger
  }: Parameters<WikiLlmProvider["compile"]>[0]) {
    const sourceText = input.rawText.trim();
    const sourceExcerpt =
      sourceText.length > MAX_SOURCE_TEXT_CHARS
        ? sourceText.slice(0, MAX_SOURCE_TEXT_CHARS)
        : sourceText;
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

    const inputs: Array<Record<string, unknown>> = [
      {
        role: "system",
        content: [{ type: "input_text", text: prompt }]
      }
    ];

    const userContent: Array<Record<string, unknown>> = [
      {
        type: "input_text",
        text: [
          `Title hint: ${input.titleHint || "none"}`,
          `Mime type: ${input.mimeType}`,
          `Parse strategy: ${input.parseStrategy}`,
          `Source length: ${sourceText.length} characters`,
          sourceText.length > MAX_SOURCE_TEXT_CHARS
            ? `Source was truncated to the first ${MAX_SOURCE_TEXT_CHARS} characters before sending to the model. Focus on durable structure, not verbatim reproduction.`
            : "Source was sent in full."
        ].join("\n")
      }
    ];

    if (sourceText) {
      userContent.push({
        type: "input_text",
        text: `Source:\n${sourceExcerpt}`
      });
    }

    if (
      input.binary &&
      input.parseStrategy !== "text_only" &&
      input.mimeType.startsWith("image/")
    ) {
      userContent.push({
        type: "input_image",
        image_url: `data:${input.mimeType};base64,${input.binary.toString("base64")}`
      });
    }

    inputs.push({
      role: "user",
      content: userContent
    });

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
        includesBinary: Boolean(input.binary)
      }
    });

    let response: Response;
    try {
      response = await fetch(
        `${profile.baseUrl.replace(/\/$/, "")}/responses`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: profile.model,
            input: inputs,
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
          })
        }
      );
    } catch (error) {
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
          error:
            error instanceof Error
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
        message: `LLM compilation failed: ${response.status}`,
        details: {
          scope: "wiki_llm",
          eventKey: "llm_compile_failed",
          provider: profile.provider,
          baseUrl: profile.baseUrl,
          model: profile.model,
          mimeType: input.mimeType,
          parseStrategy: input.parseStrategy,
          rawTextLength: input.rawText.length,
          status: response.status,
          responseBody: truncate(message)
        }
      });
      throw new Error(
        `LLM compilation failed: ${response.status}${
          message ? `: ${message}` : ""
        }`
      );
    }

    const payload = await readJsonPayload(response);
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
        responsePreview: truncate(content ?? "", 600),
        articleCandidateCount: result?.articleCandidates.length ?? 0,
        entityProposalCount: result?.entityProposals.length ?? 0,
        pageUpdateSuggestionCount: result?.pageUpdateSuggestions.length ?? 0
      }
    });
    return result;
  }
}
