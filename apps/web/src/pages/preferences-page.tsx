import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Trash2 } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import {
  psycheFocusClass,
  usePsycheFocusTarget
} from "@/components/psyche/use-psyche-focus-target";
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
import { describeApiError } from "@/lib/api-error";
import type {
  PreferenceDimensionId,
  PreferenceDomain,
  PreferenceItemStatus,
  PreferenceSignalType
} from "@/lib/types";
import { getSingleSelectedUserId } from "@/lib/user-ownership";
import { cn } from "@/lib/utils";
import {
  DEFAULT_DIMENSIONS,
  DIMENSION_LABELS,
  DimensionBar,
  FORGE_GAME_DOMAINS,
  SIGNAL_MODEL_EFFECTS,
  STATUS_CLASSES,
  buildCandidateEntities,
  buildGameHeadline,
  formatPercent,
  getScoreStatus,
  getSourceEntityHref,
  normalizeText,
  resolveSelectedTab
} from "@/components/preferences/preferences-workspace-model";
import {
  PreferenceGameDialog,
  type PreferenceGameState
} from "@/components/preferences/preference-game-dialog";
import {
  PreferenceWorkspaceControls,
  PreferenceWorkspaceTabNav
} from "@/components/preferences/preference-workspace-chrome";
import {
  PreferenceGuidedFlowDialog,
  type PreferenceGuidedFlow,
  type PreferenceGuidedSubmit
} from "@/components/preferences/preference-guided-flow-dialog";
import { PreferenceEvidencePanel } from "@/components/preferences/preference-evidence-panel";

export function PreferencesPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [entitySearchQuery, setEntitySearchQuery] = useState("");
  const [conceptSearchQuery, setConceptSearchQuery] = useState("");
  const [guidedFlow, setGuidedFlow] = useState<PreferenceGuidedFlow | null>(
    null
  );
  const [gameState, setGameState] = useState<PreferenceGameState>({
    open: false,
    phase: "domain",
    domain: ((searchParams.get("domain") as PreferenceDomain | null) ??
      "projects") as PreferenceDomain
  });
  const [gameError, setGameError] = useState<string | null>(null);
  const [gameNotice, setGameNotice] = useState<string | null>(null);
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
  const focusedCatalogId = searchParams.get("focusCatalog");
  const focusedCatalogItemId = searchParams.get("focusCatalogItem");
  const focusedContextId = searchParams.get("focusContext");
  const focusedPreferenceRecordId =
    focusedItemIdFromQuery ??
    focusedCatalogId ??
    focusedCatalogItemId ??
    focusedContextId;
  usePsycheFocusTarget(focusedPreferenceRecordId);

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

  const matchingEntities = useMemo(() => {
    const normalized = normalizeText(entitySearchQuery);
    return candidateEntities
      .filter((entry) => entry.domain === selectedDomain)
      .filter((entry) =>
        normalized ? entry.searchText.includes(normalized) : true
      );
  }, [candidateEntities, entitySearchQuery, selectedDomain]);
  const filteredEntities = matchingEntities.slice(0, 12);

  const filteredCatalogs = useMemo(() => {
    const sourceWorkspace =
      gameState.open && gameState.phase === "catalog"
        ? (activeGameWorkspace ?? workspace)
        : workspace;
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
  }, [
    activeGameWorkspace,
    conceptSearchQuery,
    gameState.open,
    gameState.phase,
    workspace
  ]);

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
      setSelectedItemId(item.id);
    }
  });

  const createCatalogMutation = useMutation({
    mutationFn: createPreferenceCatalog,
    onSuccess: async () => {
      await refreshWorkspace();
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
      const manualScore =
        itemEditor.manualScore.trim().length > 0
          ? Number(itemEditor.manualScore)
          : null;
      const confidenceLock =
        itemEditor.confidenceLock.trim().length > 0
          ? Number(itemEditor.confidenceLock)
          : null;
      const featureWeights = Object.fromEntries(
        (Object.keys(DEFAULT_DIMENSIONS) as PreferenceDimensionId[]).map(
          (dimensionId) => [
            dimensionId,
            Number(itemEditor.featureWeights[dimensionId])
          ]
        )
      ) as Record<PreferenceDimensionId, number>;
      if (manualScore !== null && !Number.isFinite(manualScore)) {
        throw new Error("Manual score must be a valid number.");
      }
      if (
        confidenceLock !== null &&
        (!Number.isFinite(confidenceLock) ||
          confidenceLock < 0 ||
          confidenceLock > 1)
      ) {
        throw new Error("Confidence lock must be between 0 and 1.");
      }
      if (
        Object.values(featureWeights).some(
          (weight) => !Number.isFinite(weight) || weight < -1 || weight > 1
        )
      ) {
        throw new Error("Every dimension weight must be between -1 and 1.");
      }
      await patchPreferenceItem(selectedScore.item.id, {
        label: itemEditor.label,
        description: itemEditor.description,
        tags: itemEditor.tags
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
        featureWeights
      });
      await patchPreferenceScore(selectedScore.item.id, {
        userId: selectedUserId,
        domain: selectedDomain,
        contextId: workspace.selectedContext.id,
        manualStatus: itemEditor.manualStatus || null,
        manualScore,
        confidenceLock,
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
    onSuccess: refreshWorkspace
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
    setGameNotice(null);
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
    setGameNotice(null);
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
    setGameNotice(null);
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
    const effect =
      outcome === "tie"
        ? "Tie recorded"
        : outcome === "skip"
          ? "Pair skipped"
          : `${outcome === "left" ? pair.left.label : pair.right.label} preferred${strength > 1 ? " strongly" : ""}`;
    setGameNotice(`${effect} in ${activeGameWorkspace.selectedContext.name}.`);
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
    const item = activeGameWorkspace.scores.find(
      (score) => score.itemId === itemId
    )?.item;
    setGameNotice(
      `${signalType.replaceAll("_", " ")} recorded for ${item?.label ?? itemId} in ${activeGameWorkspace.selectedContext.name}.`
    );
  };

  const handleGuidedSubmit = async (input: PreferenceGuidedSubmit) => {
    if (!selectedUserId) {
      throw new Error("Select one user before changing a preference model.");
    }
    if (input.kind === "catalog") {
      await createCatalogMutation.mutateAsync({
        userId: selectedUserId,
        domain: selectedDomain,
        title: input.title,
        description: input.description
      });
      return;
    }
    if (input.kind === "catalog-item") {
      await createCatalogItemMutation.mutateAsync({
        catalogId: input.catalogId,
        label: input.label,
        description: input.description,
        tags: input.tags,
        featureWeights: DEFAULT_DIMENSIONS
      });
      return;
    }
    if (input.kind === "item") {
      await createItemMutation.mutateAsync({
        userId: selectedUserId,
        domain: selectedDomain,
        label: input.label,
        description: input.description,
        tags: input.tags,
        featureWeights: DEFAULT_DIMENSIONS,
        queueForCompare: input.queueForCompare
      });
      return;
    }
    if (input.kind === "context") {
      if (input.contextId) {
        await updateContextMutation.mutateAsync({
          contextId: input.contextId,
          patch: {
            name: input.name,
            description: input.description,
            shareMode: input.shareMode,
            decayDays: input.decayDays
          }
        });
      } else {
        await createContextMutation.mutateAsync({
          userId: selectedUserId,
          domain: selectedDomain,
          name: input.name,
          description: input.description,
          shareMode: input.shareMode,
          decayDays: input.decayDays,
          active: true,
          isDefault: false
        });
      }
      return;
    }
    if (input.kind === "merge") {
      await mergeContextMutation.mutateAsync({
        sourceContextId: input.sourceContextId,
        targetContextId: input.targetContextId
      });
      updateSearchParams({
        contextId: input.targetContextId,
        tab: "contexts",
        focusItem: null
      });
      return;
    }
    const { candidate } = input;
    const { item } = await enqueueMutation.mutateAsync({
      userId: selectedUserId,
      domain: selectedDomain,
      entityType: candidate.entityType,
      entityId: candidate.entityId,
      label: candidate.label,
      description: candidate.description,
      tags: []
    });
    setSelectedItemId(item.id);
    updateSearchParams({ focusItem: item.id });
  };

  const guidedFlowPending =
    guidedFlow?.kind === "catalog"
      ? createCatalogMutation.isPending
      : guidedFlow?.kind === "catalog-item"
        ? createCatalogItemMutation.isPending
        : guidedFlow?.kind === "item"
          ? createItemMutation.isPending
          : guidedFlow?.kind === "context"
            ? createContextMutation.isPending || updateContextMutation.isPending
            : guidedFlow?.kind === "merge"
              ? mergeContextMutation.isPending
              : guidedFlow?.kind === "entity"
                ? enqueueMutation.isPending
                : false;
  const mutationError = [
    updateCatalogMutation.error,
    deleteCatalogMutation.error,
    updateCatalogItemMutation.error,
    deleteCatalogItemMutation.error,
    saveItemMutation.error,
    updateContextMutation.error
  ].find(Boolean);
  const mutationErrorDescription = mutationError
    ? describeApiError(mutationError).description
    : null;

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
  const visibleScores = filteredScores.slice(0, 50);
  const visibleCatalogs = filteredCatalogs.slice(0, 12);
  const visibleContexts = workspace.contexts.slice(0, 16);
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

        {mutationErrorDescription ? (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-[18px] border border-[color-mix(in_srgb,var(--danger)_28%,transparent)] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
          >
            {mutationErrorDescription}
          </div>
        ) : null}

        <PsycheSectionNav />

        <PreferenceWorkspaceControls
          users={shell.snapshot.users}
          user={user}
          selectedUserId={selectedUserId}
          selectedDomain={selectedDomain}
          workspace={workspace}
          onPatchSearch={updateSearchParams}
        />

        <PreferenceWorkspaceTabNav
          selectedTab={selectedTab}
          onSelectTab={(tab) => updateSearchParams({ tab })}
        />

        {selectedTab === "overview" ? (
          <div className="grid gap-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_360px]">
              <Card className="grid gap-5">
                <div className="grid gap-2">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                    What Forge knows
                  </div>
                  <div className="font-display text-3xl text-[var(--ui-ink-strong)]">
                    {headline.title}
                  </div>
                  <div className="max-w-[70ch] text-sm leading-6 text-[var(--ui-ink-soft)]">
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
                      className="rounded-[22px] bg-[var(--ui-surface-2)] px-4 py-4"
                    >
                      <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                        {entry.label}
                      </div>
                      <div className="mt-2 font-display text-3xl text-[var(--ui-ink-strong)]">
                        {entry.value}
                      </div>
                      <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
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
                <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  Next move
                </div>
                <div className="font-display text-2xl text-[var(--ui-ink-strong)]">
                  Start the game
                </div>
                <div className="text-sm leading-6 text-[var(--ui-ink-soft)]">
                  Forge will ask a small number of pairwise questions. You
                  choose a domain, Forge supplies the candidates, and the model
                  tightens from there.
                </div>
                <Button className="w-full" onClick={() => openGame()}>
                  Start the game
                </Button>
                <div className="grid gap-3 rounded-[22px] bg-[var(--ui-surface-2)] px-4 py-4 text-sm text-[var(--ui-ink-soft)]">
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
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                      Preference map
                    </div>
                    <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
                      Green drifts positive, red drifts negative, and low
                      opacity still means uncertainty.
                    </div>
                  </div>
                  <Link to="?tab=map" className="text-sm text-[var(--primary)]">
                    Open full map
                  </Link>
                </div>
                <div className="relative min-h-[340px] overflow-hidden rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)]">
                  <div className="absolute inset-x-0 top-1/2 h-px bg-[var(--ui-border-subtle)]" />
                  <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--ui-border-subtle)]" />
                  {workspace.map.map((point) => (
                    <button
                      key={point.itemId}
                      type="button"
                      className={cn(
                        "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-1 text-[11px] shadow-[var(--ui-shadow-soft)] transition hover:scale-[1.04]",
                        point.itemId === selectedScore?.itemId
                          ? "border-[var(--ui-border-strong)] bg-[var(--ui-surface-active)] text-[var(--ui-ink-strong)]"
                          : point.score >= 0
                            ? "border-[color-mix(in_srgb,var(--success)_34%,transparent)] bg-[var(--ui-success-soft)] text-[var(--ui-ink-strong)]"
                            : "border-[color-mix(in_srgb,var(--danger)_34%,transparent)] bg-[var(--ui-danger-soft)] text-[var(--ui-ink-strong)]"
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
                <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  Best read so far
                </div>
                <div className="grid gap-2">
                  {topLikes.length > 0 ? (
                    topLikes.map((score) => (
                      <button
                        key={score.itemId}
                        type="button"
                        className="rounded-[18px] bg-[var(--ui-surface-2)] px-3 py-3 text-left transition hover:bg-[var(--ui-surface-hover)]"
                        onClick={() => {
                          setSelectedItemId(score.itemId);
                          updateSearchParams({ focusItem: score.itemId });
                        }}
                      >
                        <div className="font-medium text-[var(--ui-ink-strong)]">
                          {score.item?.label ?? score.itemId}
                        </div>
                        <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
                          {score.explanation[0] ||
                            "Forge has positive evidence here."}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="rounded-[18px] bg-[var(--ui-surface-2)] px-3 py-3 text-sm text-[var(--ui-ink-soft)]">
                      No clear positives yet. A few comparison rounds will
                      change that.
                    </div>
                  )}
                </div>
                <div className="border-t border-[var(--ui-border-subtle)] pt-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                    Biggest unknowns
                  </div>
                  <div className="mt-3 grid gap-2">
                    {biggestUnknowns.length > 0 ? (
                      biggestUnknowns.map((score) => (
                        <div
                          key={score.itemId}
                          className="rounded-[18px] bg-[var(--ui-surface-2)] px-3 py-3 text-sm text-[var(--ui-ink-soft)]"
                        >
                          <div className="font-medium text-[var(--ui-ink-strong)]">
                            {score.item?.label ?? score.itemId}
                          </div>
                          <div className="mt-1">
                            Uncertainty {formatPercent(score.uncertainty)}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[18px] bg-[var(--ui-surface-2)] px-3 py-3 text-sm text-[var(--ui-ink-soft)]">
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
                  <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                    Bring in Forge records
                  </div>
                  <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
                    Search goals, projects, tasks, strategies, or habits across
                    human and bot users, then send them straight into this
                    model.
                  </div>
                </div>
                <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                  Showing {filteredEntities.length} of {matchingEntities.length}
                </Badge>
              </div>
              <div className="flex items-center gap-3">
                <Search className="size-4 text-[var(--ui-ink-muted)]" />
                <Input
                  value={entitySearchQuery}
                  onChange={(event) => setEntitySearchQuery(event.target.value)}
                  placeholder="Search across owners, handles, user kind, title, and description"
                />
              </div>
              <div className="grid gap-2">
                {filteredEntities.map((entry) => {
                  const existingItem = workspace.scores.find(
                    (score) =>
                      score.item?.sourceEntityType === entry.entityType &&
                      score.item?.sourceEntityId === entry.entityId
                  )?.item;
                  return (
                    <div
                      key={`${entry.entityType}-${entry.entityId}`}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-[var(--ui-surface-2)] px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-[var(--ui-ink-strong)]">
                            {entry.label}
                          </span>
                          <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                            {entry.entityType}
                          </Badge>
                          {entry.user ? (
                            <UserBadge user={entry.user} compact />
                          ) : null}
                        </div>
                        <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
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
                          onClick={() =>
                            setGuidedFlow({
                              kind: "entity",
                              candidate: entry,
                              existingItemId: existingItem?.id
                            })
                          }
                        >
                          {existingItem ? "Review linked item" : "Add to model"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {matchingEntities.length === 0 ? (
                  <div className="rounded-[18px] bg-[var(--ui-surface-2)] px-4 py-4 text-sm text-[var(--ui-ink-soft)]">
                    No supported Forge record matches this domain and search.
                  </div>
                ) : null}
              </div>
            </Card>
          </div>
        ) : null}

        {selectedTab === "map" ? (
          <Card className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  Full map
                </div>
                <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
                  Click a point to inspect why Forge believes it belongs there.
                </div>
              </div>
              <div className="text-sm text-[var(--ui-ink-soft)]">
                {workspace.map.length} plotted items
              </div>
            </div>
            <div className="relative min-h-[520px] overflow-hidden rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)]">
              <div className="absolute inset-x-0 top-1/2 h-px bg-[var(--ui-border-subtle)]" />
              <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--ui-border-subtle)]" />
              {workspace.map.map((point) => (
                <button
                  key={point.itemId}
                  type="button"
                  className={cn(
                    "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-3 py-1 text-xs transition hover:scale-[1.04]",
                    point.itemId === selectedScore?.itemId
                      ? "border-[var(--ui-border-strong)] bg-[var(--ui-surface-active)] text-[var(--ui-ink-strong)]"
                      : point.score >= 0
                        ? "border-[color-mix(in_srgb,var(--success)_34%,transparent)] bg-[var(--ui-success-soft)] text-[var(--ui-ink-strong)]"
                        : "border-[color-mix(in_srgb,var(--danger)_34%,transparent)] bg-[var(--ui-danger-soft)] text-[var(--ui-ink-strong)]"
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
                <Search className="size-4 text-[var(--ui-ink-muted)]" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search learned items, explanations, tags, or dominant dimensions"
                />
              </div>
              <div className="text-xs text-[var(--ui-ink-faint)]">
                Showing {visibleScores.length} of {filteredScores.length}{" "}
                matching items. Refine the search to inspect results beyond this
                bounded view.
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2">Score</th>
                      <th className="px-3 py-2">Confidence</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleScores.map((score) => (
                      <tr
                        key={score.itemId}
                        data-psyche-focus-id={score.itemId}
                        aria-current={
                          focusedItemIdFromQuery === score.itemId
                            ? "true"
                            : undefined
                        }
                        className={cn(
                          "cursor-pointer border-t border-[var(--ui-border-subtle)] transition hover:bg-[var(--ui-surface-2)]",
                          score.itemId === selectedScore?.itemId
                            ? "bg-[var(--ui-surface-2)]"
                            : "",
                          focusedItemIdFromQuery === score.itemId
                            ? "bg-[color-mix(in_srgb,var(--info)_12%,var(--ui-surface-1)_88%)]"
                            : ""
                        )}
                        onClick={() => {
                          setSelectedItemId(score.itemId);
                          updateSearchParams({ focusItem: score.itemId });
                        }}
                      >
                        <td className="px-3 py-3">
                          <div className="font-medium text-[var(--ui-ink-strong)]">
                            {score.item?.label ?? score.itemId}
                          </div>
                          <div className="text-xs text-[var(--ui-ink-muted)]">
                            {(score.item?.tags ?? []).join(" · ")}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-[var(--ui-ink-medium)]">
                          {score.latentScore.toFixed(2)}
                        </td>
                        <td className="px-3 py-3 text-[var(--ui-ink-medium)]">
                          {formatPercent(score.confidence)}
                        </td>
                        <td className="px-3 py-3">
                          <Badge
                            className={STATUS_CLASSES[getScoreStatus(score)]}
                          >
                            {getScoreStatus(score)}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 text-[var(--ui-ink-medium)]">
                          {score.evidenceCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="grid gap-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
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
                      className="min-h-10 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm text-[var(--ui-ink-strong)] outline-none"
                    >
                      <option value="">Inferred status</option>
                      {Object.keys(STATUS_CLASSES).map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                    <Input
                      type="number"
                      step="0.05"
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
                      type="number"
                      min={0}
                      max={1}
                      step="0.05"
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
                        <div className="text-sm text-[var(--ui-ink-soft)]">
                          {DIMENSION_LABELS[dimensionId]}
                        </div>
                        <Input
                          type="number"
                          min={-1}
                          max={1}
                          step="0.05"
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
                  <div className="grid gap-2 text-sm text-[var(--ui-ink-soft)]">
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
                  <PreferenceEvidencePanel
                    score={selectedScore}
                    contextName={workspace.selectedContext.name}
                    modelVersion={workspace.profile.modelVersion}
                  />
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
                <div className="text-sm text-[var(--ui-ink-soft)]">
                  Select a row to inspect or edit it.
                </div>
              )}

              <div className="mt-3 grid gap-3 border-t border-[var(--ui-border-subtle)] pt-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                    Direct item
                  </div>
                  <div className="mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
                    Create a concrete scored item here. Reusable concepts belong
                    in a catalog instead.
                  </div>
                </div>
                <Button onClick={() => setGuidedFlow({ kind: "item" })}>
                  <Plus className="size-4" />
                  Add direct item
                </Button>
              </div>
            </Card>
          </div>
        ) : null}

        {selectedTab === "history" ? (
          <div className="grid gap-5 xl:grid-cols-3">
            <Card className="grid gap-3 xl:col-span-2">
              <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                Recent pairwise judgments
              </div>
              <div className="text-xs text-[var(--ui-ink-faint)]">
                Showing latest{" "}
                {Math.min(12, workspace.history.judgments.length)} of{" "}
                {workspace.history.judgments.length} in{" "}
                {workspace.selectedContext.name}.
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
                      className="rounded-[18px] bg-[var(--ui-surface-2)] px-4 py-3 text-sm text-[var(--ui-ink-soft)]"
                    >
                      <div className="font-medium text-[var(--ui-ink-strong)]">
                        {left} vs {right}
                      </div>
                      <div className="mt-1">
                        Outcome {judgment.outcome} · strength{" "}
                        {judgment.strength} ·{" "}
                        {new Date(judgment.createdAt).toLocaleString()}
                      </div>
                      <div className="mt-1 text-xs text-[var(--ui-ink-faint)]">
                        Context {workspace.selectedContext.name} · source{" "}
                        {judgment.source}
                      </div>
                    </div>
                  );
                })}
                {workspace.history.judgments.length === 0 ? (
                  <div className="rounded-[18px] bg-[var(--ui-surface-2)] px-4 py-3 text-sm text-[var(--ui-ink-soft)]">
                    No pairwise evidence exists in this context yet.
                  </div>
                ) : null}
              </div>
            </Card>
            <Card className="grid gap-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
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
                      className="rounded-[18px] bg-[var(--ui-surface-2)] px-3 py-2 text-sm text-[var(--ui-ink-soft)]"
                    >
                      <div className="font-medium text-[var(--ui-ink-strong)]">
                        {item} · {signal.signalType.replaceAll("_", " ")}
                      </div>
                      <div className="mt-1">
                        {SIGNAL_MODEL_EFFECTS[signal.signalType]}
                      </div>
                      <div className="mt-1 text-xs text-[var(--ui-ink-faint)]">
                        Context {workspace.selectedContext.name} · source{" "}
                        {signal.source} ·{" "}
                        {new Date(signal.createdAt).toLocaleString()}
                      </div>
                    </div>
                  );
                })}
                {workspace.history.signals.length === 0 ? (
                  <div className="rounded-[18px] bg-[var(--ui-surface-2)] px-3 py-2 text-sm text-[var(--ui-ink-soft)]">
                    No direct signals exist in this context yet.
                  </div>
                ) : null}
              </div>
              <div className="grid gap-2">
                {workspace.history.snapshots.slice(0, 5).map((snapshot) => (
                  <div
                    key={snapshot.id}
                    className="rounded-[18px] bg-[var(--ui-surface-2)] px-3 py-2 text-sm text-[var(--ui-ink-soft)]"
                  >
                    Snapshot {new Date(snapshot.createdAt).toLocaleString()}
                  </div>
                ))}
              </div>
              <div className="rounded-[18px] bg-[var(--ui-surface-2)] px-3 py-3 text-sm text-[var(--ui-ink-soft)]">
                Stale items: {workspace.history.staleItemIds.length} · Flipped
                items: {workspace.history.flippedItemIds.length}
              </div>
            </Card>
          </div>
        ) : null}

        {selectedTab === "contexts" ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_360px]">
            <div className="grid gap-4">
              {visibleContexts.map((context) => (
                <Card
                  key={context.id}
                  data-psyche-focus-id={context.id}
                  aria-current={
                    focusedContextId === context.id ? "true" : undefined
                  }
                  className={cn(
                    "grid gap-3",
                    psycheFocusClass(focusedContextId === context.id)
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-display text-2xl text-[var(--ui-ink-strong)]">
                        {context.name}
                      </div>
                      <div className="text-sm text-[var(--ui-ink-soft)]">
                        {context.description || "No description yet."}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {context.isDefault ? (
                        <Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">
                          Default
                        </Badge>
                      ) : null}
                      <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                        {context.shareMode}
                      </Badge>
                      {!context.active ? (
                        <Badge className="bg-[var(--ui-warning-soft)] text-[var(--warning)]">
                          Inactive
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="grid gap-3 rounded-[18px] bg-[var(--ui-surface-2)] px-4 py-4 text-sm text-[var(--ui-ink-soft)] md:grid-cols-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                        Evidence sharing
                      </div>
                      <div className="mt-1">
                        {context.shareMode === "shared"
                          ? "All active contexts contribute at full weight."
                          : context.shareMode === "blended"
                            ? "This context is full weight; other active contexts contribute at 45%."
                            : "Only evidence recorded in this context contributes."}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                        Evidence decay
                      </div>
                      <div className="mt-1">{context.decayDays} days</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                        Provenance
                      </div>
                      <div className="mt-1">
                        {user?.displayName ?? selectedUserId} · {selectedDomain}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
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
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setGuidedFlow({ kind: "context", context })
                      }
                    >
                      Edit context
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        updateContextMutation.mutate({
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
                          updateContextMutation.mutate({
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
              {workspace.contexts.length > visibleContexts.length ? (
                <div className="text-sm text-[var(--ui-ink-soft)]">
                  Showing {visibleContexts.length} of{" "}
                  {workspace.contexts.length}
                  contexts. Open a context directly from its canonical link to
                  inspect records beyond this bounded view.
                </div>
              ) : null}
            </div>

            <div className="grid gap-4">
              <Card className="grid gap-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  Create context
                </div>
                <div className="text-sm leading-6 text-[var(--ui-ink-soft)]">
                  Define a situational boundary, evidence-sharing policy, and
                  decay window in a guided review flow.
                </div>
                <Button onClick={() => setGuidedFlow({ kind: "context" })}>
                  <Plus className="size-4" />
                  Create context
                </Button>
              </Card>

              <Card className="grid gap-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  Merge contexts
                </div>
                <div className="text-sm leading-6 text-[var(--ui-ink-soft)]">
                  Move judgments and signals into one target, retain the source
                  as inactive provenance, and recalculate target scores.
                </div>
                <Button
                  variant="secondary"
                  disabled={workspace.contexts.length < 2}
                  onClick={() => setGuidedFlow({ kind: "merge" })}
                >
                  Review context merge
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
                  <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                    Concept libraries
                  </div>
                  <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
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
                      className="rounded-[18px] bg-[var(--ui-surface-2)] px-4 py-4"
                    >
                      <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                        {label}
                      </div>
                      <div className="mt-2 font-display text-3xl text-[var(--ui-ink-strong)]">
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <Search className="size-4 text-[var(--ui-ink-muted)]" />
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
                <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  Create concept list
                </div>
                <div className="text-sm leading-6 text-[var(--ui-ink-soft)]">
                  Define its decision purpose, owner, domain, and custom
                  provenance before adding reusable concepts.
                </div>
                <Button onClick={() => setGuidedFlow({ kind: "catalog" })}>
                  <Plus className="size-4" />
                  Create concept list
                </Button>
              </Card>
            </div>

            <div className="grid gap-4">
              {visibleCatalogs.map((catalog) => {
                const matchingItems = catalog.items.filter((item) =>
                  conceptSearchQuery.trim()
                    ? [item.label, item.description, item.tags.join(" ")]
                        .join(" ")
                        .toLowerCase()
                        .includes(normalizeText(conceptSearchQuery))
                    : true
                );
                const visibleItems = matchingItems.slice(0, 24);
                return (
                  <Card
                    key={catalog.id}
                    data-psyche-focus-id={catalog.id}
                    aria-current={
                      focusedCatalogId === catalog.id ? "true" : undefined
                    }
                    className={cn(
                      "grid gap-4",
                      psycheFocusClass(focusedCatalogId === catalog.id)
                    )}
                  >
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
                              <div className="font-display text-2xl text-[var(--ui-ink-strong)]">
                                {catalog.title}
                              </div>
                              <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                                {catalog.source}
                              </Badge>
                              <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                                {catalog.domain}
                              </Badge>
                              <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                                {catalog.items.length} items
                              </Badge>
                            </div>
                            <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
                              {catalog.description || "No description yet."}
                            </div>
                            <div className="mt-1 text-xs text-[var(--ui-ink-faint)]">
                              Owner {user?.displayName ?? selectedUserId} ·{" "}
                              {catalog.source === "seeded"
                                ? "Forge seed provenance"
                                : "User-created provenance"}
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
                          pendingLabel="Archiving"
                          title="Archive this catalog and its reusable concepts. Concrete scored items already created from it remain in the preference model."
                          onClick={() => {
                            if (
                              window.confirm(
                                `Archive ${catalog.title}? Its reusable concepts leave the catalog, but existing scored items and evidence remain.`
                              )
                            ) {
                              deleteCatalogMutation.mutate(catalog.id);
                            }
                          }}
                        >
                          Archive list
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      {visibleItems.map((item) => (
                        <div
                          key={item.id}
                          data-psyche-focus-id={item.id}
                          aria-current={
                            focusedCatalogItemId === item.id
                              ? "true"
                              : undefined
                          }
                          className={cn(
                            "rounded-[18px] border border-transparent bg-[var(--ui-surface-2)] px-4 py-3",
                            psycheFocusClass(focusedCatalogItemId === item.id)
                          )}
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
                                <div className="font-medium text-[var(--ui-ink-strong)]">
                                  {item.label}
                                </div>
                                <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
                                  {item.description || "No description yet."}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {item.tags.map((tag) => (
                                    <Badge
                                      key={`${item.id}-${tag}`}
                                      className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
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
                                  pendingLabel="Archiving"
                                  title="Archive this reusable concept without deleting concrete scored items already created from it."
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `Archive ${item.label}? Existing scored items and evidence remain.`
                                      )
                                    ) {
                                      deleteCatalogItemMutation.mutate(item.id);
                                    }
                                  }}
                                >
                                  <Trash2 className="mr-1 size-4" />
                                  Archive
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                      {matchingItems.length > visibleItems.length ? (
                        <div className="text-xs text-[var(--ui-ink-faint)]">
                          Showing {visibleItems.length} of{" "}
                          {matchingItems.length}
                          matching concepts. Refine the search to narrow this
                          bounded list.
                        </div>
                      ) : null}
                    </div>

                    <div className="grid gap-3 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4">
                      <div className="flex items-center gap-2 text-sm text-[var(--ui-ink-medium)]">
                        <Plus className="size-4" />
                        Add concept to {catalog.title}
                      </div>
                      <Button
                        onClick={() =>
                          setGuidedFlow({ kind: "catalog-item", catalog })
                        }
                      >
                        Add concept
                      </Button>
                    </div>
                  </Card>
                );
              })}
              {filteredCatalogs.length > visibleCatalogs.length ? (
                <div className="text-sm text-[var(--ui-ink-soft)]">
                  Showing {visibleCatalogs.length} of {filteredCatalogs.length}
                  matching catalogs. Refine the search to narrow this bounded
                  view.
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <PreferenceGameDialog
        state={gameState}
        onOpenChange={(open) => {
          if (!open) {
            setGameError(null);
          }
          setGameState((current) => ({
            ...current,
            open
          }));
        }}
        error={
          gameError ??
          (gameWorkspaceQuery.error
            ? describeApiError(gameWorkspaceQuery.error).description
            : null)
        }
        notice={gameNotice}
        loading={gameLoading}
        submitting={judgmentMutation.isPending || signalMutation.isPending}
        workspaceLoading={gameWorkspaceQuery.isLoading}
        activeWorkspace={activeGameWorkspace}
        conceptSearchQuery={conceptSearchQuery}
        onConceptSearchQueryChange={setConceptSearchQuery}
        filteredCatalogs={visibleCatalogs}
        onSelectDomain={(domain) => void handleGameDomainSelection(domain)}
        onStartCatalogGame={(domain, catalogId) =>
          void startCatalogGame(domain, catalogId)
        }
        onJudge={(outcome, strength) => {
          setGameError(null);
          return handleGameJudgment(outcome, strength).catch((error) => {
            setGameError(describeApiError(error).description);
          });
        }}
        onSignal={(itemId, signalType) => {
          setGameError(null);
          void handleGameSignal(itemId, signalType).catch((error) =>
            setGameError(describeApiError(error).description)
          );
        }}
      />
      <PreferenceGuidedFlowDialog
        flow={guidedFlow}
        onOpenChange={(open) => {
          if (!open) {
            setGuidedFlow(null);
          }
        }}
        pending={guidedFlowPending}
        user={user}
        domain={selectedDomain}
        workspace={workspace}
        onSubmit={handleGuidedSubmit}
      />
    </>
  );
}
