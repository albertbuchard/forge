import { useMemo, useState } from "react";
import { ArchiveRestore, BookCopy, Bot, CalendarDays, Settings2, Smartphone, Trophy, Users } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const SETTINGS_SECTIONS = [
  { to: "/settings", label: "General", icon: Settings2 },
  { to: "/settings/users", label: "Users", icon: Users },
  { to: "/settings/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/settings/mobile", label: "Mobile", icon: Smartphone },
  { to: "/settings/agents", label: "Agents", icon: Bot },
  { to: "/settings/wiki", label: "Wiki", icon: BookCopy },
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
        .find((s) => sectionMatches(location.pathname, s.to)) ?? SETTINGS_SECTIONS[0]
    );
  }, [location.pathname]);

  return (
    <>
      <Card className={cn("overflow-hidden bg-[linear-gradient(180deg,rgba(15,24,31,0.94),rgba(10,18,25,0.92))] p-2", className)}>
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
            className="inline-flex min-w-0 flex-1 items-center justify-between rounded-full bg-white/[0.06] px-4 py-3 text-left"
            onClick={() => setMobileOpen(true)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <activeSection.icon className="size-4 shrink-0 text-[var(--primary)]" />
              <span className="truncate text-sm font-medium text-white">{activeSection.label}</span>
            </span>
            <span className="text-[10px] uppercase tracking-[0.16em] text-white/42">Switch</span>
          </button>
        </div>
      </Card>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 bg-[rgba(5,10,18,0.86)] px-4 py-5 backdrop-blur-xl lg:hidden">
          <div className="mx-auto flex h-full max-w-xl flex-col rounded-[32px] bg-[linear-gradient(180deg,rgba(16,25,33,0.98),rgba(11,18,25,0.98))] p-5 shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/38">Settings</div>
                <div className="mt-2 font-display text-3xl text-white">Navigate to section</div>
              </div>
              <Button variant="secondary" onClick={() => setMobileOpen(false)}>
                Close
              </Button>
            </div>

            <div className="mt-6 grid gap-3 overflow-y-auto">
              {SETTINGS_SECTIONS.map((section) => (
                <NavLink
                  key={section.to}
                  to={section.to}
                  end={section.to === "/settings"}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center justify-between rounded-[24px] px-4 py-4 transition",
                    sectionMatches(location.pathname, section.to)
                      ? "bg-[var(--primary)]/[0.14] text-white"
                      : "bg-white/[0.04] text-white/70"
                  )}
                >
                  <span className="flex items-center gap-3">
                    <section.icon className="size-4 text-[var(--primary)]" />
                    <span className="text-base font-medium">{section.label}</span>
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.16em] text-white/36">Open</span>
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
