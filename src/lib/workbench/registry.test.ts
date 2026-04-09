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
});
