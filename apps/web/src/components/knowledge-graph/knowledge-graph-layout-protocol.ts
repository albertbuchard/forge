import type { KnowledgeGraphPhysicsSettings } from "./knowledge-graph-layout-model";

export type KnowledgeGraphLayoutNodeInit = {
  id: string;
  x: number;
  y: number;
  size: number;
  mass: number;
  importance: number;
};

export type KnowledgeGraphLayoutEdgeInit = {
  source: number;
  target: number;
  weight: number;
};

export type KnowledgeGraphLayoutInitMessage = {
  type: "init-graph";
  generation: number;
  positionPublishIntervalTicks?: number;
  transferBuffers?: boolean;
  nodes: KnowledgeGraphLayoutNodeInit[];
  edges: KnowledgeGraphLayoutEdgeInit[];
  focusNodeId: string | null;
  hopLevels: number[];
  physics: KnowledgeGraphPhysicsSettings;
};

export type KnowledgeGraphLayoutFocusMessage = {
  type: "set-focus";
  focusNodeId: string | null;
  hopLevels: number[];
};

export type KnowledgeGraphLayoutPhysicsMessage = {
  type: "update-physics";
  physics: KnowledgeGraphPhysicsSettings;
};

export type KnowledgeGraphLayoutPresentationMessage = {
  type: "update-presentation";
  positionPublishIntervalTicks: number;
  reducedMotion: boolean;
};

export type KnowledgeGraphLayoutDragStartMessage = {
  type: "drag-start";
  nodeId: string;
};

export type KnowledgeGraphLayoutDragMoveMessage = {
  type: "drag-move";
  nodeId: string;
  x: number;
  y: number;
};

export type KnowledgeGraphLayoutDragEndMessage = {
  type: "drag-end";
  nodeId: string;
};

export type KnowledgeGraphLayoutNudgeMessage = {
  type: "nudge-node";
  nodeId: string;
  x: number;
  y: number;
};

export type KnowledgeGraphLayoutRecenterMessage = {
  type: "recenter-graph";
  offsetX: number;
  offsetY: number;
};

export type KnowledgeGraphLayoutDisposeMessage = {
  type: "dispose";
};

export type KnowledgeGraphLayoutWorkerMessage =
  | KnowledgeGraphLayoutInitMessage
  | KnowledgeGraphLayoutFocusMessage
  | KnowledgeGraphLayoutPhysicsMessage
  | KnowledgeGraphLayoutPresentationMessage
  | KnowledgeGraphLayoutDragStartMessage
  | KnowledgeGraphLayoutDragMoveMessage
  | KnowledgeGraphLayoutDragEndMessage
  | KnowledgeGraphLayoutNudgeMessage
  | KnowledgeGraphLayoutRecenterMessage
  | KnowledgeGraphLayoutDisposeMessage;

export type KnowledgeGraphLayoutPositionsMessage = {
  type: "positions";
  generation: number;
  x: Float32Array;
  y: Float32Array;
  tick: number;
};

export type KnowledgeGraphLayoutStatsMessage = {
  type: "stats";
  generation: number;
  tick: number;
  phase: "global" | "focus-enter" | "focused" | "focus-exit" | "dragging";
  primaryFocusedNodeId: string | null;
  focusSources: Array<{
    nodeId: string;
    strength: number;
    targetStrength: number;
    state: "entering" | "active" | "exiting";
  }>;
  focusPressure: Float32Array;
  centroid: {
    x: number;
    y: number;
  };
  settled: boolean;
};

export type KnowledgeGraphLayoutWorkerResponse =
  | KnowledgeGraphLayoutPositionsMessage
  | KnowledgeGraphLayoutStatsMessage;
