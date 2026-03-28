import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHero } from "@/components/shell/page-hero";
import { NoteMarkdown } from "@/components/notes/note-markdown";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState } from "@/components/ui/page-state";
import { listNotes } from "@/lib/api";
import { formatAnchorKeyLabel, getEntityRoute, getPrimaryNavigableLink } from "@/lib/note-helpers";
import type { CrudEntityType } from "@/lib/types";

const FILTER_ENTITY_TYPES: Array<{ value: "" | CrudEntityType; label: string }> = [
  { value: "", label: "All linked entities" },
  { value: "goal", label: "Goals" },
  { value: "project", label: "Projects" },
  { value: "task", label: "Tasks" },
  { value: "trigger_report", label: "Trigger reports" },
  { value: "psyche_value", label: "Values" },
  { value: "behavior_pattern", label: "Patterns" },
  { value: "behavior", label: "Behaviors" },
  { value: "belief_entry", label: "Beliefs" },
  { value: "mode_profile", label: "Modes" }
];

export function NotesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const linkedEntityTypeParam = searchParams.get("entityType");
  const linkedEntityIdParam = searchParams.get("entityId");
  const linkedEntityType = FILTER_ENTITY_TYPES.some((option) => option.value === linkedEntityTypeParam)
    ? (linkedEntityTypeParam as "" | CrudEntityType)
    : "";
  const [query, setQuery] = useState(searchParams.get("query") ?? "");
  const [author, setAuthor] = useState(searchParams.get("author") ?? "");
  const [entityType, setEntityType] = useState<"" | CrudEntityType>(linkedEntityType);

  useEffect(() => {
    setQuery(searchParams.get("query") ?? "");
    setAuthor(searchParams.get("author") ?? "");
    setEntityType(linkedEntityType);
  }, [linkedEntityType, searchParams]);

  const notesQuery = useQuery({
    queryKey: ["notes-index", query, author, entityType, linkedEntityIdParam],
    queryFn: () =>
      listNotes({
        linkedEntityType: linkedEntityType && linkedEntityIdParam ? linkedEntityType : undefined,
        linkedEntityId: linkedEntityType && linkedEntityIdParam ? linkedEntityIdParam : undefined,
        query: query.trim() || undefined,
        author: author.trim() || undefined,
        limit: 120
      })
  });

  const visibleNotes = useMemo(() => {
    const notes = notesQuery.data?.notes ?? [];
    return notes.filter((note) =>
      note.links.some((link) => {
        if (linkedEntityType && linkedEntityIdParam) {
          return link.entityType === linkedEntityType && link.entityId === linkedEntityIdParam;
        }
        return entityType ? link.entityType === entityType : true;
      })
    );
  }, [entityType, linkedEntityIdParam, linkedEntityType, notesQuery.data?.notes]);

  if (notesQuery.isError) {
    return <ErrorState eyebrow="Notes" error={notesQuery.error} onRetry={() => void notesQuery.refetch()} />;
  }

  return (
    <div className="grid gap-5">
      <PageHero
        title="Notes"
        titleText="Notes"
        description={
          linkedEntityType && linkedEntityIdParam
            ? "Review the Markdown notes linked to this exact entity, then jump back into the surrounding work."
            : "Search Markdown notes across Forge by content, author, and linked entity. Each result can jump you straight back to the underlying work."
        }
        badge={`${visibleNotes.length} visible`}
      />

      <Card className="grid gap-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(12rem,0.7fr)_minmax(14rem,0.8fr)]">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search note content" />
          <Input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Filter by author" />
          <select
            value={entityType}
            onChange={(event) => setEntityType(event.target.value as "" | CrudEntityType)}
            disabled={Boolean(linkedEntityType && linkedEntityIdParam)}
            className="rounded-[22px] border border-white/8 bg-white/[0.04] px-4 py-3 text-sm text-white"
          >
            {FILTER_ENTITY_TYPES.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {notesQuery.isLoading ? (
        <Card className="text-sm text-white/58">Loading notes…</Card>
      ) : visibleNotes.length === 0 ? (
        <EmptyState eyebrow="Notes" title="No matching notes yet" description="Try a broader search or remove one of the filters." />
      ) : (
        <div className="grid gap-3">
          {visibleNotes.map((note) => {
            const primaryLink = getPrimaryNavigableLink(note);
            const href = primaryLink ? getEntityRoute(primaryLink.entityType, primaryLink.entityId) : null;
            return (
              <button
                key={note.id}
                type="button"
                className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.03))] p-5 text-left transition hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.04))]"
                onClick={() => {
                  if (href) {
                    navigate(href.includes("#") ? href : `${href}#notes`);
                  }
                }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="text-xs uppercase tracking-[0.16em] text-white/38">
                    {(note.author ?? "Unknown author").toString()} • {new Date(note.updatedAt).toLocaleString()}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {note.links.map((link) => (
                      <Badge key={`${note.id}-${link.entityType}-${link.entityId}-${link.anchorKey ?? ""}`} className="bg-white/[0.08] text-white/68" wrap>
                        {link.entityType.replaceAll("_", " ")}{link.anchorKey ? ` · ${formatAnchorKeyLabel(link.anchorKey)}` : ""}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="mt-4">
                  <NoteMarkdown markdown={note.contentMarkdown} className="line-clamp-none" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
