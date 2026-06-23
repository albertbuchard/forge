import { describe, expect, it } from "vitest";
import { buildSearchWorkbenchExecution } from "./runtime";
import type { WorkbenchNodeExecutionInput, WorkbenchToolSearchInput } from "./nodes";

describe("buildSearchWorkbenchExecution", () => {
  it("treats query, entityTypes, and limit as consumed inputs with parameter fallbacks", () => {
    let seenSearch: WorkbenchToolSearchInput | null = null;
    const input = {
      nodeId: "node-1",
      definition: {
        id: "surface:habits:search-results",
        surfaceId: "habits",
        routePath: "/habits",
        title: "Habits list and results",
        description: "Habit browser",
        category: "Habits",
        tags: ["habits"],
        inputs: [],
        params: [],
        output: [
          { key: "summary", label: "Summary", kind: "summary" },
          { key: "matches", label: "Matches", kind: "entity_list", itemKind: "habit" },
          { key: "matchCount", label: "Match count", kind: "number" }
        ],
        tools: [],
        WebView: (() => null) as never,
        NodeView: (() => null) as never,
        execute: (() => {
          throw new Error("not used");
        }) as never
      },
      inputs: {
        query: "overdue",
        entityTypes: ["habit", "task"]
      },
      params: {
        query: "ignored default",
        entityTypes: "habit",
        limit: 7
      },
      context: {
        actor: { userIds: null, source: "ui" as const },
        services: {
          entities: {
            search: ({ searches }) => {
              seenSearch = searches[0] ?? null;
              return {
                results: [
                  {
                    ok: true,
                    matches: [{ id: "habit-1", title: "Meditate", entityType: "habit" }]
                  }
                ]
              };
            }
          },
          notes: {},
          movement: {},
          health: {},
          overview: {},
          wiki: {},
          tasks: {}
        },
        now: new Date().toISOString()
      }
    } as WorkbenchNodeExecutionInput;

    const execution = buildSearchWorkbenchExecution(input, {
      query: "",
      entityTypes: ["habit"],
      limit: 20
    });

    expect(seenSearch).toEqual({
      query: "overdue",
      entityTypes: ["habit", "task"],
      limit: 7
    });
    expect(execution.payload).toEqual({
      summary: "habit: Meditate",
      matches: [{ id: "habit-1", title: "Meditate", entityType: "habit" }],
      matchCount: 1
    });
    expect(execution.outputMap).toBeDefined();
    expect(execution.outputMap?.query).toBeUndefined();
    expect(execution.outputMap?.entityTypes).toBeUndefined();
    expect(execution.outputMap?.limit).toBeUndefined();
  });
});
