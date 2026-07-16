import assert from "node:assert/strict";
import test from "node:test";
import {
  findNestedPsycheNoteLinkEntityTypes,
  findPsycheNoteLinkEntityTypes
} from "./services/nested-note-authorization.js";

test("nested Note authorization recognizes every canonical Psyche entity type", () => {
  assert.deepEqual(
    findNestedPsycheNoteLinkEntityTypes({
      notes: [
        {
          links: [
            { entityType: "belief_entry", entityId: "belief_1" },
            { entityType: "event_type", entityId: "event_type_1" },
            { entityType: "goal", entityId: "goal_1" }
          ]
        }
      ],
      closeoutNote: {
        links: [
          { entityType: "mode_guide_session", entityId: "session_1" },
          { entityType: "emotion_definition", entityId: "emotion_1" }
        ]
      }
    }),
    ["belief_entry", "event_type", "mode_guide_session", "emotion_definition"]
  );
});

test("direct Note authorization ignores non-Psyche links and malformed input", () => {
  assert.deepEqual(
    findPsycheNoteLinkEntityTypes({
      links: [
        { entityType: "artifact", entityId: "artifact_1" },
        null,
        "invalid"
      ]
    }),
    []
  );
  assert.deepEqual(findNestedPsycheNoteLinkEntityTypes(null), []);
});
