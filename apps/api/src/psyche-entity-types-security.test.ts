import assert from "node:assert/strict";
import test from "node:test";
import { PSYCHE_ENTITY_TYPES } from "./psyche-types.js";

test("the canonical Psyche set covers every sensitive taxonomy entity", () => {
  assert.deepEqual(PSYCHE_ENTITY_TYPES, [
    "psyche_value",
    "behavior_pattern",
    "behavior",
    "belief_entry",
    "mode_profile",
    "mode_guide_session",
    "flashcard",
    "trigger_report",
    "event_type",
    "emotion_definition"
  ]);
  assert.equal(new Set(PSYCHE_ENTITY_TYPES).size, PSYCHE_ENTITY_TYPES.length);
});
