import { Link } from "react-router-dom";
import { NotebookPen } from "lucide-react";
import { formatNotesCountLabel, getEntityNotesHref } from "@/lib/note-helpers";
import type { CrudEntityType } from "@/lib/types";

export function EntityNoteCountLink({
  entityType,
  entityId,
  count,
  className = ""
}: {
  entityType: CrudEntityType;
  entityId: string;
  count: number;
  className?: string;
}) {
  const href = getEntityNotesHref(entityType, entityId);
  if (!href) {
    return null;
  }

  return (
    <Link
      to={href}
      className={`inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-white/72 transition hover:bg-white/[0.09] hover:text-white ${className}`}
      onClick={(event) => event.stopPropagation()}
    >
      <NotebookPen className="size-3.5" />
      {formatNotesCountLabel(count)}
    </Link>
  );
}
