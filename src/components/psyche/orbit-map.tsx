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
  mint: "border-emerald-300/24 bg-[rgba(16,185,129,0.12)] text-emerald-100",
  sky: "border-sky-300/24 bg-[rgba(56,189,248,0.12)] text-sky-100",
  violet: "border-violet-300/24 bg-[rgba(167,139,250,0.12)] text-violet-100",
  rose: "border-rose-300/24 bg-[rgba(251,113,133,0.12)] text-rose-100"
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

  const denseNodes =
    nodes.length > 0
      ? nodes
      : [
          { id: "values", label: "Values", title: "Add value", detail: "Name what matters", href: "/psyche/values?create=1", angle: -86, radius: 112, tone: "mint" as const },
          { id: "patterns", label: "Patterns", title: "Add pattern", detail: "Map a loop", href: "/psyche/patterns?create=1", angle: -14, radius: 122, tone: "rose" as const },
          { id: "beliefs", label: "Beliefs", title: "Add belief", detail: "Capture a script", href: "/psyche/schemas-beliefs?create=1", angle: 72, radius: 118, tone: "violet" as const },
          { id: "reports", label: "Reports", title: "Reflect", detail: "Open the chain", href: "/psyche/reports?create=1", angle: 160, radius: 124, tone: "sky" as const }
        ];
  const packedNodes = useMemo(
    () => packOrbitNodes(denseNodes, Math.max(frameSize.width, 320), Math.max(frameSize.height, 320)),
    [denseNodes, frameSize.height, frameSize.width]
  );

  return (
    <section className="overflow-hidden rounded-[32px] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(110,231,183,0.14),transparent_42%),linear-gradient(180deg,rgba(15,30,34,0.98),rgba(10,21,25,0.98))] px-4 py-4 shadow-[0_24px_70px_rgba(4,8,18,0.28)] lg:px-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[rgba(110,231,183,0.8)]">Reflective map</div>
          <h2 className="mt-2 font-display text-[clamp(1.35rem,2.3vw,2rem)] leading-none text-white">{title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2">
            <span className="text-xs uppercase tracking-[0.18em] text-white/38">{centerLabel}</span>
            <span className="text-sm font-medium text-white">{centerValue}</span>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      </div>

      <div ref={frameRef} className="relative min-h-[20rem] overflow-hidden rounded-[30px] border border-white/6 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.05),transparent_42%)] lg:min-h-[22rem]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(110,231,183,0.08),transparent_32%),linear-gradient(180deg,transparent,rgba(8,13,24,0.24))]" />
        {[112, 168, 224].map((ring) => (
          <div
            key={ring}
            className="absolute left-1/2 top-1/2 rounded-full border border-white/[0.05]"
            style={{
              width: `${ring * 2}px`,
              height: `${ring * 2}px`,
              transform: "translate(-50%, -50%)"
            }}
          />
        ))}
        <div className="absolute inset-1/2 size-32 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-[radial-gradient(circle,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] shadow-[0_0_0_18px_rgba(255,255,255,0.02),0_0_0_56px_rgba(255,255,255,0.015)]">
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">{centerLabel}</div>
            <div className="mt-2 font-display text-2xl text-white">{centerValue}</div>
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
                  "block rounded-[22px] border px-3.5 py-3 shadow-[0_18px_38px_rgba(4,8,18,0.28)] backdrop-blur-sm transition hover:-translate-y-0.5 hover:bg-white/[0.1] hover:shadow-[0_24px_44px_rgba(4,8,18,0.34)]",
                  toneClassMap[node.tone ?? "mint"]
                )}
              >
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/45">{node.label}</div>
                <div className="mt-1.5 font-medium text-white">{node.title}</div>
                <div className="mt-1.5 text-sm leading-5 text-white/62">{node.detail}</div>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
