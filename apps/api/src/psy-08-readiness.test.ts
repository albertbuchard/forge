import assert from "node:assert/strict";
import test from "node:test";
import {
  createFlashcardSchema,
  flashcardSchema,
  updateFlashcardSchema
} from "./psyche-types.js";

const conciseMessage = "A".repeat(600);
const overlongMessage = "A".repeat(601);

test("PSY-08 keeps new flashcards concise without rejecting legacy reads", () => {
  assert.equal(
    createFlashcardSchema.parse({ message: conciseMessage }).message.length,
    600
  );
  assert.equal(
    updateFlashcardSchema.parse({ message: conciseMessage }).message.length,
    600
  );
  assert.throws(() =>
    createFlashcardSchema.parse({ message: overlongMessage })
  );
  assert.throws(() => updateFlashcardSchema.parse({ message: overlongMessage }));

  const legacy = flashcardSchema.parse({
    id: "flashcard_legacy",
    domainId: "domain_psyche",
    title: "Legacy card",
    message: overlongMessage,
    triggerSentence: "",
    triggerSituation: "",
    tags: [],
    backgroundColor: "#f8fafc",
    textColor: "#111827",
    accentColor: "#6ee7b7",
    typography: "serif",
    imageUrl: "",
    imageAlt: "",
    layout: "centered",
    visualStyle: "calm",
    linkedValueIds: [],
    linkedBehaviorIds: [],
    linkedPatternIds: [],
    linkedBeliefIds: [],
    linkedModeIds: [],
    linkedReportIds: [],
    createdAt: "2026-08-11T10:00:00.000Z",
    updatedAt: "2026-08-11T10:00:00.000Z",
    userId: "user_operator",
    user: null
  });
  assert.equal(legacy.message.length, 601);
});
