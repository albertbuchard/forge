import * as Dialog from "@radix-ui/react-dialog";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Sparkles, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { GoalDialog } from "@/components/goal-dialog";
import { ProjectDialog } from "@/components/project-dialog";
import { TaskDialog } from "@/components/task-dialog";
import { Button } from "@/components/ui/button";
import { EntityBadge } from "@/components/ui/entity-badge";
import { useI18n } from "@/lib/i18n";
import type { EntityKind } from "@/lib/entity-visuals";
import type {
  GoalMutationInput,
  ProjectMutationInput,
  QuickTaskInput
} from "@/lib/schemas";
import type {
  DashboardGoal,
  Goal,
  ProjectSummary,
  Tag,
  UserSummary
} from "@/lib/types";

const MOBILE_BREAKPOINT_QUERY = "(max-width: 1023px)";
const CREATE_ACTION_GROUPS = ["Execution", "Psyche", "Knowledge"] as const;

export type ForgeCreateActionId =
  | "goal"
  | "project"
  | "task"
  | "strategy"
  | "habit"
  | "psyche_value"
  | "behavior_pattern"
  | "behavior"
  | "trigger_report"
  | "wiki_page";

export type ForgeCreateActionGroup = (typeof CREATE_ACTION_GROUPS)[number];

type ForgeCreateActionSpec = {
  id: ForgeCreateActionId;
  kind: EntityKind;
  group: ForgeCreateActionGroup;
  title: string;
  quickActionTitle: string;
  description: string;
  aliases: string[];
  filterIds: Array<
    | "goal"
    | "project"
    | "task"
    | "strategy"
    | "habit"
    | "psyche_value"
    | "behavior_pattern"
    | "behavior"
    | "trigger_report"
    | "wiki_page"
  >;
};

export type ForgeCreateAction = ForgeCreateActionSpec & {
  onSelect: () => void;
};

function useIsMobileCreateSheet() {
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
    const updateMatch = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };

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

function CreateActionButton({
  kind,
  title,
  description,
  onClick
}: {
  kind: EntityKind;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="w-full min-w-0 rounded-[22px] border border-white/8 bg-white/[0.04] px-4 py-4 text-left transition hover:bg-white/[0.08]"
      onClick={onClick}
    >
      <EntityBadge
        kind={kind}
        label={title}
        compact
        gradient={false}
        className="max-w-full"
      />
      <div className="mt-1 text-sm text-white/55">{description}</div>
    </button>
  );
}

function buildForgeCreateActionSpecs(
  t: ReturnType<typeof useI18n>["t"]
): ForgeCreateActionSpec[] {
  return [
    {
      id: "goal",
      kind: "goal",
      group: "Execution",
      title: t("common.navigation.newGoal"),
      quickActionTitle: "Create life goal",
      description: t("common.navigation.newGoalDescription"),
      aliases: ["goal", "life goal", "direction", "objective"],
      filterIds: ["goal"]
    },
    {
      id: "project",
      kind: "project",
      group: "Execution",
      title: t("common.navigation.newProject"),
      quickActionTitle: "Create project",
      description: t("common.navigation.newProjectDescription"),
      aliases: ["project", "initiative"],
      filterIds: ["project"]
    },
    {
      id: "task",
      kind: "task",
      group: "Execution",
      title: t("common.navigation.newTask"),
      quickActionTitle: "Create task",
      description: t("common.navigation.newTaskDescription"),
      aliases: ["task", "todo", "to-do", "action item"],
      filterIds: ["task"]
    },
    {
      id: "strategy",
      kind: "strategy",
      group: "Execution",
      title: "Strategy",
      quickActionTitle: "Create strategy",
      description:
        "Plan a directed path across projects and tasks toward a real end state.",
      aliases: ["strategy", "plan", "roadmap"],
      filterIds: ["strategy"]
    },
    {
      id: "habit",
      kind: "habit",
      group: "Execution",
      title: "Habit",
      quickActionTitle: "Create habit",
      description:
        "Track a recurring commitment or recurring slip with explicit XP logic.",
      aliases: ["habit", "routine", "recurring"],
      filterIds: ["habit"]
    },
    {
      id: "psyche_value",
      kind: "value",
      group: "Psyche",
      title: "Value",
      quickActionTitle: "Create value",
      description:
        "Place one value into the goal, project, and task constellation.",
      aliases: ["value", "psyche value", "principle"],
      filterIds: ["psyche_value"]
    },
    {
      id: "behavior_pattern",
      kind: "pattern",
      group: "Psyche",
      title: "Pattern",
      quickActionTitle: "Create pattern",
      description:
        "Map a loop, its payoff, its cost, and the response you want.",
      aliases: ["pattern", "loop", "behavior pattern", "psyche pattern"],
      filterIds: ["behavior_pattern"]
    },
    {
      id: "behavior",
      kind: "behavior",
      group: "Psyche",
      title: "Behavior",
      quickActionTitle: "Create behavior",
      description: "Describe the move first, then classify it and link it.",
      aliases: ["behavior", "psyche behavior", "behaviour"],
      filterIds: ["behavior"]
    },
    {
      id: "trigger_report",
      kind: "report",
      group: "Psyche",
      title: "Report",
      quickActionTitle: "Create report",
      description: "Start a Spark-to-Pivot reflective chain.",
      aliases: ["report", "trigger report", "psyche report"],
      filterIds: ["trigger_report"]
    },
    {
      id: "wiki_page",
      kind: "wiki_page",
      group: "Knowledge",
      title: "Wiki page",
      quickActionTitle: "Create wiki page",
      description:
        "Open a fresh KarpaWiki page draft in the current knowledge workspace.",
      aliases: ["wiki", "wiki page", "karpawiki", "page", "article"],
      filterIds: ["wiki_page"]
    }
  ];
}

export function useForgeCreateActions({
  goals,
  projects,
  tags,
  users,
  defaultUserId = null,
  onCreateGoal,
  onCreateProject,
  onCreateTask
}: {
  goals: DashboardGoal[];
  projects: ProjectSummary[];
  tags: Tag[];
  users?: UserSummary[];
  defaultUserId?: string | null;
  onCreateGoal: (input: GoalMutationInput) => Promise<void>;
  onCreateProject: (input: ProjectMutationInput) => Promise<void>;
  onCreateTask: (input: QuickTaskInput) => Promise<void>;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const safeGoals = goals ?? [];
  const safeProjects = projects ?? [];
  const safeTags = tags ?? [];
  const safeUsers = users ?? [];
  const [goalOpen, setGoalOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);

  const specs = useMemo(() => buildForgeCreateActionSpecs(t), [t]);

  const actions = useMemo<ForgeCreateAction[]>(
    () =>
      specs.map((spec) => ({
        ...spec,
        onSelect: () => {
          switch (spec.id) {
            case "goal":
              setGoalOpen(true);
              return;
            case "project":
              setProjectOpen(true);
              return;
            case "task":
              setTaskOpen(true);
              return;
            case "strategy":
              navigate("/strategies?create=1");
              return;
            case "habit":
              navigate("/habits?create=1");
              return;
            case "psyche_value":
              navigate("/psyche/values?create=1");
              return;
            case "behavior_pattern":
              navigate("/psyche/patterns?create=1");
              return;
            case "behavior":
              navigate("/psyche/behaviors?create=1");
              return;
            case "trigger_report":
              navigate("/psyche/reports?create=1");
              return;
            case "wiki_page":
              navigate("/wiki/new");
              return;
            default:
              return;
          }
        }
      })),
    [navigate, specs]
  );

  const dialogs: ReactNode = (
    <>
      <GoalDialog
        open={goalOpen}
        editingGoal={null}
        tags={safeTags}
        users={safeUsers}
        defaultUserId={defaultUserId}
        onOpenChange={setGoalOpen}
        onSubmit={async (input) => {
          await onCreateGoal(input);
        }}
      />

      <ProjectDialog
        open={projectOpen}
        goals={safeGoals as Goal[]}
        users={safeUsers}
        editingProject={null}
        defaultUserId={defaultUserId}
        onOpenChange={setProjectOpen}
        onSubmit={async (input) => {
          await onCreateProject(input);
        }}
      />

      <TaskDialog
        open={taskOpen}
        goals={safeGoals as Goal[]}
        projects={safeProjects}
        tags={safeTags}
        users={safeUsers}
        editingTask={null}
        defaultUserId={defaultUserId}
        onOpenChange={setTaskOpen}
        onSubmit={async (input) => {
          await onCreateTask(input);
        }}
      />
    </>
  );

  return {
    actions,
    dialogs
  };
}

export function CreateMenu({
  actions,
  className
}: {
  actions: ForgeCreateAction[];
  className?: string;
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [desktopMenuPosition, setDesktopMenuPosition] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const isMobile = useIsMobileCreateSheet();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const desktopMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen || isMobile) {
      return;
    }

    const syncDesktopMenuPosition = () => {
      const rect = menuRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      setDesktopMenuPosition({
        top: Math.max(24, rect.top - 18),
        right: Math.max(24, window.innerWidth - rect.right)
      });
    };

    syncDesktopMenuPosition();

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      if (desktopMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setMenuOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", syncDesktopMenuPosition);
    window.addEventListener("scroll", syncDesktopMenuPosition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", syncDesktopMenuPosition);
      window.removeEventListener("scroll", syncDesktopMenuPosition, true);
    };
  }, [isMobile, menuOpen]);

  return (
    <>
      <div
        ref={menuRef}
        className={className}
        style={
          isMobile
            ? {
                right: "max(1rem, calc(var(--forge-safe-area-right) + 1rem))",
                bottom: "var(--forge-mobile-create-bottom)"
              }
            : undefined
        }
      >
        <Button
          type="button"
          data-testid="create-floating-trigger"
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          onClick={() => setMenuOpen((current) => (isMobile ? true : !current))}
          className={`min-w-max max-w-[calc(100vw-2rem)] shrink-0 rounded-full px-3.5 py-2 text-[12px] shadow-[0_20px_60px_rgba(4,8,18,0.34)] ${menuOpen ? "bg-[linear-gradient(135deg,rgba(192,193,255,0.52),rgba(125,211,252,0.24))] text-white" : ""}`}
        >
          <Sparkles
            className={`size-4 transition ${menuOpen ? "text-white" : "text-white/72"}`}
          />
          {t("common.navigation.create")}
        </Button>
      </div>

      {menuOpen &&
      !isMobile &&
      typeof document !== "undefined" &&
      desktopMenuPosition
        ? createPortal(
            <div
              ref={desktopMenuRef}
              data-testid="create-desktop-menu"
              className="fixed z-50 w-[min(26rem,calc(100vw-2rem))] max-h-[min(34rem,calc(100vh-4rem))] overflow-y-auto rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,24,40,0.985),rgba(10,15,27,0.985))] p-4 shadow-[0_28px_90px_rgba(3,8,18,0.46)]"
              style={{
                top: `${desktopMenuPosition.top}px`,
                right: `${desktopMenuPosition.right}px`,
                transform: "translateY(-100%)"
              }}
            >
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                Create
              </div>
              <div className="mt-2 text-lg font-medium text-white">
                Start the next move
              </div>
              <div className="mt-1 text-sm leading-6 text-white/56">
                Pick one thing to create. The flow keeps the first step light
                and visible.
              </div>
              {CREATE_ACTION_GROUPS.map((group) => (
                <div key={group} className="mt-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">
                    {group}
                  </div>
                  <div className="mt-2 grid gap-2">
                    {actions
                      .filter((action) => action.group === group)
                      .map((action) => (
                        <CreateActionButton
                          key={action.id}
                          kind={action.kind}
                          title={action.title}
                          description={action.description}
                          onClick={() => {
                            setMenuOpen(false);
                            action.onSelect();
                          }}
                        />
                      ))}
                  </div>
                </div>
              ))}
            </div>,
            document.body
          )
        : null}

      <Dialog.Root open={menuOpen && isMobile} onOpenChange={setMenuOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgba(4,8,18,0.72)] backdrop-blur-xl lg:hidden" />
          <Dialog.Content
            data-testid="create-mobile-sheet"
            className="fixed inset-x-4 bottom-28 z-50 flex max-h-[min(30rem,calc(100vh-8rem))] flex-col overflow-hidden rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(24,31,50,0.98),rgba(15,21,36,0.98))] p-0 shadow-[0_30px_90px_rgba(3,8,18,0.45)] lg:hidden"
            style={{
              left: "max(1rem, calc(var(--forge-safe-area-left) + 1rem))",
              right: "max(1rem, calc(var(--forge-safe-area-right) + 1rem))",
              bottom: "calc(var(--forge-mobile-nav-clearance) - 0.5rem)"
            }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/8 px-5 py-5">
              <div>
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                  {t("common.navigation.create")}
                </div>
                <Dialog.Title className="mt-2 font-display text-2xl text-white">
                  {t("common.navigation.createTitle")}
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-sm leading-6 text-white/60">
                  {t("common.navigation.createDescription")}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label={t("common.navigation.closeCreateMenu")}
                  className="rounded-full bg-white/6 p-2 text-white/65 transition hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" />
                </button>
              </Dialog.Close>
            </div>
            <div className="overflow-y-auto p-4 overscroll-contain">
              {CREATE_ACTION_GROUPS.map((group) => (
                <div key={group} className="mt-1 grid gap-2 first:mt-0">
                  <div className="px-1 text-[11px] uppercase tracking-[0.18em] text-white/38">
                    {group}
                  </div>
                  {actions
                    .filter((action) => action.group === group)
                    .map((action) => (
                      <CreateActionButton
                        key={action.id}
                        kind={action.kind}
                        title={action.title}
                        description={action.description}
                        onClick={() => {
                          setMenuOpen(false);
                          action.onSelect();
                        }}
                      />
                    ))}
                </div>
              ))}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
