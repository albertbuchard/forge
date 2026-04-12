import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const entityPlaybook = readRepoFile(
  "skills/forge-openclaw/entity_conversation_playbooks.md"
);
const psychePlaybook = readRepoFile(
  "skills/forge-openclaw/psyche_entity_playbooks.md"
);

function getSectionSlice(document: string, section: string) {
  const headingRegex = new RegExp(`^## ${section}$`, "m");
  const headingMatch = headingRegex.exec(document);
  const heading = `## ${section}`;
  const start = headingMatch?.index ?? -1;
  expect(start, `${section} heading should exist`).toBeGreaterThanOrEqual(0);
  const nextHeadingRegex = /\n## /g;
  nextHeadingRegex.lastIndex = start + heading.length;
  const match = nextHeadingRegex.exec(document);
  const end = match ? match.index : document.length;
  return document.slice(start, end);
}

describe("question flow simulation cycles", () => {
  const nonPsycheSections = [
    "Goal",
    "Project",
    "Strategy",
    "Task",
    "Habit",
    "Tag",
    "Note",
    "Wiki Page",
    "Insight",
    "Calendar Event",
    "Work Block Template",
    "Task Timebox",
    "Task Run",
    "Self Observation",
    "Sleep Session",
    "Workout Session",
    "Calendar Connection",
    "Preference Catalog",
    "Preference Catalog Item",
    "Preference Context",
    "Preference Item",
    "Questionnaire Instrument",
    "Questionnaire Run",
    "Event Type",
    "Emotion Definition"
  ] as const;

  const psycheSections = [
    "Value",
    "Behavior Pattern",
    "Behavior",
    "Belief",
    "Mode Profile",
    "Mode Guide Session",
    "Trigger Report"
  ] as const;

  it("cycle 1: every entity flow starts with visible direction instead of field collection", () => {
    expect(entityPlaybook).toMatch(/direction of the intake visible/i);
    expect(entityPlaybook).toMatch(/Opening move recipes/i);
    expect(entityPlaybook).toMatch(/Strategic record:/i);
    expect(entityPlaybook).toMatch(/Reusable record:/i);
    expect(entityPlaybook).toMatch(/Operational record:/i);

    for (const section of nonPsycheSections) {
      const sectionSlice = getSectionSlice(entityPlaybook, section);
      expect(sectionSlice).toMatch(/Aim:/);
      expect(sectionSlice).toMatch(/Preferred opening question:/);
      expect(sectionSlice).toMatch(/Ready to (save|act|update|start)/i);
    }

    for (const section of psycheSections) {
      const sectionSlice = getSectionSlice(psychePlaybook, section);
      expect(sectionSlice).toMatch(/Aim:/);
      expect(sectionSlice).toMatch(/Preferred opening question:/);
      expect(sectionSlice).toMatch(/Ready to save/i);
    }
  });

  it("cycle 2: all flows keep a guided reflective stance, with stronger therapist-like pacing for Psyche", () => {
    expect(entityPlaybook).toMatch(/feels important to keep true/i);
    expect(entityPlaybook).toMatch(/Close cleanly/i);
    expect(entityPlaybook).toMatch(/what seems clear now is/i);

    expect(psychePlaybook).toMatch(/living center of the moment/i);
    expect(psychePlaybook).toMatch(/First reflection menu/i);
    expect(psychePlaybook).toMatch(/Permission pivots/i);
    expect(psychePlaybook).toMatch(/graspable enough/i);

    const reflectiveNonPsyche = [
      "Goal",
      "Habit",
      "Note",
      "Self Observation",
      "Sleep Session",
      "Workout Session",
      "Preference Context",
      "Questionnaire Instrument"
    ] as const;

    for (const section of reflectiveNonPsyche) {
      const sectionSlice = getSectionSlice(entityPlaybook, section);
      expect(sectionSlice).toMatch(/Helpful follow-up lanes:|Arc:/);
    }

    for (const section of psycheSections) {
      const sectionSlice = getSectionSlice(psychePlaybook, section);
      expect(sectionSlice).toMatch(/Helpful follow-up lanes:/);
      expect(sectionSlice).toMatch(/Likely linked entities:/);
    }
  });

  it("cycle 3: all flows close efficiently, preserve only helpful questions, and avoid reopening settled formulations", () => {
    expect(entityPlaybook).toMatch(/If no detail is still decision-relevant/i);
    expect(entityPlaybook).toMatch(/revise the working formulation once/i);
    expect(entityPlaybook).toMatch(/what this would help[\s\S]*decide later is/i);

    expect(psychePlaybook).toMatch(/Change and save pivots/i);
    expect(psychePlaybook).toMatch(/When the user says the formulation lands/i);
    expect(psychePlaybook).toMatch(/do not switch containers unless the user wants to/i);
    expect(psychePlaybook).toMatch(/say in plain language what makes you think/i);
  });
});
