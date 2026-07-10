import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

type OrbitNode = {
  id: string;
  label: string;
  title: string;
  detail: string;
  href: string;
  angle: number;
  radius: number;
  tone?: "mint" | "sky" | "violet" | "rose";
};

const toneClassMap: Record<NonNullable<OrbitNode["tone"]>, string> = {
  mint: "border-[color-mix(in_srgb,var(--success)_28%,var(--ui-border-subtle)_72%)] bg-[color-mix(in_srgb,var(--success)_12%,var(--ui-surface-1)_88%)] text-[color-mix(in_srgb,var(--success)_62%,var(--ui-ink-strong)_38%)]",
  sky: "border-[color-mix(in_srgb,var(--info)_28%,var(--ui-border-subtle)_72%)] bg-[color-mix(in_srgb,var(--info)_12%,var(--ui-surface-1)_88%)] text-[color-mix(in_srgb,var(--info)_62%,var(--ui-ink-strong)_38%)]",
  violet: "border-[color-mix(in_srgb,var(--primary)_28%,var(--ui-border-subtle)_72%)] bg-[color-mix(in_srgb,var(--primary)_12%,var(--ui-surface-1)_88%)] text-[color-mix(in_srgb,var(--primary)_62%,var(--ui-ink-strong)_38%)]",
  rose: "border-[color-mix(in_srgb,var(--danger)_28%,var(--ui-border-subtle)_72%)] bg-[color-mix(in_srgb,var(--danger)_12%,var(--ui-surface-1)_88%)] text-[color-mix(in_srgb,var(--danger)_62%,var(--ui-ink-strong)_38%)]"
};

type PackedOrbitNode = OrbitNode & {
  x: number;
  y: number;
  width: number;
  height: number;
  homeX: number;
  homeY: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function estimateNodeHeight(node: OrbitNode) {
  const detailLength = node.detail.trim().length;
  if (detailLength > 84) {
    return 130;
  }
  if (detailLength > 44) {
    return 118;
  }
  return 106;
}

function packOrbitNodes(nodes: OrbitNode[], frameWidth: number, frameHeight: number): PackedOrbitNode[] {
  const centerX = frameWidth / 2;
  const centerY = frameHeight / 2;
  const orbitScale = clamp(Math.min(frameWidth / 620, frameHeight / 430), 0.64, 1.06);
  const packed = nodes.map((node) => {
    const angleInRadians = (node.angle * Math.PI) / 180;
    const scaledRadius = node.radius * orbitScale;
    const width = Math.min(184, Math.max(154, frameWidth - 48));
    const height = estimateNodeHeight(node);
    const homeX = centerX + Math.cos(angleInRadians) * scaledRadius;
    const homeY = centerY + Math.sin(angleInRadians) * scaledRadius;
    return {
      ...node,
      x: homeX,
      y: homeY,
      width,
      height,
      homeX,
      homeY
    };
  });

  const gap = frameWidth < 720 ? 16 : 22;
  const leftBoundary = 20;
  const rightBoundary = frameWidth - 20;
  const topBoundary = 18;
  const bottomBoundary = frameHeight - 18;

  for (let iteration = 0; iteration < 220; iteration += 1) {
    for (const node of packed) {
      node.x += (node.homeX - node.x) * 0.065;
      node.y += (node.homeY - node.y) * 0.065;
    }

    for (let leftIndex = 0; leftIndex < packed.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < packed.length; rightIndex += 1) {
        const left = packed[leftIndex]!;
        const right = packed[rightIndex]!;
        const deltaX = right.x - left.x;
        const deltaY = right.y - left.y;
        const overlapX = left.width / 2 + right.width / 2 + gap - Math.abs(deltaX);
        const overlapY = left.height / 2 + right.height / 2 + gap - Math.abs(deltaY);

        if (overlapX <= 0 || overlapY <= 0) {
          continue;
        }

        const axis = overlapX < overlapY ? "x" : "y";
        const direction = axis === "x" ? Math.sign(deltaX || rightIndex - leftIndex || 1) : Math.sign(deltaY || rightIndex - leftIndex || 1);
        const push = (axis === "x" ? overlapX : overlapY) / 2;

        if (axis === "x") {
          left.x -= direction * push;
          right.x += direction * push;
        } else {
          left.y -= direction * push;
          right.y += direction * push;
        }
      }
    }

    for (const node of packed) {
      node.x = clamp(node.x, leftBoundary + node.width / 2, rightBoundary - node.width / 2);
      node.y = clamp(node.y, topBoundary + node.height / 2, bottomBoundary - node.height / 2);
    }
  }

  return packed;
}

export function OrbitMap({
  title,
  description,
  centerLabel,
  centerValue,
  nodes,
  action
}: {
  title: string;
  description: string;
  centerLabel: string;
  centerValue: string;
  nodes: OrbitNode[];
  action?: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });

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

  const denseNodes = useMemo(
    () =>
      nodes.length > 0
        ? nodes
        : [
            { id: "values", label: "Values", title: "Add value", detail: "Name what matters", href: "/psyche/values?create=1", angle: -86, radius: 112, tone: "mint" as const },
            { id: "patterns", label: "Patterns", title: "Add pattern", detail: "Map a loop", href: "/psyche/patterns?create=1", angle: -14, radius: 122, tone: "rose" as const },
            { id: "beliefs", label: "Beliefs", title: "Add belief", detail: "Capture a script", href: "/psyche/schemas-beliefs?create=1", angle: 72, radius: 118, tone: "violet" as const },
            { id: "reports", label: "Reports", title: "Reflect", detail: "Open the chain", href: "/psyche/reports?create=1", angle: 160, radius: 124, tone: "sky" as const }
          ],
    [nodes]
  );
  const packedNodes = useMemo(
    () => packOrbitNodes(denseNodes, Math.max(frameSize.width, 320), Math.max(frameSize.height, 320)),
    [denseNodes, frameSize.height, frameSize.width]
  );

  return (
    <section className="overflow-hidden rounded-[32px] border border-[var(--ui-border-subtle)] bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--success)_12%,transparent),transparent_42%),var(--ui-surface-section)] px-4 py-4 shadow-[var(--card-shadow)] lg:px-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--success)]">Reflective map</div>
          <h2 className="mt-2 break-words font-display text-[clamp(1.35rem,2.3vw,2rem)] leading-none text-[var(--ui-ink-strong)]">{title}</h2>
          <p className="mt-2 max-w-2xl break-words text-sm leading-6 text-[var(--ui-ink-soft)]">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex min-w-0 items-center gap-3 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-2">
            <span className="text-xs uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">{centerLabel}</span>
            <span className="min-w-0 break-words text-sm font-medium text-[var(--ui-ink-strong)]">{centerValue}</span>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      </div>

      <div className="grid gap-3 md:hidden">
        {denseNodes.map((node) => (
          <Link
            key={node.id}
            to={node.href}
            className={cn(
              "block min-w-0 rounded-[20px] border px-4 py-3 shadow-[var(--ui-shadow-soft)] transition hover:bg-[var(--ui-surface-hover)]",
              toneClassMap[node.tone ?? "mint"]
            )}
          >
            <div className="break-words text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)] [overflow-wrap:anywhere]">
              {node.label}
            </div>
            <div className="mt-1.5 break-words font-medium text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]">
              {node.title}
            </div>
            <div className="mt-1.5 break-words text-sm leading-5 text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
              {node.detail}
            </div>
          </Link>
        ))}
      </div>

      <div ref={frameRef} className="relative hidden min-h-[20rem] overflow-hidden rounded-[30px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] md:block lg:min-h-[22rem]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,color-mix(in_srgb,var(--success)_8%,transparent),transparent_32%),var(--ui-surface-section)]" />
        {[112, 168, 224].map((ring) => (
          <div
            key={ring}
            className="absolute left-1/2 top-1/2 rounded-full border border-[var(--ui-border-subtle)]"
            style={{
              width: `${ring * 2}px`,
              height: `${ring * 2}px`,
              transform: "translate(-50%, -50%)"
            }}
          />
        ))}
        <div className="absolute inset-1/2 size-32 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] shadow-[var(--card-shadow)]">
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">{centerLabel}</div>
            <div className="mt-2 font-display text-2xl text-[var(--ui-ink-strong)]">{centerValue}</div>
          </div>
        </div>

        {packedNodes.map((node, index) => {
          return (
            <motion.div
              key={node.id}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.35, delay: index * 0.05, ease: "easeOut" }}
              className="absolute w-[min(11.5rem,calc(100vw-4rem))] max-w-[11.5rem] -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${node.x}px`, top: `${node.y}px` }}
              whileHover={{ y: -6, scale: 1.03 }}
            >
              <Link
                to={node.href}
                className={cn(
                  "block min-w-0 rounded-[22px] border px-3.5 py-3 shadow-[var(--ui-shadow-soft)] backdrop-blur-sm transition hover:-translate-y-0.5 hover:bg-[var(--ui-surface-hover)]",
                  toneClassMap[node.tone ?? "mint"]
                )}
              >
                <div className="break-words text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)] [overflow-wrap:anywhere]">{node.label}</div>
                <div className="mt-1.5 break-words font-medium text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]">{node.title}</div>
                <div className="mt-1.5 break-words text-sm leading-5 text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">{node.detail}</div>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
