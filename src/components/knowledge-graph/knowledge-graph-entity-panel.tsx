import { ArrowUpRight, GitBranchPlus, NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { getEntityNotesHref } from "@/lib/note-helpers";
import { cn, formatDateTime } from "@/lib/utils";
import type {
  KnowledgeGraphFocusFamilyGroup,
  KnowledgeGraphFocusPayload,
  KnowledgeGraphNode
} from "@/lib/knowledge-graph-types";

function getKnowledgeGraphNotesHref(node: KnowledgeGraphNode): string | null {
  switch (node.entityType) {
    case "workbench_flow":
    case "workbench_surface":
    case "wiki_space":
      return null;
    default:
      return getEntityNotesHref(node.entityType, node.entityId);
  }
}

function FocusRelationSection({
  group,
  onSelectNode
}: {
  group: KnowledgeGraphFocusFamilyGroup;
  onSelectNode: (node: KnowledgeGraphNode) => void;
}) {
  if (group.relations.length === 0) {
    return null;
  }

  return (
    <section className="grid gap-3 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            {group.label}
          </div>
          <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
            {group.itemCount} entities across {group.relationCount} relation
            {group.relationCount === 1 ? "" : "s"}
          </div>
        </div>
        <Badge className="border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] text-[var(--ui-ink-medium)]">
          {group.family}
        </Badge>
      </div>

      <div className="grid gap-3">
        {group.relations.map((relation) => (
          <div key={relation.relationKind} className="grid gap-2">
            <div className="text-xs font-medium text-[var(--ui-ink-soft)]">
              {relation.label}
            </div>
            <div className="grid gap-2">
              {relation.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="flex min-w-0 items-center justify-between gap-3 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] px-3 py-2 text-left transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
                  onClick={() => onSelectNode(item)}
                >
                  <span className="min-w-0">
                    <EntityName
                      kind={item.entityKind}
                      label={item.title}
                      className="max-w-full"
                      lines={1}
                    />
                    {item.subtitle ? (
                      <span className="mt-1 block truncate text-[12px] text-[var(--ui-ink-soft)]">
                        {item.subtitle}
                      </span>
                    ) : null}
                  </span>
                  <ArrowUpRight className="size-4 shrink-0 text-[var(--ui-ink-faint)]" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function KnowledgeGraphEntityPanel({
  focus,
  onOpenPage,
  onOpenNotes,
  onOpenHierarchy,
  onSelectNode,
  className
}: {
  focus: KnowledgeGraphFocusPayload;
  onOpenPage: (node: KnowledgeGraphNode) => void;
  onOpenNotes: (node: KnowledgeGraphNode) => void;
  onOpenHierarchy: (node: KnowledgeGraphNode) => void;
  onSelectNode: (node: KnowledgeGraphNode) => void;
  className?: string;
}) {
  if (!focus.focusNode) {
    return (
      <div
        className={cn(
          "grid h-full place-items-center rounded-[24px] border border-dashed border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-6 text-center",
          className
        )}
      >
        <div className="grid gap-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            Focus
          </div>
          <div className="text-sm text-[var(--ui-ink-soft)]">
            Select a node to inspect its structure, context, and nearby
            navigation paths.
          </div>
        </div>
      </div>
    );
  }

  const node = focus.focusNode;
  const notesHref = getKnowledgeGraphNotesHref(node);
  const secondRingTotal = Object.values(focus.secondRingCounts).reduce(
    (sum, value) => sum + value,
    0
  );

  return (
    <div
      className={cn(
        "grid h-full gap-4 rounded-[28px] border border-[var(--ui-border-subtle)] bg-[linear-gradient(180deg,rgba(11,17,30,0.98),rgba(9,14,24,0.96))] p-4 shadow-[0_28px_90px_rgba(0,0,0,0.3)]",
        className
      )}
    >
      <div className="grid gap-4 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[rgba(255,255,255,0.03)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <EntityBadge
              kind={node.entityKind}
              label={node.entityKind.replaceAll("_", " ")}
              compact
            />
            <div className="mt-3">
              <EntityName
                kind={node.entityKind}
                label={node.title}
                variant="heading"
                size="lg"
                lines={3}
                className="max-w-full"
              />
            </div>
            {node.subtitle ? (
              <div className="mt-2 text-sm text-[var(--ui-ink-soft)]">
                {node.subtitle}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {node.owner?.displayName ? (
              <Badge className="border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)]">
                {node.owner.displayName}
              </Badge>
            ) : null}
            {node.updatedAt ? (
              <Badge className="border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)]">
                Updated {formatDateTime(node.updatedAt)}
              </Badge>
            ) : null}
          </div>
        </div>

        {node.description ? (
          <div className="text-sm leading-6 text-[var(--ui-ink-soft)]">
            {node.description}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {node.previewStats.map((stat) => (
            <Badge
              key={`${stat.label}-${stat.value}`}
              className="border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)]"
            >
              {stat.label}: {stat.value}
            </Badge>
          ))}
          <Badge className="border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)]">
            Degree: {node.graphStats.degree}
          </Badge>
          <Badge className="border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)]">
            Structural: {node.graphStats.structuralDegree}
          </Badge>
          <Badge className="border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)]">
            Contextual: {node.graphStats.contextualDegree}
          </Badge>
          <Badge className="border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)]">
            Nearby second ring: {secondRingTotal}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-2">
          {node.href ? (
            <Button variant="secondary" onClick={() => onOpenPage(node)}>
              <ArrowUpRight className="size-4" />
              Open page
            </Button>
          ) : null}
          {notesHref ? (
            <Button variant="secondary" onClick={() => onOpenNotes(node)}>
              <NotebookPen className="size-4" />
              Open notes
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => onOpenHierarchy(node)}>
            <GitBranchPlus className="size-4" />
            Open in hierarchy
          </Button>
        </div>
      </div>

      <div className="grid gap-4">
        {focus.familyGroups.length > 0 ? (
          focus.familyGroups.map((group) => (
            <FocusRelationSection
              key={group.family}
              group={group}
              onSelectNode={onSelectNode}
            />
          ))
        ) : (
          <div className="rounded-[20px] border border-dashed border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-5 text-sm text-[var(--ui-ink-soft)]">
            This node has no explicit first-ring relationships in the current
            graph filters.
          </div>
        )}
      </div>
    </div>
  );
}
