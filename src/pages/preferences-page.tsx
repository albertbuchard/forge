import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Compass,
  GitCompareArrows,
  History,
  Map,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  TableProperties,
  Trash2,
  X
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import { useForgeShell } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  EmptyState,
  ErrorState,
  LoadingState
} from "@/components/ui/page-state";
import { Textarea } from "@/components/ui/textarea";
import { UserBadge } from "@/components/ui/user-badge";
import {
  createPreferenceCatalog,
  createPreferenceCatalogItem,
  createPreferenceContext,
  createPreferenceItem,
  deletePreferenceCatalog,
  deletePreferenceCatalogItem,
  enqueuePreferenceEntity,
  getPreferenceWorkspace,
  mergePreferenceContexts,
  patchPreferenceCatalog,
  patchPreferenceCatalogItem,
  patchPreferenceContext,
  patchPreferenceItem,
  patchPreferenceScore,
  startPreferenceGame,
  submitPairwisePreferenceJudgment,
  submitPreferenceSignal
} from "@/lib/api";
import type {
  CrudEntityType,
  ForgeSnapshot,
  PreferenceCatalog,
  PreferenceCatalogItem,
  PreferenceContext,
  PreferenceDimensionId,
  PreferenceDimensionSummary,
  PreferenceDomain,
  PreferenceItemScore,
  PreferenceItemStatus,
  PreferenceSignalType,
  PreferenceWorkspacePayload,
  UserSummary
} from "@/lib/types";
import {
  buildOwnedEntitySearchText,
  formatUserSummaryLine,
  getSingleSelectedUserId
} from "@/lib/user-ownership";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "overview", label: "Overview", icon: Compass },
  { id: "map", label: "Map", icon: Map },
  { id: "table", label: "Table", icon: TableProperties },
  { id: "history", label: "History", icon: History },
  { id: "contexts", label: "Contexts", icon: SlidersHorizontal },
  { id: "concepts", label: "Concepts", icon: Sparkles }
] as const;

const FORGE_GAME_DOMAINS = new Set<PreferenceDomain>([
  "projects",
  "tasks",
  "strategies",
  "habits"
]);

const DOMAIN_OPTIONS: Array<{
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

const DIMENSION_LABELS: Record<PreferenceDimensionId, string> = {
  novelty: "Novelty",
  simplicity: "Simplicity",
  rigor: "Rigor",
  aesthetics: "Aesthetics",
  depth: "Depth",
  structure: "Structure",
  familiarity: "Familiarity",
  surprise: "Surprise"
};

const DEFAULT_DIMENSIONS: Record<PreferenceDimensionId, number> = {
  novelty: 0,
  simplicity: 0,
  rigor: 0,
  aesthetics: 0,
  depth: 0,
  structure: 0,
  familiarity: 0,
  surprise: 0
};

const STATUS_CLASSES: Record<PreferenceItemStatus, string> = {
  liked: "bg-emerald-500/12 text-emerald-200",
  disliked: "bg-rose-500/12 text-rose-200",
  uncertain: "bg-white/[0.08] text-white/70",
  vetoed: "bg-rose-500/15 text-rose-100",
  bookmarked: "bg-sky-500/12 text-sky-200",
  favorite: "bg-amber-500/12 text-amber-200",
  must_have: "bg-indigo-500/15 text-indigo-100",
  neutral: "bg-white/[0.08] text-white/70"
};

const SIGNAL_OPTIONS: Array<{
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

type PreferencesTab = (typeof TABS)[number]["id"];

type CandidateEntity = {
  entityType: CrudEntityType;
  entityId: string;
  domain: PreferenceDomain;
  label: string;
  description: string;
  user: UserSummary | null | undefined;
  searchText: string;
  href: string | null;
};

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function buildCandidateEntities(snapshot: ForgeSnapshot): CandidateEntity[] {
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

function getSourceEntityHref(
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

function getScoreStatus(score: PreferenceItemScore) {
  return score.manualStatus ?? score.status;
}

function resolveSelectedTab(searchValue: string | null): PreferencesTab {
  if (searchValue && TABS.some((tab) => tab.id === searchValue)) {
    return searchValue as PreferencesTab;
  }
  return "overview";
}

function buildGameHeadline(workspace: PreferenceWorkspacePayload) {
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

function DimensionBar({ summary }: { summary: PreferenceDimensionSummary }) {
  const leaning = Math.max(-1, Math.min(1, summary.leaning));
  const offset = ((leaning + 1) / 2) * 100;
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-3 text-xs text-white/56">
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
      <div className="relative h-2 rounded-full bg-white/[0.08]">
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
        <div
          className={cn(
            "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/12",
            leaning >= 0 ? "bg-emerald-300" : "bg-rose-300"
          )}
          style={{ left: `${offset}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.12em] text-white/38">
        <span>
          {leaning >= 0 ? "Leans toward" : "Leans away from"}{" "}
          {DIMENSION_LABELS[summary.dimensionId].toLowerCase()}
        </span>
        <span>Context {formatPercent(summary.contextSensitivity)}</span>
      </div>
    </div>
  );
}

function ComparisonCard({
  title,
  description,
  sideLabel,
  onClick
}: {
  title: string;
  description: string;
  sideLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="grid min-h-[220px] gap-4 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))] p-5 text-left transition hover:border-[var(--primary)]/40 hover:bg-[linear-gradient(180deg,rgba(192,193,255,0.14),rgba(255,255,255,0.05))]"
      onClick={onClick}
    >
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
        {sideLabel}
      </div>
      <div className="font-display text-3xl text-white">{title}</div>
      <div className="max-w-[36ch] text-sm leading-6 text-white/56">
        {description || "Choose the one that feels more right."}
      </div>
      <div className="mt-auto text-sm text-[var(--primary)]">
        Click this card
      </div>
    </button>
  );
}

export function PreferencesPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [entitySearchQuery, setEntitySearchQuery] = useState("");
  const [conceptSearchQuery, setConceptSearchQuery] = useState("");
  const [mergeSourceContextId, setMergeSourceContextId] = useState("");
  const [mergeTargetContextId, setMergeTargetContextId] = useState("");
  const [gameState, setGameState] = useState<{
    open: boolean;
    phase: "domain" | "catalog" | "play";
    domain: PreferenceDomain;
  }>({
    open: false,
    phase: "domain",
    domain: ((searchParams.get("domain") as PreferenceDomain | null) ??
      "projects") as PreferenceDomain
  });
  const [gameError, setGameError] = useState<string | null>(null);
  const [gameLoading, setGameLoading] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [itemEditor, setItemEditor] = useState<{
    label: string;
    description: string;
    tags: string;
    manualStatus: PreferenceItemStatus | "";
    manualScore: string;
    confidenceLock: string;
    bookmarked: boolean;
    compareLater: boolean;
    frozen: boolean;
    featureWeights: Record<PreferenceDimensionId, string>;
  }>({
    label: "",
    description: "",
    tags: "",
    manualStatus: "",
    manualScore: "",
    confidenceLock: "",
    bookmarked: false,
    compareLater: false,
    frozen: false,
    featureWeights: {
      novelty: "0",
      simplicity: "0",
      rigor: "0",
      aesthetics: "0",
      depth: "0",
      structure: "0",
      familiarity: "0",
      surprise: "0"
    }
  });
  const [customItemForm, setCustomItemForm] = useState({
    label: "",
    description: "",
    tags: ""
  });
  const [newContextForm, setNewContextForm] = useState({
    name: "",
    description: "",
    shareMode: "blended" as PreferenceContext["shareMode"],
    decayDays: "90"
  });
  const [catalogForm, setCatalogForm] = useState({
    title: "",
    description: ""
  });
  const [newConceptByCatalogId, setNewConceptByCatalogId] = useState<
    Record<string, { label: string; description: string; tags: string }>
  >({});
  const [editingCatalogId, setEditingCatalogId] = useState<string | null>(null);
  const [editingCatalogDraft, setEditingCatalogDraft] = useState({
    title: "",
    description: ""
  });
  const [editingCatalogItemId, setEditingCatalogItemId] = useState<
    string | null
  >(null);
  const [editingCatalogItemDraft, setEditingCatalogItemDraft] = useState({
    label: "",
    description: "",
    tags: ""
  });

  const selectedUserId =
    searchParams.get("userId") ??
    getSingleSelectedUserId(shell.selectedUserIds) ??
    shell.snapshot.users[0]?.id ??
    null;
  const selectedDomain =
    (searchParams.get("domain") as PreferenceDomain | null) ?? "projects";
  const selectedTab = resolveSelectedTab(searchParams.get("tab"));
  const selectedContextId = searchParams.get("contextId");
  const focusedItemIdFromQuery = searchParams.get("focusItem");

  const user = useMemo(
    () =>
      shell.snapshot.users.find((entry) => entry.id === selectedUserId) ?? null,
    [selectedUserId, shell.snapshot.users]
  );

  const candidateEntities = useMemo(
    () => buildCandidateEntities(shell.snapshot),
    [shell.snapshot]
  );

  const workspaceQuery = useQuery({
    queryKey: [
      "forge-preferences",
      selectedUserId,
      selectedDomain,
      selectedContextId
    ],
    queryFn: async () =>
      (
        await getPreferenceWorkspace({
          userId: selectedUserId ?? undefined,
          domain: selectedDomain,
          contextId: selectedContextId ?? undefined
        })
      ).workspace,
    enabled: Boolean(selectedUserId)
  });

  const gameWorkspaceQuery = useQuery({
    queryKey: [
      "forge-preferences-game",
      selectedUserId,
      gameState.domain,
      selectedContextId
    ],
    queryFn: async () =>
      (
        await getPreferenceWorkspace({
          userId: selectedUserId ?? undefined,
          domain: gameState.domain,
          contextId: selectedContextId ?? undefined
        })
      ).workspace,
    enabled: Boolean(selectedUserId) && gameState.open
  });

  const workspace = workspaceQuery.data ?? null;
  const activeGameWorkspace =
    gameState.domain === selectedDomain
      ? workspace
      : (gameWorkspaceQuery.data ?? null);

  useEffect(() => {
    if (!workspace) {
      return;
    }
    const candidate =
      focusedItemIdFromQuery &&
      workspace.scores.some((score) => score.itemId === focusedItemIdFromQuery)
        ? focusedItemIdFromQuery
        : (workspace.scores[0]?.itemId ?? null);
    setSelectedItemId((current) =>
      current && workspace.scores.some((score) => score.itemId === current)
        ? current
        : candidate
    );
  }, [focusedItemIdFromQuery, workspace]);

  const filteredScores = useMemo(() => {
    if (!workspace) {
      return [];
    }
    const normalized = normalizeText(searchQuery);
    if (!normalized) {
      return workspace.scores;
    }
    return workspace.scores.filter((score) =>
      [
        score.item?.label ?? "",
        score.item?.description ?? "",
        score.item?.tags.join(" ") ?? "",
        score.status,
        score.manualStatus ?? "",
        score.dominantDimensions.join(" "),
        score.explanation.join(" ")
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [searchQuery, workspace]);

  const selectedScore =
    filteredScores.find((score) => score.itemId === selectedItemId) ??
    workspace?.scores.find((score) => score.itemId === selectedItemId) ??
    filteredScores[0] ??
    workspace?.scores[0] ??
    null;

  useEffect(() => {
    if (!selectedScore) {
      return;
    }
    setItemEditor({
      label: selectedScore.item?.label ?? "",
      description: selectedScore.item?.description ?? "",
      tags: selectedScore.item?.tags.join(", ") ?? "",
      manualStatus: selectedScore.manualStatus ?? "",
      manualScore:
        typeof selectedScore.manualScore === "number"
          ? String(selectedScore.manualScore)
          : "",
      confidenceLock:
        typeof selectedScore.confidenceLock === "number"
          ? String(selectedScore.confidenceLock)
          : "",
      bookmarked: selectedScore.bookmarked,
      compareLater: selectedScore.compareLater,
      frozen: selectedScore.frozen,
      featureWeights: {
        novelty: String(selectedScore.item?.featureWeights.novelty ?? 0),
        simplicity: String(selectedScore.item?.featureWeights.simplicity ?? 0),
        rigor: String(selectedScore.item?.featureWeights.rigor ?? 0),
        aesthetics: String(selectedScore.item?.featureWeights.aesthetics ?? 0),
        depth: String(selectedScore.item?.featureWeights.depth ?? 0),
        structure: String(selectedScore.item?.featureWeights.structure ?? 0),
        familiarity: String(
          selectedScore.item?.featureWeights.familiarity ?? 0
        ),
        surprise: String(selectedScore.item?.featureWeights.surprise ?? 0)
      }
    });
  }, [selectedScore]);

  const filteredEntities = useMemo(() => {
    const normalized = normalizeText(entitySearchQuery);
    return candidateEntities
      .filter((entry) => entry.domain === selectedDomain)
      .filter((entry) =>
        normalized ? entry.searchText.includes(normalized) : true
      )
      .slice(0, 12);
  }, [candidateEntities, entitySearchQuery, selectedDomain]);

  const filteredCatalogs = useMemo(() => {
    const sourceWorkspace =
      selectedTab === "concepts"
        ? workspace
        : (activeGameWorkspace ?? workspace);
    const catalogs = sourceWorkspace?.catalogs ?? [];
    const normalized = normalizeText(conceptSearchQuery);
    if (!normalized) {
      return catalogs;
    }
    return catalogs.filter((catalog) =>
      [
        catalog.title,
        catalog.description,
        catalog.source,
        ...catalog.items.flatMap((item) => [
          item.label,
          item.description,
          item.tags.join(" ")
        ])
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [activeGameWorkspace, conceptSearchQuery, selectedTab, workspace]);

  const refreshWorkspace = async () => {
    await queryClient.invalidateQueries({ queryKey: ["forge-preferences"] });
    await queryClient.invalidateQueries({
      queryKey: ["forge-preferences-game"]
    });
  };

  const enqueueMutation = useMutation({
    mutationFn: enqueuePreferenceEntity,
    onSuccess: refreshWorkspace
  });

  const createItemMutation = useMutation({
    mutationFn: createPreferenceItem,
    onSuccess: async ({ item }) => {
      await refreshWorkspace();
      setCustomItemForm({ label: "", description: "", tags: "" });
      setSelectedItemId(item.id);
    }
  });

  const createCatalogMutation = useMutation({
    mutationFn: createPreferenceCatalog,
    onSuccess: async () => {
      await refreshWorkspace();
      setCatalogForm({ title: "", description: "" });
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set("tab", "concepts");
        return next;
      });
    }
  });

  const updateCatalogMutation = useMutation({
    mutationFn: ({
      catalogId,
      patch
    }: {
      catalogId: string;
      patch: Parameters<typeof patchPreferenceCatalog>[1];
    }) => patchPreferenceCatalog(catalogId, patch),
    onSuccess: async () => {
      await refreshWorkspace();
      setEditingCatalogId(null);
    }
  });

  const deleteCatalogMutation = useMutation({
    mutationFn: deletePreferenceCatalog,
    onSuccess: refreshWorkspace
  });

  const createCatalogItemMutation = useMutation({
    mutationFn: createPreferenceCatalogItem,
    onSuccess: async () => {
      await refreshWorkspace();
    }
  });

  const updateCatalogItemMutation = useMutation({
    mutationFn: ({
      catalogItemId,
      patch
    }: {
      catalogItemId: string;
      patch: Parameters<typeof patchPreferenceCatalogItem>[1];
    }) => patchPreferenceCatalogItem(catalogItemId, patch),
    onSuccess: async () => {
      await refreshWorkspace();
      setEditingCatalogItemId(null);
    }
  });

  const deleteCatalogItemMutation = useMutation({
    mutationFn: deletePreferenceCatalogItem,
    onSuccess: refreshWorkspace
  });

  const startGameMutation = useMutation({
    mutationFn: startPreferenceGame,
    onSuccess: async () => {
      await refreshWorkspace();
      setGameState((current) => ({ ...current, phase: "play" }));
    }
  });

  const judgmentMutation = useMutation({
    mutationFn: submitPairwisePreferenceJudgment,
    onSuccess: refreshWorkspace
  });

  const signalMutation = useMutation({
    mutationFn: submitPreferenceSignal,
    onSuccess: refreshWorkspace
  });

  const saveItemMutation = useMutation({
    mutationFn: async () => {
      if (!selectedScore?.item || !selectedUserId || !workspace) {
        return;
      }
      await patchPreferenceItem(selectedScore.item.id, {
        label: itemEditor.label,
        description: itemEditor.description,
        tags: itemEditor.tags
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
        featureWeights: Object.fromEntries(
          (Object.keys(DEFAULT_DIMENSIONS) as PreferenceDimensionId[]).map(
            (dimensionId) => [
              dimensionId,
              Number(itemEditor.featureWeights[dimensionId] || 0)
            ]
          )
        )
      });
      await patchPreferenceScore(selectedScore.item.id, {
        userId: selectedUserId,
        domain: selectedDomain,
        contextId: workspace.selectedContext.id,
        manualStatus: itemEditor.manualStatus || null,
        manualScore:
          itemEditor.manualScore.trim().length > 0
            ? Number(itemEditor.manualScore)
            : null,
        confidenceLock:
          itemEditor.confidenceLock.trim().length > 0
            ? Number(itemEditor.confidenceLock)
            : null,
        bookmarked: itemEditor.bookmarked,
        compareLater: itemEditor.compareLater,
        frozen: itemEditor.frozen
      });
    },
    onSuccess: refreshWorkspace
  });

  const createContextMutation = useMutation({
    mutationFn: createPreferenceContext,
    onSuccess: async ({ context }) => {
      await refreshWorkspace();
      setNewContextForm({
        name: "",
        description: "",
        shareMode: "blended",
        decayDays: "90"
      });
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set("contextId", context.id);
        next.set("tab", "contexts");
        return next;
      });
    }
  });

  const mergeContextMutation = useMutation({
    mutationFn: mergePreferenceContexts,
    onSuccess: async () => {
      await refreshWorkspace();
      setMergeSourceContextId("");
      setMergeTargetContextId("");
    }
  });

  const updateContextMutation = useMutation({
    mutationFn: ({
      contextId,
      patch
    }: {
      contextId: string;
      patch: Parameters<typeof patchPreferenceContext>[1];
    }) => patchPreferenceContext(contextId, patch),
    onSuccess: refreshWorkspace
  });

  const updateSearchParams = (patch: Record<string, string | null>) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(patch)) {
        if (!value) {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      return next;
    });
  };

  const openGame = (domain = selectedDomain) => {
    setGameError(null);
    setGameState({
      open: true,
      phase: "domain",
      domain
    });
  };

  const launchForgeDomainGame = async (domain: PreferenceDomain) => {
    if (!selectedUserId) {
      return;
    }
    setGameError(null);
    setGameLoading(true);
    const ownItems = candidateEntities.filter(
      (entry) => entry.domain === domain && entry.user?.id === selectedUserId
    );
    const fallbackItems = candidateEntities.filter(
      (entry) => entry.domain === domain
    );
    const pool = (ownItems.length > 0 ? ownItems : fallbackItems).slice(0, 12);
    if (pool.length < 2) {
      setGameError(
        "Forge needs at least two matching records in this domain before it can start the game."
      );
      setGameLoading(false);
      setGameState((current) => ({ ...current, phase: "domain" }));
      return;
    }
    try {
      updateSearchParams({
        domain,
        tab: "overview",
        contextId: null,
        focusItem: null
      });
      await Promise.all(
        pool.map((entry) =>
          enqueuePreferenceEntity({
            userId: selectedUserId,
            domain,
            entityType: entry.entityType,
            entityId: entry.entityId,
            label: entry.label,
            description: entry.description,
            tags: []
          })
        )
      );
      await refreshWorkspace();
      setGameState({
        open: true,
        phase: "play",
        domain
      });
    } catch (error) {
      setGameError(
        error instanceof Error
          ? error.message
          : "Forge could not start the game."
      );
      setGameState((current) => ({ ...current, phase: "domain" }));
    } finally {
      setGameLoading(false);
    }
  };

  const startCatalogGame = async (
    domain: PreferenceDomain,
    catalogId: string
  ) => {
    if (!selectedUserId) {
      return;
    }
    setGameError(null);
    updateSearchParams({
      domain,
      tab: "overview",
      contextId: null,
      focusItem: null
    });
    try {
      await startGameMutation.mutateAsync({
        userId: selectedUserId,
        domain,
        contextId: selectedContextId ?? undefined,
        catalogId
      });
      setGameState({
        open: true,
        phase: "play",
        domain
      });
    } catch (error) {
      setGameError(
        error instanceof Error
          ? error.message
          : "Forge could not start the game."
      );
    }
  };

  const handleGameDomainSelection = async (domain: PreferenceDomain) => {
    if (FORGE_GAME_DOMAINS.has(domain)) {
      await launchForgeDomainGame(domain);
      return;
    }
    setGameError(null);
    setGameState({
      open: true,
      phase: "catalog",
      domain
    });
  };

  const handleGameJudgment = async (
    outcome: "left" | "right" | "tie" | "skip",
    strength = 1
  ) => {
    if (!selectedUserId || !activeGameWorkspace?.compare.nextPair) {
      return;
    }
    const pair = activeGameWorkspace.compare.nextPair;
    await judgmentMutation.mutateAsync({
      userId: selectedUserId,
      domain: gameState.domain,
      contextId: activeGameWorkspace.selectedContext.id,
      leftItemId: pair.left.id,
      rightItemId: pair.right.id,
      outcome,
      strength
    });
  };

  const handleGameSignal = async (
    itemId: string,
    signalType: PreferenceSignalType
  ) => {
    if (!selectedUserId || !activeGameWorkspace) {
      return;
    }
    await signalMutation.mutateAsync({
      userId: selectedUserId,
      domain: gameState.domain,
      contextId: activeGameWorkspace.selectedContext.id,
      itemId,
      signalType,
      strength: 1
    });
  };

  if (!selectedUserId) {
    return (
      <EmptyState
        eyebrow="Preferences"
        title="No Forge user available"
        description="Forge needs at least one human or bot user before it can learn preferences."
      />
    );
  }

  if (workspaceQuery.isLoading && !workspace) {
    return (
      <LoadingState
        eyebrow="Preferences"
        title="Loading preference model"
        description="Reconstructing current scores, uncertainty, and concept libraries."
      />
    );
  }

  if (workspaceQuery.isError) {
    return (
      <ErrorState
        eyebrow="Preferences"
        error={workspaceQuery.error}
        onRetry={() => void workspaceQuery.refetch()}
      />
    );
  }

  if (!workspace) {
    return null;
  }

  const topDimensions = [...workspace.dimensions]
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 6);
  const topLikes = workspace.scores
    .filter(
      (score) =>
        getScoreStatus(score) === "liked" ||
        getScoreStatus(score) === "favorite"
    )
    .slice(0, 4);
  const biggestUnknowns = workspace.scores
    .filter((score) => score.uncertainty >= 0.5)
    .slice(0, 4);
  const headline = buildGameHeadline(workspace);
  const selectedItemHref = getSourceEntityHref(
    selectedScore?.item?.sourceEntityType ?? null,
    selectedScore?.item?.sourceEntityId ?? null
  );
  const nextPair = activeGameWorkspace?.compare.nextPair ?? null;

  return (
    <>
      <div className="grid gap-5">
        <PageHero
          title="Preferences"
          titleText="Preferences"
          description="Forge keeps an explicit, editable model of what one user prefers in one domain. The first job of this page is to show what Forge currently knows."
          badge={`${workspace.summary.totalItems} items · ${formatPercent(workspace.summary.averageConfidence)} confidence`}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button className="min-w-[10rem]" onClick={() => openGame()}>
                Start the game
              </Button>
              <Button
                variant="secondary"
                onClick={() => void refreshWorkspace()}
              >
                Refresh model
              </Button>
            </div>
          }
        />

        <PsycheSectionNav />

        <Card className="grid gap-4">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="grid gap-2">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                Active user
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={selectedUserId}
                  onChange={(event) =>
                    updateSearchParams({
                      userId: event.target.value,
                      contextId: null,
                      focusItem: null
                    })
                  }
                  className="min-h-10 rounded-[18px] border border-white/8 bg-white/[0.05] px-3 text-sm text-white outline-none"
                >
                  {shell.snapshot.users.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.displayName} · {entry.kind}
                    </option>
                  ))}
                </select>
                <UserBadge user={user} />
                <div className="text-sm text-white/54">
                  {formatUserSummaryLine(user)}
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                Domain
              </div>
              <div className="flex flex-wrap gap-2">
                {DOMAIN_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      "rounded-full border px-3 py-2 text-sm transition",
                      option.value === selectedDomain
                        ? "border-[var(--primary)] bg-[var(--primary)]/14 text-white"
                        : "border-white/8 bg-white/[0.04] text-white/62 hover:bg-white/[0.08]"
                    )}
                    onClick={() =>
                      updateSearchParams({
                        domain: option.value,
                        contextId: null,
                        focusItem: null
                      })
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="text-sm text-white/48">
                {
                  DOMAIN_OPTIONS.find((entry) => entry.value === selectedDomain)
                    ?.description
                }
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm text-white/50">
            <Badge className="bg-white/[0.08] text-white/70">
              {workspace.selectedContext.name}
            </Badge>
            <span>{workspace.selectedContext.shareMode}</span>
            <span>·</span>
            <span>{workspace.compare.pendingCount} queued comparisons</span>
            <span>·</span>
            <span>
              {workspace.libraries.totalCatalogItems} concept items ready
            </span>
          </div>
        </Card>

        <div className="flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition",
                tab.id === selectedTab
                  ? "border-[var(--primary)] bg-[var(--primary)]/14 text-white"
                  : "border-white/8 bg-white/[0.04] text-white/62 hover:bg-white/[0.08]"
              )}
              onClick={() => updateSearchParams({ tab: tab.id })}
            >
              <tab.icon className="size-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {selectedTab === "overview" ? (
          <div className="grid gap-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_360px]">
              <Card className="grid gap-5">
                <div className="grid gap-2">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                    What Forge knows
                  </div>
                  <div className="font-display text-3xl text-white">
                    {headline.title}
                  </div>
                  <div className="max-w-[70ch] text-sm leading-6 text-white/58">
                    {headline.description}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {[
                    {
                      label: "Known items",
                      value: workspace.summary.totalItems,
                      detail: "Items inside this domain"
                    },
                    {
                      label: "Confidence",
                      value: formatPercent(workspace.summary.averageConfidence),
                      detail: "Average certainty"
                    },
                    {
                      label: "Unknowns",
                      value: workspace.summary.uncertainCount,
                      detail: "Need more rounds"
                    },
                    {
                      label: "Libraries",
                      value: workspace.libraries.totalCatalogItems,
                      detail: "Seeded concepts ready"
                    }
                  ].map((entry) => (
                    <div
                      key={entry.label}
                      className="rounded-[22px] bg-white/[0.04] px-4 py-4"
                    >
                      <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                        {entry.label}
                      </div>
                      <div className="mt-2 font-display text-3xl text-white">
                        {entry.value}
                      </div>
                      <div className="mt-1 text-sm text-white/52">
                        {entry.detail}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  {topDimensions.map((summary) => (
                    <DimensionBar key={summary.dimensionId} summary={summary} />
                  ))}
                </div>
              </Card>

              <Card className="grid gap-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  Next move
                </div>
                <div className="font-display text-2xl text-white">
                  Start the game
                </div>
                <div className="text-sm leading-6 text-white/58">
                  Forge will ask a small number of pairwise questions. You
                  choose a domain, Forge supplies the candidates, and the model
                  tightens from there.
                </div>
                <Button className="w-full" onClick={() => openGame()}>
                  Start the game
                </Button>
                <div className="grid gap-3 rounded-[22px] bg-white/[0.04] px-4 py-4 text-sm text-white/58">
                  <div>
                    Current queue: {workspace.compare.pendingCount} comparison
                    {workspace.compare.pendingCount === 1 ? "" : "s"}
                  </div>
                  <div>Active context: {workspace.selectedContext.name}</div>
                  <div>
                    Library coverage: {workspace.libraries.seededCatalogCount}{" "}
                    seeded lists and {workspace.libraries.customCatalogCount}{" "}
                    custom lists
                  </div>
                </div>
              </Card>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_360px]">
              <Card className="grid gap-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                      Preference map
                    </div>
                    <div className="mt-1 text-sm text-white/54">
                      Green drifts positive, red drifts negative, and low
                      opacity still means uncertainty.
                    </div>
                  </div>
                  <Link to="?tab=map" className="text-sm text-[var(--primary)]">
                    Open full map
                  </Link>
                </div>
                <div className="relative min-h-[340px] overflow-hidden rounded-[24px] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(87,196,138,0.18),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(255,104,130,0.14),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))]">
                  <div className="absolute inset-x-0 top-1/2 h-px bg-white/8" />
                  <div className="absolute inset-y-0 left-1/2 w-px bg-white/8" />
                  {workspace.map.map((point) => (
                    <button
                      key={point.itemId}
                      type="button"
                      className={cn(
                        "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-1 text-[11px] shadow-[0_10px_25px_rgba(5,8,16,0.32)] transition hover:scale-[1.04]",
                        point.itemId === selectedScore?.itemId
                          ? "border-white/30 bg-white/16 text-white"
                          : point.score >= 0
                            ? "border-emerald-300/30 bg-emerald-500/14 text-emerald-100"
                            : "border-rose-300/30 bg-rose-500/14 text-rose-100"
                      )}
                      style={{
                        left: `${50 + point.x * 30}%`,
                        top: `${50 - point.y * 30}%`,
                        opacity: 0.55 + point.confidence * 0.45
                      }}
                      onClick={() => setSelectedItemId(point.itemId)}
                    >
                      {point.label}
                    </button>
                  ))}
                </div>
              </Card>

              <Card className="grid gap-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  Best read so far
                </div>
                <div className="grid gap-2">
                  {topLikes.length > 0 ? (
                    topLikes.map((score) => (
                      <button
                        key={score.itemId}
                        type="button"
                        className="rounded-[18px] bg-white/[0.04] px-3 py-3 text-left transition hover:bg-white/[0.07]"
                        onClick={() => {
                          setSelectedItemId(score.itemId);
                          updateSearchParams({ focusItem: score.itemId });
                        }}
                      >
                        <div className="font-medium text-white">
                          {score.item?.label ?? score.itemId}
                        </div>
                        <div className="mt-1 text-sm text-white/54">
                          {score.explanation[0] ||
                            "Forge has positive evidence here."}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="rounded-[18px] bg-white/[0.04] px-3 py-3 text-sm text-white/58">
                      No clear positives yet. A few comparison rounds will
                      change that.
                    </div>
                  )}
                </div>
                <div className="border-t border-white/8 pt-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                    Biggest unknowns
                  </div>
                  <div className="mt-3 grid gap-2">
                    {biggestUnknowns.length > 0 ? (
                      biggestUnknowns.map((score) => (
                        <div
                          key={score.itemId}
                          className="rounded-[18px] bg-white/[0.04] px-3 py-3 text-sm text-white/58"
                        >
                          <div className="font-medium text-white">
                            {score.item?.label ?? score.itemId}
                          </div>
                          <div className="mt-1">
                            Uncertainty {formatPercent(score.uncertainty)}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[18px] bg-white/[0.04] px-3 py-3 text-sm text-white/58">
                        The current unknown list is short.
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </div>

            <Card className="grid gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                    Bring in Forge records
                  </div>
                  <div className="mt-1 text-sm text-white/54">
                    Search goals, projects, tasks, strategies, or habits across
                    human and bot users, then send them straight into this
                    model.
                  </div>
                </div>
                <Badge className="bg-white/[0.08] text-white/70">
                  {filteredEntities.length} visible
                </Badge>
              </div>
              <div className="flex items-center gap-3">
                <Search className="size-4 text-white/38" />
                <Input
                  value={entitySearchQuery}
                  onChange={(event) => setEntitySearchQuery(event.target.value)}
                  placeholder="Search across owners, handles, user kind, title, and description"
                />
              </div>
              <div className="grid gap-2">
                {filteredEntities.map((entry) => (
                  <div
                    key={`${entry.entityType}-${entry.entityId}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-white/[0.04] px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-white">
                          {entry.label}
                        </span>
                        <Badge className="bg-white/[0.08] text-white/70">
                          {entry.entityType}
                        </Badge>
                        {entry.user ? (
                          <UserBadge user={entry.user} compact />
                        ) : null}
                      </div>
                      <div className="mt-1 text-sm text-white/52">
                        {entry.description || "No description yet."}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {entry.href ? (
                        <Link to={entry.href}>
                          <Button variant="ghost" size="sm">
                            Open
                          </Button>
                        </Link>
                      ) : null}
                      <Button
                        variant="secondary"
                        size="sm"
                        pending={enqueueMutation.isPending}
                        pendingLabel="Adding"
                        onClick={() =>
                          void enqueueMutation.mutateAsync({
                            userId: selectedUserId,
                            domain: selectedDomain,
                            entityType: entry.entityType,
                            entityId: entry.entityId,
                            label: entry.label,
                            description: entry.description,
                            tags: []
                          })
                        }
                      >
                        Add to model
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        ) : null}

        {selectedTab === "map" ? (
          <Card className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  Full map
                </div>
                <div className="mt-1 text-sm text-white/54">
                  Click a point to inspect why Forge believes it belongs there.
                </div>
              </div>
              <div className="text-sm text-white/52">
                {workspace.map.length} plotted items
              </div>
            </div>
            <div className="relative min-h-[520px] overflow-hidden rounded-[24px] border border-white/8 bg-[radial-gradient(circle_at_20%_20%,rgba(87,196,138,0.2),transparent_25%),radial-gradient(circle_at_80%_80%,rgba(255,104,130,0.2),transparent_26%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))]">
              <div className="absolute inset-x-0 top-1/2 h-px bg-white/8" />
              <div className="absolute inset-y-0 left-1/2 w-px bg-white/8" />
              {workspace.map.map((point) => (
                <button
                  key={point.itemId}
                  type="button"
                  className={cn(
                    "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-3 py-1 text-xs transition hover:scale-[1.04]",
                    point.itemId === selectedScore?.itemId
                      ? "border-white/30 bg-white/16 text-white"
                      : point.score >= 0
                        ? "border-emerald-300/30 bg-emerald-500/14 text-emerald-100"
                        : "border-rose-300/30 bg-rose-500/14 text-rose-100"
                  )}
                  style={{
                    left: `${50 + point.x * 34}%`,
                    top: `${50 - point.y * 34}%`,
                    opacity: 0.45 + point.confidence * 0.55
                  }}
                  onClick={() => {
                    setSelectedItemId(point.itemId);
                    updateSearchParams({ focusItem: point.itemId });
                  }}
                >
                  {point.label}
                </button>
              ))}
            </div>
          </Card>
        ) : null}

        {selectedTab === "table" ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_380px]">
            <Card className="grid gap-3">
              <div className="flex items-center gap-3">
                <Search className="size-4 text-white/38" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search learned items, explanations, tags, or dominant dimensions"
                />
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-[0.14em] text-white/38">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2">Score</th>
                      <th className="px-3 py-2">Confidence</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredScores.map((score) => (
                      <tr
                        key={score.itemId}
                        className={cn(
                          "cursor-pointer border-t border-white/6 transition hover:bg-white/[0.04]",
                          score.itemId === selectedScore?.itemId
                            ? "bg-white/[0.05]"
                            : ""
                        )}
                        onClick={() => {
                          setSelectedItemId(score.itemId);
                          updateSearchParams({ focusItem: score.itemId });
                        }}
                      >
                        <td className="px-3 py-3">
                          <div className="font-medium text-white">
                            {score.item?.label ?? score.itemId}
                          </div>
                          <div className="text-xs text-white/48">
                            {(score.item?.tags ?? []).join(" · ")}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-white/68">
                          {score.latentScore.toFixed(2)}
                        </td>
                        <td className="px-3 py-3 text-white/68">
                          {formatPercent(score.confidence)}
                        </td>
                        <td className="px-3 py-3">
                          <Badge
                            className={STATUS_CLASSES[getScoreStatus(score)]}
                          >
                            {getScoreStatus(score)}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 text-white/68">
                          {score.evidenceCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="grid gap-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                Item editor
              </div>
              {selectedScore?.item ? (
                <>
                  <Input
                    value={itemEditor.label}
                    onChange={(event) =>
                      setItemEditor((current) => ({
                        ...current,
                        label: event.target.value
                      }))
                    }
                    placeholder="Item label"
                  />
                  <Textarea
                    value={itemEditor.description}
                    onChange={(event) =>
                      setItemEditor((current) => ({
                        ...current,
                        description: event.target.value
                      }))
                    }
                    className="min-h-24"
                    placeholder="Item description"
                  />
                  <Input
                    value={itemEditor.tags}
                    onChange={(event) =>
                      setItemEditor((current) => ({
                        ...current,
                        tags: event.target.value
                      }))
                    }
                    placeholder="comma, separated, tags"
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <select
                      value={itemEditor.manualStatus}
                      onChange={(event) =>
                        setItemEditor((current) => ({
                          ...current,
                          manualStatus: event.target.value as
                            | PreferenceItemStatus
                            | ""
                        }))
                      }
                      className="min-h-10 rounded-[18px] border border-white/8 bg-white/[0.05] px-3 text-sm text-white outline-none"
                    >
                      <option value="">Inferred status</option>
                      {Object.keys(STATUS_CLASSES).map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                    <Input
                      value={itemEditor.manualScore}
                      onChange={(event) =>
                        setItemEditor((current) => ({
                          ...current,
                          manualScore: event.target.value
                        }))
                      }
                      placeholder="Manual score"
                    />
                    <Input
                      value={itemEditor.confidenceLock}
                      onChange={(event) =>
                        setItemEditor((current) => ({
                          ...current,
                          confidenceLock: event.target.value
                        }))
                      }
                      placeholder="Confidence lock 0-1"
                    />
                  </div>
                  <div className="grid gap-2">
                    {(
                      Object.keys(DEFAULT_DIMENSIONS) as PreferenceDimensionId[]
                    ).map((dimensionId) => (
                      <div
                        key={dimensionId}
                        className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3"
                      >
                        <div className="text-sm text-white/56">
                          {DIMENSION_LABELS[dimensionId]}
                        </div>
                        <Input
                          value={itemEditor.featureWeights[dimensionId]}
                          onChange={(event) =>
                            setItemEditor((current) => ({
                              ...current,
                              featureWeights: {
                                ...current.featureWeights,
                                [dimensionId]: event.target.value
                              }
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <div className="grid gap-2 text-sm text-white/58">
                    {[
                      ["bookmarked", "Bookmarked"],
                      ["compareLater", "Compare later"],
                      ["frozen", "Frozen"]
                    ].map(([field, label]) => (
                      <label key={field} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={
                            itemEditor[
                              field as "bookmarked" | "compareLater" | "frozen"
                            ]
                          }
                          onChange={(event) =>
                            setItemEditor((current) => ({
                              ...current,
                              [field]: event.target.checked
                            }))
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  <Button
                    pending={saveItemMutation.isPending}
                    pendingLabel="Saving item"
                    onClick={() => void saveItemMutation.mutateAsync()}
                  >
                    Save item model
                  </Button>
                  {selectedItemHref ? (
                    <Link
                      className="text-sm text-[var(--primary)]"
                      to={selectedItemHref}
                    >
                      Open linked entity
                    </Link>
                  ) : null}
                </>
              ) : (
                <div className="text-sm text-white/52">
                  Select a row to inspect or edit it.
                </div>
              )}

              <div className="mt-3 border-t border-white/8 pt-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  Add custom item
                </div>
                <div className="mt-3 grid gap-3">
                  <Input
                    value={customItemForm.label}
                    onChange={(event) =>
                      setCustomItemForm((current) => ({
                        ...current,
                        label: event.target.value
                      }))
                    }
                    placeholder="Custom item label"
                  />
                  <Textarea
                    value={customItemForm.description}
                    onChange={(event) =>
                      setCustomItemForm((current) => ({
                        ...current,
                        description: event.target.value
                      }))
                    }
                    className="min-h-24"
                    placeholder="What is this preference item?"
                  />
                  <Input
                    value={customItemForm.tags}
                    onChange={(event) =>
                      setCustomItemForm((current) => ({
                        ...current,
                        tags: event.target.value
                      }))
                    }
                    placeholder="comma, separated, tags"
                  />
                  <Button
                    disabled={!customItemForm.label.trim()}
                    pending={createItemMutation.isPending}
                    pendingLabel="Creating item"
                    onClick={() =>
                      void createItemMutation.mutateAsync({
                        userId: selectedUserId,
                        domain: selectedDomain,
                        label: customItemForm.label,
                        description: customItemForm.description,
                        tags: customItemForm.tags
                          .split(",")
                          .map((entry) => entry.trim())
                          .filter(Boolean),
                        featureWeights: DEFAULT_DIMENSIONS,
                        queueForCompare: true
                      })
                    }
                  >
                    Create custom item
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        ) : null}

        {selectedTab === "history" ? (
          <div className="grid gap-5 xl:grid-cols-3">
            <Card className="grid gap-3 xl:col-span-2">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                Recent pairwise judgments
              </div>
              <div className="grid gap-2">
                {workspace.history.judgments.slice(0, 12).map((judgment) => {
                  const left =
                    workspace.scores.find(
                      (score) => score.itemId === judgment.leftItemId
                    )?.item?.label ?? judgment.leftItemId;
                  const right =
                    workspace.scores.find(
                      (score) => score.itemId === judgment.rightItemId
                    )?.item?.label ?? judgment.rightItemId;
                  return (
                    <div
                      key={judgment.id}
                      className="rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm text-white/58"
                    >
                      <div className="font-medium text-white">
                        {left} vs {right}
                      </div>
                      <div className="mt-1">
                        Outcome {judgment.outcome} · strength{" "}
                        {judgment.strength} ·{" "}
                        {new Date(judgment.createdAt).toLocaleString()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
            <Card className="grid gap-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                Signals and snapshots
              </div>
              <div className="grid gap-2">
                {workspace.history.signals.slice(0, 8).map((signal) => {
                  const item =
                    workspace.scores.find(
                      (score) => score.itemId === signal.itemId
                    )?.item?.label ?? signal.itemId;
                  return (
                    <div
                      key={signal.id}
                      className="rounded-[18px] bg-white/[0.04] px-3 py-2 text-sm text-white/58"
                    >
                      {item} · {signal.signalType} ·{" "}
                      {new Date(signal.createdAt).toLocaleString()}
                    </div>
                  );
                })}
              </div>
              <div className="grid gap-2">
                {workspace.history.snapshots.slice(0, 5).map((snapshot) => (
                  <div
                    key={snapshot.id}
                    className="rounded-[18px] bg-white/[0.04] px-3 py-2 text-sm text-white/58"
                  >
                    Snapshot {new Date(snapshot.createdAt).toLocaleString()}
                  </div>
                ))}
              </div>
              <div className="rounded-[18px] bg-white/[0.04] px-3 py-3 text-sm text-white/58">
                Stale items: {workspace.history.staleItemIds.length} · Flipped
                items: {workspace.history.flippedItemIds.length}
              </div>
            </Card>
          </div>
        ) : null}

        {selectedTab === "contexts" ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_360px]">
            <div className="grid gap-4">
              {workspace.contexts.map((context) => (
                <Card key={context.id} className="grid gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-display text-2xl text-white">
                        {context.name}
                      </div>
                      <div className="text-sm text-white/54">
                        {context.description || "No description yet."}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {context.isDefault ? (
                        <Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">
                          Default
                        </Badge>
                      ) : null}
                      <Badge className="bg-white/[0.08] text-white/70">
                        {context.shareMode}
                      </Badge>
                      {!context.active ? (
                        <Badge className="bg-amber-500/12 text-amber-200">
                          Inactive
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-4">
                    <Input
                      value={context.name}
                      onChange={(event) =>
                        void updateContextMutation.mutateAsync({
                          contextId: context.id,
                          patch: { name: event.target.value }
                        })
                      }
                      placeholder="Context name"
                    />
                    <select
                      value={context.shareMode}
                      onChange={(event) =>
                        void updateContextMutation.mutateAsync({
                          contextId: context.id,
                          patch: {
                            shareMode: event.target
                              .value as PreferenceContext["shareMode"]
                          }
                        })
                      }
                      className="min-h-10 rounded-[18px] border border-white/8 bg-white/[0.05] px-3 text-sm text-white outline-none"
                    >
                      <option value="shared">shared</option>
                      <option value="blended">blended</option>
                      <option value="isolated">isolated</option>
                    </select>
                    <Input
                      value={String(context.decayDays)}
                      onChange={(event) =>
                        void updateContextMutation.mutateAsync({
                          contextId: context.id,
                          patch: { decayDays: Number(event.target.value || 90) }
                        })
                      }
                      placeholder="Decay days"
                    />
                    <Button
                      variant="secondary"
                      onClick={() =>
                        updateSearchParams({
                          contextId: context.id,
                          tab: "overview"
                        })
                      }
                    >
                      Open context
                    </Button>
                  </div>
                  <Textarea
                    value={context.description}
                    onChange={(event) =>
                      void updateContextMutation.mutateAsync({
                        contextId: context.id,
                        patch: { description: event.target.value }
                      })
                    }
                    className="min-h-20"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void updateContextMutation.mutateAsync({
                          contextId: context.id,
                          patch: { active: !context.active }
                        })
                      }
                    >
                      {context.active ? "Deactivate" : "Activate"}
                    </Button>
                    {!context.isDefault ? (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          void updateContextMutation.mutateAsync({
                            contextId: context.id,
                            patch: { isDefault: true }
                          })
                        }
                      >
                        Make default
                      </Button>
                    ) : null}
                  </div>
                </Card>
              ))}
            </div>

            <div className="grid gap-4">
              <Card className="grid gap-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  Create context
                </div>
                <Input
                  value={newContextForm.name}
                  onChange={(event) =>
                    setNewContextForm((current) => ({
                      ...current,
                      name: event.target.value
                    }))
                  }
                  placeholder="Context name"
                />
                <Textarea
                  value={newContextForm.description}
                  onChange={(event) =>
                    setNewContextForm((current) => ({
                      ...current,
                      description: event.target.value
                    }))
                  }
                  className="min-h-24"
                  placeholder="What changes in this context?"
                />
                <select
                  value={newContextForm.shareMode}
                  onChange={(event) =>
                    setNewContextForm((current) => ({
                      ...current,
                      shareMode: event.target
                        .value as PreferenceContext["shareMode"]
                    }))
                  }
                  className="min-h-10 rounded-[18px] border border-white/8 bg-white/[0.05] px-3 text-sm text-white outline-none"
                >
                  <option value="blended">blended</option>
                  <option value="shared">shared</option>
                  <option value="isolated">isolated</option>
                </select>
                <Input
                  value={newContextForm.decayDays}
                  onChange={(event) =>
                    setNewContextForm((current) => ({
                      ...current,
                      decayDays: event.target.value
                    }))
                  }
                  placeholder="Decay days"
                />
                <Button
                  disabled={!newContextForm.name.trim()}
                  pending={createContextMutation.isPending}
                  pendingLabel="Creating context"
                  onClick={() =>
                    void createContextMutation.mutateAsync({
                      userId: selectedUserId,
                      domain: selectedDomain,
                      name: newContextForm.name,
                      description: newContextForm.description,
                      shareMode: newContextForm.shareMode,
                      decayDays: Number(newContextForm.decayDays || 90),
                      active: true,
                      isDefault: false
                    })
                  }
                >
                  Create context
                </Button>
              </Card>

              <Card className="grid gap-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  Merge contexts
                </div>
                <select
                  value={mergeSourceContextId}
                  onChange={(event) =>
                    setMergeSourceContextId(event.target.value)
                  }
                  className="min-h-10 rounded-[18px] border border-white/8 bg-white/[0.05] px-3 text-sm text-white outline-none"
                >
                  <option value="">Source context</option>
                  {workspace.contexts.map((context) => (
                    <option key={context.id} value={context.id}>
                      {context.name}
                    </option>
                  ))}
                </select>
                <select
                  value={mergeTargetContextId}
                  onChange={(event) =>
                    setMergeTargetContextId(event.target.value)
                  }
                  className="min-h-10 rounded-[18px] border border-white/8 bg-white/[0.05] px-3 text-sm text-white outline-none"
                >
                  <option value="">Target context</option>
                  {workspace.contexts.map((context) => (
                    <option key={context.id} value={context.id}>
                      {context.name}
                    </option>
                  ))}
                </select>
                <Button
                  pending={mergeContextMutation.isPending}
                  pendingLabel="Merging"
                  disabled={
                    !mergeSourceContextId ||
                    !mergeTargetContextId ||
                    mergeSourceContextId === mergeTargetContextId
                  }
                  onClick={() =>
                    void mergeContextMutation.mutateAsync({
                      sourceContextId: mergeSourceContextId,
                      targetContextId: mergeTargetContextId
                    })
                  }
                >
                  Merge into target
                </Button>
              </Card>
            </div>
          </div>
        ) : null}

        {selectedTab === "concepts" ? (
          <div className="grid gap-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_380px]">
              <Card className="grid gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                    Concept libraries
                  </div>
                  <div className="mt-1 text-sm text-white/54">
                    These are the lists Forge can use when you start the game in
                    a concept domain. Seeded lists are editable, and custom
                    lists are fully yours.
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  {[
                    ["Lists", workspace.libraries.totalCatalogs],
                    ["Concepts", workspace.libraries.totalCatalogItems],
                    ["Seeded", workspace.libraries.seededCatalogCount],
                    ["Custom", workspace.libraries.customCatalogCount]
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-[18px] bg-white/[0.04] px-4 py-4"
                    >
                      <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                        {label}
                      </div>
                      <div className="mt-2 font-display text-3xl text-white">
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <Search className="size-4 text-white/38" />
                  <Input
                    value={conceptSearchQuery}
                    onChange={(event) =>
                      setConceptSearchQuery(event.target.value)
                    }
                    placeholder="Search lists, concepts, tags, and seeded domains"
                  />
                </div>
              </Card>

              <Card className="grid gap-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  Create concept list
                </div>
                <Input
                  value={catalogForm.title}
                  onChange={(event) =>
                    setCatalogForm((current) => ({
                      ...current,
                      title: event.target.value
                    }))
                  }
                  placeholder="List title"
                />
                <Textarea
                  value={catalogForm.description}
                  onChange={(event) =>
                    setCatalogForm((current) => ({
                      ...current,
                      description: event.target.value
                    }))
                  }
                  className="min-h-24"
                  placeholder="What should this list help compare?"
                />
                <Button
                  disabled={!catalogForm.title.trim()}
                  pending={createCatalogMutation.isPending}
                  pendingLabel="Creating list"
                  onClick={() =>
                    void createCatalogMutation.mutateAsync({
                      userId: selectedUserId,
                      domain: selectedDomain,
                      title: catalogForm.title,
                      description: catalogForm.description
                    })
                  }
                >
                  Create list
                </Button>
              </Card>
            </div>

            <div className="grid gap-4">
              {filteredCatalogs.map((catalog) => {
                const conceptForm = newConceptByCatalogId[catalog.id] ?? {
                  label: "",
                  description: "",
                  tags: ""
                };
                const visibleItems = catalog.items.filter((item) =>
                  conceptSearchQuery.trim()
                    ? [item.label, item.description, item.tags.join(" ")]
                        .join(" ")
                        .toLowerCase()
                        .includes(normalizeText(conceptSearchQuery))
                    : true
                );
                return (
                  <Card key={catalog.id} className="grid gap-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        {editingCatalogId === catalog.id ? (
                          <div className="grid gap-3">
                            <Input
                              value={editingCatalogDraft.title}
                              onChange={(event) =>
                                setEditingCatalogDraft((current) => ({
                                  ...current,
                                  title: event.target.value
                                }))
                              }
                            />
                            <Textarea
                              value={editingCatalogDraft.description}
                              onChange={(event) =>
                                setEditingCatalogDraft((current) => ({
                                  ...current,
                                  description: event.target.value
                                }))
                              }
                              className="min-h-24"
                            />
                          </div>
                        ) : (
                          <>
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="font-display text-2xl text-white">
                                {catalog.title}
                              </div>
                              <Badge className="bg-white/[0.08] text-white/70">
                                {catalog.source}
                              </Badge>
                              <Badge className="bg-white/[0.08] text-white/70">
                                {catalog.items.length} items
                              </Badge>
                            </div>
                            <div className="mt-1 text-sm text-white/54">
                              {catalog.description || "No description yet."}
                            </div>
                          </>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            void startCatalogGame(selectedDomain, catalog.id)
                          }
                        >
                          Start from this list
                        </Button>
                        {editingCatalogId === catalog.id ? (
                          <>
                            <Button
                              size="sm"
                              pending={updateCatalogMutation.isPending}
                              pendingLabel="Saving"
                              onClick={() =>
                                void updateCatalogMutation.mutateAsync({
                                  catalogId: catalog.id,
                                  patch: {
                                    title: editingCatalogDraft.title,
                                    description: editingCatalogDraft.description
                                  }
                                })
                              }
                            >
                              Save
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingCatalogId(null)}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingCatalogId(catalog.id);
                              setEditingCatalogDraft({
                                title: catalog.title,
                                description: catalog.description
                              });
                            }}
                          >
                            Edit list
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          pending={deleteCatalogMutation.isPending}
                          pendingLabel="Deleting"
                          onClick={() =>
                            void deleteCatalogMutation.mutateAsync(catalog.id)
                          }
                        >
                          Delete list
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      {visibleItems.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-[18px] bg-white/[0.04] px-4 py-3"
                        >
                          {editingCatalogItemId === item.id ? (
                            <div className="grid gap-3">
                              <Input
                                value={editingCatalogItemDraft.label}
                                onChange={(event) =>
                                  setEditingCatalogItemDraft((current) => ({
                                    ...current,
                                    label: event.target.value
                                  }))
                                }
                              />
                              <Textarea
                                value={editingCatalogItemDraft.description}
                                onChange={(event) =>
                                  setEditingCatalogItemDraft((current) => ({
                                    ...current,
                                    description: event.target.value
                                  }))
                                }
                                className="min-h-20"
                              />
                              <Input
                                value={editingCatalogItemDraft.tags}
                                onChange={(event) =>
                                  setEditingCatalogItemDraft((current) => ({
                                    ...current,
                                    tags: event.target.value
                                  }))
                                }
                                placeholder="comma, separated, tags"
                              />
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  pending={updateCatalogItemMutation.isPending}
                                  pendingLabel="Saving"
                                  onClick={() =>
                                    void updateCatalogItemMutation.mutateAsync({
                                      catalogItemId: item.id,
                                      patch: {
                                        label: editingCatalogItemDraft.label,
                                        description:
                                          editingCatalogItemDraft.description,
                                        tags: editingCatalogItemDraft.tags
                                          .split(",")
                                          .map((entry) => entry.trim())
                                          .filter(Boolean)
                                      }
                                    })
                                  }
                                >
                                  Save concept
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditingCatalogItemId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-medium text-white">
                                  {item.label}
                                </div>
                                <div className="mt-1 text-sm text-white/54">
                                  {item.description || "No description yet."}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {item.tags.map((tag) => (
                                    <Badge
                                      key={`${item.id}-${tag}`}
                                      className="bg-white/[0.08] text-white/70"
                                    >
                                      {tag}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setEditingCatalogItemId(item.id);
                                    setEditingCatalogItemDraft({
                                      label: item.label,
                                      description: item.description,
                                      tags: item.tags.join(", ")
                                    });
                                  }}
                                >
                                  Edit
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  pending={deleteCatalogItemMutation.isPending}
                                  pendingLabel="Deleting"
                                  onClick={() =>
                                    void deleteCatalogItemMutation.mutateAsync(
                                      item.id
                                    )
                                  }
                                >
                                  <Trash2 className="mr-1 size-4" />
                                  Delete
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="grid gap-3 rounded-[18px] border border-white/8 bg-white/[0.02] px-4 py-4">
                      <div className="flex items-center gap-2 text-sm text-white/68">
                        <Plus className="size-4" />
                        Add concept to {catalog.title}
                      </div>
                      <Input
                        value={conceptForm.label}
                        onChange={(event) =>
                          setNewConceptByCatalogId((current) => ({
                            ...current,
                            [catalog.id]: {
                              ...conceptForm,
                              label: event.target.value
                            }
                          }))
                        }
                        placeholder="Concept label"
                      />
                      <Textarea
                        value={conceptForm.description}
                        onChange={(event) =>
                          setNewConceptByCatalogId((current) => ({
                            ...current,
                            [catalog.id]: {
                              ...conceptForm,
                              description: event.target.value
                            }
                          }))
                        }
                        className="min-h-20"
                        placeholder="Short description"
                      />
                      <Input
                        value={conceptForm.tags}
                        onChange={(event) =>
                          setNewConceptByCatalogId((current) => ({
                            ...current,
                            [catalog.id]: {
                              ...conceptForm,
                              tags: event.target.value
                            }
                          }))
                        }
                        placeholder="comma, separated, tags"
                      />
                      <Button
                        disabled={!conceptForm.label.trim()}
                        pending={createCatalogItemMutation.isPending}
                        pendingLabel="Adding"
                        onClick={() =>
                          void createCatalogItemMutation
                            .mutateAsync({
                              catalogId: catalog.id,
                              label: conceptForm.label,
                              description: conceptForm.description,
                              tags: conceptForm.tags
                                .split(",")
                                .map((entry) => entry.trim())
                                .filter(Boolean),
                              featureWeights: DEFAULT_DIMENSIONS
                            })
                            .then(() =>
                              setNewConceptByCatalogId((current) => ({
                                ...current,
                                [catalog.id]: {
                                  label: "",
                                  description: "",
                                  tags: ""
                                }
                              }))
                            )
                        }
                      >
                        Add concept
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      <Dialog.Root
        open={gameState.open}
        onOpenChange={(open) => {
          if (!open) {
            setGameError(null);
          }
          setGameState((current) => ({
            ...current,
            open
          }));
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgba(4,8,18,0.74)] backdrop-blur-xl" />
          <Dialog.Content className="fixed inset-x-4 bottom-4 top-4 z-50 overflow-y-auto rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,24,39,0.98),rgba(10,14,24,0.98))] shadow-[0_30px_90px_rgba(3,8,18,0.45)] md:inset-x-10 lg:left-1/2 lg:right-auto lg:w-[min(72rem,calc(100vw-3rem))] lg:-translate-x-1/2">
            <Dialog.Title className="sr-only">Preference game</Dialog.Title>
            <Dialog.Description className="sr-only">
              Start comparison rounds from a Forge domain or concept list.
            </Dialog.Description>

            <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-white/8 bg-[rgba(10,14,24,0.92)] px-5 py-4 backdrop-blur-xl">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                  Preference game
                </div>
                <div className="mt-1 font-display text-2xl text-white">
                  {gameState.phase === "domain"
                    ? "Choose a domain"
                    : gameState.phase === "catalog"
                      ? "Choose a concept list"
                      : "Pick the better fit"}
                </div>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close preference game"
                  className="rounded-full bg-white/6 p-2 text-white/65 transition hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" />
                </button>
              </Dialog.Close>
            </div>

            <div className="grid gap-5 px-5 py-5">
              {gameError ? (
                <div className="rounded-[18px] border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {gameError}
                </div>
              ) : null}

              {gameState.phase === "domain" ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {DOMAIN_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="rounded-[24px] border border-white/8 bg-white/[0.04] px-5 py-5 text-left transition hover:border-[var(--primary)]/30 hover:bg-[var(--primary)]/10"
                      onClick={() =>
                        void handleGameDomainSelection(option.value)
                      }
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium text-white">
                          {option.label}
                        </div>
                        <Badge className="bg-white/[0.08] text-white/70">
                          {option.mode === "forge" ? "Forge" : "Concept"}
                        </Badge>
                      </div>
                      <div className="mt-2 text-sm leading-6 text-white/56">
                        {option.description}
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}

              {gameState.phase === "catalog" ? (
                <div className="grid gap-4">
                  <div className="text-sm text-white/58">
                    Pick the concept list Forge should draw from. You do not
                    need to assemble the items yourself.
                  </div>
                  <div className="flex items-center gap-3">
                    <Search className="size-4 text-white/38" />
                    <Input
                      value={conceptSearchQuery}
                      onChange={(event) =>
                        setConceptSearchQuery(event.target.value)
                      }
                      placeholder="Search concept lists"
                    />
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {filteredCatalogs.length > 0 ? (
                      filteredCatalogs.map((catalog) => (
                        <button
                          key={catalog.id}
                          type="button"
                          className="rounded-[24px] border border-white/8 bg-white/[0.04] px-5 py-5 text-left transition hover:border-[var(--primary)]/30 hover:bg-[var(--primary)]/10"
                          onClick={() =>
                            void startCatalogGame(gameState.domain, catalog.id)
                          }
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-medium text-white">
                              {catalog.title}
                            </div>
                            <Badge className="bg-white/[0.08] text-white/70">
                              {catalog.items.length} items
                            </Badge>
                          </div>
                          <div className="mt-2 text-sm leading-6 text-white/56">
                            {catalog.description || "No description yet."}
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="rounded-[24px] bg-white/[0.04] px-5 py-6 text-sm text-white/58">
                        No concept list matches that search yet.
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              {gameState.phase === "play" ? (
                <div className="grid gap-5">
                  {gameLoading || gameWorkspaceQuery.isLoading ? (
                    <LoadingState
                      eyebrow="Preference game"
                      title="Preparing the next round"
                      description="Forge is lining up comparison candidates."
                    />
                  ) : nextPair ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-white/52">
                        <Badge className="bg-white/[0.08] text-white/70">
                          {DOMAIN_OPTIONS.find(
                            (entry) => entry.value === gameState.domain
                          )?.label ?? gameState.domain}
                        </Badge>
                        <span>{activeGameWorkspace?.selectedContext.name}</span>
                        <span>·</span>
                        <span>
                          {activeGameWorkspace?.compare.pendingCount ?? 0}{" "}
                          queued comparisons
                        </span>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-2">
                        <ComparisonCard
                          title={nextPair.left.label}
                          description={nextPair.left.description}
                          sideLabel="Left"
                          onClick={() => void handleGameJudgment("left", 1)}
                        />
                        <ComparisonCard
                          title={nextPair.right.label}
                          description={nextPair.right.description}
                          sideLabel="Right"
                          onClick={() => void handleGameJudgment("right", 1)}
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() => void handleGameJudgment("left", 1)}
                        >
                          Left
                        </Button>
                        <Button
                          onClick={() => void handleGameJudgment("right", 1)}
                        >
                          Right
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void handleGameJudgment("left", 1.75)}
                        >
                          Strong left
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void handleGameJudgment("right", 1.75)}
                        >
                          Strong right
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void handleGameJudgment("tie", 1)}
                        >
                          Tie
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void handleGameJudgment("skip", 1)}
                        >
                          Skip
                        </Button>
                      </div>

                      <div className="grid gap-4 rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-4 lg:grid-cols-2">
                        {[nextPair.left, nextPair.right].map((item) => (
                          <div key={item.id} className="grid gap-3">
                            <div className="font-medium text-white">
                              {item.label}
                            </div>
                            <div className="text-sm text-white/56">
                              Quick signals
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {SIGNAL_OPTIONS.map((signal) => (
                                <Button
                                  key={`${item.id}-${signal.signalType}`}
                                  variant="secondary"
                                  size="sm"
                                  onClick={() =>
                                    void handleGameSignal(
                                      item.id,
                                      signal.signalType
                                    )
                                  }
                                >
                                  {signal.label}
                                </Button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <EmptyState
                      eyebrow="Preference game"
                      title="No pair is ready yet"
                      description="Forge needs more items in this domain before it can keep asking comparisons."
                    />
                  )}
                </div>
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
