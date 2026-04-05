import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BookCopy, BrainCircuit, BriefcaseBusiness, CalendarDays, Clock3, GitBranch, LayoutDashboard, NotebookPen, Repeat, Search, Settings, SlidersHorizontal, Target, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { EntityName } from "@/components/ui/entity-name";
import { Input } from "@/components/ui/input";
import { formatUserSummaryLine } from "@/lib/user-ownership";
import { useI18n } from "@/lib/i18n";
import type { EntityKind } from "@/lib/entity-visuals";
import type { ForgeSnapshot } from "@/lib/types";

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: ForgeSnapshot;
};

type CommandItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  category: string;
  kind?: EntityKind;
};

export function CommandPalette({ open, onOpenChange, snapshot }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  const items = useMemo<CommandItem[]>(() => {
    const coreRoutes: CommandItem[] = [
      { id: "route-overview", title: t("common.routeLabels.overview"), detail: t("common.commandPalette.routeOverview"), href: "/overview", category: t("common.commandPalette.categoryRoute") },
      { id: "route-today", title: t("common.routeLabels.today"), detail: t("common.commandPalette.routeToday"), href: "/today", category: t("common.commandPalette.categoryRoute") },
      { id: "route-kanban", title: t("common.routeLabels.kanban"), detail: t("common.commandPalette.routeKanban"), href: "/kanban", category: t("common.commandPalette.categoryRoute") },
      { id: "route-psyche", title: t("common.routeLabels.psyche"), detail: t("common.commandPalette.routePsyche"), href: "/psyche", category: t("common.commandPalette.categoryRoute") },
      { id: "route-notes", title: t("common.routeLabels.notes"), detail: t("common.commandPalette.routeNotes"), href: "/notes", category: t("common.commandPalette.categoryRoute") },
      { id: "route-wiki", title: t("common.routeLabels.wiki"), detail: t("common.commandPalette.routeWiki"), href: "/wiki", category: t("common.commandPalette.categoryRoute") },
      { id: "route-goals", title: t("common.routeLabels.goals"), detail: t("common.commandPalette.routeGoals"), href: "/goals", category: t("common.commandPalette.categoryRoute") },
      { id: "route-habits", title: t("common.routeLabels.habits"), detail: t("common.commandPalette.routeHabits"), href: "/habits", category: t("common.commandPalette.categoryRoute") },
      { id: "route-projects", title: t("common.routeLabels.projects"), detail: t("common.commandPalette.routeProjects"), href: "/projects", category: t("common.commandPalette.categoryRoute") },
      { id: "route-strategies", title: t("common.routeLabels.strategies"), detail: t("common.commandPalette.routeStrategies"), href: "/strategies", category: t("common.commandPalette.categoryRoute") },
      { id: "route-preferences", title: t("common.routeLabels.preferences"), detail: t("common.commandPalette.routePreferences"), href: "/preferences", category: t("common.commandPalette.categoryRoute") },
      { id: "route-calendar", title: t("common.routeLabels.calendar"), detail: t("common.commandPalette.routeCalendar"), href: "/calendar", category: t("common.commandPalette.categoryRoute") },
      { id: "route-review", title: t("common.routeLabels.review"), detail: t("common.commandPalette.routeReview"), href: "/review/weekly", category: t("common.commandPalette.categoryRoute") },
      { id: "route-settings", title: t("common.routeLabels.settings"), detail: t("common.commandPalette.routeSettings"), href: "/settings", category: t("common.commandPalette.categoryRoute") }
    ];

    return [
      ...coreRoutes,
      ...snapshot.dashboard.goals.slice(0, 6).map((goal) => ({
        id: `goal-${goal.id}`,
        title: goal.title,
        detail:
          formatUserSummaryLine(goal.user) || t("common.commandPalette.openLifeGoal"),
        href: `/goals/${goal.id}`,
        category: t("common.commandPalette.categoryGoal"),
        kind: "goal" as const
      })),
      ...snapshot.dashboard.projects.slice(0, 6).map((project) => ({
        id: `project-${project.id}`,
        title: project.title,
        detail: [project.goalTitle, formatUserSummaryLine(project.user)]
          .filter(Boolean)
          .join(" · "),
        href: `/projects/${project.id}`,
        category: t("common.commandPalette.categoryProject"),
        kind: "project" as const
      })),
      ...snapshot.strategies.slice(0, 6).map((strategy) => ({
        id: `strategy-${strategy.id}`,
        title: strategy.title,
        detail: [
          `Alignment ${strategy.metrics.alignmentScore}%`,
          formatUserSummaryLine(strategy.user)
        ]
          .filter(Boolean)
          .join(" · "),
        href: `/strategies/${strategy.id}`,
        category: "Strategy",
        kind: "strategy" as const
      })),
      ...snapshot.overview.topTasks.slice(0, 8).map((task) => ({
        id: `task-${task.id}`,
        title: task.title,
        detail:
          formatUserSummaryLine(task.user) || t("common.commandPalette.openFocusTask"),
        href: `/tasks/${task.id}`,
        category: t("common.commandPalette.categoryTask"),
        kind: "task" as const
      }))
    ];
  }, [snapshot, t]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return items.slice(0, 12);
    }
    return items.filter((item) => `${item.title} ${item.detail} ${item.category}`.toLowerCase().includes(normalized)).slice(0, 12);
  }, [items, query]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgba(5,10,18,0.68)] backdrop-blur-xl" />
        <Dialog.Content className="fixed inset-x-4 top-[12vh] z-50 mx-auto max-w-2xl overflow-hidden rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(20,28,42,0.98),rgba(12,17,30,0.98))] shadow-[0_32px_90px_rgba(3,8,18,0.45)]">
          <div className="border-b border-white/8 p-4">
            <div className="flex items-center gap-3 rounded-[22px] bg-white/[0.04] px-4 py-3">
              <Search className="size-4 text-white/42" />
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("common.commandPalette.searchPlaceholder")}
                className="border-0 bg-transparent px-0 py-0 focus:border-0"
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-white/50">
              {[
                { label: t("common.routeLabels.overview"), icon: LayoutDashboard },
                { label: t("common.routeLabels.today"), icon: Clock3 },
                { label: t("common.routeLabels.kanban"), icon: Zap },
                { label: t("common.routeLabels.notes"), icon: NotebookPen },
                { label: t("common.routeLabels.wiki"), icon: BookCopy },
                { label: t("common.routeLabels.psyche"), icon: BrainCircuit },
                { label: t("common.routeLabels.goals"), icon: Target },
                { label: t("common.routeLabels.habits"), icon: Repeat },
                { label: t("common.routeLabels.projects"), icon: BriefcaseBusiness },
                { label: t("common.routeLabels.strategies"), icon: GitBranch },
                { label: t("common.routeLabels.preferences"), icon: SlidersHorizontal },
                { label: t("common.routeLabels.calendar"), icon: CalendarDays },
                { label: t("common.routeLabels.settings"), icon: Settings }
              ].map((entry) => (
                <span key={entry.label} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white/[0.04] px-3 py-2 text-xs text-white/58">
                  <entry.icon className="size-3.5" />
                  {entry.label}
                </span>
              ))}
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-3">
            <div className="grid gap-2">
              {filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="interactive-tap rounded-[22px] bg-white/[0.04] px-4 py-3 text-left transition hover:bg-white/[0.07]"
                  onClick={() => {
                    onOpenChange(false);
                    navigate(item.href);
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm text-white/46">{item.category}</div>
                      <div className="mt-1 type-title-md text-white">
                        {item.kind ? <EntityName kind={item.kind} label={item.title} /> : item.title}
                      </div>
                      <div className="mt-1 text-sm text-white/58">{item.detail}</div>
                    </div>
                    <ArrowRight className="size-4 text-white/35" />
                  </div>
                </button>
              ))}
              {filtered.length === 0 ? <div className="rounded-[22px] bg-white/[0.04] px-4 py-5 text-sm text-white/56">{t("common.commandPalette.noResults")}</div> : null}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
