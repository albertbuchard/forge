import { useEffect, useMemo, useState } from "react";
import {
  BrainCircuit,
  GitBranchPlus,
  HeartHandshake,
  ListChecks,
  Moon,
  MonitorSmartphone,
  Orbit,
  SlidersHorizontal,
  Sparkles,
  StickyNote,
  UnfoldVertical,
  Waves,
  Waypoints,
  X
} from "lucide-react";
import { createPortal } from "react-dom";
import { NavLink, useLocation } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const PSYCHE_SECTIONS = [
  { to: "/psyche", label: "Overview", icon: BrainCircuit },
  { to: "/psyche/values", label: "Values", icon: Orbit },
  { to: "/psyche/patterns", label: "Patterns", icon: Waves },
  { to: "/psyche/questionnaires", label: "Questionnaires", icon: ListChecks },
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
  { to: "/psyche/screen-time", label: "Screen Time", icon: MonitorSmartphone },
  { to: "/preferences", label: "Preferences", icon: SlidersHorizontal },
  { to: "/sleep", label: "Sleep", icon: Moon }
] as const;

function sectionMatches(pathname: string, to: string) {
  if (to === "/psyche") {
    return pathname === "/psyche";
  }
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

  useEffect(() => {
    if (!mobileOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    const previousTouchAction = document.body.style.touchAction;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.touchAction = previousTouchAction;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileOpen]);

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
                end={section.to === "/psyche"}
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
            className="inline-flex min-w-0 flex-1 items-center gap-3 rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(19,28,42,0.96),rgba(11,17,30,0.94))] px-3.5 py-2.5 text-left shadow-[0_18px_38px_rgba(3,8,18,0.2)] transition hover:border-white/12 hover:bg-[linear-gradient(180deg,rgba(24,34,50,0.98),rgba(12,19,34,0.96))]"
            onClick={() => setMobileOpen(true)}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-[rgba(110,231,183,0.2)] bg-[rgba(110,231,183,0.12)]">
                <activeSection.icon className="size-4 text-[var(--tertiary)]" />
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] uppercase tracking-[0.18em] text-white/40">
                  Psyche section
                </span>
                <span className="mt-0.5 block truncate text-sm font-medium text-white">
                  {activeSection.label}
                </span>
              </span>
            </span>
          </button>
        </div>
      </Card>

      {mobileOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="lg:hidden">
              <div className="fixed inset-0 z-50 bg-[rgba(5,10,18,0.78)] backdrop-blur-xl" />
              <button
                type="button"
                aria-label="Close psyche sections"
                className="fixed inset-0 z-[51]"
                onClick={() => setMobileOpen(false)}
              />
              <div
                className="pointer-events-none fixed inset-0 z-[52] flex items-end justify-center px-3 pt-3 sm:px-4 sm:pt-4"
                style={{
                  paddingLeft:
                    "max(0.75rem, calc(var(--forge-safe-area-left) + 0.75rem))",
                  paddingRight:
                    "max(0.75rem, calc(var(--forge-safe-area-right) + 0.75rem))",
                  paddingTop:
                    "max(0.75rem, calc(env(safe-area-inset-top) + 0.75rem))",
                  paddingBottom:
                    "calc(var(--forge-mobile-nav-clearance) - 0.25rem)"
                }}
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Psyche sections"
                  className="pointer-events-auto flex max-h-[min(34rem,calc(100dvh-var(--forge-mobile-nav-clearance)-1rem))] w-full max-w-xl min-h-0 flex-col overflow-hidden rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(110,231,183,0.12),transparent_40%),linear-gradient(180deg,rgba(18,27,42,0.98),rgba(10,15,28,0.98))] shadow-[0_36px_110px_rgba(3,8,18,0.5)]"
                >
                  <div className="shrink-0 border-b border-white/8 px-4 pb-2.5 pt-3 sm:px-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-label text-[10px] uppercase tracking-[0.22em] text-white/38">
                          Psyche sections
                        </div>
                        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
                          <div className="truncate text-[1.05rem] font-semibold text-white">
                            Move through Psyche
                          </div>
                          <span className="rounded-full border border-[rgba(110,231,183,0.18)] bg-[rgba(110,231,183,0.12)] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-[var(--tertiary)]">
                            {activeSection.label}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label="Close psyche sections"
                        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.05] text-white/65 transition hover:border-white/12 hover:bg-white/[0.09] hover:text-white"
                        onClick={() => setMobileOpen(false)}
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  </div>

                  <div className="min-h-0 overflow-y-auto p-3 overscroll-contain sm:p-4">
                    <div className="grid gap-2">
                      {PSYCHE_SECTIONS.map((section) => {
                        const isActive = sectionMatches(
                          location.pathname,
                          section.to
                        );

                        return (
                          <NavLink
                            key={section.to}
                            to={section.to}
                            end={section.to === "/psyche"}
                            onClick={() => setMobileOpen(false)}
                            className={cn(
                              "group flex items-center justify-between gap-3 rounded-[22px] border px-3.5 py-3 transition-[transform,border-color,background-color,color] duration-150 hover:-translate-y-[1px] hover:text-white",
                              isActive
                                ? "border-[rgba(110,231,183,0.18)] bg-[rgba(110,231,183,0.12)] text-white"
                                : "border-white/8 bg-white/[0.04] text-white/72 hover:border-white/12 hover:bg-white/[0.06]"
                            )}
                          >
                            <span className="flex min-w-0 items-center gap-3">
                              <span
                                className={cn(
                                  "flex size-10 shrink-0 items-center justify-center rounded-2xl border transition",
                                  isActive
                                    ? "border-[rgba(110,231,183,0.18)] bg-[rgba(110,231,183,0.14)] text-[var(--tertiary)]"
                                    : "border-white/8 bg-[rgba(255,255,255,0.03)] text-white/58 group-hover:border-white/12 group-hover:text-white/80"
                                )}
                              >
                                <section.icon className="size-4" />
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-white">
                                  {section.label}
                                </span>
                                <span className="mt-0.5 block text-[10px] uppercase tracking-[0.16em] text-white/35">
                                  {section.to === "/preferences"
                                    ? "Preference system"
                                    : "Psyche workspace"}
                                </span>
                              </span>
                            </span>
                            <span
                              className={cn(
                                "rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.16em]",
                                isActive
                                  ? "bg-[rgba(110,231,183,0.16)] text-[var(--tertiary)]"
                                  : "bg-white/[0.05] text-white/42"
                              )}
                            >
                              {isActive ? "Current" : "Open"}
                            </span>
                          </NavLink>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
