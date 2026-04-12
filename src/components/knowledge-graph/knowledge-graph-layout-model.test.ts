import { describe, expect, it } from "vitest";
import {
  advanceKnowledgeGraphFocusSources,
  computeKnowledgeGraphCentroid,
  computeKnowledgeGraphFocusPressure,
  DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS,
  KNOWLEDGE_GRAPH_MAX_EDGE_SPRING_STRENGTH,
  KNOWLEDGE_GRAPH_MAX_FOCUS_DIFFUSION,
  KNOWLEDGE_GRAPH_MAX_FOCUS_REPULSION,
  KNOWLEDGE_GRAPH_MAX_FOCUS_SHELL_SPACING,
  KNOWLEDGE_GRAPH_MAX_FOCUS_SPRING_DIFFUSION,
  KNOWLEDGE_GRAPH_MAX_FOCUS_SPRING_REDUCTION,
  KNOWLEDGE_GRAPH_MAX_GRAVITY_STRENGTH,
  KNOWLEDGE_GRAPH_MIN_EDGE_SPRING_STRENGTH,
  KNOWLEDGE_GRAPH_MIN_FOCUS_SHELL_SPACING,
  getKnowledgeGraphSpringReduction,
  getKnowledgeGraphHopAttenuation,
  reconcileKnowledgeGraphFocusSources,
  resolveKnowledgeGraphFocusEnterDurationMs,
  resolveKnowledgeGraphFocusExitDurationMs,
  sanitizeKnowledgeGraphPhysicsSettings,
  stepCriticallyDampedValue,
  type FocusSourceState
} from "@/components/knowledge-graph/knowledge-graph-layout-model";

describe("knowledge graph layout model", () => {
  it("allows the stronger slider ceiling values without clipping them below the UI range", () => {
    const settings = sanitizeKnowledgeGraphPhysicsSettings({
      focusRepulsion: KNOWLEDGE_GRAPH_MAX_FOCUS_REPULSION,
      focusDiffusion: KNOWLEDGE_GRAPH_MAX_FOCUS_DIFFUSION,
      focusSpringReductionMax: KNOWLEDGE_GRAPH_MAX_FOCUS_SPRING_REDUCTION,
      focusSpringReductionDiffusion: KNOWLEDGE_GRAPH_MAX_FOCUS_SPRING_DIFFUSION,
      edgeSpringStrength: KNOWLEDGE_GRAPH_MAX_EDGE_SPRING_STRENGTH,
      gravityStrength: KNOWLEDGE_GRAPH_MAX_GRAVITY_STRENGTH,
      focusShellSpacing: KNOWLEDGE_GRAPH_MAX_FOCUS_SHELL_SPACING
    });

    expect(settings.focusRepulsion).toBe(KNOWLEDGE_GRAPH_MAX_FOCUS_REPULSION);
    expect(settings.focusDiffusion).toBe(KNOWLEDGE_GRAPH_MAX_FOCUS_DIFFUSION);
    expect(settings.focusSpringReductionMax).toBe(
      KNOWLEDGE_GRAPH_MAX_FOCUS_SPRING_REDUCTION
    );
    expect(settings.focusSpringReductionDiffusion).toBe(
      KNOWLEDGE_GRAPH_MAX_FOCUS_SPRING_DIFFUSION
    );
    expect(settings.edgeSpringStrength).toBe(KNOWLEDGE_GRAPH_MAX_EDGE_SPRING_STRENGTH);
    expect(settings.gravityStrength).toBe(KNOWLEDGE_GRAPH_MAX_GRAVITY_STRENGTH);
    expect(settings.focusShellSpacing).toBe(KNOWLEDGE_GRAPH_MAX_FOCUS_SHELL_SPACING);
  });

  it("accepts very loose spread settings without clamping away the user controls", () => {
    const settings = sanitizeKnowledgeGraphPhysicsSettings({
      edgeSpringStrength: KNOWLEDGE_GRAPH_MIN_EDGE_SPRING_STRENGTH,
      gravityStrength: 0,
      focusShellSpacing: KNOWLEDGE_GRAPH_MAX_FOCUS_SHELL_SPACING
    });

    expect(settings.edgeSpringStrength).toBe(KNOWLEDGE_GRAPH_MIN_EDGE_SPRING_STRENGTH);
    expect(settings.gravityStrength).toBe(0);
    expect(settings.focusShellSpacing).toBe(KNOWLEDGE_GRAPH_MAX_FOCUS_SHELL_SPACING);
  });

  it("softens spring constants most strongly at the focus and then falls off by hop distance", () => {
    const focusReduction = getKnowledgeGraphSpringReduction({
      hopLevel: 0,
      maxReduction: 0.5,
      diffusion: 2
    });
    const firstHopReduction = getKnowledgeGraphSpringReduction({
      hopLevel: 1,
      maxReduction: 0.5,
      diffusion: 2
    });
    const secondHopReduction = getKnowledgeGraphSpringReduction({
      hopLevel: 2,
      maxReduction: 0.5,
      diffusion: 2
    });

    expect(focusReduction).toBeCloseTo(0.5);
    expect(firstHopReduction).toBeLessThan(focusReduction);
    expect(secondHopReduction).toBeLessThan(firstHopReduction);
    expect(secondHopReduction).toBeGreaterThan(0);
  });

  it("creates, ramps, decays, and removes focus sources deterministically", () => {
    const nodeIndexById = new Map([
      ["a", 0],
      ["b", 1],
      ["c", 2]
    ]);

    let sources = reconcileKnowledgeGraphFocusSources({
      sources: [],
      nodeIndexById,
      focusNodeId: "a",
      hopLevels: [0, 1, 2],
      nowMs: 0
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]?.nodeId).toBe("a");
    expect(sources[0]?.targetStrength).toBe(1);

    sources = advanceKnowledgeGraphFocusSources({
      sources,
      nowMs: 600
    });
    expect(sources[0]?.strength).toBeCloseTo(1, 3);

    sources = reconcileKnowledgeGraphFocusSources({
      sources,
      nodeIndexById,
      focusNodeId: "b",
      hopLevels: [1, 0, 1],
      nowMs: 620
    });
    expect(sources.map((source) => source.nodeId)).toEqual(["b", "a"]);
    expect(sources[0]?.targetStrength).toBe(1);
    expect(sources[1]?.targetStrength).toBe(0);

    sources = advanceKnowledgeGraphFocusSources({
      sources,
      nowMs: 1600
    });
    expect(sources[0]?.strength).toBeCloseTo(1, 3);
    expect(sources.some((source) => source.nodeId === "a")).toBe(false);
  });

  it("builds monotonic focus pressure by hop distance and keeps historical sources weaker", () => {
    const sources: FocusSourceState[] = [
      {
        nodeId: "a",
        index: 0,
        strength: 1,
        targetStrength: 1,
        enteredAt: 0,
        lastUpdatedAt: 0,
        hopLevels: new Int16Array([0, 1, 2, 3, 4, -1])
      },
      {
        nodeId: "b",
        index: 1,
        strength: 0.8,
        targetStrength: 0,
        enteredAt: 0,
        lastUpdatedAt: 0,
        hopLevels: new Int16Array([1, 0, 1, 2, 3, -1])
      }
    ];

    const pressure = computeKnowledgeGraphFocusPressure({
      nodeCount: 6,
      sources
    });

    expect(pressure[0]).toBeGreaterThanOrEqual(pressure[1]);
    expect(pressure[1]).toBeGreaterThan(pressure[2]);
    expect(pressure[2]).toBeGreaterThan(pressure[3]);
    expect(pressure[3]).toBeGreaterThanOrEqual(pressure[4]);
    expect(pressure[5]).toBe(0);
    expect(pressure[1]).toBeLessThanOrEqual(1.25);
  });

  it("computes a stable centroid for displaced graphs", () => {
    const centroid = computeKnowledgeGraphCentroid({
      x: new Float32Array([4, 6, 8]),
      y: new Float32Array([-2, 0, 2]),
      mass: new Float32Array([1, 2, 1])
    });

    expect(centroid.x).toBeCloseTo(6);
    expect(centroid.y).toBeCloseTo(0);
  });

  it("caps focus history and returns pressure close to baseline after focus exit", () => {
    const nodeIndexById = new Map([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["d", 3],
      ["e", 4]
    ]);

    let sources: FocusSourceState[] = [];
    for (const [offset, nodeId] of ["a", "b", "c", "d", "e"].entries()) {
      sources = reconcileKnowledgeGraphFocusSources({
        sources,
        nodeIndexById,
        focusNodeId: nodeId,
        hopLevels: [0, 1, 2, 3, 4],
        nowMs: offset * 100
      });
    }

    expect(sources).toHaveLength(5);
    expect(sources.map((source) => source.nodeId)).toEqual(["e", "d", "c", "b", "a"]);

    sources = reconcileKnowledgeGraphFocusSources({
      sources,
      nodeIndexById,
      focusNodeId: null,
      hopLevels: [-1, -1, -1, -1, -1],
      nowMs: 900
    });

    const decayed = advanceKnowledgeGraphFocusSources({
      sources,
      nowMs: 2400
    });
    expect(decayed).toHaveLength(0);

    const pressure = computeKnowledgeGraphFocusPressure({
      nodeCount: 5,
      sources: decayed
    });
    expect([...pressure]).toEqual([0, 0, 0, 0, 0]);
  });

  it("uses the documented hop attenuation curve", () => {
    expect(getKnowledgeGraphHopAttenuation(0)).toBe(1);
    expect(getKnowledgeGraphHopAttenuation(1)).toBe(0.65);
    expect(getKnowledgeGraphHopAttenuation(2)).toBe(0.35);
    expect(getKnowledgeGraphHopAttenuation(3)).toBe(0.18);
    expect(getKnowledgeGraphHopAttenuation(8)).toBe(0.08);
    expect(getKnowledgeGraphHopAttenuation(-1)).toBe(0);
  });

  it("increases downstream focus pressure when diffusion is raised", () => {
    const sources: FocusSourceState[] = [
      {
        nodeId: "a",
        index: 0,
        strength: 1,
        targetStrength: 1,
        enteredAt: 0,
        lastUpdatedAt: 0,
        hopLevels: new Int16Array([0, 1, 2, 3, 4])
      }
    ];

    const baseline = computeKnowledgeGraphFocusPressure({
      nodeCount: 5,
      sources,
      settings: sanitizeKnowledgeGraphPhysicsSettings({
        focusRepulsion: DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS.focusRepulsion,
        focusDiffusion: 1
      })
    });
    const diffused = computeKnowledgeGraphFocusPressure({
      nodeCount: 5,
      sources,
      settings: sanitizeKnowledgeGraphPhysicsSettings({
        focusRepulsion: DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS.focusRepulsion,
        focusDiffusion: 2.8
      })
    });

    expect(diffused[1]).toBeGreaterThan(baseline[1]);
    expect(diffused[2]).toBeGreaterThan(baseline[2]);
    expect(diffused[4]).toBeGreaterThan(baseline[4]);
  });

  it("keeps more historical smoothing with the stronger default diffusion", () => {
    const nodeIndexById = new Map([
      ["a", 0],
      ["b", 1],
      ["c", 2]
    ]);

    const enterDurationMs = resolveKnowledgeGraphFocusEnterDurationMs(
      DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS
    );
    const exitDurationMs = resolveKnowledgeGraphFocusExitDurationMs(
      DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS
    );

    let sources = reconcileKnowledgeGraphFocusSources({
      sources: [],
      nodeIndexById,
      focusNodeId: "a",
      hopLevels: [0, 1, 2],
      nowMs: 0
    });
    sources = advanceKnowledgeGraphFocusSources({
      sources,
      nowMs: 1600,
      enterDurationMs,
      exitDurationMs
    });

    sources = reconcileKnowledgeGraphFocusSources({
      sources,
      nodeIndexById,
      focusNodeId: "b",
      hopLevels: [1, 0, 1],
      nowMs: 1700
    });
    const partiallyDecayed = advanceKnowledgeGraphFocusSources({
      sources,
      nowMs: 2300,
      enterDurationMs,
      exitDurationMs
    });

    expect(partiallyDecayed).toHaveLength(2);
    expect(partiallyDecayed[0]?.nodeId).toBe("b");
    expect(partiallyDecayed[1]?.nodeId).toBe("a");
    expect((partiallyDecayed[1]?.strength ?? 0) > 0).toBe(true);
  });

  it("critically damps camera values toward the target without overshooting", () => {
    const next = stepCriticallyDampedValue({
      state: {
        value: 8,
        velocity: 0
      },
      target: 2,
      deltaSeconds: 1 / 60,
      settleTimeMs: 180
    });

    expect(next.value).toBeLessThan(8);
    expect(next.value).toBeGreaterThan(2);
    expect(next.velocity).toBeLessThan(0);
  });
});
