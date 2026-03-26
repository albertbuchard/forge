import type {
  ModeTimelineEntry,
  TriggerBehavior,
  TriggerConsequences,
  TriggerEmotion,
  TriggerThought
} from "./psyche-types";

function normalizeLines(value: string) {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function nextLocalId(prefix: string, index: number) {
  return `${prefix}_${index + 1}`;
}

export function formatLines(values: string[]) {
  return values.join("\n");
}

export function parseLines(value: string) {
  return normalizeLines(value);
}

export function formatEmotionLines(emotions: TriggerEmotion[]) {
  return emotions
    .map((emotion) =>
      `${emotion.label} | ${emotion.intensity} | ${emotion.note} | ${emotion.emotionDefinitionId ?? ""}`.trim()
    )
    .join("\n");
}

export function parseEmotionLines(value: string): TriggerEmotion[] {
  return normalizeLines(value).map((line, index) => {
    const [label = "", intensityText = "50", note = "", emotionDefinitionId = ""] = line
      .split("|")
      .map((entry) => entry.trim());
    const intensity = Number.parseInt(intensityText || "50", 10);
    return {
      id: nextLocalId("emotion", index),
      emotionDefinitionId: emotionDefinitionId || null,
      label,
      intensity: Number.isFinite(intensity) ? Math.max(0, Math.min(100, intensity)) : 50,
      note
    };
  });
}

export function formatThoughtLines(thoughts: TriggerThought[]) {
  return thoughts
    .map((thought) => `${thought.text} | ${thought.parentMode} | ${thought.criticMode} | ${thought.beliefId ?? ""}`.trim())
    .join("\n");
}

export function parseThoughtLines(value: string): TriggerThought[] {
  return normalizeLines(value).map((line, index) => {
    const [text = "", parentMode = "", criticMode = "", beliefId = ""] = line.split("|").map((entry) => entry.trim());
    return {
      id: nextLocalId("thought", index),
      text,
      parentMode,
      criticMode,
      beliefId: beliefId || null
    };
  });
}

export function formatBehaviorLines(behaviors: TriggerBehavior[]) {
  return behaviors
    .map((behavior) => `${behavior.text} | ${behavior.mode} | ${behavior.behaviorId ?? ""}`.trim())
    .join("\n");
}

export function parseBehaviorLines(value: string): TriggerBehavior[] {
  return normalizeLines(value).map((line, index) => {
    const [text = "", mode = "", behaviorId = ""] = line.split("|").map((entry) => entry.trim());
    return {
      id: nextLocalId("behavior", index),
      text,
      mode,
      behaviorId: behaviorId || null
    };
  });
}

export function formatModeTimelineLines(entries: ModeTimelineEntry[]) {
  return entries.map((entry) => `${entry.stage} | ${entry.label} | ${entry.note}`.trim()).join("\n");
}

export function parseModeTimelineLines(value: string): ModeTimelineEntry[] {
  return normalizeLines(value).map((line, index) => {
    const [stage = "", label = "", note = ""] = line.split("|").map((entry) => entry.trim());
    return {
      id: nextLocalId("timeline", index),
      stage,
      modeId: null,
      label,
      note
    };
  });
}

export function formatConsequences(consequences: TriggerConsequences) {
  return {
    selfShortTerm: formatLines(consequences.selfShortTerm),
    selfLongTerm: formatLines(consequences.selfLongTerm),
    othersShortTerm: formatLines(consequences.othersShortTerm),
    othersLongTerm: formatLines(consequences.othersLongTerm)
  };
}

export function parseConsequences(input: {
  selfShortTerm: string;
  selfLongTerm: string;
  othersShortTerm: string;
  othersLongTerm: string;
}): TriggerConsequences {
  return {
    selfShortTerm: parseLines(input.selfShortTerm),
    selfLongTerm: parseLines(input.selfLongTerm),
    othersShortTerm: parseLines(input.othersShortTerm),
    othersLongTerm: parseLines(input.othersLongTerm)
  };
}
