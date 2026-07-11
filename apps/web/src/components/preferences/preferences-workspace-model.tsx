import {
  Compass,
  History,
  Map,
  SlidersHorizontal,
  Sparkles,
  TableProperties
} from "lucide-react";

import type {
  CrudEntityType,
  ForgeSnapshot,
  PreferenceDimensionId,
  PreferenceDimensionSummary,
  PreferenceDomain,
  PreferenceItemScore,
  PreferenceItemStatus,
  PreferenceSignalType,
  PreferenceWorkspacePayload,
  UserSummary
} from "@/lib/types";
import { buildOwnedEntitySearchText } from "@/lib/user-ownership";
import { cn } from "@/lib/utils";

export const TABS = [
  { id: "overview", label: "Overview", icon: Compass },
  { id: "map", label: "Map", icon: Map },
  { id: "table", label: "Table", icon: TableProperties },
  { id: "history", label: "History", icon: History },
  { id: "contexts", label: "Contexts", icon: SlidersHorizontal },
  { id: "concepts", label: "Concepts", icon: Sparkles }
] as const;

export const FORGE_GAME_DOMAINS = new Set<PreferenceDomain>([
  "projects",
  "tasks",
  "strategies",
  "habits"
]);

export const DOMAIN_OPTIONS: Array<{
  value: PreferenceDomain;
  label: string;
  description: string;
  mode: "forge" | "concept";
}> = [
  {
    value: "projects",
    label: "Projects",
    description: "Goals and projects already living in Forge.",
    mode: "forge"
  },
  {
    value: "tasks",
    label: "Tasks",
    description: "Execution-level work choices inside Forge.",
    mode: "forge"
  },
  {
    value: "strategies",
    label: "Strategies",
    description: "Plan shapes and sequencing choices in Forge.",
    mode: "forge"
  },
  {
    value: "habits",
    label: "Habits",
    description: "Recurring behaviors and routines from Forge.",
    mode: "forge"
  },
  {
    value: "activities",
    label: "Activities",
    description: "Movement, leisure, and social setting concepts.",
    mode: "concept"
  },
  {
    value: "food",
    label: "Food",
    description: "Cuisine, meal mood, and drink preferences.",
    mode: "concept"
  },
  {
    value: "places",
    label: "Places",
    description: "Living environments, venues, and trip shapes.",
    mode: "concept"
  },
  {
    value: "countries",
    label: "Countries",
    description: "Country-level attraction and lifestyle fit.",
    mode: "concept"
  },
  {
    value: "fashion",
    label: "Fashion",
    description: "Silhouette, material, and palette preferences.",
    mode: "concept"
  },
  {
    value: "people",
    label: "People",
    description: "Presence, body-type, and conversation preferences.",
    mode: "concept"
  },
  {
    value: "media",
    label: "Media",
    description: "Film, reading, and music taste.",
    mode: "concept"
  },
  {
    value: "tools",
    label: "Tools",
    description: "Workflow and capture preferences.",
    mode: "concept"
  },
  {
    value: "custom",
    label: "Custom",
    description: "General-purpose concept libraries you control.",
    mode: "concept"
  }
];

export const DIMENSION_LABELS: Record<PreferenceDimensionId, string> = {
  novelty: "Novelty",
  simplicity: "Simplicity",
  rigor: "Rigor",
  aesthetics: "Aesthetics",
  depth: "Depth",
  structure: "Structure",
  familiarity: "Familiarity",
  surprise: "Surprise"
};

export const DEFAULT_DIMENSIONS: Record<PreferenceDimensionId, number> = {
  novelty: 0,
  simplicity: 0,
  rigor: 0,
  aesthetics: 0,
  depth: 0,
  structure: 0,
  familiarity: 0,
  surprise: 0
};

export const STATUS_CLASSES: Record<PreferenceItemStatus, string> = {
  liked: "bg-[var(--ui-success-soft)] text-[var(--success)]",
  disliked: "bg-[var(--ui-danger-soft)] text-[var(--danger)]",
  uncertain: "bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]",
  vetoed: "bg-[var(--ui-danger-soft)] text-[var(--danger)]",
  bookmarked: "bg-[var(--ui-info-soft)] text-[var(--info)]",
  favorite: "bg-[var(--ui-warning-soft)] text-[var(--warning)]",
  must_have: "bg-[var(--ui-accent-soft)] text-[var(--primary)]",
  neutral: "bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]"
};

export const SIGNAL_OPTIONS: Array<{
  signalType: PreferenceSignalType;
  label: string;
}> = [
  { signalType: "favorite", label: "Favorite" },
  { signalType: "must_have", label: "Must-have" },
  { signalType: "bookmark", label: "Bookmark" },
  { signalType: "compare_later", label: "Later" },
  { signalType: "neutral", label: "Neutral" },
  { signalType: "veto", label: "Veto" }
];

export const SIGNAL_MODEL_EFFECTS: Record<PreferenceSignalType, string> = {
  favorite: "Strong positive evidence; inferred status becomes favorite.",
  must_have: "Strongest positive evidence; inferred status becomes must-have.",
  bookmark: "Light positive evidence and a bookmarked inferred status.",
  compare_later: "Light positive evidence and priority for another comparison.",
  neutral: "Zero score weight; records an explicit neutral observation.",
  veto: "Strong negative evidence; inferred status becomes vetoed."
};

export type PreferencesTab = (typeof TABS)[number]["id"];

export type CandidateEntity = {
  entityType: CrudEntityType;
  entityId: string;
  domain: PreferenceDomain;
  label: string;
  description: string;
  user: UserSummary | null | undefined;
  searchText: string;
  href: string | null;
};

export function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

export function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function buildCandidateEntities(
  snapshot: ForgeSnapshot
): CandidateEntity[] {
  return [
    ...snapshot.goals.map((goal) => ({
      entityType: "goal" as const,
      entityId: goal.id,
      domain: "projects" as const,
      label: goal.title,
      description: goal.description,
      user: goal.user,
      href: `/goals/${goal.id}`,
      searchText: buildOwnedEntitySearchText(
        [goal.title, goal.description, goal.status, goal.horizon],
        goal
      )
    })),
    ...snapshot.dashboard.projects.map((project) => ({
      entityType: "project" as const,
      entityId: project.id,
      domain: "projects" as const,
      label: project.title,
      description: project.description,
      user: project.user,
      href: `/projects/${project.id}`,
      searchText: buildOwnedEntitySearchText(
        [project.title, project.description, project.status, project.goalTitle],
        project
      )
    })),
    ...snapshot.tasks.map((task) => ({
      entityType: "task" as const,
      entityId: task.id,
      domain: "tasks" as const,
      label: task.title,
      description: task.description,
      user: task.user,
      href: `/tasks/${task.id}`,
      searchText: buildOwnedEntitySearchText(
        [task.title, task.description, task.status, task.priority, task.owner],
        task
      )
    })),
    ...snapshot.strategies.map((strategy) => ({
      entityType: "strategy" as const,
      entityId: strategy.id,
      domain: "strategies" as const,
      label: strategy.title,
      description: strategy.overview || strategy.endStateDescription,
      user: strategy.user,
      href: `/strategies/${strategy.id}`,
      searchText: buildOwnedEntitySearchText(
        [
          strategy.title,
          strategy.overview,
          strategy.endStateDescription,
          strategy.status
        ],
        strategy
      )
    })),
    ...snapshot.habits.map((habit) => ({
      entityType: "habit" as const,
      entityId: habit.id,
      domain: "habits" as const,
      label: habit.title,
      description: habit.description,
      user: habit.user,
      href: null,
      searchText: buildOwnedEntitySearchText(
        [habit.title, habit.description, habit.status, habit.frequency],
        habit
      )
    }))
  ];
}

export function getSourceEntityHref(
  entityType: CrudEntityType | null | undefined,
  entityId: string | null | undefined
) {
  if (!entityType || !entityId) {
    return null;
  }
  if (entityType === "goal") {
    return `/goals/${entityId}`;
  }
  if (entityType === "project") {
    return `/projects/${entityId}`;
  }
  if (entityType === "task") {
    return `/tasks/${entityId}`;
  }
  if (entityType === "strategy") {
    return `/strategies/${entityId}`;
  }
  return null;
}

export function getScoreStatus(score: PreferenceItemScore) {
  return score.manualStatus ?? score.status;
}

export function resolveSelectedTab(searchValue: string | null): PreferencesTab {
  if (searchValue && TABS.some((tab) => tab.id === searchValue)) {
    return searchValue as PreferencesTab;
  }
  return "overview";
}

export function buildGameHeadline(workspace: PreferenceWorkspacePayload) {
  if (workspace.summary.totalItems < 2) {
    return {
      title: "Forge does not know enough yet.",
      description:
        "Start the game so Forge can ask a few clean comparisons and build a real preference model."
    };
  }
  if (workspace.summary.averageConfidence < 0.28) {
    return {
      title: "Forge has a rough sketch, not a stable read.",
      description:
        "There is some signal, but the model still needs more rounds before its preferences are trustworthy."
    };
  }
  return {
    title: "This is what Forge currently thinks.",
    description:
      "The summary below is the current best model for this user, this domain, and the active context."
  };
}

export function DimensionBar({
  summary
}: {
  summary: PreferenceDimensionSummary;
}) {
  const leaning = Math.max(-1, Math.min(1, summary.leaning));
  const offset = ((leaning + 1) / 2) * 100;
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-3 text-xs text-[var(--ui-ink-soft)]">
        <span>{DIMENSION_LABELS[summary.dimensionId]}</span>
        <span>
          {summary.movement > 0.08
            ? "Rising"
            : summary.movement < -0.08
              ? "Falling"
              : "Stable"}{" "}
          · {formatPercent(summary.confidence)}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-[var(--ui-surface-2)]">
        <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--ui-border-strong)]" />
        <div
          className={cn(
            "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--ui-border-strong)]",
            leaning >= 0 ? "bg-[var(--success)]" : "bg-[var(--danger)]"
          )}
          style={{ left: `${offset}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.12em] text-[var(--ui-ink-faint)]">
        <span>
          {leaning >= 0 ? "Leans toward" : "Leans away from"}{" "}
          {DIMENSION_LABELS[summary.dimensionId].toLowerCase()}
        </span>
        <span>Context {formatPercent(summary.contextSensitivity)}</span>
      </div>
    </div>
  );
}

export function ComparisonCard({
  title,
  description,
  sideLabel,
  disabled = false,
  onClick
}: {
  title: string;
  description: string;
  sideLabel: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="grid min-h-[220px] gap-4 rounded-[28px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] p-5 text-left transition hover:border-[color-mix(in_srgb,var(--primary)_40%,transparent)] hover:bg-[var(--ui-surface-hover)]"
      onClick={onClick}
    >
      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
        {sideLabel}
      </div>
      <div className="font-display text-3xl text-[var(--ui-ink-strong)]">
        {title}
      </div>
      <div className="max-w-[36ch] text-sm leading-6 text-[var(--ui-ink-soft)]">
        {description || "Choose the one that feels more right."}
      </div>
      <div className="mt-auto text-sm text-[var(--primary)]">
        Click this card
      </div>
    </button>
  );
}
