import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { InlineCreateNoteInput } from "@/lib/schemas";

const EMPTY_NOTE: InlineCreateNoteInput = {
  contentMarkdown: "",
  author: ""
};

export function buildEmptyInlineNote(): InlineCreateNoteInput {
  return { ...EMPTY_NOTE };
}

export function InlineNoteFields({
  notes,
  onChange,
  entityLabel
}: {
  notes: InlineCreateNoteInput[];
  onChange: (notes: InlineCreateNoteInput[]) => void;
  entityLabel: string;
}) {
  return (
    <div className="grid gap-3">
      {notes.length === 0 ? (
        <div className="rounded-[18px] bg-white/[0.04] px-4 py-4 text-sm leading-6 text-white/58">
          Add an optional Markdown note if this {entityLabel} should start with
          context, evidence, or a clear handoff summary.
        </div>
      ) : null}

      {notes.map((note, index) => (
        <div
          key={index}
          className="rounded-[20px] border border-white/8 bg-white/[0.04] p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Creation note {index + 1}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange(notes.filter((_, entryIndex) => entryIndex !== index))
              }
            >
              Remove
            </Button>
          </div>

          <div className="mt-4 grid gap-4">
            <label className="grid gap-2">
              <span className="text-sm text-white/58">Author</span>
              <Input
                value={note.author}
                placeholder="Albert"
                onChange={(event) =>
                  onChange(
                    notes.map((entry, entryIndex) =>
                      entryIndex === index
                        ? { ...entry, author: event.target.value }
                        : entry
                    )
                  )
                }
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm text-white/58">Markdown note</span>
              <Textarea
                className="min-h-28"
                value={note.contentMarkdown}
                placeholder="Capture why this was created now, what changed, or what the next person should know."
                onChange={(event) =>
                  onChange(
                    notes.map((entry, entryIndex) =>
                      entryIndex === index
                        ? { ...entry, contentMarkdown: event.target.value }
                        : entry
                    )
                  )
                }
              />
            </label>
          </div>
        </div>
      ))}

      <div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onChange([...notes, buildEmptyInlineNote()])}
        >
          Add creation note
        </Button>
      </div>
    </div>
  );
}
