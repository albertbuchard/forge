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
      {children}
    </motion.div>
  );
}
