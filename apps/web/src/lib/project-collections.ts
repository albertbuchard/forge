import type { ProjectSummary } from "@/lib/types";

export type ProjectCollectionStatusFilter = "active" | "paused" | "completed" | "all";

export const PROJECT_COLLECTION_FILTER_ORDER: ProjectCollectionStatusFilter[] = [
  "active",
  "paused",
  "completed",
  "all"
];

export function buildProjectCollectionCounts(projects: ProjectSummary[]) {
  return {
    active: projects.filter((project) => project.status === "active").length,
    paused: projects.filter((project) => project.status === "paused").length,
    completed: projects.filter((project) => project.status === "completed").length,
    all: projects.length
  } satisfies Record<ProjectCollectionStatusFilter, number>;
}

export function filterProjectsByCollectionStatus(
  projects: ProjectSummary[],
  filter: ProjectCollectionStatusFilter
) {
  if (filter === "all") {
    return projects;
  }
  return projects.filter((project) => project.status === filter);
}
