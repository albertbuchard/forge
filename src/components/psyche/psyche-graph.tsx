import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Maximize, Minus, Move, Plus, RotateCcw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { getEntityVisual, type EntityKind } from "@/lib/entity-visuals";
import { cn } from "@/lib/utils";

export type PsycheGraphTone = "mint" | "sky" | "violet" | "rose" | "amber" | "orange" | "blue" | "slate";

export type PsycheGraphNodeKind = "goal" | "value" | "behavior" | "belief" | "report" | "project" | "habit" | "ghost";

export interface PsycheGraphNode {
  id: string;
  kind: PsycheGraphNodeKind;
  x: number;
  y: number;
  radius?: number;
  width?: number;
  height?: number;
  tone?: PsycheGraphTone;
  label: string;
  meta?: string;
  href?: string;
}

export interface PsycheGraphEdge {
  id: string;
  from: string;
  to: string;
  tone?: PsycheGraphTone;
  dashed?: boolean;
  strength?: "low" | "medium" | "high";
}

export interface PsycheGraphField {
  id: string;
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  tone?: PsycheGraphTone;
  opacity?: number;
}

export interface PsycheGraphViewportState {
  scale: number;
  x: number;
  y: number;
}

const toneStrokeMap: Record<PsycheGraphTone, string> = {
  mint: "rgba(110,231,183,0.64)",
  sky: "rgba(125,211,252,0.66)",
  violet: "rgba(196,181,253,0.72)",
  rose: "rgba(251,113,133,0.68)",
  amber: "rgba(251,191,36,0.68)",
  orange: "rgba(251,146,60,0.72)",
  blue: "rgba(96,165,250,0.72)",
  slate: "rgba(148,163,184,0.52)"
};

const toneFillMap: Record<PsycheGraphTone, string> = {
  mint: "rgba(16,185,129,0.18)",
  sky: "rgba(56,189,248,0.18)",
  violet: "rgba(167,139,250,0.18)",
  rose: "rgba(251,113,133,0.18)",
  amber: "rgba(251,191,36,0.18)",
  orange: "rgba(251,146,60,0.18)",
  blue: "rgba(96,165,250,0.18)",
  slate: "rgba(148,163,184,0.12)"
};

const toneTextMap: Record<PsycheGraphTone, string> = {
  mint: "rgba(209,250,229,0.98)",
  sky: "rgba(224,242,254,0.98)",
  violet: "rgba(237,233,254,0.98)",
  rose: "rgba(255,228,230,0.98)",
  amber: "rgba(254,243,199,0.98)",
  orange: "rgba(255,237,213,0.98)",
  blue: "rgba(219,234,254,0.98)",
  slate: "rgba(241,245,249,0.9)"
};

function getEntityKindForNode(nodeKind: PsycheGraphNodeKind): EntityKind | null {
  switch (nodeKind) {
    case "goal":
    case "value":
    case "behavior":
    case "belief":
    case "report":
    case "project":
    case "habit":
      return nodeKind;
    default:
      return null;
  }
}

function getToneForNode(node: PsycheGraphNode): PsycheGraphTone {
  if (node.tone) {
    return node.tone;
  }

  switch (node.kind) {
    case "goal":
      return "amber";
    case "value":
      return "mint";
    case "belief":
      return "violet";
    case "behavior":
      return "orange";
    case "project":
      return "sky";
    case "habit":
      return "mint";
    case "report":
      return "blue";
    default:
      return "slate";
  }
}

function getNodeMetaLabel(node: PsycheGraphNode) {
  if (node.kind === "ghost") {
    return node.meta ?? null;
  }

  const entityKind = getEntityKindForNode(node.kind);
  if (!entityKind) {
    return node.meta ?? null;
  }

  return getEntityVisual(entityKind).label;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function splitLabel(label: string, maxLength: number, maxLines = 3) {
  const words = label.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength && current) {
      lines.push(current);
      if (lines.length >= maxLines - 1) {
        current = [word, ...words.slice(index + 1)].join(" ");
        break;
      }
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  const trimmed = lines.slice(0, maxLines);
  const lastIndex = trimmed.length - 1;
  if (lastIndex >= 0 && trimmed[lastIndex]!.length > maxLength) {
    trimmed[lastIndex] = `${trimmed[lastIndex]!.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
  }

  return trimmed;
}

function computeBounds(nodes: PsycheGraphNode[], fields: PsycheGraphField[]) {
  if (nodes.length === 0 && fields.length === 0) {
    return { minX: -360, maxX: 360, minY: -240, maxY: 240 };
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    const halfWidth = node.kind === "goal" || node.kind === "value" || node.kind === "ghost" ? (node.radius ?? 32) : (node.width ?? 124) / 2;
    const halfHeight = node.kind === "goal" || node.kind === "value" || node.kind === "ghost" ? (node.radius ?? 32) : (node.height ?? 56) / 2;
    const metaTopAllowance = node.meta && (node.kind === "goal" || node.kind === "ghost") ? 48 : 0;
    minX = Math.min(minX, node.x - halfWidth);
    maxX = Math.max(maxX, node.x + halfWidth);
    minY = Math.min(minY, node.y - halfHeight - metaTopAllowance);
    maxY = Math.max(maxY, node.y + halfHeight);
  }

  for (const field of fields) {
    minX = Math.min(minX, field.x - field.radiusX);
    maxX = Math.max(maxX, field.x + field.radiusX);
    minY = Math.min(minY, field.y - field.radiusY);
    maxY = Math.max(maxY, field.y + field.radiusY);
  }

  return { minX, maxX, minY, maxY };
}

function resolveNodeCenter(node: PsycheGraphNode) {
  return { x: node.x, y: node.y };
}

function buildNodeLabelLines(node: PsycheGraphNode) {
  if (node.kind === "goal") {
    const radius = node.radius ?? 112;
    return splitLabel(node.label, Math.max(14, Math.floor(radius / 7.2)), 4);
  }
  if (node.kind === "value" || node.kind === "ghost") {
    const radius = node.radius ?? 40;
    return splitLabel(node.label, Math.max(12, Math.floor(radius / 3)), 3);
  }
  if (node.kind === "project") {
    return splitLabel(node.label, Math.max(18, Math.floor((node.width ?? 220) / 10)), 3);
  }
  return splitLabel(node.label, Math.max(16, Math.floor((node.width ?? 180) / 10.5)), 2);
}

function getToneForEntityKind(kind: EntityKind): PsycheGraphTone {
  switch (kind) {
    case "goal":
      return "amber";
    case "project":
      return "sky";
    case "value":
      return "mint";
    case "behavior":
      return "orange";
    case "belief":
      return "violet";
    case "report":
      return "blue";
    default:
      return "slate";
  }
}

export function PsycheGraphCanvas({
  nodes,
  edges,
  fields = [],
  title,
  hint,
  action,
  legend,
  selectedNodeId,
  onSelectNode,
  minHeightClassName = "min-h-[34rem] lg:min-h-[44rem]",
  compact = false,
  testId
}: {
  nodes: PsycheGraphNode[];
  edges: PsycheGraphEdge[];
  fields?: PsycheGraphField[];
  title: string;
  hint?: string;
  action?: ReactNode;
  legend?: Array<{ label: string; tone?: PsycheGraphTone; kind?: EntityKind }>;
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
  minHeightClassName?: string;
  compact?: boolean;
  testId?: string;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<PsycheGraphViewportState>({ scale: 1, x: 0, y: 0 });
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const dragRef = useRef<{ pointerId: number; originX: number; originY: number; startX: number; startY: number } | null>(null);
  const viewportRef = useRef<PsycheGraphViewportState>({ scale: 1, x: 0, y: 0 });
  const activePointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{
    startDistance: number;
    startScale: number;
    startViewportX: number;
    startViewportY: number;
    startMidpointX: number;
    startMidpointY: number;
  } | null>(null);
  const suppressClickUntilRef = useRef(0);
  const userAdjustedRef = useRef(false);

  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const bounds = useMemo(() => computeBounds(nodes, fields), [fields, nodes]);
  const isMobileFrame = frameSize.width > 0 && frameSize.width < 640;

  useEffect(() => {
    if (!frameRef.current || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      setFrameSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height
      });
    });

    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, []);

  const fitToContent = useCallback(() => {
    if (!frameSize.width || !frameSize.height) {
      return;
    }

    const padding = isMobileFrame ? 132 : compact ? 140 : 190;
    const width = Math.max(bounds.maxX - bounds.minX, 1);
    const height = Math.max(bounds.maxY - bounds.minY, 1);
    const scale = clamp(
      Math.min(frameSize.width / (width + padding), frameSize.height / (height + padding)),
      isMobileFrame ? 0.24 : compact ? 0.4 : 0.46,
      isMobileFrame ? 0.76 : compact ? 1.04 : 1.18
    );
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    setViewport({
      scale,
      x: frameSize.width / 2 - centerX * scale,
      y: frameSize.height / 2 - centerY * scale
    });
  }, [bounds.maxX, bounds.maxY, bounds.minX, bounds.minY, compact, frameSize.height, frameSize.width, isMobileFrame]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    if (!userAdjustedRef.current) {
      fitToContent();
    }
  }, [fitToContent]);

  const adjustScale = useCallback(
    (nextScale: number, focusX?: number, focusY?: number) => {
      const targetScale = clamp(nextScale, 0.28, 1.9);
      setViewport((current) => {
        if (focusX == null || focusY == null) {
          return { ...current, scale: targetScale };
        }

        const worldX = (focusX - current.x) / current.scale;
        const worldY = (focusY - current.y) / current.scale;
        return {
          scale: targetScale,
          x: focusX - worldX * targetScale,
          y: focusY - worldY * targetScale
        };
      });
    },
    []
  );

  const beginPinchGesture = useCallback(() => {
    const pointers = [...activePointersRef.current.values()];
    if (pointers.length < 2) {
      pinchRef.current = null;
      return;
    }

    const [first, second] = pointers;
    const distance = Math.hypot(second.x - first.x, second.y - first.y);
    if (!Number.isFinite(distance) || distance <= 0) {
      pinchRef.current = null;
      return;
    }

    const currentViewport = viewportRef.current;
    pinchRef.current = {
      startDistance: distance,
      startScale: currentViewport.scale,
      startViewportX: currentViewport.x,
      startViewportY: currentViewport.y,
      startMidpointX: (first.x + second.x) / 2,
      startMidpointY: (first.y + second.y) / 2
    };
  }, []);

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    userAdjustedRef.current = true;
    const delta = event.deltaY < 0 ? 1.1 : 0.9;
    adjustScale(viewport.scale * delta, event.clientX - rect.left, event.clientY - rect.top);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = frameRef.current?.getBoundingClientRect();
    const localX = event.clientX - (rect?.left ?? 0);
    const localY = event.clientY - (rect?.top ?? 0);
    activePointersRef.current.set(event.pointerId, { x: localX, y: localY });
    if (activePointersRef.current.size === 1) {
      const currentViewport = viewportRef.current;
      dragRef.current = {
        pointerId: event.pointerId,
        originX: currentViewport.x,
        originY: currentViewport.y,
        startX: localX,
        startY: localY
      };
    } else {
      dragRef.current = null;
      beginPinchGesture();
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = frameRef.current?.getBoundingClientRect();
    const localX = event.clientX - (rect?.left ?? 0);
    const localY = event.clientY - (rect?.top ?? 0);
    if (activePointersRef.current.has(event.pointerId)) {
      activePointersRef.current.set(event.pointerId, { x: localX, y: localY });
    }

    if (pinchRef.current && activePointersRef.current.size >= 2) {
      const [first, second] = [...activePointersRef.current.values()];
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      if (Number.isFinite(distance) && distance > 0) {
        userAdjustedRef.current = true;
        suppressClickUntilRef.current = Date.now() + 240;
        const midpointX = (first.x + second.x) / 2;
        const midpointY = (first.y + second.y) / 2;
        const gesture = pinchRef.current;
        const targetScale = clamp((gesture.startScale * distance) / gesture.startDistance, 0.24, 1.42);
        const worldX = (gesture.startMidpointX - gesture.startViewportX) / gesture.startScale;
        const worldY = (gesture.startMidpointY - gesture.startViewportY) / gesture.startScale;

        setViewport({
          scale: targetScale,
          x: midpointX - worldX * targetScale,
          y: midpointY - worldY * targetScale
        });
      }
      return;
    }

    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId || activePointersRef.current.size !== 1) {
      return;
    }

    userAdjustedRef.current = true;
    const deltaX = localX - dragRef.current.startX;
    const deltaY = localY - dragRef.current.startY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      suppressClickUntilRef.current = Date.now() + 240;
    }
    setViewport((current) => ({
      ...current,
      x: (dragRef.current?.originX ?? current.x) + deltaX,
      y: (dragRef.current?.originY ?? current.y) + deltaY
    }));
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(event.pointerId);

    if (activePointersRef.current.size < 2) {
      pinchRef.current = null;
    }

    if (activePointersRef.current.size === 1) {
      const [pointerId, point] = [...activePointersRef.current.entries()][0] ?? [];
      if (pointerId != null && point) {
        const currentViewport = viewportRef.current;
        dragRef.current = {
          pointerId,
          originX: currentViewport.x,
          originY: currentViewport.y,
          startX: point.x,
          startY: point.y
        };
      }
    } else {
      dragRef.current = null;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const activeNodeId = hoveredNodeId ?? selectedNodeId ?? null;
  const openNode = useCallback(
    (node: PsycheGraphNode) => {
      if (Date.now() < suppressClickUntilRef.current) {
        return;
      }
      onSelectNode?.(node.id);
      if (node.href) {
        navigate(node.href);
      }
    },
    [navigate, onSelectNode]
  );

  return (
    <section
      data-testid={testId}
      className={cn(
        "overflow-hidden rounded-[32px] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.12),transparent_32%),linear-gradient(180deg,rgba(11,18,31,0.985),rgba(7,12,23,0.98))] shadow-[0_26px_90px_rgba(2,6,16,0.38)]",
        compact ? "px-3 py-3 sm:px-4 sm:py-4 lg:px-5 lg:py-5" : "px-3 py-3 sm:px-4 sm:py-4 lg:px-5 lg:py-5"
      )}
    >
      <div className="mb-3 flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[rgba(125,211,252,0.82)]">Gravity well</div>
          <h2 className={cn("mt-2 font-display leading-none text-white", compact ? "text-[clamp(1.25rem,2vw,1.7rem)]" : "text-[clamp(1.45rem,2.8vw,2.3rem)]")}>{title}</h2>
          {hint ? <p className="mt-1.5 max-w-3xl text-sm leading-6 text-white/54">{isMobileFrame ? "Select a node, pan the field, and open the full map when you need the wider structure." : hint}</p> : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{action}</div>
      </div>

      <div
        ref={frameRef}
        className={cn(
          "group relative overflow-hidden rounded-[30px] border border-white/6 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.04),transparent_46%)] touch-none",
          minHeightClassName
        )}
        style={{ touchAction: "none" }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(110,231,183,0.06),transparent_28%),radial-gradient(circle_at_20%_20%,rgba(196,181,253,0.08),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.015),rgba(4,8,18,0.24))]" />

        <div className="absolute left-3 top-3 z-10 inline-flex max-w-[calc(100%-7rem)] items-center gap-2 rounded-full border border-white/8 bg-[rgba(8,14,25,0.78)] px-2.5 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white/42 backdrop-blur-xl sm:left-4 sm:top-4 sm:max-w-none sm:px-3" onPointerDown={(event) => event.stopPropagation()}>
          <Move className="size-3.5" />
          {isMobileFrame ? "Drag or pinch" : "Drag to pan, scroll to zoom"}
        </div>

        <div className="absolute right-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-end gap-1.5 sm:right-4 sm:top-4 sm:max-w-none sm:gap-2" onPointerDown={(event) => event.stopPropagation()}>
          <Button type="button" variant="secondary" size="sm" className="px-2.5 sm:px-3" aria-label="Zoom in" onClick={() => {
            userAdjustedRef.current = true;
            adjustScale(viewport.scale * 1.12, frameSize.width - 96, 72);
          }}>
            <Plus className="size-4" />
          </Button>
          <Button type="button" variant="secondary" size="sm" className="px-2.5 sm:px-3" aria-label="Zoom out" onClick={() => {
            userAdjustedRef.current = true;
            adjustScale(viewport.scale * 0.88, frameSize.width - 96, 72);
          }}>
            <Minus className="size-4" />
          </Button>
          <Button type="button" variant="secondary" size="sm" className="px-2.5 sm:min-w-[4.75rem] sm:px-3" aria-label="Fit graph" onClick={() => {
            userAdjustedRef.current = true;
            fitToContent();
          }}>
            <Maximize className="size-4" />
            {!isMobileFrame ? "Fit" : null}
          </Button>
          <Button type="button" variant="secondary" size="sm" className="px-2.5 sm:min-w-[5.5rem] sm:px-3" aria-label="Reset graph" onClick={() => {
            userAdjustedRef.current = false;
            fitToContent();
          }}>
            <RotateCcw className="size-4" />
            {!isMobileFrame ? "Reset" : null}
          </Button>
        </div>

        {legend && legend.length > 0 && !isMobileFrame ? (
          <div className="absolute bottom-4 left-4 z-10 flex flex-wrap items-center gap-2 rounded-[24px] border border-white/8 bg-[rgba(8,14,25,0.76)] px-3 py-2 text-xs text-white/58 backdrop-blur-xl">
            {legend.map((item) => {
              const legendTone = item.kind ? getToneForEntityKind(item.kind) : (item.tone ?? "slate");
              const Icon = item.kind ? getEntityVisual(item.kind).icon : null;
              return (
                <span key={item.label} className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-white/[0.04] px-2.5 py-1.5">
                  {Icon ? <Icon className="size-3.5" color={toneTextMap[legendTone]} strokeWidth={2.1} /> : <span className="size-2 rounded-full" style={{ backgroundColor: toneStrokeMap[legendTone] }} />}
                  {item.label}
                </span>
              );
            })}
          </div>
        ) : null}

        <svg className="relative z-[1] h-full w-full" viewBox={`0 0 ${frameSize.width || 1200} ${frameSize.height || 760}`} role="img" aria-label={title}>
          <defs>
            <filter id="forge-graph-blur">
              <feGaussianBlur stdDeviation="34" />
            </filter>
          </defs>

          <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
            {fields.map((field) => (
              <ellipse
                key={field.id}
                cx={field.x}
                cy={field.y}
                rx={field.radiusX}
                ry={field.radiusY}
                fill={toneFillMap[field.tone ?? "rose"]}
                opacity={field.opacity ?? 0.42}
                filter="url(#forge-graph-blur)"
              />
            ))}

            {nodes
              .filter((node) => node.kind === "goal" || node.kind === "ghost")
              .map((node) => {
                const radius = node.radius ?? 76;
                return (
                  <g key={`${node.id}-orbital-lanes`} opacity={node.kind === "ghost" ? 0.28 : 0.55}>
                    {[radius + 74, radius + 124].map((ringRadius, index) => (
                      <circle
                        key={`${node.id}-ring-${ringRadius}`}
                        cx={node.x}
                        cy={node.y}
                        r={ringRadius}
                        fill="none"
                        stroke={index === 0 ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.045)"}
                        strokeDasharray={index === 0 ? "0" : "10 10"}
                      />
                    ))}
                  </g>
                );
              })}

            {edges.map((edge) => {
              const from = nodeMap.get(edge.from);
              const to = nodeMap.get(edge.to);
              if (!from || !to) {
                return null;
              }
              const start = resolveNodeCenter(from);
              const end = resolveNodeCenter(to);
              const midX = (start.x + end.x) / 2;
              const midY = (start.y + end.y) / 2;
              const drift = Math.max(24, Math.abs(start.x - end.x) * 0.08);
              const controlX = midX;
              const controlY = midY - drift;

              return (
                <path
                  key={edge.id}
                  d={`M ${start.x} ${start.y} Q ${controlX} ${controlY} ${end.x} ${end.y}`}
                  fill="none"
                  stroke={toneStrokeMap[edge.tone ?? "slate"]}
                  strokeWidth={edge.strength === "high" ? 3 : edge.strength === "medium" ? 2.2 : 1.6}
                  strokeDasharray={edge.dashed ? "8 8" : undefined}
                  opacity={activeNodeId && edge.from !== activeNodeId && edge.to !== activeNodeId ? 0.18 : 0.62}
                />
              );
            })}

            {nodes.map((node) => {
              const isSelected = selectedNodeId === node.id;
              const isHovered = hoveredNodeId === node.id;
              const isActive = activeNodeId === node.id;
              const tone = getToneForNode(node);
              const metaLabel = getNodeMetaLabel(node);
              const labelLines = buildNodeLabelLines(node);
              const entityKind = getEntityKindForNode(node.kind);
              const Icon = entityKind ? getEntityVisual(entityKind).icon : null;

              if (node.kind === "goal" || node.kind === "value" || node.kind === "ghost") {
                const radius = node.radius ?? (node.kind === "goal" ? 76 : 34);
                const metaY = metaLabel ? node.y - radius - (node.kind === "goal" ? 18 : 10) : null;
                const lineSpacing = node.kind === "goal" ? 20 : 14.5;
                const iconSize = node.kind === "goal" ? 28 : 16;
                const iconCenterY = node.kind === "goal" ? node.y - radius * 0.34 : node.kind === "value" ? node.y - radius * 0.3 : node.y - radius * 0.2;
                const labelBaseY = node.kind === "goal" ? node.y + radius * 0.2 : node.y + 10;
                return (
                  <g
                    key={node.id}
                    tabIndex={0}
                    role="button"
                    onPointerEnter={() => {
                      setHoveredNodeId(node.id);
                      onSelectNode?.(node.id);
                    }}
                    onPointerLeave={() => setHoveredNodeId((current) => (current === node.id ? null : current))}
                    onFocus={() => onSelectNode?.(node.id)}
                    onClick={() => openNode(node)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openNode(node);
                      }
                    }}
                    className="cursor-pointer outline-none"
                  >
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={radius + (isActive ? 14 : 0)}
                      fill={isActive ? `${toneStrokeMap[tone]}22` : "transparent"}
                      stroke={isActive ? toneStrokeMap[tone] : "transparent"}
                      opacity={isHovered ? 0.98 : 0.9}
                    />
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={radius + (isHovered ? 2 : 0)}
                      fill={node.kind === "ghost" ? "rgba(255,255,255,0.03)" : toneFillMap[tone]}
                      stroke={node.kind === "ghost" ? "rgba(255,255,255,0.18)" : toneStrokeMap[tone]}
                      strokeDasharray={node.kind === "ghost" ? "8 8" : undefined}
                      strokeWidth={isActive ? 2.8 : 1.6}
                    />
                    {metaLabel ? (
                      <text x={node.x} y={metaY ?? node.y - 12} textAnchor="middle" fontSize={node.kind === "goal" ? "11.5" : "10.5"} fill={node.kind === "ghost" ? "rgba(255,255,255,0.62)" : toneTextMap[tone]} style={{ letterSpacing: "0.18em", textTransform: "uppercase" }}>
                        {metaLabel}
                      </text>
                    ) : null}
                    {Icon ? (
                      <Icon
                        x={node.x - iconSize / 2}
                        y={iconCenterY - iconSize / 2}
                        width={iconSize}
                        height={iconSize}
                        color={toneTextMap[tone]}
                        strokeWidth={2.1}
                      />
                    ) : null}
                    {labelLines.map((line, index) => (
                      <text
                        key={`${node.id}-${line}-${index}`}
                        x={node.x}
                        y={labelBaseY + index * lineSpacing - ((labelLines.length - 1) * lineSpacing) / 2}
                        textAnchor="middle"
                        fontSize={node.kind === "goal" ? 21 : 12.8}
                        fontWeight={node.kind === "goal" ? 600 : 500}
                        fill={node.kind === "ghost" ? "rgba(255,255,255,0.92)" : toneTextMap[tone]}
                      >
                        {line}
                      </text>
                    ))}
                  </g>
                );
              }

              const width = node.width ?? 146;
              const height = node.height ?? 58;
              const x = node.x - width / 2;
              const y = node.y - height / 2;
              const iconSize = node.kind === "project" ? 14 : 13;
              const iconX = x + 14;
              const iconY = y + 13;
              const metaY = y + 22;
              const labelCenterY = metaLabel ? y + height * 0.65 : y + height * 0.56;
              const lineSpacing = node.kind === "project" ? 16 : 15;
              const labelFontSize = node.kind === "project" ? 14.2 : 13.2;

              return (
                <g
                  key={node.id}
                  tabIndex={0}
                  role="button"
                  onPointerEnter={() => {
                    setHoveredNodeId(node.id);
                    onSelectNode?.(node.id);
                  }}
                  onPointerLeave={() => setHoveredNodeId((current) => (current === node.id ? null : current))}
                  onFocus={() => onSelectNode?.(node.id)}
                  onClick={() => openNode(node)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openNode(node);
                    }
                  }}
                  className="cursor-pointer outline-none"
                >
                  <rect
                    x={x - (isActive ? 6 : 0)}
                    y={y - (isActive ? 6 : 0)}
                    rx="28"
                    ry="28"
                    width={width + (isActive ? 12 : 0)}
                    height={height + (isActive ? 12 : 0)}
                    fill={isActive ? `${toneStrokeMap[tone]}22` : "transparent"}
                  />
                  <rect
                    x={x - (isHovered ? 2 : 0)}
                    y={y - (isHovered ? 2 : 0)}
                    rx="22"
                    ry="22"
                    width={width + (isHovered ? 4 : 0)}
                    height={height + (isHovered ? 4 : 0)}
                    fill={toneFillMap[tone]}
                    stroke={toneStrokeMap[tone]}
                    strokeWidth={isActive ? 2.3 : 1.3}
                  />
                  {Icon ? (
                    <Icon
                      x={iconX}
                      y={iconY}
                      width={iconSize}
                      height={iconSize}
                      color={toneTextMap[tone]}
                      strokeWidth={2.1}
                    />
                  ) : null}
                  {metaLabel ? (
                    <text x={iconX + iconSize + 8} y={metaY} textAnchor="start" fontSize="9.5" fill={toneTextMap[tone]} style={{ letterSpacing: "0.16em", textTransform: "uppercase", opacity: 0.82 }}>
                      {metaLabel}
                    </text>
                  ) : null}
                  {labelLines.map((line, index) => (
                    <text
                      key={`${node.id}-${line}-${index}`}
                      x={node.x}
                      y={labelCenterY + index * lineSpacing - ((labelLines.length - 1) * lineSpacing) / 2}
                      textAnchor="middle"
                      fontSize={labelFontSize}
                      fontWeight={600}
                      fill={toneTextMap[tone]}
                    >
                      {line}
                    </text>
                  ))}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </section>
  );
}
