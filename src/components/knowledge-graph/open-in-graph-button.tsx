import type { ComponentProps } from "react";
import { Network } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  buildKnowledgeGraphFocusHref,
  type KnowledgeGraphEntityType,
  type KnowledgeGraphView
} from "@/lib/knowledge-graph-types";

export function OpenInGraphButton({
  entityType,
  entityId,
  view,
  label = "Open in graph",
  variant = "secondary",
  size
}: {
  entityType: KnowledgeGraphEntityType;
  entityId: string;
  view?: KnowledgeGraphView;
  label?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
}) {
  const navigate = useNavigate();

  return (
    <Button
      variant={variant}
      size={size}
      onClick={() =>
        navigate(buildKnowledgeGraphFocusHref(entityType, entityId, { view }))
      }
    >
      <Network className="size-4" />
      {label}
    </Button>
  );
}
