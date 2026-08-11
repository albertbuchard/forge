import {
  Ban,
  Bookmark,
  Clock3,
  Compass,
  Heart,
  History,
  Map,
  MinusCircle,
  ShieldCheck,
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
import { getKnowledgeGraphEntityHref } from "@/lib/knowledge-graph-types";
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
    value: "calendar",
    label: "Calendar",
    description: "Events, time commitments, and scheduling preferences.",
    mode: "concept"
  },
  {
    value: "sleep",
    label: "Sleep",
    description: "Sleep routines, conditions, and recovery preferences.",
    mode: "concept"
  },
  {
    value: "sports",
    label: "Sports",
    description: "Training types, settings, and workout preferences.",
    mode: "concept"
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
  icon: typeof Heart;
  modelWeight: number;
}> = [
  {
    signalType: "favorite",
    label: "Favorite",
    icon: Heart,
    modelWeight: 1.25
  },
  {
    signalType: "must_have",
    label: "Must-have",
    icon: ShieldCheck,
    modelWeight: 1.5
  },
  {
    signalType: "bookmark",
    label: "Bookmark",
    icon: Bookmark,
    modelWeight: 0.35
  },
  {
    signalType: "compare_later",
    label: "Later",
    icon: Clock3,
    modelWeight: 0.2
  },
  {
    signalType: "neutral",
    label: "Clear effect",
    icon: MinusCircle,
    modelWeight: 0
  },
  { signalType: "veto", label: "Veto", icon: Ban, modelWeight: -1.6 }
];

export const SIGNAL_MODEL_EFFECTS: Record<PreferenceSignalType, string> = {
  favorite:
    "+1.25 raw weight at strength 1; status becomes favorite before any manual override.",
  must_have:
    "+1.50 raw weight at strength 1; status becomes must-have before any manual override.",
  bookmark:
    "+0.35 raw weight at strength 1; status becomes bookmarked and remains reviewable.",
  compare_later:
    "+0.20 raw weight at strength 1; queues another comparison without a hard like or dislike.",
  neutral:
    "Clears the current direct effect. Earlier signals remain in history, while the score, status, evidence count, and confidence return to the remaining evidence.",
  veto: "-1.60 raw weight at strength 1; status becomes vetoed before any manual override."
};

export function getPreferenceContextScope(
  context: PreferenceWorkspacePayload["selectedContext"]
) {
  const sharing =
    context.shareMode === "shared"
      ? "All active contexts contribute at full weight."
      : context.shareMode === "blended"
        ? "This context contributes at full weight; other active contexts contribute at 45%."
        : "Only evidence recorded in this context contributes.";
  return `${sharing} Evidence then decays over ${context.decayDays} days.`;
}

export function getPreferenceSignalHistory(
  workspace: PreferenceWorkspacePayload,
  itemId: string
) {
  return workspace.history.signals.filter((signal) => signal.itemId === itemId);
}

export function getPreferenceEffectiveSignal(
  workspace: PreferenceWorkspacePayload,
  itemId: string
) {
  const score = workspace.scores.find((entry) => entry.itemId === itemId);
  if (score) {
    return score.effectiveSignal;
  }
  return getPreferenceSignalHistory(workspace, itemId)[0] ?? null;
}

export function isPreferenceHistoryPartial(
  workspace: PreferenceWorkspacePayload
) {
  const signalIds = new Set(
    workspace.history.signals.map((signal) => signal.id)
  );
  const effectiveSignalOutsideHistory = workspace.scores.some(
    (score) => score.effectiveSignal && !signalIds.has(score.effectiveSignal.id)
  );
  const selectedContextCoverage = workspace.evidenceCoverage.contexts.find(
    (coverage) => coverage.contextId === workspace.selectedContext.id
  );
  const judgmentsOutsideHistory =
    (selectedContextCoverage?.totalJudgments ?? 0) >
    workspace.history.judgments.length;
  const historyLimitReached =
    workspace.history.judgments.length >= workspace.presentation.historyLimit ||
    workspace.history.signals.length >= workspace.presentation.historyLimit;
  return (
    effectiveSignalOutsideHistory ||
    judgmentsOutsideHistory ||
    historyLimitReached
  );
}

export function getPreferenceSignalConflicts(
  workspace: PreferenceWorkspacePayload,
  itemId: string,
  candidateSignalType?: PreferenceSignalType
) {
  const history = getPreferenceSignalHistory(workspace, itemId);
  const score = workspace.scores.find((entry) => entry.itemId === itemId);
  const currentSignal = score ? score.effectiveSignal : (history[0] ?? null);
  const signalType = candidateSignalType ?? currentSignal?.signalType ?? null;
  if (!signalType) {
    return [];
  }

  const weight =
    SIGNAL_OPTIONS.find((option) => option.signalType === signalType)
      ?.modelWeight ?? 0;
  const wins = score?.pairwiseWins ?? 0;
  const losses = score?.pairwiseLosses ?? 0;

  const conflicts: string[] = [];
  if (weight > 0 && losses > 0) {
    conflicts.push(
      `${losses} prior comparison ${losses === 1 ? "loss conflicts" : "losses conflict"} with this positive signal.`
    );
  }
  if (weight < 0 && wins > 0) {
    conflicts.push(
      `${wins} prior comparison ${wins === 1 ? "win conflicts" : "wins conflict"} with this veto.`
    );
  }
  const replacedSignal = candidateSignalType
    ? currentSignal
    : history.find((signal) => signal.id !== currentSignal?.id);
  if (
    replacedSignal &&
    Math.sign(weight) !==
      Math.sign(
        SIGNAL_OPTIONS.find(
          (option) => option.signalType === replacedSignal.signalType
        )?.modelWeight ?? 0
      )
  ) {
    conflicts.push(
      candidateSignalType
        ? `This replaces the current ${replacedSignal.signalType.replaceAll("_", " ")} signal; the earlier record remains in history but stops affecting the model.`
        : `The current ${signalType.replaceAll("_", " ")} signal replaced the prior ${replacedSignal.signalType.replaceAll("_", " ")} signal; the earlier record remains in history but no longer affects the model.`
    );
  }
  return conflicts;
}

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
  return getKnowledgeGraphEntityHref(entityType, entityId);
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
