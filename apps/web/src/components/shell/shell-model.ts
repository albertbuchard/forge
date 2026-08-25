import type { Location as RouterLocation } from "react-router-dom";
import type { UserSummary } from "@/lib/types";
import type { KnowledgeGraphNode } from "@/lib/knowledge-graph-types";
import { formatKnowledgeGraphFocusValue } from "@/lib/knowledge-graph-types";
import { getEntityNotesHref } from "@/lib/note-helpers";

export function sameSelectedUserIds(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

export function sanitizeSelectedUserIds(
  selectedUserIds: string[],
  users: UserSummary[]
) {
  if (selectedUserIds.length === 0 || users.length === 0) {
    return selectedUserIds;
  }
  const validUserIds = new Set(users.map((user) => user.id));
  return selectedUserIds.filter((userId) => validUserIds.has(userId));
}

export function buildStartTaskNowInput(
  actor: string,
  options: {
    timerMode?: "planned" | "unlimited";
    plannedDurationSeconds?: number | null;
  } = {}
) {
  const timerMode = options.timerMode ?? "unlimited";
  const plannedDurationSeconds =
    options.plannedDurationSeconds === undefined
      ? timerMode === "planned"
        ? 20 * 60
        : null
      : options.plannedDurationSeconds;
  return {
    actor,
    timerMode,
    plannedDurationSeconds,
    isCurrent: true,
    leaseTtlSeconds: 1800,
    note: ""
  };
}

export function getKnowledgeGraphNodeNotesHref(node: KnowledgeGraphNode) {
  switch (node.entityType) {
    case "workbench_flow":
    case "workbench_surface":
    case "wiki_space":
    case "work_organization":
    case "work_engagement":
    case "opportunity_campaign":
    case "job_opportunity":
    case "job_application":
    case "job_interview":
    case "job_offer":
    case "work_outreach":
      return null;
    default:
      return getEntityNotesHref(node.entityType, node.entityId);
  }
}

export function buildKnowledgeGraphSearchFromLocation(
  location: RouterLocation,
  node: KnowledgeGraphNode | null,
  extras?: Record<string, string | null>
) {
  const next = new URLSearchParams(location.search);
  if (!node) {
    next.delete("focus");
  } else {
    next.set(
      "focus",
      formatKnowledgeGraphFocusValue(node.entityType, node.entityId)
    );
  }
  if (extras) {
    for (const [key, value] of Object.entries(extras)) {
      if (value === null) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }
  }
  const query = next.toString();
  return query ? `?${query}` : "";
}

export function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0
  }).format(value);
}

export function getRouteTransitionKey(pathname: string) {
  if (pathname === "/wiki" || pathname.startsWith("/wiki/page/")) {
    return "/wiki";
  }

  if (pathname === "/wiki/new" || pathname.startsWith("/wiki/edit/")) {
    return "/wiki/editor";
  }

  return pathname;
}

export function buildRoutePathKey(
  location: Pick<RouterLocation, "pathname" | "search" | "hash">
) {
  return `${location.pathname}${location.search}${location.hash}`;
}

export function buildRouteIntentLocation(
  currentLocation: RouterLocation,
  to: string
): RouterLocation {
  const target = new URL(to, "http://forge.local");
  return {
    ...currentLocation,
    pathname: target.pathname,
    search: target.search,
    hash: target.hash,
    key: `intent:${target.pathname}${target.search}${target.hash}`
  };
}
