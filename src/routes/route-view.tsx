import { Suspense, type ReactElement } from "react";
import { motion } from "framer-motion";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { WorkbenchRouteSurface } from "@/components/workbench/workbench-route-surface";
import { cn } from "@/lib/utils";
import {
  ROUTE_VIEW_CATALOG,
  type RouteViewId,
  type RouteViewMeta,
  type RouteViewTone
} from "@/routes/route-view-catalog";

const TONE_CLASSES: Record<RouteViewTone, string> = {
  core: "route-view-loading--core",
  execution: "route-view-loading--execution",
  health: "route-view-loading--health",
  knowledge: "route-view-loading--knowledge",
  psyche: "route-view-loading--psyche",
  settings: "route-view-loading--settings"
};

function RouteSubviewPulse({ index }: { index: number }) {
  return (
    <div
      className="surface-pulse min-h-[7.5rem] rounded-[22px] border border-white/8 bg-white/[0.04] p-4"
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <div className="h-2.5 w-24 rounded-full bg-white/10" />
      <div className="mt-4 h-9 w-full rounded-2xl bg-white/[0.065]" />
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="h-3 rounded-full bg-white/[0.055]" />
        <div className="h-3 rounded-full bg-white/[0.045]" />
        <div className="h-3 rounded-full bg-white/[0.035]" />
      </div>
    </div>
  );
}

export function RouteViewLoadingSurface({ meta }: { meta: RouteViewMeta }) {
  const skeleton = meta.skeleton ?? {};
  const blocks = Math.max(2, skeleton.blocks ?? 4);
  const previewBlocks = Array.from({ length: Math.min(blocks, 6) });

  return (
    <motion.section
      key={meta.surfaceId}
      className={cn(
        "route-view-loading relative isolate grid min-h-[28rem] gap-5 overflow-hidden rounded-[28px] border border-white/8 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.24)] sm:p-5",
        TONE_CLASSES[meta.tone]
      )}
      role="status"
      aria-busy="true"
      aria-live="polite"
      initial={{ opacity: 0.72, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.42),transparent)]" />
      <div className="pointer-events-none absolute inset-x-6 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent)] opacity-70" />

      <header className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="font-label text-[10px] uppercase tracking-[0.16em] text-white/44">
            Opening surface
          </div>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-normal text-white sm:text-3xl">
            {meta.title}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/58">
            {meta.description}
          </p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 py-2 text-[12px] font-medium text-white/62">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/30" />
            <span className="relative inline-flex size-2.5 rounded-full bg-white/80" />
          </span>
          Loading
        </div>
      </header>

      <div
        className={cn(
          "relative grid gap-3",
          (skeleton.columns ?? 2) > 1 ? "md:grid-cols-2 xl:grid-cols-3" : ""
        )}
        aria-hidden="true"
      >
        {previewBlocks.map((_, index) => (
          <RouteSubviewPulse key={index} index={index} />
        ))}
      </div>

      <SurfaceSkeleton
        header={skeleton.header ?? false}
        sideRail={skeleton.sideRail ?? true}
        columns={skeleton.columns ?? 2}
        blocks={blocks}
        className="relative opacity-80"
      />
    </motion.section>
  );
}

export function RouteView({
  viewId,
  children
}: {
  viewId: RouteViewId;
  children: ReactElement;
}) {
  const meta = ROUTE_VIEW_CATALOG[viewId];
  return (
    <Suspense fallback={<RouteViewLoadingSurface meta={meta} />}>
      <WorkbenchRouteSurface surfaceId={meta.surfaceId}>
        {children}
      </WorkbenchRouteSurface>
    </Suspense>
  );
}
