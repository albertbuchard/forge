export type KnowledgeGraphSimulationPhase =
  | "global"
  | "focus-enter"
  | "focused"
  | "focus-exit"
  | "dragging";

export type FocusSourceState = {
  nodeId: string;
  index: number;
  strength: number;
  targetStrength: number;
  enteredAt: number;
  lastUpdatedAt: number;
  hopLevels: Int16Array;
};

export type FocusSourceSnapshot = {
  nodeId: string;
  strength: number;
  targetStrength: number;
  state: "entering" | "active" | "exiting";
};

export type KnowledgeGraphCentroid = {
  x: number;
  y: number;
};

export type DampedValueState = {
  value: number;
  velocity: number;
};

const HOP_ATTENUATION = [1, 0.65, 0.35, 0.18, 0.08] as const;
const DEFAULT_MAX_SOURCES = 6;
const DEFAULT_ENTER_DURATION_MS = 600;
const DEFAULT_EXIT_DURATION_MS = 900;
const DEFAULT_REMOVAL_EPSILON = 0.001;
const HISTORICAL_SOURCE_WEIGHT = 0.52;
export const KNOWLEDGE_GRAPH_MAX_FOCUS_REPULSION = 6;
export const KNOWLEDGE_GRAPH_MAX_FOCUS_DIFFUSION = 5;
export const KNOWLEDGE_GRAPH_MAX_FOCUS_SPRING_REDUCTION = 0.92;
export const KNOWLEDGE_GRAPH_MAX_FOCUS_SPRING_DIFFUSION = 5;
export const KNOWLEDGE_GRAPH_MIN_EDGE_SPRING_STRENGTH = 0.15;
export const KNOWLEDGE_GRAPH_MAX_EDGE_SPRING_STRENGTH = 2.4;
export const KNOWLEDGE_GRAPH_MAX_GRAVITY_STRENGTH = 2;
export const KNOWLEDGE_GRAPH_MIN_FOCUS_SHELL_SPACING = 0.8;
export const KNOWLEDGE_GRAPH_MAX_FOCUS_SHELL_SPACING = 3;

export type KnowledgeGraphPhysicsSettings = {
  focusRepulsion: number;
  focusDiffusion: number;
  focusSpringReductionMax: number;
  focusSpringReductionDiffusion: number;
  edgeSpringStrength: number;
  gravityStrength: number;
  focusShellSpacing: number;
};

export const DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS: KnowledgeGraphPhysicsSettings = {
  focusRepulsion: 2.25,
  focusDiffusion: 1.95,
  focusSpringReductionMax: 0.34,
  focusSpringReductionDiffusion: 1.85,
  edgeSpringStrength: 1,
  gravityStrength: 1,
  focusShellSpacing: 1
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function sanitizeKnowledgeGraphPhysicsSettings(
  settings: Partial<KnowledgeGraphPhysicsSettings> | null | undefined
) {
  return {
    focusRepulsion: clamp(
      settings?.focusRepulsion ?? DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS.focusRepulsion,
      0.6,
      KNOWLEDGE_GRAPH_MAX_FOCUS_REPULSION
    ),
    focusDiffusion: clamp(
      settings?.focusDiffusion ?? DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS.focusDiffusion,
      0.6,
      KNOWLEDGE_GRAPH_MAX_FOCUS_DIFFUSION
    ),
    focusSpringReductionMax: clamp(
      settings?.focusSpringReductionMax ??
        DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS.focusSpringReductionMax,
      0,
      KNOWLEDGE_GRAPH_MAX_FOCUS_SPRING_REDUCTION
    ),
    focusSpringReductionDiffusion: clamp(
      settings?.focusSpringReductionDiffusion ??
        DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS.focusSpringReductionDiffusion,
      0.6,
      KNOWLEDGE_GRAPH_MAX_FOCUS_SPRING_DIFFUSION
    ),
    edgeSpringStrength: clamp(
      settings?.edgeSpringStrength ??
        DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS.edgeSpringStrength,
      KNOWLEDGE_GRAPH_MIN_EDGE_SPRING_STRENGTH,
      KNOWLEDGE_GRAPH_MAX_EDGE_SPRING_STRENGTH
    ),
    gravityStrength: clamp(
      settings?.gravityStrength ??
        DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS.gravityStrength,
      0,
      KNOWLEDGE_GRAPH_MAX_GRAVITY_STRENGTH
    ),
    focusShellSpacing: clamp(
      settings?.focusShellSpacing ??
        DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS.focusShellSpacing,
      KNOWLEDGE_GRAPH_MIN_FOCUS_SHELL_SPACING,
      KNOWLEDGE_GRAPH_MAX_FOCUS_SHELL_SPACING
    )
  } satisfies KnowledgeGraphPhysicsSettings;
}

export function resolveKnowledgeGraphFocusEnterDurationMs(
  settings: KnowledgeGraphPhysicsSettings
) {
  return Math.round(DEFAULT_ENTER_DURATION_MS + settings.focusDiffusion * 420);
}

export function resolveKnowledgeGraphFocusExitDurationMs(
  settings: KnowledgeGraphPhysicsSettings
) {
  return Math.round(DEFAULT_EXIT_DURATION_MS + settings.focusDiffusion * 620);
}

export function resolveKnowledgeGraphHistoricalSourceWeight(
  settings: KnowledgeGraphPhysicsSettings
) {
  return clamp(
    HISTORICAL_SOURCE_WEIGHT + (settings.focusDiffusion - 1) * 0.16,
    0.28,
    0.72
  );
}

export function getKnowledgeGraphHopAttenuation(
  hopLevel: number,
  diffusion = 1
) {
  if (hopLevel < 0) {
    return 0;
  }
  if (hopLevel >= HOP_ATTENUATION.length) {
    const terminal = HOP_ATTENUATION[HOP_ATTENUATION.length - 1] ?? 0;
    return hopLevel === 0 ? 1 : Math.pow(terminal, 1 / Math.max(diffusion, 0.1));
  }
  const base = HOP_ATTENUATION[hopLevel] ?? 0;
  return hopLevel === 0 ? base : Math.pow(base, 1 / Math.max(diffusion, 0.1));
}

export function getKnowledgeGraphSpringReduction({
  hopLevel,
  maxReduction,
  diffusion
}: {
  hopLevel: number;
  maxReduction: number;
  diffusion: number;
}) {
  if (hopLevel < 0 || maxReduction <= 0) {
    return 0;
  }

  return clamp(
    maxReduction * getKnowledgeGraphHopAttenuation(hopLevel, diffusion),
    0,
    KNOWLEDGE_GRAPH_MAX_FOCUS_SPRING_REDUCTION
  );
}

export function reconcileKnowledgeGraphFocusSources({
  sources,
  nodeIndexById,
  focusNodeId,
  hopLevels,
  nowMs,
  maxSources = DEFAULT_MAX_SOURCES
}: {
  sources: FocusSourceState[];
  nodeIndexById: Map<string, number>;
  focusNodeId: string | null;
  hopLevels: number[];
  nowMs: number;
  maxSources?: number;
}) {
  const nextSources = sources.map((source) => ({
    ...source,
    targetStrength: 0
  }));

  if (focusNodeId) {
    const nextIndex = nodeIndexById.get(focusNodeId);
    if (nextIndex !== undefined) {
      const existingIndex = nextSources.findIndex(
        (source) => source.nodeId === focusNodeId
      );
      const nextHopLevels = new Int16Array(
        hopLevels.map((level) => Math.max(-1, Math.trunc(level)))
      );
      if (existingIndex >= 0) {
        const existing = nextSources.splice(existingIndex, 1)[0]!;
        nextSources.unshift({
          ...existing,
          index: nextIndex,
          targetStrength: 1,
          enteredAt: nowMs,
          lastUpdatedAt: nowMs,
          hopLevels: nextHopLevels
        });
      } else {
        nextSources.unshift({
          nodeId: focusNodeId,
          index: nextIndex,
          strength: 0,
          targetStrength: 1,
          enteredAt: nowMs,
          lastUpdatedAt: nowMs,
          hopLevels: nextHopLevels
        });
      }
    }
  }

  return nextSources.slice(0, maxSources);
}

export function advanceKnowledgeGraphFocusSources({
  sources,
  nowMs,
  enterDurationMs = DEFAULT_ENTER_DURATION_MS,
  exitDurationMs = DEFAULT_EXIT_DURATION_MS,
  removalEpsilon = DEFAULT_REMOVAL_EPSILON
}: {
  sources: FocusSourceState[];
  nowMs: number;
  enterDurationMs?: number;
  exitDurationMs?: number;
  removalEpsilon?: number;
}) {
  const advanced = sources
    .map((source) => {
      const elapsed = Math.max(0, nowMs - source.lastUpdatedAt);
      const duration =
        source.targetStrength > source.strength
          ? enterDurationMs
          : exitDurationMs;
      const delta = duration <= 0 ? 1 : elapsed / duration;
      const nextStrength =
        source.targetStrength > source.strength
          ? Math.min(source.targetStrength, source.strength + delta)
          : Math.max(source.targetStrength, source.strength - delta);

      return {
        ...source,
        strength: clamp(nextStrength, 0, 1),
        lastUpdatedAt: nowMs
      };
    })
    .filter(
      (source) =>
        source.targetStrength > 0 || source.strength > removalEpsilon
    );

  return advanced;
}

export function computeKnowledgeGraphFocusPressure({
  nodeCount,
  sources,
  settings = DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS
}: {
  nodeCount: number;
  sources: FocusSourceState[];
  settings?: KnowledgeGraphPhysicsSettings;
}) {
  const pressure = new Float32Array(nodeCount);
  const historicalWeight = resolveKnowledgeGraphHistoricalSourceWeight(settings);

  sources.forEach((source, sourceIndex) => {
    const sourceWeight =
      sourceIndex === 0 ? source.strength : source.strength * historicalWeight;
    if (sourceWeight <= 0) {
      return;
    }
    for (let index = 0; index < nodeCount; index += 1) {
      const attenuation = getKnowledgeGraphHopAttenuation(
        source.hopLevels[index] ?? -1,
        settings.focusDiffusion
      );
      if (attenuation <= 0) {
        continue;
      }
      pressure[index] = clamp(
        pressure[index]! + attenuation * sourceWeight,
        0,
        1.25
      );
    }
  });

  return pressure;
}

export function buildKnowledgeGraphFocusSourceSnapshots(
  sources: FocusSourceState[]
) {
  return sources.map((source) => ({
    nodeId: source.nodeId,
    strength: Number(source.strength.toFixed(4)),
    targetStrength: source.targetStrength,
    state:
      source.targetStrength > source.strength
        ? "entering"
        : source.targetStrength < source.strength
          ? "exiting"
          : "active"
  })) satisfies FocusSourceSnapshot[];
}

export function computeKnowledgeGraphCentroid({
  x,
  y,
  mass
}: {
  x: Float32Array;
  y: Float32Array;
  mass?: Float32Array;
}) {
  let totalMass = 0;
  let sumX = 0;
  let sumY = 0;

  for (let index = 0; index < x.length; index += 1) {
    const weight = mass?.[index] ?? 1;
    totalMass += weight;
    sumX += x[index]! * weight;
    sumY += y[index]! * weight;
  }

  if (totalMass <= 0) {
    return {
      x: 0,
      y: 0
    } satisfies KnowledgeGraphCentroid;
  }

  return {
    x: sumX / totalMass,
    y: sumY / totalMass
  } satisfies KnowledgeGraphCentroid;
}

export function stepCriticallyDampedValue({
  state,
  target,
  deltaSeconds,
  settleTimeMs
}: {
  state: DampedValueState;
  target: number;
  deltaSeconds: number;
  settleTimeMs: number;
}) {
  const smoothTime = Math.max(0.001, settleTimeMs / 1000);
  const omega = 2 / smoothTime;
  const x = omega * Math.max(0.0001, deltaSeconds);
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = state.value - target;
  const temp = (state.velocity + omega * change) * deltaSeconds;
  const nextVelocity = (state.velocity - omega * temp) * exp;
  const nextValue = target + (change + temp) * exp;

  return {
    value: nextValue,
    velocity: nextVelocity
  } satisfies DampedValueState;
}
