import { AnimatePresence, motion } from "framer-motion";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MOBILE_BREAKPOINT_QUERY = "(max-width: 1023px)";

function useIsMobileCanvas() {
  const [isMobile, setIsMobile] = useState(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return false;
    }
    return window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches;
  });

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    const updateMatch = (event: MediaQueryListEvent) =>
      setIsMobile(event.matches);
    setIsMobile(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateMatch);
      return () => mediaQuery.removeEventListener("change", updateMatch);
    }

    mediaQuery.addListener(updateMatch);
    return () => mediaQuery.removeListener(updateMatch);
  }, []);

  return isMobile;
}

export function ChainCanvas({
  stages,
  activeStageId,
  onStageChange,
  stageContent,
  inspector
}: {
  stages: Array<{ id: string; label: string; summary: string }>;
  activeStageId: string;
  onStageChange: (stageId: string) => void;
  stageContent: ReactNode;
  inspector?: ReactNode;
}) {
  const isMobile = useIsMobileCanvas();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const activeStage = stages.find((stage) => stage.id === activeStageId);

  useEffect(() => {
    setInspectorOpen(!isMobile);
  }, [isMobile]);

  return (
    <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 rounded-[30px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              Tracing the chain
            </div>
            <div className="mt-1 break-words text-sm text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
              {activeStage?.summary}
            </div>
          </div>
          {inspector ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setInspectorOpen((current) => !current)}
            >
              {inspectorOpen ? (
                <PanelRightClose className="size-4" />
              ) : (
                <PanelRightOpen className="size-4" />
              )}
              Inspector
            </Button>
          ) : null}
        </div>

        <div className="mb-4 pb-1">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            {stages.map((stage, index) => (
              <button
                key={stage.id}
                type="button"
                className={cn(
                  "min-w-0 max-w-full rounded-[22px] px-4 py-3 text-left transition",
                  isMobile ? "flex-1 basis-[5.5rem]" : "basis-[13rem]",
                  stage.id === activeStageId
                    ? "bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)] shadow-[var(--ui-shadow-soft)]"
                    : "bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                )}
                onClick={() => onStageChange(stage.id)}
              >
                <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  {index + 1}. {stage.label}
                </div>
                {!isMobile ? (
                  <div className="mt-1.5 text-sm leading-5">
                    {stage.summary}
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0 rounded-[28px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 md:p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[var(--ui-surface-2)] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              {activeStage?.label}
            </span>
            <span className="min-w-0 break-words text-sm text-[var(--ui-ink-faint)] [overflow-wrap:anywhere]">
              {activeStage?.summary}
            </span>
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeStageId}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.26, ease: "easeOut" }}
            >
              {stageContent}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {inspector ? (
        <AnimatePresence initial={false}>
          {inspectorOpen ? (
            <motion.div
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="min-w-0 rounded-[26px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] p-3.5"
            >
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                Linked inspectors
              </div>
              <div className="mt-3 grid gap-3">{inspector}</div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      ) : null}
    </section>
  );
}
