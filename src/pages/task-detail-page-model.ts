import { CheckCheck, CircleAlert, Clock3, Play, Target } from "lucide-react";
import type { TaskStatus } from "@/lib/types";

export const TASK_STATUS_META: Array<{
  status: TaskStatus;
  label: string;
  description: string;
  icon: typeof Clock3;
}> = [
  {
    status: "backlog",
    label: "Backlog",
    description: "Not started yet.",
    icon: Clock3
  },
  {
    status: "focus",
    label: "Focus",
    description: "Ready to start soon.",
    icon: Target
  },
  {
    status: "in_progress",
    label: "In progress",
    description: "Work is active now.",
    icon: Play
  },
  {
    status: "blocked",
    label: "Blocked",
    description: "Something is stopping progress.",
    icon: CircleAlert
  },
  {
    status: "done",
    label: "Done",
    description: "The task is completed.",
    icon: CheckCheck
  }
];

export const WORK_ITEM_LEVEL_META = {
  issue: {
    label: "Issue",
    noun: "issue",
    descriptor: "Vertical slice issue",
    heroDescription:
      "Track the vertical slice, keep the acceptance bar explicit, and surface the execution context without losing the product-level story."
  },
  task: {
    label: "Task",
    noun: "task",
    descriptor: "AI session task",
    heroDescription:
      "Drive one focused AI execution session, keep the work contract crisp, and show the concrete evidence of what changed."
  },
  subtask: {
    label: "Subtask",
    noun: "subtask",
    descriptor: "Granular child step",
    heroDescription:
      "Keep the child step sharply scoped, trace its parent chain, and make the work evidence visible without opening the editor."
  }
} as const;

export const GIT_REF_META = {
  commit: {
    label: "Commit",
    className: "bg-emerald-500/12 text-emerald-100"
  },
  branch: {
    label: "Branch",
    className: "bg-sky-500/12 text-sky-100"
  },
  pull_request: {
    label: "Pull request",
    className: "bg-fuchsia-500/12 text-fuchsia-100"
  }
} as const;

export function getWorkItemVisualKind(level: "issue" | "task" | "subtask") {
  return level === "issue" ? "issue" : "task";
}

export function getEntityHref(entityType: string, entityId: string) {
  switch (entityType) {
    case "goal":
      return `/goals/${entityId}`;
    case "project":
      return `/projects/${entityId}`;
    case "task":
      return `/tasks/${entityId}`;
    case "strategy":
      return `/strategies/${entityId}`;
    case "habit":
      return "/habits";
    default:
      return null;
  }
}

export function formatDurationLabel(seconds: number | null | undefined) {
  if (!seconds || seconds <= 0) {
    return "0 min";
  }
  if (seconds < 3600) {
    return `${Math.max(1, Math.round(seconds / 60))} min`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (minutes === 0) {
    return `${hours} h`;
  }
  return `${hours} h ${minutes} min`;
}
