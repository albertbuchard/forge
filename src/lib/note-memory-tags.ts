export type NoteMemoryTagPreset = {
  value: string;
  label: string;
  description: string;
};

export const NOTE_MEMORY_TAG_PRESETS: NoteMemoryTagPreset[] = [
  {
    value: "Working memory",
    label: "Working memory",
    description: "What you are actively working on right now."
  },
  {
    value: "Short-term memory",
    label: "Short-term memory",
    description: "What just happened and still needs near-term recall."
  },
  {
    value: "Episodic memory",
    label: "Episodic memory",
    description: "Long-term recall for what happened or what you did."
  },
  {
    value: "Semantic memory",
    label: "Semantic memory",
    description: "Long-term knowledge about what something is."
  },
  {
    value: "Procedural memory",
    label: "Procedural memory",
    description: "Long-term know-how and repeatable how-to knowledge."
  }
];

export type NoteDestroyDelayUnit = "hours" | "days";

export function normalizeNoteTags(tags: string[]) {
  const seen = new Set<string>();
  return tags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => {
      const normalized = tag.toLowerCase();
      if (seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
}

export function parseDateTimeLocalToIso(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function formatNoteDestroyAtInput(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function buildDestroyAtFromDelay(
  delayValue: string,
  unit: NoteDestroyDelayUnit
) {
  const numericValue = Number(delayValue);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }
  const multiplier = unit === "hours" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return new Date(Date.now() + numericValue * multiplier).toISOString();
}
