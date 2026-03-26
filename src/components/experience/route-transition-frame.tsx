import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";

export function RouteTransitionFrame({
  routeKey,
  tone = "core",
  children
}: {
  routeKey: string;
  tone?: "core" | "psyche";
  children: ReactNode;
}) {
  const distance = tone === "psyche" ? 10 : 18;
  const duration = tone === "psyche" ? 0.26 : 0.2;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={routeKey}
        className="w-full max-w-full min-w-0"
        initial={{ opacity: 0, y: distance }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
