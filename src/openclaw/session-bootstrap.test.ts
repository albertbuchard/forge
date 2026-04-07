import { describe, expect, it } from "vitest";
import {
  buildForgeSessionBootstrapContext,
  listPeopleBranchPages
} from "./session-bootstrap";

describe("forge session bootstrap", () => {
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
});
