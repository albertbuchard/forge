import { describe, expect, it } from "vitest";
import { buildWorkbenchToolCatalog } from "./tool-catalog";

describe("workbench tool catalog", () => {
  it("deduplicates repeated box-level tool exposures into unique capabilities", () => {
    const catalog = buildWorkbenchToolCatalog([
      {
        id: "box:goals",
        surfaceId: "goals",
        routePath: "/goals",
        title: "Goals list and results",
        description: "",
        category: "Goals",
        tags: [],
        inputs: [],
        params: [],
        output: [],
        tools: [
          {
            key: "forge.search_entities",
            label: "Search Forge entities",
            description: "Search Forge entities by query and entity types.",
            accessMode: "read",
            argsSchema: {
              type: "object",
              properties: {
                query: { type: "string" }
              }
            }
          }
        ]
      },
      {
        id: "box:habits",
        surfaceId: "habits",
        routePath: "/habits",
        title: "Habits list and results",
        description: "",
        category: "Habits",
        tags: [],
        inputs: [],
        params: [],
        output: [],
        tools: [
          {
            key: "forge.search_entities",
            label: "Search Forge entities",
            description: "Search Forge entities by query and entity types.",
            accessMode: "read"
          }
        ]
      },
      {
        id: "box:notes",
        surfaceId: "notes-index",
        routePath: "/notes",
        title: "Note composer",
        description: "",
        category: "Notes",
        tags: [],
        inputs: [],
        params: [],
        output: [],
        tools: [
          {
            key: "forge.create_note",
            label: "Create note",
            description: "Create an evidence note from markdown content.",
            accessMode: "write"
          }
        ]
      }
    ]);

    expect(catalog).toHaveLength(2);
    expect(catalog.find((tool) => tool.key === "forge.search_entities")).toMatchObject({
      sources: ["Goals list and results", "Habits list and results"],
      accessMode: "read",
      argsSchema: {
        type: "object",
        properties: {
          query: { type: "string" }
        }
      }
    });
    expect(catalog.find((tool) => tool.key === "forge.create_note")).toMatchObject({
      sources: ["Note composer"],
      accessMode: "write"
    });
  });
});
