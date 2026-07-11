import { useId } from "react";
import { ExternalLink, Link2, Network, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  buildKnowledgeGraphFocusHref,
  getKnowledgeGraphEntityHref,
  type KnowledgeGraphEntityType
} from "@/lib/knowledge-graph-types";
import type { Artifact, EntityLinkInput } from "@/lib/types";

export const MAX_ARTIFACT_ENTITY_LINKS = 100;

export const ARTIFACT_ENTITY_TYPE_SUGGESTIONS = [
  "goal",
  "strategy",
  "project",
  "task",
  "habit",
  "tag",
  "note",
  "wiki_space",
  "artifact",
  "insight",
  "calendar_event",
  "life_event",
  "psyche_value",
  "behavior_pattern",
  "behavior",
  "belief_entry",
  "mode_profile",
  "flashcard",
  "trigger_report",
  "sleep_session",
  "workout_session",
  "workbench_flow",
  "workbench_surface"
] as const;

const KNOWN_GRAPH_ENTITY_TYPES = new Set<string>(
  ARTIFACT_ENTITY_TYPE_SUGGESTIONS
);

export type ArtifactEntityLinkDraft = {
  id: string;
  entityType: string;
  entityId: string;
  relationship: string;
  anchorKey: string;
};

function createDraftId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `artifact-link-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createArtifactEntityLinkDraft(): ArtifactEntityLinkDraft {
  return {
    id: createDraftId(),
    entityType: "",
    entityId: "",
    relationship: "related",
    anchorKey: ""
  };
}

export function artifactEntityLinksToDrafts(
  links: Artifact["links"]
): ArtifactEntityLinkDraft[] {
  return links.map((link) => ({
    id: createDraftId(),
    entityType: link.targetEntityType,
    entityId: link.targetEntityId,
    relationship: link.relationship || "related",
    anchorKey: link.anchorKey ?? ""
  }));
}

export function validateArtifactEntityLinkDrafts(
  drafts: ArtifactEntityLinkDraft[]
) {
  if (drafts.length > MAX_ARTIFACT_ENTITY_LINKS) {
    return `Keep at most ${MAX_ARTIFACT_ENTITY_LINKS} relationships per artifact.`;
  }

  const incomplete = drafts.find(
    (draft) => !draft.entityType.trim() || !draft.entityId.trim()
  );
  if (incomplete) {
    return "Each relationship needs both an entity type and entity ID.";
  }

  const seen = new Set<string>();
  for (const draft of drafts) {
    const key = [
      draft.entityType.trim(),
      draft.entityId.trim(),
      draft.relationship.trim() || "related",
      draft.anchorKey.trim()
    ].join("\u0000");
    if (seen.has(key)) {
      return "Remove duplicate relationships before saving.";
    }
    seen.add(key);
  }

  return null;
}

export function artifactEntityLinkDraftsToInputs(
  drafts: ArtifactEntityLinkDraft[]
): EntityLinkInput[] {
  return drafts.map((draft) => ({
    entityType: draft.entityType.trim(),
    entityId: draft.entityId.trim(),
    relationship: draft.relationship.trim() || "related",
    anchorKey: draft.anchorKey.trim()
  }));
}

export function ArtifactEntityTypeInput({
  value,
  onChange,
  ariaLabel = "Entity type"
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  const suggestionsId = useId();
  return (
    <>
      <Input
        aria-label={ariaLabel}
        list={suggestionsId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="project"
      />
      <datalist id={suggestionsId}>
        {ARTIFACT_ENTITY_TYPE_SUGGESTIONS.map((entityType) => (
          <option key={entityType} value={entityType} />
        ))}
      </datalist>
    </>
  );
}

export function ArtifactEntityLinksEditor({
  drafts,
  onChange
}: {
  drafts: ArtifactEntityLinkDraft[];
  onChange: (drafts: ArtifactEntityLinkDraft[]) => void;
}) {
  const updateDraft = (id: string, patch: Partial<ArtifactEntityLinkDraft>) => {
    onChange(
      drafts.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft))
    );
  };

  return (
    <div className="grid gap-3">
      {drafts.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 text-sm text-[var(--ui-ink-muted)]">
          No entity relationships.
        </div>
      ) : (
        drafts.map((draft, index) => (
          <div
            key={draft.id}
            className="grid min-w-0 gap-3 rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-[var(--ui-ink-strong)]">
                <Link2 className="size-4 shrink-0 text-[var(--primary)]" />
                <span className="truncate">Relationship {index + 1}</span>
              </div>
              <button
                type="button"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-muted)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--danger)]"
                onClick={() =>
                  onChange(
                    drafts.filter((candidate) => candidate.id !== draft.id)
                  )
                }
                aria-label={`Remove relationship ${index + 1}`}
                title="Remove relationship"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid min-w-0 gap-1.5 text-xs text-[var(--ui-ink-muted)]">
                Entity type
                <ArtifactEntityTypeInput
                  ariaLabel={`Entity type for relationship ${index + 1}`}
                  value={draft.entityType}
                  onChange={(entityType) =>
                    updateDraft(draft.id, { entityType })
                  }
                />
              </label>
              <label className="grid min-w-0 gap-1.5 text-xs text-[var(--ui-ink-muted)]">
                Entity ID
                <Input
                  aria-label={`Entity ID for relationship ${index + 1}`}
                  value={draft.entityId}
                  onChange={(event) =>
                    updateDraft(draft.id, { entityId: event.target.value })
                  }
                  placeholder="Exact Forge record ID"
                />
              </label>
              <label className="grid min-w-0 gap-1.5 text-xs text-[var(--ui-ink-muted)]">
                Relationship
                <Input
                  aria-label={`Relationship for relationship ${index + 1}`}
                  value={draft.relationship}
                  onChange={(event) =>
                    updateDraft(draft.id, { relationship: event.target.value })
                  }
                  placeholder="related"
                />
              </label>
              <label className="grid min-w-0 gap-1.5 text-xs text-[var(--ui-ink-muted)]">
                Anchor key
                <Input
                  aria-label={`Anchor key for relationship ${index + 1}`}
                  value={draft.anchorKey}
                  onChange={(event) =>
                    updateDraft(draft.id, { anchorKey: event.target.value })
                  }
                  placeholder="Optional section anchor"
                />
              </label>
            </div>
          </div>
        ))
      )}
      <Button
        type="button"
        variant="secondary"
        disabled={drafts.length >= MAX_ARTIFACT_ENTITY_LINKS}
        onClick={() => onChange([...drafts, createArtifactEntityLinkDraft()])}
      >
        <Plus className="size-4" />
        Add relationship
      </Button>
      <div className="text-xs text-[var(--ui-ink-muted)]">
        {drafts.length} of {MAX_ARTIFACT_ENTITY_LINKS} relationships
      </div>
    </div>
  );
}

function resolveEntityHrefs(entityType: string, entityId: string) {
  if (!KNOWN_GRAPH_ENTITY_TYPES.has(entityType)) {
    return { directHref: null, graphHref: null };
  }
  const typedEntity = entityType as KnowledgeGraphEntityType;
  return {
    directHref: getKnowledgeGraphEntityHref(typedEntity, entityId),
    graphHref: buildKnowledgeGraphFocusHref(typedEntity, entityId)
  };
}

function formatLinkLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function ArtifactEntityLinksList({
  links
}: {
  links: Artifact["links"];
}) {
  if (links.length === 0) {
    return (
      <p className="text-sm text-[var(--ui-ink-muted)]">No linked entities.</p>
    );
  }

  return (
    <div className="grid gap-2">
      {links.map((link) => {
        const { directHref, graphHref } = resolveEntityHrefs(
          link.targetEntityType,
          link.targetEntityId
        );
        return (
          <div
            key={`${link.targetEntityType}:${link.targetEntityId}:${link.relationship}:${link.anchorKey ?? ""}`}
            className="min-w-0 rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 text-sm"
          >
            <div className="font-medium text-[var(--ui-ink-strong)]">
              {formatLinkLabel(link.targetEntityType)}
            </div>
            <div className="mt-1 break-all text-xs text-[var(--ui-ink-muted)]">
              {link.targetEntityId}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-2 py-1 text-[11px] font-medium text-[var(--ui-ink-muted)]">
                {formatLinkLabel(link.relationship)}
              </span>
              {directHref ? (
                <Link
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-xs font-medium text-[var(--primary)] hover:bg-[var(--ui-surface-hover)]"
                  to={directHref}
                >
                  <ExternalLink className="size-3.5" />
                  Open record
                </Link>
              ) : null}
              {graphHref ? (
                <Link
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-xs font-medium text-[var(--primary)] hover:bg-[var(--ui-surface-hover)]"
                  to={graphHref}
                >
                  <Network className="size-3.5" />
                  Open in graph
                </Link>
              ) : null}
            </div>
            {link.anchorKey ? (
              <div className="mt-2 break-words text-xs text-[var(--ui-ink-muted)]">
                Anchor: {link.anchorKey}
              </div>
            ) : null}
            {!directHref && !graphHref ? (
              <div className="mt-2 text-xs text-[var(--ui-ink-muted)]">
                No registered Forge route for this entity type.
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
