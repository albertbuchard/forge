import { useNavigate } from "react-router-dom";
import { NotebookPen } from "lucide-react";
import { formatNotesCountLabel, getEntityNotesHref } from "@/lib/note-helpers";
import type { CrudEntityType } from "@/lib/types";

export function EntityNoteCountLink({
  entityType,
  entityId,
  count,
  compact = false,
  className = ""
}: {
  entityType: CrudEntityType;
  entityId: string;
  count: number;
  compact?: boolean;
  className?: string;
}) {
  const navigate = useNavigate();
  const href = getEntityNotesHref(entityType, entityId);
  if (!href) {
    return null;
  }

  return (
    <span
      role="link"
      tabIndex={0}
      className={`inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] text-white/72 transition hover:bg-white/[0.09] hover:text-white ${
        compact ? "min-h-5 gap-1 px-2 py-0.5 text-[10px]" : "min-h-10 gap-2 px-3 py-2 text-xs"
      } ${className}`}
      onClick={(event) => {
        event.stopPropagation();
        navigate(href);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          navigate(href);
        }
      }}
    >
      <NotebookPen className={compact ? "size-3" : "size-3.5"} />
      {formatNotesCountLabel(count)}
    </span>
  );
}
