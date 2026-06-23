import type { WikiLlmProfile } from "@/lib/types";

export type WikiLlmReasoningEffort =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export type WikiLlmVerbosity = "low" | "medium" | "high";

export const OPENAI_WIKI_MODELS = [
  {
    value: "gpt-5.4",
    label: "GPT-5.4",
    description: "Highest quality drafting for long, connected wiki pages."
  },
  {
    value: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    description: "Balanced speed and quality for regular ingest jobs."
  },
  {
    value: "gpt-5.4-nano",
    label: "GPT-5.4 nano",
    description: "Fastest and cheapest option for smaller imports."
  }
] as const;

export const WIKI_LLM_REASONING_OPTIONS: Array<{
  value: WikiLlmReasoningEffort;
  label: string;
  description: string;
}> = [
  { value: "none", label: "None", description: "Fastest response." },
  { value: "low", label: "Low", description: "Short reasoning budget." },
  {
    value: "medium",
    label: "Medium",
    description: "Balanced depth for most imports."
  },
  { value: "high", label: "High", description: "More drafting effort." },
  {
    value: "xhigh",
    label: "X-High",
    description: "Deepest reasoning for dense source material."
  }
];

export const WIKI_LLM_VERBOSITY_OPTIONS: Array<{
  value: WikiLlmVerbosity;
  label: string;
  description: string;
}> = [
  { value: "low", label: "Low", description: "Concise output." },
  { value: "medium", label: "Medium", description: "Balanced detail." },
  { value: "high", label: "High", description: "Longer, fuller drafts." }
];

export const DEFAULT_WIKI_LLM_MODEL = OPENAI_WIKI_MODELS[1].value;
export const DEFAULT_WIKI_LLM_REASONING: WikiLlmReasoningEffort = "medium";
export const DEFAULT_WIKI_LLM_VERBOSITY: WikiLlmVerbosity = "medium";
export const DEFAULT_WIKI_SYSTEM_PROMPT =
  "Prepare reviewable Forge wiki drafts from the source. Do not dump raw chats or transcripts. Extract durable people, projects, goals, tasks, habits, strategies, values, notes, evidence, self-observations, and recurring patterns. Keep the main page concise, split strong subtopics into article candidates with meaningful [[wiki links]], and organize knowledge around durable Forge themes such as people, projects, concepts, sources, chronicle, values, practices, health, places, decisions, and enduring life areas like relationships, work, learning, finances, and home.";

export function readWikiLlmReasoning(
  metadata: Record<string, unknown> | undefined
): WikiLlmReasoningEffort {
  const value = metadata?.reasoningEffort;
  if (
    value === "none" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }
  return DEFAULT_WIKI_LLM_REASONING;
}

export function readWikiLlmVerbosity(
  metadata: Record<string, unknown> | undefined
): WikiLlmVerbosity {
  const value = metadata?.verbosity;
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return DEFAULT_WIKI_LLM_VERBOSITY;
}

export function buildWikiLlmMetadata(input: {
  reasoningEffort: WikiLlmReasoningEffort;
  verbosity: WikiLlmVerbosity;
}) {
  return {
    reasoningEffort: input.reasoningEffort,
    verbosity: input.verbosity
  } satisfies Record<string, unknown>;
}

export function summarizeWikiLlmProfile(profile: WikiLlmProfile) {
  const model =
    OPENAI_WIKI_MODELS.find((entry) => entry.value === profile.model)?.label ??
    profile.model;
  return {
    model,
    reasoning: readWikiLlmReasoning(profile.metadata),
    verbosity: readWikiLlmVerbosity(profile.metadata),
    hasKey: Boolean(profile.secretId)
  };
}
