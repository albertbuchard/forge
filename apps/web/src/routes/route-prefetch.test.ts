import { describe, expect, it } from "vitest";
import { NAV_ROUTE_REGISTRY } from "@/components/shell/shell-routes";
import { resolveRouteModuleKey } from "@/routes/route-prefetch";

describe("route module prefetch", () => {
  it("covers every shell navigation destination", () => {
    const missing = NAV_ROUTE_REGISTRY.filter(
      (route) => resolveRouteModuleKey(route.to) === null
    ).map((route) => route.to);

    expect(missing).toEqual([]);
  });

  it.each([
    ["/projects/project_123", "projectDetail"],
    ["/projects/hierarchy", "projectHierarchy"],
    ["/strategies/strategy_123", "strategyDetail"],
    ["/people", "people"],
    ["/people/person_123", "personDetail"],
    ["/courses", "courses"],
    ["/courses/math_123", "courseDetail"],
    ["/courses/math_123/learn?lesson=week_1", "courseLearn"],
    ["/concepts", "concepts"],
    ["/concepts/local-invertibility", "conceptDetail"],
    ["/sports/workouts/workout_123", "workoutDetail"],
    [
      "/psyche/questionnaires/instrument_123/edit",
      "psycheQuestionnaireBuilder"
    ],
    ["/psyche/questionnaires/instrument_123/take", "psycheQuestionnaireRun"],
    ["/psyche/questionnaire-runs/run_123", "psycheQuestionnaireRunDetail"],
    ["/wiki/edit/page_123", "wikiEditor"],
    ["/workbench/flow_123", "workbenchFlow"],
    ["/settings/mobile/lab", "companionLab"],
    ["/tasks/task_123?from=overview", "taskDetail"]
  ])("selects the correct module for %s", (path, expected) => {
    expect(resolveRouteModuleKey(path)).toBe(expected);
  });
});
