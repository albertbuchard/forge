import { AnimatePresence, motion } from "framer-motion";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MOBILE_BREAKPOINT_QUERY = "(max-width: 1023px)";

function useIsMobileCanvas() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    const updateMatch = (event: MediaQueryListEvent) => setIsMobile(event.matches);
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
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="rounded-[30px] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(196,181,253,0.12),transparent_38%),linear-gradient(180deg,rgba(21,20,38,0.98),rgba(10,12,22,0.96))] p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/38">Tracing the chain</div>
            <div className="mt-1 text-sm text-white/58">{activeStage?.summary}</div>
          </div>
          {inspector ? (
            <Button variant="secondary" size="sm" onClick={() => setInspectorOpen((current) => !current)}>
              {inspectorOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
              Inspector
            </Button>
          ) : null}
        </div>

        <div className="mb-4 overflow-x-auto pb-1">
          <div className="flex min-w-max items-center gap-3">
            {stages.map((stage, index) => (
              <button
                key={stage.id}
                type="button"
                className={cn(
                  "rounded-[22px] px-4 py-3 text-left transition",
                  stage.id === activeStageId ? "bg-[rgba(196,181,253,0.18)] text-white shadow-[0_18px_40px_rgba(15,12,28,0.28)]" : "bg-white/[0.04] text-white/58 hover:bg-white/[0.07] hover:text-white"
                )}
                onClick={() => onStageChange(stage.id)}
              >
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/34">
                  {index + 1}. {stage.label}
                </div>
                {!isMobile ? <div className="mt-1.5 text-sm leading-5">{stage.summary}</div> : null}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-4 md:p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/[0.07] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white/42">
              {activeStage?.label}
            </span>
            <span className="text-sm text-white/54">{activeStage?.summary}</span>
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
              className="rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(17,24,35,0.96),rgba(11,16,24,0.94))] p-3.5"
            >
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">Linked inspectors</div>
              <div className="mt-3 grid gap-3">{inspector}</div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      ) : null}
    </section>
  );
}
