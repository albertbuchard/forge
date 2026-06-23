import { useEffect, useMemo, useState } from "react";
import { FolderKanban, Layers3, Network, X } from "lucide-react";
import { createPortal } from "react-dom";
import { NavLink, useLocation } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const PROJECT_MANAGEMENT_SECTIONS = [
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/kanban", label: "Board", icon: Layers3 },
  { to: "/projects/hierarchy", label: "Hierarchy", icon: Network }
] as const;

function sectionMatches(pathname: string, to: string) {
  if (to === "/projects") {
    return pathname === "/projects" || /^\/projects\/[^/]+$/.test(pathname);
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function ProjectManagementSectionNav({
  className
}: {
  className?: string;
}) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeSection = useMemo(() => {
    return (
      [...PROJECT_MANAGEMENT_SECTIONS]
        .sort((left, right) => right.to.length - left.to.length)
        .find((section) => sectionMatches(location.pathname, section.to)) ??
      PROJECT_MANAGEMENT_SECTIONS[0]
    );
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) {
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileOpen]);

  return (
    <>
      <Card
        className={cn(
          "overflow-hidden bg-[var(--card-gradient)] p-2",
          className
        )}
      >
        <div className="hidden items-center gap-3 lg:flex">
          <div className="flex flex-wrap gap-2">
            {PROJECT_MANAGEMENT_SECTIONS.map((section) => (
              <NavLink
                key={section.to}
                to={section.to}
                end={section.to === "/projects"}
                className={({ isActive }) =>
                  cn(
                    "inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition",
                    isActive || sectionMatches(location.pathname, section.to)
                      ? "border border-[color-mix(in_srgb,var(--info)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_76%,var(--ui-ink-strong)_24%)]"
                      : "border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
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
              <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-[color-mix(in_srgb,var(--info)_24%,var(--ui-border-subtle)_76%)] bg-[var(--ui-info-soft)]">
                <activeSection.icon className="size-4 text-[color-mix(in_srgb,var(--info)_76%,var(--ui-ink-strong)_24%)]" />
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                  Project management
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
              <div className="surface-overlay fixed inset-0 z-50 backdrop-blur-xl" />
              <button
                type="button"
                aria-label="Close project management sections"
                className="fixed inset-0 z-[51]"
                onClick={() => setMobileOpen(false)}
              />
              <div
                className="pointer-events-none fixed inset-0 z-[52] flex items-end justify-center px-3 pt-3 sm:px-4 sm:pt-4"
                style={{
                  paddingBottom:
                    "calc(var(--forge-mobile-nav-clearance) - 0.25rem)"
                }}
              >
                <div className="surface-modal-panel pointer-events-auto flex max-h-[min(34rem,calc(100dvh-var(--forge-mobile-nav-clearance)-1rem))] w-full max-w-xl min-h-0 flex-col overflow-hidden rounded-[30px] border shadow-[var(--ui-shadow-strong)]">
                  <div className="shrink-0 border-b border-[var(--ui-border-subtle)] px-4 pb-2.5 pt-3 sm:px-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-label text-[10px] uppercase tracking-[0.22em] text-[var(--ui-ink-muted)]">
                          Forge PM
                        </div>
                        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
                          <div className="truncate text-[1.05rem] font-semibold text-[var(--ui-ink-strong)]">
                            Browse the hierarchy
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label="Close project management sections"
                        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                        onClick={() => setMobileOpen(false)}
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  </div>
                  <div className="min-h-0 overflow-y-auto p-3 overscroll-contain sm:p-4">
                    <div className="grid gap-2">
                      {PROJECT_MANAGEMENT_SECTIONS.map((section) => {
                        const isActive = sectionMatches(
                          location.pathname,
                          section.to
                        );
                        return (
                          <NavLink
                            key={section.to}
                            to={section.to}
                            end={section.to === "/projects"}
                            onClick={() => setMobileOpen(false)}
                            className={cn(
                              "group flex items-center justify-between gap-3 rounded-[22px] border px-3.5 py-3 transition hover:-translate-y-[1px] hover:text-[var(--ui-ink-strong)]",
                              isActive
                                ? "border-[color-mix(in_srgb,var(--info)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_76%,var(--ui-ink-strong)_24%)]"
                                : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)] hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
                            )}
                          >
                            <span className="flex items-center gap-3">
                              <span className="flex size-10 items-center justify-center rounded-2xl border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)]">
                                <section.icon className="size-4" />
                              </span>
                              <span className="text-sm font-medium">
                                {section.label}
                              </span>
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
