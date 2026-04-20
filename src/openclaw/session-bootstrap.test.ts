import { beforeEach, describe, expect, it, vi } from "vitest";
import { callConfiguredForgeApi } from "./api-client.js";
import {
  buildLiveForgeSessionBootstrapContext,
  buildForgeSessionBootstrapContext,
  listPeopleBranchPages
} from "./session-bootstrap";

vi.mock("./api-client.js", () => ({
  callConfiguredForgeApi: vi.fn(),
  expectForgeSuccess: (result: { body: unknown }) => result.body
}));

const mockedCallConfiguredForgeApi = vi.mocked(callConfiguredForgeApi);

describe("forge session bootstrap", () => {
  beforeEach(() => {
    mockedCallConfiguredForgeApi.mockReset();
  });

  it("collects all descendants under the People wiki branch", () => {
    const peoplePages = listPeopleBranchPages([
      {
        id: "home",
        slug: "index",
        title: "Home",
        kind: "wiki",
        parentSlug: null
      },
      {
        id: "people-root",
        slug: "people",
        title: "People",
        kind: "wiki",
        parentSlug: "index"
      },
      {
        id: "albert",
        slug: "albert-buchard",
        title: "Albert Buchard",
        kind: "wiki",
        parentSlug: "people",
        contentPlain: "Founder page."
      },
      {
        id: "family",
        slug: "family",
        title: "Family",
        kind: "wiki",
        parentSlug: "people"
      },
      {
        id: "mother",
        slug: "mother",
        title: "Mother",
        kind: "wiki",
        parentSlug: "family",
        contentPlain: "Nested descendant."
      },
      {
        id: "concepts-root",
        slug: "concepts",
        title: "Concepts",
        kind: "wiki",
        parentSlug: "index"
      },
      {
        id: "strategy-page",
        slug: "execution-strategy",
        title: "Execution strategy",
        kind: "wiki",
        parentSlug: "concepts",
        contentPlain: "Not a people page."
      }
    ]);

    expect(peoplePages.map((page) => page.title)).toEqual([
      "Albert Buchard",
      "Family",
      "Mother"
    ]);
  });

  it("renders a compact live Forge bootstrap block for new sessions", () => {
    const content = buildForgeSessionBootstrapContext({
      bootstrapPolicy: {
        mode: "active_only",
        goalsLimit: 5,
        projectsLimit: 8,
        tasksLimit: 10,
        habitsLimit: 6,
        strategiesLimit: 4,
        peoplePageLimit: 4,
        includePeoplePages: true
      },
      overview: {
        generatedAt: "2026-04-07T10:15:00.000Z",
        warnings: ["Psyche summary omitted for this token."],
        operator: {
          activeProjects: [{ id: "p1", title: "Forge Plugin" }],
          focusTasks: [{ id: "t1", title: "Ship hook bootstrap" }],
          dueHabits: [{ id: "h1", title: "Sleep before 01:00" }],
          recommendedNextTask: {
            id: "t1",
            title: "Ship hook bootstrap"
          }
        }
      },
      goals: [
        {
          id: "g1",
          title: "Build Forge",
          status: "active",
          horizon: "year",
          description: "Ship a truthful operator system."
        }
      ],
      projects: [
        {
          id: "p1",
          title: "Forge Plugin",
          status: "active",
          goalId: "g1",
          description: "Keep the OpenClaw integration excellent."
        }
      ],
      tasks: [
        {
          id: "t1",
          title: "Ship hook bootstrap",
          status: "in_progress",
          priority: "high",
          dueDate: "2026-04-08",
          projectId: "p1",
          description: "Inject Forge overview at session start."
        }
      ],
      habits: [
        {
          id: "h1",
          title: "Sleep before 01:00",
          polarity: "positive",
          frequency: "daily",
          description: "Protect recovery so execution quality stays high."
        }
      ],
      strategies: [
        {
          id: "s1",
          title: "Forge rollout",
          status: "active",
          isLocked: true,
          overview: "Sequence the plugin, docs, and UI surfaces cleanly."
        }
      ],
      peoplePages: [
        {
          id: "w1",
          slug: "albert-buchard",
          title: "Albert Buchard",
          kind: "wiki",
          parentSlug: "people",
          contentPlain:
            "Albert is the operator behind Forge and the primary decision-maker for the system."
        }
      ]
    });

    expect(content).toContain("# Forge Session Bootstrap");
    expect(content).toContain("Bootstrap mode: active only");
    expect(content).toContain("## Goals (1)");
    expect(content).toContain("Build Forge [active | year]");
    expect(content).toContain("## Projects (1)");
    expect(content).toContain("Forge Plugin [active | goal: Build Forge]");
    expect(content).toContain("## Strategies (1)");
    expect(content).toContain("Forge rollout [active | locked]");
    expect(content).toContain("## Tasks (1)");
    expect(content).toContain(
      "Ship hook bootstrap [in_progress | high | due 2026-04-08 | project: Forge Plugin]"
    );
    expect(content).toContain("## Habits (1)");
    expect(content).toContain("Sleep before 01:00 [positive | daily]");
    expect(content).toContain("## Wiki People Pages (1)");
    expect(content).toContain("Albert Buchard — Albert is the operator behind Forge");
    expect(content).toContain("If you need more detail about any Forge entity");
    expect(content).toContain("goals, projects, tasks, habits, strategies");
  });

  it("skips bootstrap file generation entirely when the effective policy disables it", async () => {
    mockedCallConfiguredForgeApi.mockImplementation(async (_config, request) => {
      if (request.path === "/api/v1/agents/onboarding") {
        return {
          status: 200,
          body: {
            onboarding: {
              effectiveBootstrapPolicy: {
                mode: "disabled",
                goalsLimit: 0,
                projectsLimit: 0,
                tasksLimit: 0,
                habitsLimit: 0,
                strategiesLimit: 0,
                peoplePageLimit: 0,
                includePeoplePages: false
              }
            }
          }
        };
      }
      throw new Error(`Unexpected path: ${request.path}`);
    });

    const content = await buildLiveForgeSessionBootstrapContext({
      origin: "http://127.0.0.1",
      port: 4317,
      baseUrl: "http://127.0.0.1:4317",
      webAppUrl: "http://127.0.0.1:4317/forge/",
      portSource: "configured",
      dataRoot: "/tmp/forge",
      apiToken: "fg_live_test",
      actorLabel: "OpenClaw",
      timeoutMs: 15_000
    });

    expect(content).toBe("");
    expect(mockedCallConfiguredForgeApi).toHaveBeenCalledTimes(1);
  });

  it("uses budget-aware active-only route filters when loading live bootstrap content", async () => {
    mockedCallConfiguredForgeApi.mockImplementation(async (_config, request) => {
      if (request.path === "/api/v1/agents/onboarding") {
        return {
          status: 200,
          body: {
            onboarding: {
              effectiveBootstrapPolicy: {
                mode: "active_only",
                goalsLimit: 2,
                projectsLimit: 3,
                tasksLimit: 4,
                habitsLimit: 5,
                strategiesLimit: 2,
                peoplePageLimit: 1,
                includePeoplePages: true
              }
            }
          }
        };
      }
      if (request.path === "/api/v1/operator/overview") {
        return {
          status: 200,
          body: { overview: { generatedAt: "2026-04-21T08:00:00.000Z", operator: {} } }
        };
      }
      if (request.path === "/api/v1/goals?status=active&limit=2") {
        return {
          status: 200,
          body: { goals: [{ id: "g1", title: "Goal 1" }, { id: "g2", title: "Goal 2" }] }
        };
      }
      if (request.path === "/api/v1/projects?status=active&limit=3") {
        return {
          status: 200,
          body: { projects: [{ id: "p1", title: "Project 1" }] }
        };
      }
      if (request.path === "/api/v1/tasks?status=focus&limit=4") {
        return {
          status: 200,
          body: { tasks: [{ id: "t1", title: "Task 1" }] }
        };
      }
      if (request.path === "/api/v1/habits?dueToday=true&limit=5") {
        return {
          status: 200,
          body: { habits: [{ id: "h1", title: "Habit 1" }] }
        };
      }
      if (request.path === "/api/v1/strategies?status=active&limit=2") {
        return {
          status: 200,
          body: { strategies: [{ id: "s1", title: "Strategy 1" }] }
        };
      }
      if (request.path === "/api/v1/wiki/pages?kind=wiki&limit=25") {
        return {
          status: 200,
          body: {
            pages: [
              {
                id: "people-root",
                slug: "people",
                title: "People",
                kind: "wiki",
                parentSlug: "index"
              },
              {
                id: "albert",
                slug: "albert-buchard",
                title: "Albert Buchard",
                kind: "wiki",
                parentSlug: "people",
                contentPlain: "Operator page."
              },
              {
                id: "friend",
                slug: "friend",
                title: "Friend",
                kind: "wiki",
                parentSlug: "people",
                contentPlain: "Should be sliced away."
              }
            ]
          }
        };
      }
      throw new Error(`Unexpected path: ${request.path}`);
    });

    const content = await buildLiveForgeSessionBootstrapContext({
      origin: "http://127.0.0.1",
      port: 4317,
      baseUrl: "http://127.0.0.1:4317",
      webAppUrl: "http://127.0.0.1:4317/forge/",
      portSource: "configured",
      dataRoot: "/tmp/forge",
      apiToken: "fg_live_test",
      actorLabel: "OpenClaw",
      timeoutMs: 15_000
    });

    expect(content).toContain("Bootstrap mode: active only");
    expect(content).toContain("## Goals (2)");
    expect(content).toContain("## Wiki People Pages (1)");
    expect(content).toContain("Albert Buchard");
    expect(content).not.toContain("Friend");
  });
});
