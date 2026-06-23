import { describe, expect, it } from "vitest";
import { getWorkbenchNodeDefinition } from "./registry";

describe("workbench registry", () => {
  it("registers the missing Forge entity surfaces", () => {
    expect(getWorkbenchNodeDefinition("surface:habits:search-results")).toMatchObject({
      routePath: "/habits",
      category: "Habits"
    });
    expect(getWorkbenchNodeDefinition("surface:goals:search-results")).toMatchObject({
      routePath: "/goals",
      category: "Goals"
    });
    expect(
      getWorkbenchNodeDefinition("surface:strategies:search-results")
    ).toMatchObject({
      routePath: "/strategies",
      category: "Strategies"
    });
    expect(getWorkbenchNodeDefinition("surface:tasks:inbox")).toMatchObject({
      routePath: "/today",
      category: "Tasks"
    });
    expect(getWorkbenchNodeDefinition("surface:calendar:events")).toMatchObject({
      routePath: "/calendar",
      category: "Calendar"
    });
    expect(getWorkbenchNodeDefinition("surface:preferences:items")).toMatchObject({
      routePath: "/preferences",
      category: "Preferences"
    });
    expect(getWorkbenchNodeDefinition("surface:questionnaires:library")).toMatchObject({
      routePath: "/psyche/questionnaires",
      category: "Questionnaires"
    });
    expect(getWorkbenchNodeDefinition("surface:psyche:values")).toMatchObject({
      routePath: "/psyche",
      category: "Psyche"
    });
    expect(getWorkbenchNodeDefinition("surface:overview:snapshot")).toMatchObject({
      routePath: "/overview",
      category: "Overview"
    });
    expect(getWorkbenchNodeDefinition("surface:review:weekly-summary")).toMatchObject({
      routePath: "/review/weekly",
      category: "Review"
    });
    expect(getWorkbenchNodeDefinition("surface:wiki:pages")).toMatchObject({
      routePath: "/wiki",
      category: "Wiki"
    });
    expect(getWorkbenchNodeDefinition("surface:insights:feed")).toMatchObject({
      routePath: "/insights",
      category: "Insights"
    });
  });

  it("uses semantic output contracts instead of generic primary content ports", () => {
    expect(getWorkbenchNodeDefinition("surface:tasks:inbox")?.output).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "summary", kind: "summary" }),
        expect.objectContaining({ key: "matches", kind: "entity_list" }),
        expect.objectContaining({ key: "matchCount", kind: "number" })
      ])
    );
    expect(getWorkbenchNodeDefinition("surface:overview:snapshot")?.output).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "summary", kind: "summary" }),
        expect.objectContaining({
          key: "context",
          kind: "context",
          modelName: "ForgeOverviewContext"
        })
      ])
    );
    expect(getWorkbenchNodeDefinition("surface:sleep-index:summary")?.output).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "summary", kind: "summary" }),
        expect.objectContaining({
          key: "sleepView",
          kind: "context",
          modelName: "ForgeSleepView"
        })
      ])
    );
    expect(getWorkbenchNodeDefinition("surface:habits:search-results")?.output).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "matches",
          kind: "entity_list",
          itemKind: "habit",
          shape: expect.arrayContaining([
            expect.objectContaining({ key: "id", kind: "text" }),
            expect.objectContaining({ key: "title", kind: "text" }),
            expect.objectContaining({ key: "frequency", kind: "text" })
          ])
        })
      ])
    );
    expect(getWorkbenchNodeDefinition("surface:habits:search-results")?.output).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "query" }),
        expect.objectContaining({ key: "entityTypes" }),
        expect.objectContaining({ key: "limit" })
      ])
    );
    expect(getWorkbenchNodeDefinition("surface:habits:search-results")?.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "query", kind: "text" }),
        expect.objectContaining({ key: "entityTypes", kind: "array" }),
        expect.objectContaining({ key: "limit", kind: "number" })
      ])
    );
    expect(getWorkbenchNodeDefinition("surface:habits:search-results")?.params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "query", kind: "text" }),
        expect.objectContaining({ key: "entityTypes", kind: "array" }),
        expect.objectContaining({ key: "limit", kind: "number" })
      ])
    );
  });
});
