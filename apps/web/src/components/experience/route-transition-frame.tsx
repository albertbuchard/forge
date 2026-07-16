import type { ReactNode } from "react";
import { motion } from "framer-motion";

export function RouteTransitionFrame({
  routeKey,
  tone = "core",
  children
}: {
  routeKey: string;
  tone?: "core" | "psyche";
  children: ReactNode;
}) {
  return (
    <motion.div
      data-route-key={routeKey}
      data-route-tone={tone}
      className="w-full max-w-full min-w-0"
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
    >
      <div data-route-transition-content>{children}</div>
      <div
        data-route-transition-fallback
        aria-hidden="true"
        className={`route-view-loading route-view-loading--${tone} relative isolate min-h-[28rem] overflow-hidden py-4`}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-36 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]" />
          <div className="h-36 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]" />
          <div className="h-52 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] md:col-span-2" />
        </div>
      </div>
    </motion.div>
  );
}
