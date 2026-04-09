import type { ForgeBoxCatalogEntry } from "@/lib/types";

export type WorkbenchToolOption = {
  key: string;
  label: string;
  description: string;
  accessMode: "read" | "write" | "read_write" | "exec";
  sources: string[];
  sourceSurfaceIds: string[];
};

function rankAccessMode(mode: WorkbenchToolOption["accessMode"]) {
  switch (mode) {
    case "exec":
      return 4;
    case "read_write":
      return 3;
    case "write":
      return 2;
    case "read":
    default:
      return 1;
  }
}

function preferAccessMode(
  left: WorkbenchToolOption["accessMode"],
  right: WorkbenchToolOption["accessMode"]
) {
  return rankAccessMode(left) >= rankAccessMode(right) ? left : right;
}

function normalizeToolDescription(toolKey: string, descriptions: string[]) {
  if (toolKey === "forge.search_entities") {
    return "Search across Forge entities. You can optionally narrow the search to specific entity types.";
  }
  if (toolKey === "forge.create_note") {
    return "Create a Forge note from generated content or captured markdown.";
  }
  if (toolKey === "forge.update_task_status") {
    return "Move a task between execution states such as backlog, focus, in progress, blocked, and done.";
  }
  return descriptions.sort((left, right) => right.length - left.length)[0] ?? "Workbench tool";
}

export function buildWorkbenchToolCatalog(
  boxes: ForgeBoxCatalogEntry[]
): WorkbenchToolOption[] {
  const byKey = new Map<string, WorkbenchToolOption>();

  for (const box of boxes) {
    for (const tool of box.tools) {
      const current = byKey.get(tool.key);
      if (!current) {
        byKey.set(tool.key, {
          key: tool.key,
          label: tool.label,
          description: normalizeToolDescription(tool.key, [tool.description]),
          accessMode: tool.accessMode,
          sources: [box.title],
          sourceSurfaceIds: box.surfaceId ? [box.surfaceId] : []
        });
        continue;
      }

      current.accessMode = preferAccessMode(current.accessMode, tool.accessMode);
      current.label = current.label.length >= tool.label.length ? current.label : tool.label;
      current.description = normalizeToolDescription(tool.key, [
        current.description,
        tool.description
      ]);
      if (!current.sources.includes(box.title)) {
        current.sources.push(box.title);
      }
      if (box.surfaceId && !current.sourceSurfaceIds.includes(box.surfaceId)) {
        current.sourceSurfaceIds.push(box.surfaceId);
      }
    }
  }

  return [...byKey.values()].sort((left, right) => {
    const accessDelta = rankAccessMode(right.accessMode) - rankAccessMode(left.accessMode);
    if (accessDelta !== 0) {
      return accessDelta;
    }
    return left.label.localeCompare(right.label);
  });
}
