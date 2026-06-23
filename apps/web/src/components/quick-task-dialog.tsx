import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TaskDialog } from "@/components/task-dialog";
import type { Goal, ProjectSummary, Tag, UserSummary } from "@/lib/types";
import type { QuickTaskInput } from "@/lib/schemas";

export function QuickTaskDialog({
  goals,
  projects,
  tags,
  users,
  defaultUserId = null,
  onSubmit
}: {
  goals: Goal[];
  projects: ProjectSummary[];
  tags: Tag[];
  users: UserSummary[];
  defaultUserId?: string | null;
  onSubmit: (input: QuickTaskInput) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>New task</Button>
      <TaskDialog
        open={open}
        goals={goals}
        projects={projects}
        tags={tags}
        users={users}
        editingTask={null}
        defaultUserId={defaultUserId}
        onOpenChange={setOpen}
        onSubmit={async (input) => {
          await onSubmit(input);
        }}
      />
    </>
  );
}
