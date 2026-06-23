import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AiSurfaceWorkspace } from "@/components/customization/ai-surface-workspace";
import { type SurfaceWidgetDefinition } from "@/components/customization/editable-surface";
import { PillCluster } from "@/components/primitives/pill-cluster";
import { SectionGrid } from "@/components/primitives/section-grid";
import {
  ProjectsHeroBox,
  ProjectsSearchResultsBox,
  ProjectsSummaryBox
} from "@/components/workbench-boxes/projects/projects-boxes";
import { PageHero } from "@/components/shell/page-hero";
import { EntityNoteCountLink } from "@/components/notes/entity-note-count-link";
import { ProjectCollectionFilters } from "@/components/projects/project-collection-filters";
import { ProjectManagementSectionNav } from "@/components/projects/project-management-section-nav";
import {
  ProjectSearchBar,
  type ProjectSearchTokenOption
} from "@/components/projects/project-search-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { EmptyState } from "@/components/ui/page-state";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { UserBadge } from "@/components/ui/user-badge";
import { useForgeShell } from "@/components/shell/app-shell";
import { getEntityNotesSummary } from "@/lib/note-helpers";
import {
  buildProjectCollectionCounts,
  filterProjectsByCollectionStatus,
  type ProjectCollectionStatusFilter
} from "@/lib/project-collections";
import {
  buildOwnedEntitySearchText,
  formatOwnedEntityDescription
} from "@/lib/user-ownership";

const PROJECT_TYPE_LABELS = {
  execution: "Execution",
  value: "Value",
  category: "Category"
} as const;

function normalize(text: string) {
  return text.trim().toLowerCase();
}

export function ProjectsPage() {
  const shell = useForgeShell();
  const [collectionFilter, setCollectionFilter] =
    useState<ProjectCollectionStatusFilter>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSearchOptionIds, setSelectedSearchOptionIds] = useState<
    string[]
  >([]);
  const [pendingRestartProjectId, setPendingRestartProjectId] = useState<
    string | null
  >(null);

  const collectionCounts = useMemo(
    () => buildProjectCollectionCounts(shell.snapshot.dashboard.projects),
    [shell.snapshot.dashboard.projects]
  );

  const projectFacets = useMemo(() => {
    const goalsById = new Map(
      shell.snapshot.dashboard.goals.map((goal) => [goal.id, goal])
    );
    const tagsById = new Map(shell.snapshot.tags.map((tag) => [tag.id, tag]));
    const usersById = new Map(
      shell.snapshot.users.map((user) => [user.id, user])
    );
    const tasksByProjectId = new Map<string, typeof shell.snapshot.tasks>();

    for (const task of shell.snapshot.tasks) {
      if (!task.projectId) {
        continue;
      }
      const current = tasksByProjectId.get(task.projectId) ?? [];
      current.push(task);
      tasksByProjectId.set(task.projectId, current);
    }

    return new Map(
      shell.snapshot.dashboard.projects.map((project) => {
        const goal = goalsById.get(project.goalId) ?? null;
        const projectTasks = tasksByProjectId.get(project.id) ?? [];
        const projectUser = project.userId
          ? (usersById.get(project.userId) ?? null)
          : null;
        const projectTags = new Map<
          string,
          { id: string; name: string; kind: keyof typeof PROJECT_TYPE_LABELS }
        >();

        for (const tag of goal?.tags ?? []) {
          projectTags.set(tag.id, {
            id: tag.id,
            name: tag.name,
            kind: tag.kind
          });
        }
        for (const task of projectTasks) {
          for (const tagId of task.tagIds) {
            const tag = tagsById.get(tagId);
            if (!tag) {
              continue;
            }
            projectTags.set(tag.id, {
              id: tag.id,
              name: tag.name,
              kind: tag.kind
            });
          }
        }

        const typeKeys = Array.from(
          new Set(Array.from(projectTags.values()).map((tag) => tag.kind))
        );
        const searchText = [
          project.title,
          project.description,
          project.goalTitle,
          projectUser?.displayName ?? "",
          projectUser?.handle ?? "",
          projectUser?.kind ?? "",
          goal?.description ?? "",
          project.nextTaskTitle ?? "",
          project.momentumLabel,
          project.status,
          projectTasks.map((task) => task.title).join(" "),
          Array.from(projectTags.values())
            .map((tag) => `${tag.name} ${tag.kind}`)
            .join(" ")
        ]
          .join(" ")
          .toLowerCase();

        return [
          project.id,
          {
            tagIds: Array.from(projectTags.keys()),
            tags: Array.from(projectTags.values()),
            taskIds: projectTasks.map((task) => task.id),
            typeKeys,
            userId: project.userId,
            searchText
          }
        ] as const;
      })
    );
  }, [
    shell.snapshot.dashboard.goals,
    shell.snapshot.dashboard.projects,
    shell.snapshot.tags,
    shell.snapshot.tasks,
    shell.snapshot.users
  ]);

  const searchOptions = useMemo(() => {
    const optionMap = new Map<string, ProjectSearchTokenOption>();
    const projectIdsByGoal = new Map<string, Set<string>>();
    const projectIdsByTask = new Map<string, Set<string>>();
    const projectIdsByTag = new Map<string, Set<string>>();
    const projectIdsByStatus = new Map<string, Set<string>>();
    const projectIdsByType = new Map<string, Set<string>>();
    const projectIdsByUser = new Map<string, Set<string>>();

    for (const project of shell.snapshot.dashboard.projects) {
      const facets = projectFacets.get(project.id);
      if (!facets) {
        continue;
      }
      if (!projectIdsByGoal.has(project.goalId)) {
        projectIdsByGoal.set(project.goalId, new Set());
      }
      projectIdsByGoal.get(project.goalId)!.add(project.id);

      if (!projectIdsByStatus.has(project.status)) {
        projectIdsByStatus.set(project.status, new Set());
      }
      projectIdsByStatus.get(project.status)!.add(project.id);

      for (const taskId of facets.taskIds) {
        if (!projectIdsByTask.has(taskId)) {
          projectIdsByTask.set(taskId, new Set());
        }
        projectIdsByTask.get(taskId)!.add(project.id);
      }

      for (const tag of facets.tags) {
        if (!projectIdsByTag.has(tag.id)) {
          projectIdsByTag.set(tag.id, new Set());
        }
        projectIdsByTag.get(tag.id)!.add(project.id);
      }

      for (const typeKey of facets.typeKeys) {
        if (!projectIdsByType.has(typeKey)) {
          projectIdsByType.set(typeKey, new Set());
        }
        projectIdsByType.get(typeKey)!.add(project.id);
      }

      if (facets.userId) {
        if (!projectIdsByUser.has(facets.userId)) {
          projectIdsByUser.set(facets.userId, new Set());
        }
        projectIdsByUser.get(facets.userId)!.add(project.id);
      }
    }

    for (const goal of shell.snapshot.dashboard.goals) {
      const projectCount = projectIdsByGoal.get(goal.id)?.size ?? 0;
      if (projectCount === 0) {
        continue;
      }
      optionMap.set(`goal:${goal.id}`, {
        id: `goal:${goal.id}`,
        kind: "goal",
        value: goal.id,
        label: goal.title,
        description: formatOwnedEntityDescription(
          `${projectCount} project${projectCount === 1 ? "" : "s"} linked to this goal`,
          goal.user,
          `${projectCount} project${projectCount === 1 ? "" : "s"} linked to this goal`
        ),
        searchText: buildOwnedEntitySearchText(
          [goal.title, goal.description],
          goal
        )
      });
    }

    for (const task of shell.snapshot.tasks) {
      const projectCount = projectIdsByTask.get(task.id)?.size ?? 0;
      if (projectCount === 0) {
        continue;
      }
      optionMap.set(`task:${task.id}`, {
        id: `task:${task.id}`,
        kind: "task",
        value: task.id,
        label: task.title,
        description: formatOwnedEntityDescription(
          `${projectCount} project${projectCount === 1 ? "" : "s"} linked to this task`,
          task.user,
          `${projectCount} project${projectCount === 1 ? "" : "s"} linked to this task`
        ),
        searchText: buildOwnedEntitySearchText(
          [task.title, task.description],
          task
        )
      });
    }

    for (const tag of shell.snapshot.tags) {
      const projectCount = projectIdsByTag.get(tag.id)?.size ?? 0;
      if (projectCount === 0) {
        continue;
      }
      optionMap.set(`tag:${tag.id}`, {
        id: `tag:${tag.id}`,
        kind: "tag",
        value: tag.id,
        label: tag.name,
        description: formatOwnedEntityDescription(
          `${projectCount} project${projectCount === 1 ? "" : "s"} touching this tag`,
          tag.user,
          `${projectCount} project${projectCount === 1 ? "" : "s"} touching this tag`
        ),
        searchText: buildOwnedEntitySearchText(
          [tag.name, tag.kind, tag.description],
          tag
        )
      });
    }

    for (const [status, count] of Object.entries(collectionCounts)) {
      if (status === "all" || count === 0) {
        continue;
      }
      optionMap.set(`status:${status}`, {
        id: `status:${status}`,
        kind: "status",
        value: status,
        label:
          status === "paused"
            ? "Suspended"
            : status === "completed"
              ? "Finished"
              : "Active",
        description: `${count} project${count === 1 ? "" : "s"} currently ${status === "paused" ? "suspended" : status === "completed" ? "finished" : "active"}`,
        searchText: `${status} ${status === "paused" ? "suspended" : ""} ${status === "completed" ? "finished" : ""}`
      });
    }

    for (const [typeKey, label] of Object.entries(PROJECT_TYPE_LABELS)) {
      const projectCount = projectIdsByType.get(typeKey)?.size ?? 0;
      if (projectCount === 0) {
        continue;
      }
      optionMap.set(`type:${typeKey}`, {
        id: `type:${typeKey}`,
        kind: "type",
        value: typeKey,
        label,
        description: `${projectCount} project${projectCount === 1 ? "" : "s"} linked to ${label.toLowerCase()} tags`,
        searchText: `${label} ${typeKey} project type`
      });
    }

    for (const user of shell.snapshot.users) {
      const projectCount = projectIdsByUser.get(user.id)?.size ?? 0;
      if (projectCount === 0) {
        continue;
      }
      optionMap.set(`user:${user.id}`, {
        id: `user:${user.id}`,
        kind: "user",
        value: user.id,
        label: user.displayName,
        description: `${projectCount} project${projectCount === 1 ? "" : "s"} owned by this ${user.kind}`,
        searchText: `${user.displayName} ${user.handle} ${user.kind} ${user.description}`
      });
    }

    return Array.from(optionMap.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    );
  }, [
    collectionCounts,
    projectFacets,
    shell.snapshot.dashboard.goals,
    shell.snapshot.dashboard.projects,
    shell.snapshot.tags,
    shell.snapshot.tasks,
    shell.snapshot.users
  ]);

  const selectedSearchOptions = useMemo(
    () =>
      selectedSearchOptionIds
        .map((id) => searchOptions.find((option) => option.id === id))
        .filter(Boolean) as ProjectSearchTokenOption[],
    [searchOptions, selectedSearchOptionIds]
  );

  const visibleProjects = useMemo(() => {
    const normalizedQuery = normalize(searchQuery);

    return filterProjectsByCollectionStatus(
      shell.snapshot.dashboard.projects,
      collectionFilter
    ).filter((project) => {
      const facets = projectFacets.get(project.id);
      if (!facets) {
        return false;
      }

      const matchesTokens = selectedSearchOptions.every((option) => {
        switch (option.kind) {
          case "goal":
            return project.goalId === option.value;
          case "task":
            return facets.taskIds.includes(option.value);
          case "tag":
            return facets.tagIds.includes(option.value);
          case "status":
            return project.status === option.value;
          case "type":
            return facets.typeKeys.includes(
              option.value as keyof typeof PROJECT_TYPE_LABELS
            );
          case "user":
            return facets.userId === option.value;
          default:
            return true;
        }
      });

      if (!matchesTokens) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return facets.searchText.includes(normalizedQuery);
    });
  }, [
    collectionFilter,
    projectFacets,
    searchQuery,
    selectedSearchOptions,
    shell.snapshot.dashboard.projects
  ]);

  const projectPoolSize =
    collectionFilter === "all"
      ? collectionCounts.all
      : collectionCounts[collectionFilter];
  const activeSearch =
    searchQuery.trim().length > 0 || selectedSearchOptionIds.length > 0;
  const resultSummary = activeSearch
    ? `${visibleProjects.length} matching project${visibleProjects.length === 1 ? "" : "s"} in the current collection view`
    : `${projectPoolSize} project${projectPoolSize === 1 ? "" : "s"} in ${collectionFilter === "all" ? "all project states" : collectionFilter === "paused" ? "the suspended view" : collectionFilter === "completed" ? "the finished view" : "the active view"}`;

  const restartProject = async (projectId: string) => {
    setPendingRestartProjectId(projectId);
    try {
      await shell.patchProject(projectId, { status: "active" });
    } finally {
      setPendingRestartProjectId(null);
    }
  };

  const projectCards = (
    <SectionGrid columns="two" className="2xl:grid-cols-3">
      {visibleProjects.map((project) => {
        const projectNotes = getEntityNotesSummary(
          shell.snapshot.dashboard.notesSummaryByEntity,
          "project",
          project.id
        );
        const facets = projectFacets.get(project.id);
        const visibleTags = facets?.tags.slice(0, 3) ?? [];

        return (
          <Card
            key={project.id}
            className="flex h-full flex-col transition hover:bg-[var(--ui-surface-hover)]"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <EntityBadge kind="goal" label={project.goalTitle} compact />
                <UserBadge user={project.user} compact />
              </div>
              <Badge
                className={
                  project.status === "completed"
                    ? "bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]"
                    : project.status === "paused"
                      ? "bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_76%,var(--ui-ink-strong)_24%)]"
                      : "bg-[var(--ui-accent-soft)] text-[var(--primary)]"
                }
              >
                {project.status === "paused"
                  ? "Suspended"
                  : project.status === "completed"
                    ? "Finished"
                    : "Active"}
              </Badge>
            </div>

            <div className="mt-4">
              <Link
                to={`/projects/${project.id}`}
                className="transition hover:opacity-90"
              >
                <EntityName
                  kind="project"
                  label={project.title}
                  variant="heading"
                  size="xl"
                  lines={2}
                />
              </Link>
            </div>

            <p className="mt-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
              {project.description}
            </p>

            {visibleTags.length > 0 ? (
              <PillCluster className="mt-4">
                {visibleTags.map((tag) => (
                  <Badge
                    key={tag.id}
                    className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
                  >
                    {tag.name}
                  </Badge>
                ))}
              </PillCluster>
            ) : null}

            <div className="mt-4">
              <ProgressMeter
                value={project.progress}
                tone={project.status === "completed" ? "secondary" : "primary"}
              />
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div>
                <div className="font-label text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  Active
                </div>
                <div className="mt-2 text-[var(--ui-ink-strong)]">
                  {project.activeTaskCount}
                </div>
              </div>
              <div>
                <div className="font-label text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  Completed
                </div>
                <div className="mt-2 text-[var(--ui-ink-strong)]">
                  {project.completedTaskCount}
                </div>
              </div>
              <div>
                <div className="font-label text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  XP
                </div>
                <div className="mt-2 text-[var(--ui-ink-strong)]">
                  {project.earnedPoints}
                </div>
              </div>
            </div>

            <div className="mt-5 break-words text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)] [overflow-wrap:anywhere]">
              {project.nextTaskTitle
                ? `Next move: ${project.nextTaskTitle}`
                : "Ready for the next task"}
            </div>

            <div className="mt-4">
              <EntityNoteCountLink
                entityType="project"
                entityId={project.id}
                count={projectNotes.count}
              />
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 pt-1">
              <Link to={`/projects/${project.id}`}>
                <Button variant="ghost">Open project</Button>
              </Link>
              {collectionFilter !== "active" && project.status !== "active" ? (
                <Button
                  variant="secondary"
                  pending={pendingRestartProjectId === project.id}
                  pendingLabel="Restarting…"
                  onClick={() => void restartProject(project.id)}
                >
                  Restart
                </Button>
              ) : null}
            </div>
          </Card>
        );
      })}
    </SectionGrid>
  );

  const customWidgets: SurfaceWidgetDefinition[] = [
    {
      id: "hero",
      title: "Projects",
      description: "Route header",
      defaultWidth: 12,
      defaultHeight: 2,
      removable: false,
      surfaceChrome: "none",
      defaultTitleVisible: false,
      defaultDescriptionVisible: false,
      render: () => (
        <ProjectsHeroBox>
          <PageHero
            entityKind="project"
            title={
              <EntityName
                kind="project"
                label="Projects"
                variant="heading"
                size="lg"
              />
            }
            titleText="Projects"
            description="Projects are the concrete paths that move a life goal forward."
            badge={`${shell.snapshot.dashboard.projects.length} total projects`}
          />
        </ProjectsHeroBox>
      )
    },
    {
      id: "search-results",
      title: "Search and results",
      description: "Search stays grouped with its live result set.",
      defaultWidth: 8,
      defaultHeight: 6,
      minWidth: 6,
      render: ({ compact }) => (
        <ProjectsSearchResultsBox>
          <div className="grid min-w-0 gap-4">
            <ProjectSearchBar
              query={searchQuery}
              onQueryChange={setSearchQuery}
              options={searchOptions}
              selectedOptionIds={selectedSearchOptionIds}
              onSelectedOptionIdsChange={setSelectedSearchOptionIds}
              resultSummary={resultSummary}
            />
            <ProjectCollectionFilters
              value={collectionFilter}
              counts={collectionCounts}
              onChange={setCollectionFilter}
            />
            {visibleProjects.length === 0 ? (
              <Card>
                <div className="font-label text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  No matching projects
                </div>
                <div className="mt-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
                  Nothing in this project collection matches the current search
                  and chips.
                </div>
              </Card>
            ) : compact ? (
              <div className="grid min-w-0 gap-3">
                {visibleProjects.slice(0, 5).map((project) => (
                  <Link
                    key={project.id}
                    to={`/projects/${project.id}`}
                    className="block min-w-0 max-w-full rounded-[18px] bg-[var(--ui-surface-2)] px-4 py-3 transition hover:bg-[var(--ui-surface-hover)]"
                  >
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[var(--ui-ink-strong)]">
                          {project.title}
                        </div>
                        <div className="truncate text-sm text-[var(--ui-ink-soft)]">
                          {project.goalTitle}
                        </div>
                      </div>
                      <Badge
                        wrap
                        className="max-w-[7rem] shrink-0 bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)]"
                      >
                        {project.earnedPoints} xp
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              projectCards
            )}
          </div>
        </ProjectsSearchResultsBox>
      )
    },
    {
      id: "summary",
      title: "Collection summary",
      description: "Counts and spotlight cards.",
      defaultWidth: 4,
      defaultHeight: 5,
      minWidth: 4,
      render: () => {
        const spotlight =
          visibleProjects[0] ?? shell.snapshot.dashboard.projects[0] ?? null;
        return (
          <ProjectsSummaryBox>
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <Card className="p-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                    Active
                  </div>
                  <div className="mt-2 font-display text-4xl text-[var(--ui-ink-strong)]">
                    {collectionCounts.active}
                  </div>
                </Card>
                <Card className="p-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                    Finished
                  </div>
                  <div className="mt-2 font-display text-4xl text-[var(--ui-ink-strong)]">
                    {collectionCounts.completed}
                  </div>
                </Card>
              </div>
              {spotlight ? (
                <Card className="p-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                    Spotlight
                  </div>
                  <div className="mt-3 text-base font-semibold text-[var(--ui-ink-strong)]">
                    {spotlight.title}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                    {spotlight.description}
                  </div>
                  <div className="mt-3">
                    <ProgressMeter value={spotlight.progress} />
                  </div>
                </Card>
              ) : null}
            </div>
          </ProjectsSummaryBox>
        );
      }
    }
  ];

  return (
    <div className="grid gap-5">
      <ProjectManagementSectionNav />
      {shell.snapshot.dashboard.projects.length === 0 ? (
        <EmptyState
          eyebrow="Projects"
          title="No projects in flight"
          description="Create the first practical path under a life goal so execution, kanban, and evidence all have a concrete home."
          action={
            <Link
              to="/goals"
              className="inline-flex min-h-10 min-w-max shrink-0 items-center justify-center rounded-full bg-[var(--ui-surface-2)] px-4 py-3 text-sm whitespace-nowrap text-[var(--ui-ink-strong)] transition hover:bg-[var(--ui-surface-hover)]"
            >
              Open goals
            </Link>
          }
        />
      ) : (
        <AiSurfaceWorkspace surfaceId="projects" baseWidgets={customWidgets} />
      )}
    </div>
  );
}
