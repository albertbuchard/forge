import { useEffect, useMemo, useState } from "react";
import {
  ArchiveRestore,
  BookCopy,
  Bot,
  CalendarDays,
  Cpu,
  ScrollText,
  Settings2,
  Smartphone,
  Trophy,
  Users,
  X
} from "lucide-react";
import { createPortal } from "react-dom";
import { NavLink, useLocation } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const SETTINGS_SECTIONS = [
  { to: "/settings", label: "General", icon: Settings2 },
  { to: "/settings/users", label: "Users", icon: Users },
  { to: "/settings/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/settings/mobile", label: "Mobile", icon: Smartphone },
  { to: "/settings/models", label: "Models", icon: Cpu },
  { to: "/settings/agents", label: "Agents", icon: Bot },
  { to: "/settings/wiki", label: "Wiki", icon: BookCopy },
  { to: "/settings/logs", label: "Logs", icon: ScrollText },
  { to: "/settings/rewards", label: "Rewards", icon: Trophy },
  { to: "/settings/bin", label: "Bin", icon: ArchiveRestore }
] as const;

function sectionMatches(pathname: string, to: string) {
  if (to === "/settings") {
    return pathname === "/settings";
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function SettingsSectionNav({ className }: { className?: string }) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeSection = useMemo(() => {
    return (
      [...SETTINGS_SECTIONS]
        .sort((a, b) => b.to.length - a.to.length)
        .find((s) => sectionMatches(location.pathname, s.to)) ??
      SETTINGS_SECTIONS[0]
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
            {SETTINGS_SECTIONS.map((section) => (
              <NavLink
                key={section.to}
                to={section.to}
                end={section.to === "/settings"}
                className={({ isActive }) =>
                  cn(
                    "inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition",
                    isActive || sectionMatches(location.pathname, section.to)
                      ? "bg-[var(--primary)]/[0.18] text-[var(--primary)]"
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
            className="inline-flex min-w-0 flex-1 items-center justify-between gap-3 rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(19,28,42,0.96),rgba(11,17,30,0.94))] px-3.5 py-2.5 text-left shadow-[0_18px_38px_rgba(3,8,18,0.2)] transition hover:border-white/12 hover:bg-[linear-gradient(180deg,rgba(24,34,50,0.98),rgba(12,19,34,0.96))]"
            onClick={() => setMobileOpen(true)}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-[var(--primary)]/20 bg-[var(--primary)]/12">
                <activeSection.icon className="size-4 text-[var(--primary)]" />
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] uppercase tracking-[0.18em] text-white/40">
                  Settings section
                </span>
                <span className="mt-0.5 block truncate text-sm font-medium text-white">
                  {activeSection.label}
                </span>
              </span>
            </span>
            <span className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-white/48">
              Browse
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
                aria-label="Close settings sections"
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
                  aria-label="Settings sections"
                  className="pointer-events-auto flex max-h-[min(34rem,calc(100dvh-var(--forge-mobile-nav-clearance)-1rem))] w-full max-w-xl min-h-0 flex-col overflow-hidden rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.12),transparent_40%),linear-gradient(180deg,rgba(18,27,42,0.98),rgba(10,15,28,0.98))] shadow-[0_36px_110px_rgba(3,8,18,0.5)]"
                >
                  <div className="shrink-0 border-b border-white/8 px-4 pb-3 pt-4 sm:px-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-label text-[10px] uppercase tracking-[0.22em] text-white/38">
                          Settings
                        </div>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                          <div className="truncate text-base font-semibold text-white">
                            Tune Forge
                          </div>
                          <span className="rounded-full border border-[var(--primary)]/20 bg-[var(--primary)]/12 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-[var(--primary)]">
                            {activeSection.label}
                          </span>
                        </div>
                        <div className="mt-1 text-xs leading-5 text-white/55">
                          Jump between users, calendar, models, rewards, and
                          more.
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label="Close settings sections"
                        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.05] text-white/65 transition hover:border-white/12 hover:bg-white/[0.09] hover:text-white"
                        onClick={() => setMobileOpen(false)}
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  </div>

                  <div className="min-h-0 overflow-y-auto p-3 overscroll-contain sm:p-4">
                    <div className="grid gap-2">
                      {SETTINGS_SECTIONS.map((section) => {
                        const isActive = sectionMatches(
                          location.pathname,
                          section.to
                        );

                        return (
                          <NavLink
                            key={section.to}
                            to={section.to}
                            end={section.to === "/settings"}
                            onClick={() => setMobileOpen(false)}
                            className={cn(
                              "group flex items-center justify-between gap-3 rounded-[22px] border px-3.5 py-3 transition-[transform,border-color,background-color,color] duration-150 hover:-translate-y-[1px] hover:text-white",
                              isActive
                                ? "border-[var(--primary)]/18 bg-[var(--primary)]/12 text-white"
                                : "border-white/8 bg-white/[0.04] text-white/72 hover:border-white/12 hover:bg-white/[0.06]"
                            )}
                          >
                            <span className="flex min-w-0 items-center gap-3">
                              <span
                                className={cn(
                                  "flex size-10 shrink-0 items-center justify-center rounded-2xl border transition",
                                  isActive
                                    ? "border-[var(--primary)]/18 bg-[var(--primary)]/14 text-[var(--primary)]"
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
                                  Forge settings
                                </span>
                              </span>
                            </span>
                            <span
                              className={cn(
                                "rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.16em]",
                                isActive
                                  ? "bg-[var(--primary)]/16 text-[var(--primary)]"
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
