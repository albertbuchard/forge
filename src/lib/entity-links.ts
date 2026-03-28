import type { ActivityEvent } from "@/lib/types";

export function getActivityEventHref(event: ActivityEvent): string | null {
  if (event.entityType === "goal") {
    return `/goals/${event.entityId}`;
  }

  if (event.entityType === "project") {
    return `/projects/${event.entityId}`;
  }

  if (event.entityType === "task") {
    return `/tasks/${event.entityId}`;
  }

  if (event.entityType === "task_run" && typeof event.metadata.taskId === "string") {
    return `/tasks/${event.metadata.taskId}`;
  }

  return null;
}

export function getActivityEventCtaLabel(event: ActivityEvent): string | null {
  if (event.entityType === "goal") {
    return "Open goal";
  }

  if (event.entityType === "project") {
    return "Open project";
  }

  if (event.entityType === "task" || event.entityType === "task_run") {
    return "Open task";
  }

  return null;
}
