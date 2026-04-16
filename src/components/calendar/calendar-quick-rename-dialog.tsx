import { useEffect, useState } from "react";
import {
  FlowField,
  QuestionFlowDialog
} from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";

export function CalendarQuickRenameDialog({
  open,
  onOpenChange,
  initialTitle,
  pending = false,
  onSubmit
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTitle: string;
  pending?: boolean;
  onSubmit: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setTitle(initialTitle);
    setError(null);
  }, [initialTitle, open]);

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Calendar"
      title="Quick rename"
      description="Rename the event without reopening the full event guide."
      value={{ title }}
      onChange={(next) => setTitle(next.title)}
      draftPersistenceKey={`calendar.quick-rename.${initialTitle}`}
      steps={[
        {
          id: "rename",
          eyebrow: "Rename",
          title: "Update the event title",
          description:
            "Keep the rename fast and direct. Everything else on the event stays unchanged.",
          render: (value, setValue) => (
            <FlowField label="Event title">
              <Input
                value={value.title}
                onChange={(event) => setValue({ title: event.target.value })}
                placeholder="Weekly research supervision"
              />
            </FlowField>
          )
        }
      ]}
      submitLabel="Save title"
      pending={pending}
      pendingLabel="Saving"
      error={error}
      onSubmit={async () => {
        const nextTitle = title.trim();
        if (!nextTitle) {
          setError("Add a title before saving.");
          return;
        }
        setError(null);
        await onSubmit(nextTitle);
        onOpenChange(false);
      }}
    />
  );
}
