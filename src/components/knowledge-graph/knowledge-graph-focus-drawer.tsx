import { PanelRightOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KnowledgeGraphEntityPanel } from "@/components/knowledge-graph/knowledge-graph-entity-panel";
import type {
  KnowledgeGraphFocusPayload,
  KnowledgeGraphNode
} from "@/lib/knowledge-graph-types";

export function KnowledgeGraphFocusDrawer({
  focus,
  onOpenPage,
  onOpenNotes,
  onOpenHierarchy,
  onSelectNode,
  onClose
}: {
  focus: KnowledgeGraphFocusPayload;
  onOpenPage: (node: KnowledgeGraphNode) => void;
  onOpenNotes: (node: KnowledgeGraphNode) => void;
  onOpenHierarchy: (node: KnowledgeGraphNode) => void;
  onSelectNode: (node: KnowledgeGraphNode) => void;
  onClose?: () => void;
}) {
  return (
    <aside className="grid h-full gap-3 rounded-[28px] border border-[var(--ui-border-subtle)] bg-[rgba(8,13,24,0.94)] p-3 shadow-[0_32px_110px_rgba(0,0,0,0.38)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[rgba(11,16,28,0.92)] px-3 py-2">
        <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-soft)]">
          <PanelRightOpen className="size-3.5" />
          Focus Node
        </div>
        {onClose ? (
          <Button variant="secondary" size="sm" onClick={onClose}>
            <X className="size-4" />
            Close
          </Button>
        ) : null}
      </div>
      <KnowledgeGraphEntityPanel
        focus={focus}
        onOpenPage={onOpenPage}
        onOpenNotes={onOpenNotes}
        onOpenHierarchy={onOpenHierarchy}
        onSelectNode={onSelectNode}
        className="h-full"
      />
    </aside>
  );
}
