import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildPerformanceGraphFixture,
  buildVisualStoryGraphFixture,
  PERFORMANCE_GRAPH_SIZES,
  type PerformanceGraphSize,
  VISUAL_STORY_FIXTURE_VERSION
} from "../../../../tests/e2e/knowledge-graph-performance-fixture";

const PERFORMANCE_FIXTURE_HASHES = {
  small: "35dc9e776ca2b25d659dc3c33e7283c548872db81fa4b271d4ec4ae5ff8d9301",
  medium: "8a0518f4681acdddc2a2e1630de11b5bbfc87363ab8f45c7818445de2a9d6aef",
  large: "1f79d41ece8be62a43650b6acabe021784e704efa77c4d8b9224b00d0a4f26e7"
} as const satisfies Record<PerformanceGraphSize, string>;

function hashPayload(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

describe("knowledge graph performance fixtures", () => {
  it.each(Object.keys(PERFORMANCE_FIXTURE_HASHES) as PerformanceGraphSize[])(
    "preserves the sealed %s performance payload",
    (size) => {
      expect(hashPayload(buildPerformanceGraphFixture(size))).toBe(
        PERFORMANCE_FIXTURE_HASHES[size]
      );
    }
  );

  it.each(Object.keys(PERFORMANCE_GRAPH_SIZES) as PerformanceGraphSize[])(
    "builds a semantically valid %s visual-story variant",
    (size) => {
      const baseline = buildPerformanceGraphFixture(size);
      const visual = buildVisualStoryGraphFixture(size);
      expect(VISUAL_STORY_FIXTURE_VERSION).toBe("visual-story-v2");
      expect(visual.nodes).toHaveLength(baseline.nodes.length);
      expect(visual.edges).toHaveLength(baseline.edges.length);
      expect(
        visual.edges
          .slice(0, 6)
          .map((edge) => [edge.id, edge.source, edge.target, edge.relationKind])
      ).toEqual([
        [
          `fixture:${size}:story:goal-project`,
          `goal:${size}-goal-0000`,
          `project:${size}-project-0001`,
          "goal_project"
        ],
        [
          `fixture:${size}:story:project-task`,
          `project:${size}-project-0001`,
          `task:${size}-task-0002`,
          "project_task"
        ],
        [
          `fixture:${size}:story:task-note`,
          `task:${size}-task-0002`,
          `note:${size}-note-0006`,
          "entity_link"
        ],
        [
          `fixture:${size}:story:goal-task`,
          `goal:${size}-goal-0000`,
          `task:${size}-task-0002`,
          "goal_task"
        ],
        [
          `fixture:${size}:story:strategy-goal`,
          `strategy:${size}-strategy-0003`,
          `goal:${size}-goal-0000`,
          "strategy_target"
        ],
        [
          `fixture:${size}:story:value-goal`,
          `psyche_value:${size}-value-0015`,
          `goal:${size}-goal-0000`,
          "value_goal"
        ]
      ]);
      expect(hashPayload(visual)).not.toBe(hashPayload(baseline));
    }
  );
});
