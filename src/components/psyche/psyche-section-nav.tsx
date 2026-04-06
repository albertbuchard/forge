import { useMemo, useState } from "react";
import {
  BrainCircuit,
  GitBranchPlus,
  HeartHandshake,
  Moon,
  Orbit,
  SlidersHorizontal,
  Sparkles,
  StickyNote,
  UnfoldVertical,
  Waves,
  Waypoints
} from "lucide-react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const PSYCHE_SECTIONS = [
  { to: "/psyche", label: "Overview", icon: BrainCircuit },
  { to: "/psyche/values", label: "Values", icon: Orbit },
  { to: "/psyche/patterns", label: "Patterns", icon: Waves },
  {
    to: "/psyche/self-observation",
    label: "Self Observation",
    icon: StickyNote
  },
  { to: "/psyche/behaviors", label: "Behaviors", icon: GitBranchPlus },
  { to: "/psyche/reports", label: "Reports", icon: Sparkles },
  { to: "/psyche/goal-map", label: "Goal Map", icon: Waypoints },
  {
    to: "/psyche/schemas-beliefs",
    label: "Schemas & Beliefs",
    icon: UnfoldVertical
  },
  { to: "/psyche/modes", label: "Modes", icon: HeartHandshake },
  { to: "/preferences", label: "Preferences", icon: SlidersHorizontal },
  { to: "/sleep", label: "Sleep", icon: Moon }
] as const;

function sectionMatches(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function PsycheSectionNav({ className }: { className?: string }) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeSection = useMemo(() => {
    return (
      [...PSYCHE_SECTIONS]
        .sort((left, right) => right.to.length - left.to.length)
        .find((section) => sectionMatches(location.pathname, section.to)) ??
      PSYCHE_SECTIONS[0]
    );
  }, [location.pathname]);

  return (
    <>
      <Card
        className={cn(
          "overflow-hidden bg-[linear-gradient(180deg,rgba(15,24,31,0.94),rgba(10,18,25,0.92))] p-2",
          className
        )}
      >
        <div className="hidden items-center gap-3 lg:flex">
          <div className="flex flex-wrap gap-2">
            {PSYCHE_SECTIONS.map((section) => (
              <NavLink
                key={section.to}
                to={section.to}
                className={({ isActive }) =>
                  cn(
                    "inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition",
                    isActive || sectionMatches(location.pathname, section.to)
                      ? "bg-[rgba(110,231,183,0.18)] text-[var(--tertiary)]"
                      : "bg-white/[0.04] text-white/58 hover:bg-white/[0.08] hover:text-white"
                  )
                }
              >
                <section.icon className="size-3.5" />
                <span>{section.label}</span>
              </NavLink>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 lg:hidden">
          <button
            type="button"
            className="inline-flex min-w-0 flex-1 items-center justify-between rounded-full bg-white/[0.06] px-4 py-3 text-left"
            onClick={() => setMobileOpen(true)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <activeSection.icon className="size-4 shrink-0 text-[var(--tertiary)]" />
              <span className="truncate text-sm font-medium text-white">
                {activeSection.label}
              </span>
            </span>
            <span className="text-[10px] uppercase tracking-[0.16em] text-white/42">
              Switch
            </span>
          </button>
        </div>
      </Card>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 bg-[rgba(5,10,18,0.86)] px-4 py-5 backdrop-blur-xl lg:hidden">
          <div className="mx-auto flex h-full max-w-xl flex-col rounded-[32px] bg-[linear-gradient(180deg,rgba(16,25,33,0.98),rgba(11,18,25,0.98))] p-5 shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/38">
                  Psyche sections
                </div>
                <div className="mt-2 font-display text-3xl text-white">
                  Move through the inner map
                </div>
              </div>
              <Button variant="secondary" onClick={() => setMobileOpen(false)}>
                Close
              </Button>
            </div>

            <div className="mt-6 grid gap-3 overflow-y-auto">
              {PSYCHE_SECTIONS.map((section) => (
                <NavLink
                  key={section.to}
                  to={section.to}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center justify-between rounded-[24px] px-4 py-4 transition",
                    sectionMatches(location.pathname, section.to)
                      ? "bg-[rgba(110,231,183,0.14)] text-white"
                      : "bg-white/[0.04] text-white/70"
                  )}
                >
                  <span className="flex items-center gap-3">
                    <section.icon className="size-4 text-[var(--tertiary)]" />
                    <span className="text-base font-medium">
                      {section.label}
                    </span>
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.16em] text-white/36">
                    Open
                  </span>
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
