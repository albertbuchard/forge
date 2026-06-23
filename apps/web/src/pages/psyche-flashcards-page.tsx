import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Image, Plus, Search, Sparkles, X } from "lucide-react";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import {
  psycheFocusClass,
  usePsycheFocusTarget
} from "@/components/psyche/use-psyche-focus-target";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserBadge } from "@/components/ui/user-badge";
import { UserSelectField } from "@/components/ui/user-select-field";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import {
  createFlashcard,
  deleteFlashcard,
  listFlashcards,
  patchFlashcard
} from "@/lib/api";
import { flashcardSchema, type FlashcardInput } from "@/lib/psyche-schemas";
import type { Flashcard } from "@/lib/psyche-types";
import type { UserSummary } from "@/lib/types";
import {
  formatOwnerSelectDefaultLabel,
  getSingleSelectedUserId
} from "@/lib/user-ownership";
import { cn } from "@/lib/utils";

const DEFAULT_FLASHCARD: FlashcardInput = {
  title: "",
  message: "",
  triggerSentence: "",
  triggerSituation: "",
  tags: [],
  backgroundColor: "#f8fafc",
  textColor: "#111827",
  accentColor: "#6ee7b7",
  typography: "serif",
  imageUrl: "",
  imageAlt: "",
  layout: "centered",
  visualStyle: "calm",
  linkedValueIds: [],
  linkedBehaviorIds: [],
  linkedPatternIds: [],
  linkedBeliefIds: [],
  linkedModeIds: [],
  linkedReportIds: [],
  userId: null
};

const TYPOGRAPHY_CLASSES: Record<Flashcard["typography"], string> = {
  serif: "font-serif",
  sans: "font-sans",
  mono: "font-mono",
  display: "font-display"
};

const STYLE_LABELS: Record<Flashcard["visualStyle"], string> = {
  calm: "Calm",
  urgent: "Urgent",
  warm: "Warm",
  clinical: "Clinical",
  playful: "Playful"
};

function splitList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function flashcardToInput(card: Flashcard): FlashcardInput {
  return {
    title: card.title,
    message: card.message,
    triggerSentence: card.triggerSentence,
    triggerSituation: card.triggerSituation,
    tags: card.tags,
    backgroundColor: card.backgroundColor,
    textColor: card.textColor,
    accentColor: card.accentColor,
    typography: card.typography,
    imageUrl: card.imageUrl,
    imageAlt: card.imageAlt,
    layout: card.layout,
    visualStyle: card.visualStyle,
    linkedValueIds: card.linkedValueIds,
    linkedBehaviorIds: card.linkedBehaviorIds,
    linkedPatternIds: card.linkedPatternIds,
    linkedBeliefIds: card.linkedBeliefIds,
    linkedModeIds: card.linkedModeIds,
    linkedReportIds: card.linkedReportIds,
    userId: card.userId ?? null
  };
}

function FlashcardPreview({
  card,
  compact = false,
  focused = false,
  onClick
}: {
  card: Flashcard | FlashcardInput;
  compact?: boolean;
  focused?: boolean;
  onClick?: () => void;
}) {
  const hasImage = card.imageUrl.trim().length > 0;
  const layout = card.layout;
  const title = card.title.trim();
  const trigger = card.triggerSentence.trim() || card.triggerSituation.trim();

  return (
    <button
      type="button"
      className={cn(
        "group min-w-0 rounded-[26px] border p-2 text-left shadow-[var(--card-shadow)] transition hover:-translate-y-0.5 hover:border-[var(--ui-border-strong)]",
        focused
          ? "border-[color-mix(in_srgb,var(--tertiary)_72%,var(--ui-border-subtle)_28%)]"
          : "border-[var(--ui-border-subtle)]"
      )}
      onClick={onClick}
    >
      <div
        className={cn(
          "relative grid min-h-[18rem] overflow-hidden rounded-[20px] border",
          compact ? "min-h-[15rem]" : "sm:min-h-[21rem]",
          layout === "image_split" && hasImage ? "md:grid-cols-[0.9fr_1.1fr]" : ""
        )}
        style={{
          background: card.backgroundColor,
          color: card.textColor,
          borderColor: card.accentColor
        }}
      >
        {hasImage && layout !== "image_split" ? (
          <img
            src={card.imageUrl}
            alt={card.imageAlt || title || "Flashcard image"}
            className="absolute inset-0 size-full object-cover opacity-30"
          />
        ) : null}
        {hasImage && layout === "image_split" ? (
          <div className="relative min-h-[10rem] overflow-hidden">
            <img
              src={card.imageUrl}
              alt={card.imageAlt || title || "Flashcard image"}
              className="absolute inset-0 size-full object-cover"
            />
          </div>
        ) : null}
        <div
          className={cn(
            "relative z-10 flex min-w-0 flex-col p-6",
            layout === "top_left" ? "items-start justify-start" : "items-center justify-center text-center",
            layout === "poster" ? "min-h-[22rem] p-8" : "",
            TYPOGRAPHY_CLASSES[card.typography]
          )}
        >
          <div
            className="mb-5 h-1.5 w-16 rounded-full"
            style={{ backgroundColor: card.accentColor }}
          />
          <div
            className={cn(
              "max-w-[24rem] text-balance leading-[1.12]",
              compact ? "text-2xl" : "text-[clamp(1.9rem,4vw,3.45rem)]"
            )}
          >
            {card.message || "Write the sentence that should meet you in the hard moment."}
          </div>
          {trigger ? (
            <div className="mt-6 max-w-md rounded-full border px-3 py-1.5 text-xs font-medium opacity-75" style={{ borderColor: card.accentColor }}>
              {trigger}
            </div>
          ) : null}
        </div>
      </div>
      <div className="px-2 pt-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {title ? (
            <div className="truncate text-sm font-semibold text-[var(--ui-ink-strong)]">
              {title}
            </div>
          ) : null}
          <Badge className="bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)]">
            {STYLE_LABELS[card.visualStyle]}
          </Badge>
        </div>
        {card.tags.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {card.tags.slice(0, 5).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-[var(--ui-surface-1)] px-2 py-1 text-[11px] text-[var(--ui-ink-soft)]"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </button>
  );
}

function FlashcardDialog({
  open,
  editingCard,
  draft,
  users,
  suggestedOwner,
  submitError,
  saving,
  onClose,
  onDelete,
  onDraftChange,
  onSubmit
}: {
  open: boolean;
  editingCard: Flashcard | null;
  draft: FlashcardInput;
  users: UserSummary[];
  suggestedOwner: UserSummary | null;
  submitError: string | null;
  saving: boolean;
  onClose: () => void;
  onDelete: () => void;
  onDraftChange: (draft: FlashcardInput) => void;
  onSubmit: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--overlay)] px-3 py-4 backdrop-blur-xl sm:items-center sm:p-6">
      <div className="max-h-[min(92dvh,58rem)] w-full max-w-6xl overflow-hidden rounded-[30px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] shadow-[var(--ui-shadow-floating)]">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--ui-border-subtle)] px-5 py-4">
          <div>
            <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--tertiary)]">
              {editingCard ? "Edit flashcard" : "New flashcard"}
            </div>
            <div className="mt-1 text-lg font-semibold text-[var(--ui-ink-strong)]">
              Message first, retrieval second, styling last.
            </div>
          </div>
          <button
            type="button"
            aria-label="Close flashcard editor"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="grid max-h-[calc(min(92dvh,58rem)-5rem)] min-h-0 overflow-y-auto p-4 md:grid-cols-[1fr_0.9fr] md:p-5">
          <div className="grid content-start gap-4 pr-0 md:pr-5">
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                Main message
              </label>
              <Textarea
                className="mt-2 min-h-28"
                value={draft.message}
                placeholder="This urge is a wave. You do not have to obey it."
                onChange={(event) =>
                  onDraftChange({ ...draft, message: event.target.value })
                }
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  Trigger sentence
                </label>
                <Input
                  className="mt-2"
                  value={draft.triggerSentence}
                  placeholder="I feel the urge to…"
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      triggerSentence: event.target.value
                    })
                  }
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  Optional title
                </label>
                <Input
                  className="mt-2"
                  value={draft.title}
                  placeholder="Late-night urge card"
                  onChange={(event) =>
                    onDraftChange({ ...draft, title: event.target.value })
                  }
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                Trigger situation
              </label>
              <Input
                className="mt-2"
                value={draft.triggerSituation}
                placeholder="Late evening shame, loneliness, conflict, or boredom"
                onChange={(event) =>
                  onDraftChange({
                    ...draft,
                    triggerSituation: event.target.value
                  })
                }
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                Tags
              </label>
              <Input
                className="mt-2"
                value={draft.tags.join(", ")}
                placeholder="urge, sobriety, grounding"
                onChange={(event) =>
                  onDraftChange({ ...draft, tags: splitList(event.target.value) })
                }
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                ["backgroundColor", "Background"],
                ["textColor", "Text"],
                ["accentColor", "Accent"]
              ].map(([key, label]) => (
                <label key={key} className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  {label}
                  <input
                    type="color"
                    value={String(draft[key as keyof FlashcardInput])}
                    className="h-11 w-full rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-1"
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        [key]: event.target.value
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                Typography
                <select
                  className="h-11 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 text-sm normal-case tracking-normal text-[var(--ui-ink-strong)]"
                  value={draft.typography}
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      typography: event.target.value as FlashcardInput["typography"]
                    })
                  }
                >
                  <option value="serif">Serif</option>
                  <option value="sans">Sans</option>
                  <option value="mono">Mono</option>
                  <option value="display">Display</option>
                </select>
              </label>
              <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                Layout
                <select
                  className="h-11 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 text-sm normal-case tracking-normal text-[var(--ui-ink-strong)]"
                  value={draft.layout}
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      layout: event.target.value as FlashcardInput["layout"]
                    })
                  }
                >
                  <option value="centered">Centered</option>
                  <option value="top_left">Top left</option>
                  <option value="image_split">Image split</option>
                  <option value="poster">Poster</option>
                </select>
              </label>
              <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                Tone
                <select
                  className="h-11 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 text-sm normal-case tracking-normal text-[var(--ui-ink-strong)]"
                  value={draft.visualStyle}
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      visualStyle: event.target.value as FlashcardInput["visualStyle"]
                    })
                  }
                >
                  <option value="calm">Calm</option>
                  <option value="urgent">Urgent</option>
                  <option value="warm">Warm</option>
                  <option value="clinical">Clinical</option>
                  <option value="playful">Playful</option>
                </select>
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  Image URL
                </label>
                <Input
                  className="mt-2"
                  value={draft.imageUrl}
                  placeholder="https://…"
                  onChange={(event) =>
                    onDraftChange({ ...draft, imageUrl: event.target.value })
                  }
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  Image alt
                </label>
                <Input
                  className="mt-2"
                  value={draft.imageAlt}
                  placeholder="Describe the image"
                  onChange={(event) =>
                    onDraftChange({ ...draft, imageAlt: event.target.value })
                  }
                />
              </div>
            </div>
            <UserSelectField
              users={users}
              value={draft.userId ?? null}
              defaultLabel={formatOwnerSelectDefaultLabel(
                suggestedOwner,
                "Choose flashcard owner"
              )}
              onChange={(userId) => onDraftChange({ ...draft, userId })}
              help="Flashcards can belong to a human or bot owner while still being searchable by trigger, tags, and linked Psyche records."
            />
            {submitError ? (
              <div className="rounded-[18px] border border-[var(--danger)]/20 bg-[var(--ui-danger-soft)] px-4 py-3 text-sm text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]">
                {submitError}
              </div>
            ) : null}
            <div className="flex flex-wrap justify-between gap-3">
              {editingCard ? (
                <Button type="button" variant="ghost" onClick={onDelete}>
                  Delete
                </Button>
              ) : (
                <span />
              )}
              <Button type="button" disabled={saving} onClick={onSubmit}>
                {saving ? "Saving..." : "Save flashcard"}
              </Button>
            </div>
          </div>
          <div className="mt-5 min-w-0 md:mt-0">
            <FlashcardPreview card={draft} compact />
          </div>
        </div>
      </div>
    </div>
  );
}

export function PsycheFlashcardsPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusedCardId = searchParams.get("focus");
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [draft, setDraft] = useState<FlashcardInput>(DEFAULT_FLASHCARD);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const defaultUserId = getSingleSelectedUserId(shell.selectedUserIds);
  const suggestedOwner =
    shell.snapshot.users.find((user) => user.id === defaultUserId) ?? null;

  usePsycheFocusTarget(focusedCardId);

  const flashcardsQuery = useQuery({
    queryKey: ["forge-psyche-flashcards", shell.selectedUserIds],
    queryFn: () => listFlashcards(shell.selectedUserIds)
  });

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setEditingCard(null);
      setDraft({ ...DEFAULT_FLASHCARD, userId: defaultUserId });
      setDialogOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("create");
      setSearchParams(next, { replace: true });
    }
  }, [defaultUserId, searchParams, setSearchParams]);

  const saveMutation = useMutation({
    mutationFn: async (input: FlashcardInput) => {
      const parsed = flashcardSchema.parse(input);
      if (editingCard) {
        return patchFlashcard(editingCard.id, parsed);
      }
      return createFlashcard(parsed);
    },
    onSuccess: async () => {
      setDialogOpen(false);
      setEditingCard(null);
      setDraft({ ...DEFAULT_FLASHCARD, userId: defaultUserId });
      setSubmitError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-flashcards"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] })
      ]);
    },
    onError: (error) => {
      setSubmitError(error instanceof Error ? error.message : String(error));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (card: Flashcard) => deleteFlashcard(card.id),
    onSuccess: async () => {
      setDialogOpen(false);
      setEditingCard(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-flashcards"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] })
      ]);
    }
  });

  const flashcards = flashcardsQuery.data?.flashcards ?? [];
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return flashcards;
    }
    return flashcards.filter((card) =>
      [
        card.title,
        card.message,
        card.triggerSentence,
        card.triggerSituation,
        ...card.tags
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [flashcards, query]);

  if (flashcardsQuery.isLoading) {
    return <LoadingState title="Loading Psyche flashcards" />;
  }

  if (flashcardsQuery.isError) {
    return (
      <ErrorState
        eyebrow="Psyche"
        error={flashcardsQuery.error}
        onRetry={() => void flashcardsQuery.refetch()}
      />
    );
  }

  return (
    <div className="grid gap-6">
      <PageHero
        title="Flashcards"
        titleText="Flashcards"
        description="Small therapeutic reminder cards for urges, trigger moments, mode shifts, and values-based pivots."
        actions={
          <Button
            type="button"
            onClick={() => {
              setEditingCard(null);
              setDraft({ ...DEFAULT_FLASHCARD, userId: defaultUserId });
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-2 size-4" />
            New flashcard
          </Button>
        }
      />
      <PsycheSectionNav />

      <div className="grid gap-4 rounded-[26px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] p-4 md:grid-cols-[1fr_auto] md:items-center">
        <div className="relative min-w-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ui-ink-faint)]" />
          <Input
            value={query}
            placeholder="Search message, tags, trigger sentence, or situation"
            className="pl-10"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2 text-sm text-[var(--ui-ink-soft)]">
          <Badge className="bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)]">
            {flashcards.length} saved
          </Badge>
          <Badge className="bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)]">
            {filtered.length} visible
          </Badge>
        </div>
      </div>

      {filtered.length > 0 ? (
        <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((card) => (
            <div
              key={card.id}
              className={psycheFocusClass(focusedCardId === card.id)}
            >
              <FlashcardPreview
                card={card}
                focused={focusedCardId === card.id}
                onClick={() => {
                  setEditingCard(card);
                  setDraft(flashcardToInput(card));
                  setDialogOpen(true);
                }}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1">
                <div className="flex min-w-0 items-center gap-2">
                  {card.user ? <UserBadge user={card.user} compact /> : null}
                  {card.imageUrl ? (
                    <Badge className="bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)]">
                      <Image className="mr-1 size-3" />
                      image
                    </Badge>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEditingCard(card);
                    setDraft(flashcardToInput(card));
                    setDialogOpen(true);
                  }}
                >
                  Edit
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[30px] border border-[var(--ui-border-subtle)] bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--tertiary)_12%,transparent),transparent_46%),var(--ui-surface-section)] p-8 text-center">
          <Sparkles className="mx-auto size-8 text-[var(--tertiary)]" />
          <div className="mt-4 text-xl font-semibold text-[var(--ui-ink-strong)]">
            No flashcards match this view.
          </div>
          <div className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--ui-ink-soft)]">
            Create cards for the sentences you want available during urges,
            shame spirals, critic attacks, and values-based pivots.
          </div>
        </div>
      )}

      <FlashcardDialog
        open={dialogOpen}
        editingCard={editingCard}
        draft={draft}
        users={shell.snapshot.users}
        suggestedOwner={suggestedOwner}
        submitError={submitError}
        saving={saveMutation.isPending || deleteMutation.isPending}
        onClose={() => {
          setDialogOpen(false);
          setEditingCard(null);
          setSubmitError(null);
        }}
        onDelete={() => {
          if (editingCard) {
            void deleteMutation.mutateAsync(editingCard);
          }
        }}
        onDraftChange={setDraft}
        onSubmit={() => void saveMutation.mutateAsync(draft)}
      />
    </div>
  );
}
