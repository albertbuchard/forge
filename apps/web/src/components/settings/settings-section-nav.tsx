import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from "react";
import {
  ArchiveRestore,
  BookCopy,
  Bot,
  CalendarDays,
  ChevronRight,
  Cpu,
  Database,
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
import { prefetchRouteModule } from "@/routes/route-prefetch";

export const SETTINGS_SECTIONS = [
  {
    to: "/settings",
    label: "Runtime",
    description:
      "Operator session, execution policy, appearance, locale, and Doctor checks.",
    icon: Settings2
  },
  {
    to: "/settings/data",
    label: "Data",
    description: "Active data root, backups, exports, and recovery candidates.",
    icon: Database
  },
  {
    to: "/settings/users",
    label: "Users",
    description: "Human and bot identities, ownership, and directional access.",
    icon: Users
  },
  {
    to: "/settings/calendar",
    label: "Calendar",
    description: "Provider connections, calendar selection, and sync defaults.",
    icon: CalendarDays
  },
  {
    to: "/settings/mobile",
    label: "Mobile",
    description: "iPhone and watch pairing, permissions, sync, and recovery.",
    icon: Smartphone
  },
  {
    to: "/settings/models",
    label: "Models",
    description: "Model providers, credentials, defaults, and health checks.",
    icon: Cpu
  },
  {
    to: "/settings/agents",
    label: "Agents",
    description: "Agent identities, sessions, scopes, tokens, and approvals.",
    icon: Bot
  },
  {
    to: "/settings/rewards",
    label: "Rewards",
    description: "Progression rules, assets, and reward controls.",
    icon: Trophy
  },
  {
    to: "/settings/wiki",
    label: "KarpaWiki",
    description: "Wiki spaces, index health, ingest behavior, and reindexing.",
    icon: BookCopy
  },
  {
    to: "/settings/logs",
    label: "Logs",
    description: "Bounded runtime diagnostics and recovery evidence.",
    icon: ScrollText
  },
  {
    to: "/settings/bin",
    label: "Bin",
    description: "Soft-deleted records available for deliberate recovery.",
    icon: ArchiveRestore
  }
] as const;

type SettingsRouteFocusRequest = {
  pathname: string;
  target: "desktop-link" | "mobile-trigger";
};

let pendingSettingsRouteFocus: SettingsRouteFocusRequest | null = null;

function sectionMatches(pathname: string, to: string) {
  if (to === "/settings") {
    return pathname === "/settings";
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function SettingsStateFrame({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto grid w-full max-w-[1220px] gap-5", className)}>
      <SettingsSectionNav />
      {children}
    </div>
  );
}

export function SettingsSectionNav({ className }: { className?: string }) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const desktopLinkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileDialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const isSettingsIndex = location.pathname === "/settings";
  const activeSection = useMemo(() => {
    return (
      [...SETTINGS_SECTIONS]
        .sort((a, b) => b.to.length - a.to.length)
        .find((s) => sectionMatches(location.pathname, s.to)) ??
      SETTINGS_SECTIONS[0]
    );
  }, [location.pathname]);

  useEffect(() => {
    setMobileOpen(false);
    const focusRequest = pendingSettingsRouteFocus;
    if (!focusRequest || focusRequest.pathname !== location.pathname) {
      return undefined;
    }

    pendingSettingsRouteFocus = null;
    const focusTimer = window.setTimeout(() => {
      if (focusRequest.target === "mobile-trigger") {
        mobileTriggerRef.current?.focus();
      } else {
        desktopLinkRefs.current[focusRequest.pathname]?.focus();
      }
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [location.pathname]);

  const prepareRouteFocus = (
    event: ReactMouseEvent<HTMLAnchorElement>,
    pathname: string,
    target: SettingsRouteFocusRequest["target"]
  ) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    if (pathname === location.pathname) {
      pendingSettingsRouteFocus = null;
      window.setTimeout(() => {
        if (target === "mobile-trigger") {
          mobileTriggerRef.current?.focus();
        } else {
          desktopLinkRefs.current[pathname]?.focus();
        }
      }, 0);
      return;
    }

    pendingSettingsRouteFocus = { pathname, target };
  };

  useEffect(() => {
    if (!mobileOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    const previousTouchAction = document.body.style.touchAction;
    const fallbackTrigger = mobileTriggerRef.current;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const focusableSelector =
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusTimer = window.setTimeout(() => {
      const firstControl =
        mobileDialogRef.current?.querySelector<HTMLElement>(focusableSelector);
      (firstControl ?? mobileDialogRef.current)?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        return;
      }

      if (event.key !== "Tab" || !mobileDialogRef.current) {
        return;
      }

      const controls = Array.from(
        mobileDialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)
      ).filter((element) => element.getAttribute("aria-hidden") !== "true");
      if (controls.length === 0) {
        event.preventDefault();
        mobileDialogRef.current.focus();
        return;
      }

      const firstControl = controls[0];
      const lastControl = controls[controls.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && activeElement === firstControl) {
        event.preventDefault();
        lastControl.focus();
      } else if (!event.shiftKey && activeElement === lastControl) {
        event.preventDefault();
        firstControl.focus();
      } else if (!mobileDialogRef.current.contains(activeElement)) {
        event.preventDefault();
        firstControl.focus();
      }
    };

    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.body.style.touchAction = previousTouchAction;
      window.removeEventListener("keydown", handleKeyDown);

      const previousFocus = previousFocusRef.current;
      if (pendingSettingsRouteFocus?.target === "mobile-trigger") {
        return;
      }
      window.setTimeout(() => {
        if (previousFocus?.isConnected && previousFocus !== document.body) {
          previousFocus.focus();
        } else {
          fallbackTrigger?.focus();
        }
      }, 0);
    };
  }, [mobileOpen]);

  return (
    <>
      <Card
        className={cn("surface-shell-panel overflow-hidden p-2", className)}
      >
        <nav aria-label="Settings sections" className="hidden lg:block">
          <div
            className={cn(
              "gap-2",
              isSettingsIndex
                ? "grid lg:grid-cols-2 xl:grid-cols-3"
                : "flex flex-wrap"
            )}
          >
            {SETTINGS_SECTIONS.map((section) => {
              const isActive = sectionMatches(location.pathname, section.to);
              const labelId = `settings-desktop-${section.label.toLowerCase()}-label`;
              const descriptionId = `settings-desktop-${section.label.toLowerCase()}-description`;

              return (
                <NavLink
                  key={section.to}
                  ref={(node) => {
                    desktopLinkRefs.current[section.to] = node;
                  }}
                  to={section.to}
                  end={section.to === "/settings"}
                  title={isSettingsIndex ? undefined : section.description}
                  aria-labelledby={labelId}
                  aria-describedby={isSettingsIndex ? descriptionId : undefined}
                  aria-current={isActive ? "page" : undefined}
                  onPointerEnter={() => void prefetchRouteModule(section.to)}
                  onFocus={() => void prefetchRouteModule(section.to)}
                  onTouchStart={() => void prefetchRouteModule(section.to)}
                  onClick={(event) =>
                    prepareRouteFocus(event, section.to, "desktop-link")
                  }
                  className={cn(
                    "group transition",
                    isSettingsIndex
                      ? "flex min-h-[88px] min-w-0 items-center gap-3 rounded-[18px] border px-3 py-3 text-left"
                      : "inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]",
                    isActive
                      ? "border-[var(--primary)]/14 bg-[var(--ui-accent-soft)] text-[var(--primary)]"
                      : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                  )}
                >
                  {isSettingsIndex ? (
                    <>
                      <span
                        className={cn(
                          "flex size-10 shrink-0 items-center justify-center rounded-[14px] border transition",
                          isActive
                            ? "border-[var(--primary)]/18 bg-[var(--primary)]/14 text-[var(--primary)]"
                            : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)] group-hover:border-[var(--ui-border-strong)] group-hover:text-[var(--ui-ink-strong)]"
                        )}
                      >
                        <section.icon className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          id={labelId}
                          className="block text-sm font-semibold text-[var(--ui-ink-strong)]"
                        >
                          {section.label}
                        </span>
                        <span
                          id={descriptionId}
                          className="mt-0.5 block text-xs leading-5 text-[var(--ui-ink-faint)]"
                        >
                          {section.description}
                        </span>
                      </span>
                      <ChevronRight
                        className="size-4 shrink-0 text-[var(--ui-ink-faint)] transition group-hover:translate-x-0.5 group-hover:text-[var(--ui-ink-strong)]"
                        aria-hidden="true"
                      />
                    </>
                  ) : (
                    <>
                      <section.icon className="size-3.5" aria-hidden="true" />
                      <span id={labelId}>{section.label}</span>
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        </nav>

        <div className="flex items-center justify-between gap-3 lg:hidden">
          <button
            ref={mobileTriggerRef}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={mobileOpen}
            aria-controls="settings-section-dialog"
            className="surface-shell-panel inline-flex min-w-0 flex-1 items-center justify-between gap-3 rounded-[22px] border px-3.5 py-2.5 text-left transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
            onClick={() => setMobileOpen(true)}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-[var(--primary)]/20 bg-[var(--primary)]/12">
                <activeSection.icon
                  className="size-4 text-[var(--primary)]"
                  aria-hidden="true"
                />
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                  Settings section
                </span>
                <span className="mt-0.5 block truncate text-sm font-medium text-[var(--ui-ink-strong)]">
                  {activeSection.label}
                </span>
              </span>
            </span>
            <span className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
              Browse
            </span>
          </button>
        </div>
      </Card>

      {mobileOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="lg:hidden">
              <div className="surface-overlay fixed inset-0 z-50 backdrop-blur-xl" />
              <div
                aria-hidden="true"
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
                  id="settings-section-dialog"
                  ref={mobileDialogRef}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Settings sections"
                  tabIndex={-1}
                  className="surface-modal-panel pointer-events-auto flex max-h-[min(34rem,calc(100dvh-var(--forge-mobile-nav-clearance)-1rem))] w-full max-w-xl min-h-0 flex-col overflow-hidden rounded-[30px] border"
                >
                  <div className="shrink-0 border-b border-[var(--ui-border-subtle)] px-4 pb-3 pt-4 sm:px-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-label text-[10px] uppercase tracking-[0.22em] text-[var(--ui-ink-faint)]">
                          Settings
                        </div>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                          <div className="truncate text-base font-semibold text-[var(--ui-ink-strong)]">
                            Tune Forge
                          </div>
                          <span className="rounded-full border border-[var(--primary)]/20 bg-[var(--primary)]/12 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-[var(--primary)]">
                            {activeSection.label}
                          </span>
                        </div>
                        <div className="mt-1 text-xs leading-5 text-[var(--ui-ink-soft)]">
                          Every operator control stays reachable from this
                          index.
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label="Close settings sections"
                        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                        onClick={() => setMobileOpen(false)}
                      >
                        <X className="size-4" aria-hidden="true" />
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
                            aria-label={section.label}
                            aria-describedby={`settings-mobile-${section.label.toLowerCase()}-description`}
                            aria-current={isActive ? "page" : undefined}
                            onPointerEnter={() =>
                              void prefetchRouteModule(section.to)
                            }
                            onFocus={() => void prefetchRouteModule(section.to)}
                            onTouchStart={() =>
                              void prefetchRouteModule(section.to)
                            }
                            onClick={(event) => {
                              prepareRouteFocus(
                                event,
                                section.to,
                                "mobile-trigger"
                              );
                              setMobileOpen(false);
                            }}
                            className={cn(
                              "group flex items-center justify-between gap-3 rounded-[22px] border px-3.5 py-3 transition-[transform,border-color,background-color,color] duration-150 hover:-translate-y-[1px] hover:text-[var(--ui-ink-strong)]",
                              isActive
                                ? "border-[var(--primary)]/18 bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)]"
                                : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)] hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
                            )}
                          >
                            <span className="flex min-w-0 items-center gap-3">
                              <span
                                className={cn(
                                  "flex size-10 shrink-0 items-center justify-center rounded-2xl border transition",
                                  isActive
                                    ? "border-[var(--primary)]/18 bg-[var(--primary)]/14 text-[var(--primary)]"
                                    : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] group-hover:border-[var(--ui-border-strong)] group-hover:text-[var(--ui-ink-strong)]"
                                )}
                              >
                                <section.icon
                                  className="size-4"
                                  aria-hidden="true"
                                />
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-[var(--ui-ink-strong)]">
                                  {section.label}
                                </span>
                                <span
                                  id={`settings-mobile-${section.label.toLowerCase()}-description`}
                                  className="mt-0.5 block text-xs leading-5 text-[var(--ui-ink-faint)]"
                                >
                                  {section.description}
                                </span>
                              </span>
                            </span>
                            <span
                              className={cn(
                                "rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.16em]",
                                isActive
                                  ? "bg-[var(--primary)]/16 text-[var(--primary)]"
                                  : "bg-[var(--ui-surface-1)] text-[var(--ui-ink-faint)]"
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
