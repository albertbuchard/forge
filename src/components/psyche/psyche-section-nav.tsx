import { useEffect, useMemo, useState } from "react";
import {
  BrainCircuit,
  ChartNoAxesCombined,
  GitBranchPlus,
  HeartHandshake,
  ListChecks,
  Moon,
  MonitorSmartphone,
  Orbit,
  PanelTop,
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
  { to: "/psyche/metrics", label: "Metrics", icon: ChartNoAxesCombined },
  { to: "/psyche/flashcards", label: "Flashcards", icon: PanelTop },
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
          "overflow-hidden border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] p-2",
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
                      ? "bg-[color-mix(in_srgb,var(--tertiary)_18%,var(--ui-surface-1)_82%)] text-[var(--ui-ink-strong)]"
                      : "bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
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
            className="inline-flex min-w-0 flex-1 items-center gap-3 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3.5 py-2.5 text-left shadow-[var(--ui-shadow-soft)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
            onClick={() => setMobileOpen(true)}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-[color-mix(in_srgb,var(--tertiary)_24%,transparent)] bg-[color-mix(in_srgb,var(--tertiary)_14%,transparent)]">
                <activeSection.icon className="size-4 text-[var(--tertiary)]" />
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                  Psyche section
                </span>
                <span className="mt-0.5 block truncate text-sm font-medium text-[var(--ui-ink-strong)]">
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
              <div className="fixed inset-0 z-50 bg-[var(--overlay)] backdrop-blur-xl" />
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
	                  className="pointer-events-auto flex max-h-[min(34rem,calc(100dvh-var(--forge-mobile-nav-clearance)-1rem))] w-full max-w-xl min-h-0 flex-col overflow-hidden rounded-[30px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-modal)] shadow-[var(--ui-shadow-floating)]"
	                >
	                  <div className="shrink-0 border-b border-[var(--ui-border-subtle)] px-4 pb-2.5 pt-3 sm:px-5">
	                    <div className="flex items-start justify-between gap-3">
	                      <div className="min-w-0">
	                        <div className="font-label text-[10px] uppercase tracking-[0.22em] text-[var(--ui-ink-faint)]">
	                          Psyche sections
	                        </div>
	                        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
	                          <div className="truncate text-[1.05rem] font-semibold text-[var(--ui-ink-strong)]">
	                            Move through Psyche
	                          </div>
	                          <span className="rounded-full border border-[color-mix(in_srgb,var(--tertiary)_24%,transparent)] bg-[color-mix(in_srgb,var(--tertiary)_14%,transparent)] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-[var(--tertiary)]">
	                            {activeSection.label}
	                          </span>
                        </div>
                      </div>
	                      <button
	                        type="button"
	                        aria-label="Close psyche sections"
	                        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
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
	                              "group flex items-center justify-between gap-3 rounded-[22px] border px-3.5 py-3 transition-[transform,border-color,background-color,color] duration-150 hover:-translate-y-[1px] hover:text-[var(--ui-ink-strong)]",
	                              isActive
	                                ? "border-[color-mix(in_srgb,var(--tertiary)_24%,transparent)] bg-[color-mix(in_srgb,var(--tertiary)_14%,var(--ui-surface-1)_86%)] text-[var(--ui-ink-strong)]"
	                                : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)] hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
	                            )}
	                          >
                            <span className="flex min-w-0 items-center gap-3">
                              <span
                                className={cn(
	                                  "flex size-10 shrink-0 items-center justify-center rounded-2xl border transition",
	                                  isActive
	                                    ? "border-[color-mix(in_srgb,var(--tertiary)_24%,transparent)] bg-[color-mix(in_srgb,var(--tertiary)_16%,transparent)] text-[var(--tertiary)]"
	                                    : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)] group-hover:border-[var(--ui-border-strong)] group-hover:text-[var(--ui-ink-strong)]"
	                                )}
	                              >
                                <section.icon className="size-4" />
                              </span>
                              <span className="min-w-0">
	                                <span className="block truncate text-sm font-semibold text-[var(--ui-ink-strong)]">
	                                  {section.label}
	                                </span>
	                                <span className="mt-0.5 block text-[10px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
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
	                                  ? "bg-[color-mix(in_srgb,var(--tertiary)_16%,transparent)] text-[var(--tertiary)]"
	                                  : "bg-[var(--ui-surface-2)] text-[var(--ui-ink-faint)]"
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
