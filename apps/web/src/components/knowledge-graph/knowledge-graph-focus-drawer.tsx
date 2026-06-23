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
    <aside className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--ui-border-subtle)] px-4 py-3">
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
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        <KnowledgeGraphEntityPanel
          focus={focus}
          onOpenPage={onOpenPage}
          onOpenNotes={onOpenNotes}
          onOpenHierarchy={onOpenHierarchy}
          onSelectNode={onSelectNode}
        />
      </div>
    </aside>
  );
}
