import type {
  KnowledgeGraphLayoutWorkerMessage,
  KnowledgeGraphLayoutWorkerResponse
} from "./knowledge-graph-layout-protocol";
import {
  advanceKnowledgeGraphFocusSources,
  buildKnowledgeGraphFocusSourceSnapshots,
  computeKnowledgeGraphCentroid,
  computeKnowledgeGraphFocusPressure,
  DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS,
  getKnowledgeGraphSpringReduction,
  reconcileKnowledgeGraphFocusSources,
  resolveKnowledgeGraphFocusEnterDurationMs,
  resolveKnowledgeGraphFocusExitDurationMs,
  sanitizeKnowledgeGraphPhysicsSettings,
  type FocusSourceState,
  type KnowledgeGraphPhysicsSettings,
  type KnowledgeGraphSimulationPhase
} from "./knowledge-graph-layout-model";

type LayoutState = {
  nodeIds: string[];
  nodeIndexById: Map<string, number>;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  fx: Float32Array;
  fy: Float32Array;
  mass: Float32Array;
  radius: Float32Array;
  importance: Float32Array;
  focusPressure: Float32Array;
  rowPtr: Uint32Array;
  colIdx: Uint32Array;
  colWeight: Float32Array;
  edgeSource: Uint32Array;
  edgeTarget: Uint32Array;
  edgeWeight: Float32Array;
  edgeRestLength0: Float32Array;
  physics: KnowledgeGraphPhysicsSettings;
  focusIndex: number;
  focusAnchorX: number;
  focusAnchorY: number;
  focusSources: FocusSourceState[];
  dragIndex: number;
  dragTargetX: number;
  dragTargetY: number;
  phase: KnowledgeGraphSimulationPhase;
  tick: number;
  accumulatorSeconds: number;
  lastFrameTimeMs: number;
};

type QuadNode = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  mass: number;
  massX: number;
  massY: number;
  point: number;
  children: [QuadNode | null, QuadNode | null, QuadNode | null, QuadNode | null] | null;
};

const THETA = 0.55;
const DT = 1 / 120;
const MAX_FRAME_CATCHUP = 3;
const GLOBAL_DRAG = 7.2;
const SPRING_K = 8.0;
const SPRING_DAMPING = 1.4;
const REPULSION_K = 34.0;
const GRAVITY_K = 0.18;
const CENTROID_RESTORE_K = 0.09;
const FOCUS_REST_GAIN = 0.35;
const MAX_SPEED = 10.0;
const PUBLISH_POSITIONS_EVERY_TICKS = 1;
const PUBLISH_STATS_EVERY_TICKS = 12;
const COLLISION_PADDING = 0.16;
const FOCUS_SHELL_BASE_RADIUS = 1.4;
const FOCUS_SHELL_RADIUS_STEP = 1.15;
const FOCUS_SHELL_STIFFNESS = 5.6;
const FOCUS_SHELL_DAMPING = 3.8;

let state: LayoutState | null = null;
let loopHandle: number | null = null;

function clearLoop() {
  if (loopHandle !== null) {
    clearTimeout(loopHandle);
    loopHandle = null;
  }
}

function scheduleLoop() {
  clearLoop();
  loopHandle = self.setTimeout(runLoop, 16) as unknown as number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function hashIndex(index: number) {
  let hash = (index + 1) * 2654435761;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822519);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489917);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function criticalDampedForce({
  x,
  y,
  vx,
  vy,
  targetX,
  targetY,
  stiffness,
  damping
}: {
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  stiffness: number;
  damping: number;
}) {
  return {
    fx: -stiffness * (x - targetX) - damping * vx,
    fy: -stiffness * (y - targetY) - damping * vy
  };
}

function createQuad(minX: number, minY: number, maxX: number, maxY: number): QuadNode {
  return {
    minX,
    minY,
    maxX,
    maxY,
    mass: 0,
    massX: 0,
    massY: 0,
    point: -1,
    children: null
  };
}

function quadrantFor(node: QuadNode, x: number, y: number) {
  const midX = (node.minX + node.maxX) / 2;
  const midY = (node.minY + node.maxY) / 2;
  const east = x >= midX ? 1 : 0;
  const south = y >= midY ? 1 : 0;
  return south * 2 + east;
}

function ensureChildren(node: QuadNode) {
  if (node.children) {
    return node.children;
  }
  const midX = (node.minX + node.maxX) / 2;
  const midY = (node.minY + node.maxY) / 2;
  node.children = [
    createQuad(node.minX, node.minY, midX, midY),
    createQuad(midX, node.minY, node.maxX, midY),
    createQuad(node.minX, midY, midX, node.maxY),
    createQuad(midX, midY, node.maxX, node.maxY)
  ];
  return node.children;
}

function insertPoint(current: LayoutState, node: QuadNode, index: number) {
  const nodeX = current.x[index]!;
  const nodeY = current.y[index]!;

  if (node.point === -1 && !node.children) {
    node.point = index;
    return;
  }

  const children = ensureChildren(node);
  if (node.point !== -1) {
    const existing = node.point;
    node.point = -1;
    const existingQuadrant = quadrantFor(node, current.x[existing]!, current.y[existing]!);
    insertPoint(current, children[existingQuadrant]!, existing);
  }

  const nextQuadrant = quadrantFor(node, nodeX, nodeY);
  insertPoint(current, children[nextQuadrant]!, index);
}

function accumulateQuad(current: LayoutState, node: QuadNode): { mass: number; x: number; y: number } {
  if (!node.children) {
    if (node.point === -1) {
      node.mass = 0;
      node.massX = 0;
      node.massY = 0;
      return { mass: 0, x: 0, y: 0 };
    }
    const pointIndex = node.point;
    const effectiveMass =
      current.mass[pointIndex]! *
      (1 + current.focusPressure[pointIndex]! * current.physics.focusRepulsion * 0.35);
    const x = current.x[pointIndex]!;
    const y = current.y[pointIndex]!;
    node.mass = effectiveMass;
    node.massX = x;
    node.massY = y;
    return {
      mass: effectiveMass,
      x,
      y
    };
  }

  let totalMass = 0;
  let sumX = 0;
  let sumY = 0;

  for (const child of node.children) {
    if (!child) {
      continue;
    }
    const aggregate = accumulateQuad(current, child);
    totalMass += aggregate.mass;
    sumX += aggregate.x * aggregate.mass;
    sumY += aggregate.y * aggregate.mass;
  }

  node.mass = totalMass;
  node.massX = totalMass > 0 ? sumX / totalMass : 0;
  node.massY = totalMass > 0 ? sumY / totalMass : 0;
  return {
    mass: totalMass,
    x: node.massX,
    y: node.massY
  };
}

function buildQuadtree(current: LayoutState) {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < current.x.length; index += 1) {
    minX = Math.min(minX, current.x[index]!);
    maxX = Math.max(maxX, current.x[index]!);
    minY = Math.min(minY, current.y[index]!);
    maxY = Math.max(maxY, current.y[index]!);
  }

  const span = Math.max(maxX - minX, maxY - minY, 1);
  const padding = span * 0.1 + 1;
  const root = createQuad(minX - padding, minY - padding, maxX + padding, maxY + padding);

  for (let index = 0; index < current.x.length; index += 1) {
    insertPoint(current, root, index);
  }

  accumulateQuad(current, root);
  return root;
}

function applyRepulsion(current: LayoutState, quad: QuadNode, index: number) {
  if (quad.mass === 0) {
    return;
  }
  if (!quad.children && quad.point === index) {
    return;
  }

  const dx = current.x[index]! - quad.massX;
  const dy = current.y[index]! - quad.massY;
  const distanceSq = dx * dx + dy * dy + 0.01;
  const distance = Math.sqrt(distanceSq);
  const size = Math.max(quad.maxX - quad.minX, quad.maxY - quad.minY);

  if (!quad.children || size / distance < THETA) {
    const stressGain = 1 + current.focusPressure[index]! * current.physics.focusRepulsion;
    const force = (REPULSION_K * stressGain * current.mass[index]! * quad.mass) / distanceSq;
    current.fx[index]! += (dx / distance) * force;
    current.fy[index]! += (dy / distance) * force;
    return;
  }

  for (const child of quad.children) {
    if (!child) {
      continue;
    }
    applyRepulsion(current, child, index);
  }
}

function applySpringAttraction(current: LayoutState) {
  const primarySource = current.focusSources[0];
  const primaryStrength = primarySource?.strength ?? 0;
  const hopLevels = primarySource?.hopLevels;

  for (let edgeIndex = 0; edgeIndex < current.edgeSource.length; edgeIndex += 1) {
    const source = current.edgeSource[edgeIndex]!;
    const target = current.edgeTarget[edgeIndex]!;
    const dx = current.x[target]! - current.x[source]!;
    const dy = current.y[target]! - current.y[source]!;
    const distance = Math.max(0.0001, Math.hypot(dx, dy));
    const ux = dx / distance;
    const uy = dy / distance;
    const relativeVelocity =
      (current.vx[source]! - current.vx[target]!) * ux +
      (current.vy[source]! - current.vy[target]!) * uy;
    const averageStress =
      (current.focusPressure[source]! + current.focusPressure[target]!) * 0.5;
    const sourceHopLevel = hopLevels?.[source] ?? -1;
    const targetHopLevel = hopLevels?.[target] ?? -1;
    const edgeHopLevel =
      sourceHopLevel < 0
        ? targetHopLevel
        : targetHopLevel < 0
          ? sourceHopLevel
          : Math.min(sourceHopLevel, targetHopLevel);
    const restLength =
      current.edgeRestLength0[edgeIndex]! *
      (1 + averageStress * (FOCUS_REST_GAIN + (current.physics.focusRepulsion - 1) * 0.16));
    const stretch = distance - restLength;
    const springReduction =
      primaryStrength > 0
        ? getKnowledgeGraphSpringReduction({
            hopLevel: edgeHopLevel,
            maxReduction:
              current.physics.focusSpringReductionMax * primaryStrength,
            diffusion: current.physics.focusSpringReductionDiffusion
          })
        : 0;
    const springForce =
      SPRING_K *
      current.physics.edgeSpringStrength *
      (1 - springReduction) *
      current.edgeWeight[edgeIndex]! *
      stretch;
    const dampingForce = -SPRING_DAMPING * relativeVelocity;
    const force = springForce + dampingForce;
    const forceX = ux * force;
    const forceY = uy * force;

    current.fx[source]! += forceX;
    current.fy[source]! += forceY;
    current.fx[target]! -= forceX;
    current.fy[target]! -= forceY;
  }
}

function applyGravity(current: LayoutState) {
  for (let index = 0; index < current.x.length; index += 1) {
    current.fx[index]! +=
      -GRAVITY_K *
      current.physics.gravityStrength *
      current.mass[index]! *
      current.x[index]!;
    current.fy[index]! +=
      -GRAVITY_K *
      current.physics.gravityStrength *
      current.mass[index]! *
      current.y[index]!;
  }
}

function applyCentroidRestoringForce(current: LayoutState) {
  const centroid = computeKnowledgeGraphCentroid({
    x: current.x,
    y: current.y,
    mass: current.mass
  });
  for (let index = 0; index < current.x.length; index += 1) {
    current.fx[index]! +=
      -CENTROID_RESTORE_K *
      current.physics.gravityStrength *
      current.mass[index]! *
      centroid.x;
    current.fy[index]! +=
      -CENTROID_RESTORE_K *
      current.physics.gravityStrength *
      current.mass[index]! *
      centroid.y;
  }
}

function applyFocusAndDragPins(current: LayoutState) {
  if (current.dragIndex >= 0) {
    current.fx[current.dragIndex] = 0;
    current.fy[current.dragIndex] = 0;
  }
}

function applyFocusShellForces(current: LayoutState, focusGain: number) {
  const primarySource = current.focusSources[0];
  if (current.focusIndex < 0 || !primarySource || focusGain <= 0) {
    return;
  }

  const focusX = current.x[current.focusIndex]!;
  const focusY = current.y[current.focusIndex]!;
  const hopLevels = primarySource.hopLevels;

  for (let index = 0; index < current.x.length; index += 1) {
    if (index === current.focusIndex) {
      continue;
    }

    const hopLevel = hopLevels[index] ?? -1;
    if (hopLevel < 1) {
      continue;
    }

    let dx = current.x[index]! - focusX;
    let dy = current.y[index]! - focusY;
    let distance = Math.hypot(dx, dy);

    if (distance < 0.001) {
      const angle = ((hashIndex(index) % 4096) / 4096) * Math.PI * 2;
      dx = Math.cos(angle);
      dy = Math.sin(angle);
      distance = 1;
    }

    const ux = dx / distance;
    const uy = dy / distance;
    const desiredRadius =
      (FOCUS_SHELL_BASE_RADIUS * current.physics.focusShellSpacing) +
      (Math.min(hopLevel, 6) - 1) *
        (
          FOCUS_SHELL_RADIUS_STEP *
          current.physics.focusShellSpacing *
          (0.92 + current.physics.focusDiffusion * 0.24)
        ) +
      current.focusPressure[index]! * (0.42 + current.physics.focusRepulsion * 0.12);
    const targetX = focusX + ux * desiredRadius;
    const targetY = focusY + uy * desiredRadius;
    const shellStrength =
      ((FOCUS_SHELL_STIFFNESS * (0.92 + current.physics.focusDiffusion * 0.18)) /
        Math.max(1, hopLevel)) *
      focusGain;
    const shellForce = criticalDampedForce({
      x: current.x[index]!,
      y: current.y[index]!,
      vx: current.vx[index]!,
      vy: current.vy[index]!,
      targetX,
      targetY,
      stiffness: shellStrength,
      damping: FOCUS_SHELL_DAMPING
    });

    current.fx[index]! += shellForce.fx;
    current.fy[index]! += shellForce.fy;
  }
}

function applyCollision(current: LayoutState) {
  const grid = new Map<string, number[]>();
  const cellSize = 1.2;

  for (let index = 0; index < current.x.length; index += 1) {
    const gx = Math.floor(current.x[index]! / cellSize);
    const gy = Math.floor(current.y[index]! / cellSize);
    const key = `${gx}:${gy}`;
    const bucket = grid.get(key) ?? [];
    bucket.push(index);
    grid.set(key, bucket);
  }

  for (const [key, indices] of grid) {
    const [gridX, gridY] = key.split(":").map(Number);
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const neighbor = grid.get(`${gridX + offsetX}:${gridY + offsetY}`);
        if (!neighbor) {
          continue;
        }
        for (const left of indices) {
          for (const right of neighbor) {
            if (left >= right) {
              continue;
            }
            const dx = current.x[right]! - current.x[left]!;
            const dy = current.y[right]! - current.y[left]!;
            const distance = Math.max(0.001, Math.hypot(dx, dy));
            const minimum = current.radius[left]! + current.radius[right]! + COLLISION_PADDING;
            if (distance >= minimum) {
              continue;
            }
            const push = ((minimum - distance) / distance) * 0.18;
            const pushX = dx * push;
            const pushY = dy * push;
            current.fx[left]! -= pushX;
            current.fy[left]! -= pushY;
            current.fx[right]! += pushX;
            current.fy[right]! += pushY;
          }
        }
      }
    }
  }
}

function integrate(current: LayoutState) {
  const dragFactor = Math.exp(-GLOBAL_DRAG * DT);

  for (let index = 0; index < current.x.length; index += 1) {
    if (index === current.dragIndex) {
      current.x[index] = current.dragTargetX;
      current.y[index] = current.dragTargetY;
      current.vx[index] = 0;
      current.vy[index] = 0;
      continue;
    }
    current.vx[index]! = (current.vx[index]! + (current.fx[index]! / current.mass[index]!) * DT) * dragFactor;
    current.vy[index]! = (current.vy[index]! + (current.fy[index]! / current.mass[index]!) * DT) * dragFactor;
    const speed = Math.hypot(current.vx[index]!, current.vy[index]!);
    if (speed > MAX_SPEED) {
      const scale = MAX_SPEED / speed;
      current.vx[index]! *= scale;
      current.vy[index]! *= scale;
    }
    current.x[index]! += current.vx[index]! * DT;
    current.y[index]! += current.vy[index]! * DT;
  }

  if (current.focusIndex >= 0 && current.dragIndex !== current.focusIndex) {
    current.x[current.focusIndex] = current.focusAnchorX;
    current.y[current.focusIndex] = current.focusAnchorY;
    current.vx[current.focusIndex] = 0;
    current.vy[current.focusIndex] = 0;
  }
}

function applyDraggedNodeIntervention(current: LayoutState) {
  if (current.dragIndex < 0) {
    return;
  }
  current.x[current.dragIndex] = current.dragTargetX;
  current.y[current.dragIndex] = current.dragTargetY;
  current.vx[current.dragIndex] = 0;
  current.vy[current.dragIndex] = 0;
  current.fx[current.dragIndex] = 0;
  current.fy[current.dragIndex] = 0;
  if (current.focusIndex === current.dragIndex) {
    current.focusAnchorX = current.dragTargetX;
    current.focusAnchorY = current.dragTargetY;
  }
}

function computePhase(current: LayoutState, nowMs: number) {
  if (current.dragIndex >= 0) {
    current.phase = "dragging";
    return;
  }
  if (current.focusIndex >= 0 || current.focusSources.length > 0) {
    const primaryStrength = current.focusSources[0]?.strength ?? 0;
    if (current.focusIndex >= 0 && primaryStrength < 0.999) {
      current.phase = "focus-enter";
      return;
    }
    if (current.focusIndex >= 0) {
      current.phase = "focused";
      return;
    }
    current.phase = "focus-exit";
    return;
  }
  current.phase = "global";
}

function tick(current: LayoutState, nowMs: number) {
  applyDraggedNodeIntervention(current);
  current.focusSources = advanceKnowledgeGraphFocusSources({
    sources: current.focusSources,
    nowMs,
    enterDurationMs: resolveKnowledgeGraphFocusEnterDurationMs(current.physics),
    exitDurationMs: resolveKnowledgeGraphFocusExitDurationMs(current.physics)
  });
  current.focusPressure = computeKnowledgeGraphFocusPressure({
    nodeCount: current.x.length,
    sources: current.focusSources,
    settings: current.physics
  });
  current.fx.fill(0);
  current.fy.fill(0);
  const quadtree = buildQuadtree(current);
  for (let index = 0; index < current.x.length; index += 1) {
    applyRepulsion(current, quadtree, index);
  }
  applySpringAttraction(current);
  applyGravity(current);
  applyCentroidRestoringForce(current);
  applyFocusAndDragPins(current);
  applyFocusShellForces(current, current.focusSources[0]?.strength ?? 0);
  applyCollision(current);
  applyDraggedNodeIntervention(current);
  integrate(current);
  computePhase(current, nowMs);
  current.tick += 1;
}

function publishPositions(current: LayoutState) {
  const x = current.x.slice();
  const y = current.y.slice();
  const message: KnowledgeGraphLayoutWorkerResponse = {
    type: "positions",
    x,
    y,
    tick: current.tick
  };
  self.postMessage(message);
}

function publishStats(current: LayoutState) {
  const message: KnowledgeGraphLayoutWorkerResponse = {
    type: "stats",
    tick: current.tick,
    phase: current.phase,
    primaryFocusedNodeId:
      current.focusIndex >= 0 ? current.nodeIds[current.focusIndex] ?? null : null,
    focusSources: buildKnowledgeGraphFocusSourceSnapshots(current.focusSources),
    focusPressure: current.focusPressure.slice(),
    centroid: computeKnowledgeGraphCentroid({
      x: current.x,
      y: current.y,
      mass: current.mass
    })
  };
  self.postMessage(message);
}

function runLoop() {
  if (!state) {
    clearLoop();
    return;
  }

  const nowMs = performance.now();
  const deltaSeconds = clamp((nowMs - state.lastFrameTimeMs) / 1000, 0, DT * MAX_FRAME_CATCHUP);
  state.lastFrameTimeMs = nowMs;
  state.accumulatorSeconds += deltaSeconds;

  let steps = 0;
  while (state.accumulatorSeconds >= DT && steps < MAX_FRAME_CATCHUP) {
    tick(state, nowMs);
    state.accumulatorSeconds -= DT;
    steps += 1;
  }

  if (steps > 0 && state.tick % PUBLISH_POSITIONS_EVERY_TICKS === 0) {
    publishPositions(state);
  }

  if (steps > 0 && state.tick % PUBLISH_STATS_EVERY_TICKS === 0) {
    publishStats(state);
  }

  scheduleLoop();
}

function buildAdjacency(edges: { source: number; target: number; weight: number }[], nodeCount: number) {
  const degree = new Uint32Array(nodeCount);
  for (const edge of edges) {
    degree[edge.source]! += 1;
    degree[edge.target]! += 1;
  }
  const rowPtr = new Uint32Array(nodeCount + 1);
  for (let index = 0; index < nodeCount; index += 1) {
    rowPtr[index + 1] = rowPtr[index]! + degree[index]!;
  }
  const colIdx = new Uint32Array(rowPtr[nodeCount]!);
  const colWeight = new Float32Array(rowPtr[nodeCount]!);
  const cursor = new Uint32Array(rowPtr);

  for (const edge of edges) {
    let pointer = cursor[edge.source]!;
    colIdx[pointer] = edge.target;
    colWeight[pointer] = edge.weight;
    cursor[edge.source]! += 1;

    pointer = cursor[edge.target]!;
    colIdx[pointer] = edge.source;
    colWeight[pointer] = edge.weight;
    cursor[edge.target]! += 1;
  }

  return {
    rowPtr,
    colIdx,
    colWeight
  };
}

function initializeState(message: Extract<KnowledgeGraphLayoutWorkerMessage, { type: "init-graph" }>) {
  const nodeIds = message.nodes.map((node) => node.id);
  const adjacency = buildAdjacency(message.edges, message.nodes.length);
  state = {
    nodeIds,
    nodeIndexById: new Map(nodeIds.map((id, index) => [id, index])),
    x: new Float32Array(message.nodes.map((node) => node.x)),
    y: new Float32Array(message.nodes.map((node) => node.y)),
    vx: new Float32Array(message.nodes.length),
    vy: new Float32Array(message.nodes.length),
    fx: new Float32Array(message.nodes.length),
    fy: new Float32Array(message.nodes.length),
    mass: new Float32Array(message.nodes.map((node) => Math.max(1, node.mass))),
    radius: new Float32Array(message.nodes.map((node) => Math.max(0.35, node.size * 0.12))),
    importance: new Float32Array(message.nodes.map((node) => node.importance)),
    focusPressure: new Float32Array(message.nodes.length),
    rowPtr: adjacency.rowPtr,
    colIdx: adjacency.colIdx,
    colWeight: adjacency.colWeight,
    edgeSource: new Uint32Array(message.edges.map((edge) => edge.source)),
    edgeTarget: new Uint32Array(message.edges.map((edge) => edge.target)),
    edgeWeight: new Float32Array(message.edges.map((edge) => edge.weight)),
    edgeRestLength0: new Float32Array(
      message.edges.map((edge) => {
        const sourceRadius = Math.max(0.35, message.nodes[edge.source]!.size * 0.12);
        const targetRadius = Math.max(0.35, message.nodes[edge.target]!.size * 0.12);
        return 0.8 + sourceRadius + targetRadius;
      })
    ),
    physics: sanitizeKnowledgeGraphPhysicsSettings(
      message.physics ?? DEFAULT_KNOWLEDGE_GRAPH_PHYSICS_SETTINGS
    ),
    focusIndex: message.focusNodeId
      ? nodeIds.findIndex((nodeId) => nodeId === message.focusNodeId)
      : -1,
    focusAnchorX: 0,
    focusAnchorY: 0,
    focusSources: [],
    dragIndex: -1,
    dragTargetX: 0,
    dragTargetY: 0,
    phase: message.focusNodeId ? "focus-enter" : "global",
    tick: 0,
    accumulatorSeconds: 0,
    lastFrameTimeMs: performance.now()
  };

  if (state.focusIndex >= 0) {
    state.focusAnchorX = state.x[state.focusIndex]!;
    state.focusAnchorY = state.y[state.focusIndex]!;
    state.vx[state.focusIndex] = 0;
    state.vy[state.focusIndex] = 0;
  }
  state.focusSources = reconcileKnowledgeGraphFocusSources({
    sources: [],
    nodeIndexById: state.nodeIndexById,
    focusNodeId: message.focusNodeId,
    hopLevels: message.hopLevels,
    nowMs: performance.now()
  });
  state.focusPressure = computeKnowledgeGraphFocusPressure({
    nodeCount: state.x.length,
    sources: state.focusSources,
    settings: state.physics
  });

  publishPositions(state);
  publishStats(state);
  scheduleLoop();
}

function setFocus(message: Extract<KnowledgeGraphLayoutWorkerMessage, { type: "set-focus" }>) {
  if (!state) {
    return;
  }
  state.focusIndex = message.focusNodeId
    ? state.nodeIndexById.get(message.focusNodeId) ?? -1
    : -1;
  state.focusSources = reconcileKnowledgeGraphFocusSources({
    sources: state.focusSources,
    nodeIndexById: state.nodeIndexById,
    focusNodeId: message.focusNodeId,
    hopLevels: message.hopLevels,
    nowMs: performance.now()
  });
  if (state.focusIndex >= 0) {
    state.focusAnchorX = state.x[state.focusIndex]!;
    state.focusAnchorY = state.y[state.focusIndex]!;
    state.vx[state.focusIndex] = 0;
    state.vy[state.focusIndex] = 0;
    state.phase = "focus-enter";
  } else {
    state.phase = "focus-exit";
  }
}

function updatePhysics(
  message: Extract<KnowledgeGraphLayoutWorkerMessage, { type: "update-physics" }>
) {
  if (!state) {
    return;
  }
  state.physics = sanitizeKnowledgeGraphPhysicsSettings(message.physics);
  state.focusPressure = computeKnowledgeGraphFocusPressure({
    nodeCount: state.x.length,
    sources: state.focusSources,
    settings: state.physics
  });
}

function dragStart(message: Extract<KnowledgeGraphLayoutWorkerMessage, { type: "drag-start" }>) {
  if (!state) {
    return;
  }
  const index = state.nodeIndexById.get(message.nodeId);
  if (index === undefined) {
    return;
  }
  state.dragIndex = index;
  state.dragTargetX = state.x[index]!;
  state.dragTargetY = state.y[index]!;
  state.x[index] = state.dragTargetX;
  state.y[index] = state.dragTargetY;
  state.vx[index] = 0;
  state.vy[index] = 0;
  state.phase = "dragging";
}

function dragMove(
  message: Extract<
    KnowledgeGraphLayoutWorkerMessage,
    { type: "drag-move" | "nudge-node" }
  >
) {
  if (!state) {
    return;
  }
  const index = state.nodeIndexById.get(message.nodeId);
  if (index === undefined) {
    return;
  }
  state.dragTargetX = message.x;
  state.dragTargetY = message.y;
  state.x[index] = message.x;
  state.y[index] = message.y;
  state.vx[index] = 0;
  state.vy[index] = 0;
  if (message.type === "nudge-node") {
    state.fx[index] = 0;
    state.fy[index] = 0;
  }
  if (index === state.focusIndex) {
    state.focusAnchorX = message.x;
    state.focusAnchorY = message.y;
  }
}

function dragEnd(message: Extract<KnowledgeGraphLayoutWorkerMessage, { type: "drag-end" }>) {
  if (!state) {
    return;
  }
  const index = state.nodeIndexById.get(message.nodeId);
  if (index === undefined || state.dragIndex !== index) {
    return;
  }
  state.dragIndex = -1;
  state.phase = state.focusIndex >= 0 ? "focus-enter" : "global";
}

function recenterGraph(
  message: Extract<KnowledgeGraphLayoutWorkerMessage, { type: "recenter-graph" }>
) {
  if (!state) {
    return;
  }
  if (message.offsetX === 0 && message.offsetY === 0) {
    return;
  }
  for (let index = 0; index < state.x.length; index += 1) {
    state.x[index]! -= message.offsetX;
    state.y[index]! -= message.offsetY;
  }
  if (state.dragIndex >= 0) {
    state.dragTargetX -= message.offsetX;
    state.dragTargetY -= message.offsetY;
  }
  if (state.focusIndex >= 0) {
    state.focusAnchorX -= message.offsetX;
    state.focusAnchorY -= message.offsetY;
  }
  publishPositions(state);
  publishStats(state);
}

self.onmessage = (event: MessageEvent<KnowledgeGraphLayoutWorkerMessage>) => {
  const message = event.data;

  switch (message.type) {
    case "init-graph":
      initializeState(message);
      return;
    case "set-focus":
      setFocus(message);
      return;
    case "update-physics":
      updatePhysics(message);
      return;
    case "drag-start":
      dragStart(message);
      return;
    case "drag-move":
      dragMove(message);
      return;
    case "nudge-node":
      dragMove(message);
      return;
    case "recenter-graph":
      recenterGraph(message);
      return;
    case "drag-end":
      dragEnd(message);
      return;
    case "dispose":
      clearLoop();
      state = null;
      return;
  }
};
