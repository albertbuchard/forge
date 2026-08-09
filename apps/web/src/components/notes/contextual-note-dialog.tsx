import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createNote } from "@/lib/api";
import {
  buildFallbackNoteLinkOptions,
  encodeNoteLinkOptionValue,
  mergeNoteLinkOptions,
  searchNoteLinkOptions
} from "@/lib/note-link-options";
import { normalizeNoteTags } from "@/lib/note-memory-tags";
import type { CrudEntityType } from "@/lib/types";
import { invalidateForgeSnapshot } from "@/store/api/invalidate-forge-snapshot";
import {
  NoteEditorFlowDialog,
  resolveNoteDraftDestroyAt,
  resolveNoteDraftFrontmatter,
  resolveNoteDraftLinks,
  type NoteEditorDraft
} from "./note-editor-flow-dialog";

export const CONTEXTUAL_NOTE_SOURCE_TYPES = [
  "goal",
  "project",
  "task",
  "strategy",
  "habit",
  "trigger_report"
] as const;

export type ContextualNoteSource = {
  version: 1;
  entityType: (typeof CONTEXTUAL_NOTE_SOURCE_TYPES)[number];
  entityId: string;
  anchorKey: string | null;
  label: string;
};

export type ContextualCreateReturnState = {
  scrollX: number;
  scrollY: number;
  focusTarget: HTMLElement | null;
};

function restoreReturnState(state: ContextualCreateReturnState | null) {
  if (!state || typeof window === "undefined") {
    return;
  }
  window.requestAnimationFrame(() => {
    window.scrollTo(state.scrollX, state.scrollY);
    if (state.focusTarget?.isConnected) {
      state.focusTarget.focus({ preventScroll: true });
    }
  });
}

export function ContextualNoteDialog({
  open,
  source,
  defaultUserId,
  returnState,
  onOpenChange
}: {
  open: boolean;
  source: ContextualNoteSource | null;
  defaultUserId: string | null;
  returnState: ContextualCreateReturnState | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const sourceValue = source
    ? encodeNoteLinkOptionValue(source.entityType, source.entityId)
    : null;
  const entityOptions = useMemo(
    () =>
      source && sourceValue
        ? mergeNoteLinkOptions(buildFallbackNoteLinkOptions([sourceValue]), [
            {
              value: sourceValue,
              label: source.label,
              description: "The record this note will stay linked to"
            }
          ])
        : [],
    [source, sourceValue]
  );

  if (!source) {
    return null;
  }

  const lockedLink = {
    entityType: source.entityType as CrudEntityType,
    entityId: source.entityId,
    anchorKey: source.anchorKey
  };
  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      restoreReturnState(returnState);
    }
  };

  return (
    <>
      <NoteEditorFlowDialog
        open={open}
        note={null}
        lockedLinks={[lockedLink]}
        entityOptions={entityOptions}
        onSearchEntityOptions={(query) =>
          searchNoteLinkOptions(query, defaultUserId ? [defaultUserId] : [])
        }
        draftScopeKey={`context.${source.entityType}.${source.entityId}.${source.anchorKey ?? "root"}`}
        onOpenChange={handleOpenChange}
        onSubmit={async (draft: NoteEditorDraft) => {
          await createNote({
            title: draft.title || undefined,
            contentMarkdown: draft.contentMarkdown,
            author: draft.author || null,
            tags: normalizeNoteTags(draft.tags),
            destroyAt: resolveNoteDraftDestroyAt(draft),
            frontmatter: resolveNoteDraftFrontmatter(draft),
            userId: defaultUserId ?? undefined,
            links: resolveNoteDraftLinks(draft),
            createContext: {
              version: 1,
              sourceEntityType: source.entityType,
              sourceEntityId: source.entityId,
              anchorKey: source.anchorKey
            }
          });
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["notes"] }),
            queryClient.invalidateQueries({ queryKey: ["notes-index"] }),
            invalidateForgeSnapshot(queryClient)
          ]);
          setConfirmation(`Note created and linked to ${source.label}.`);
        }}
      />

      {confirmation ? (
        <div
          role="status"
          aria-live="polite"
          className="surface-modal-panel fixed bottom-[calc(var(--forge-mobile-nav-clearance)+0.75rem)] left-1/2 z-[80] flex w-[min(32rem,calc(100vw-1.5rem))] -translate-x-1/2 items-center gap-3 rounded-[22px] border px-4 py-3 shadow-[var(--ui-shadow-floating)] md:bottom-6"
        >
          <CheckCircle2 className="size-5 shrink-0 text-[var(--success)]" />
          <span className="min-w-0 flex-1 text-sm text-[var(--ui-ink-strong)]">
            {confirmation}
          </span>
          <Button
            type="button"
            variant="ghost"
            className="size-11 shrink-0 rounded-full p-0"
            aria-label="Dismiss note confirmation"
            onClick={() => setConfirmation(null)}
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : null}
    </>
  );
}
