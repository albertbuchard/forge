import type { ReactNode } from "react";
import {
  buildSearchWorkbenchExecution,
  buildStaticWorkbenchExecution
} from "../../../lib/workbench/runtime.js";
import type {
  WorkbenchExecutionFunction,
  WorkbenchNodeExecutionInput
} from "../../../lib/workbench/nodes.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";

type SlotProps = { children: ReactNode };
function Slot({ children }: SlotProps) {
  return <>{children}</>;
}

function defineProjectBox(
  id: string,
  title: string,
  description: string,
  tags: string[],
  execute: WorkbenchExecutionFunction
) {
  return defineWorkbenchBox(Slot, {
    id,
    surfaceId: "projects",
    routePath: "/projects",
    title,
    icon: "projects",
    description,
    category: "Projects",
    tags,
    inputs: [],
    params: [],
    output: [{ key: "primary", label: title, kind: "content" }],
    tools: id === "surface:projects:search-results"
      ? [
          {
            key: "forge.search_entities",
            label: "Search Forge entities",
            description: "Search Forge entities by query and entity types.",
            accessMode: "read"
          }
        ]
      : [],
    NodeView: createGenericWorkbenchNodeView({
      title,
      description,
      inputs: [],
      params: [],
      output: [{ key: "primary", label: title, kind: "content" }],
      tools:
        id === "surface:projects:search-results"
          ? [
              {
                key: "forge.search_entities",
                label: "Search Forge entities",
                description: "Search Forge entities by query and entity types.",
                accessMode: "read"
              }
            ]
          : []
    }),
    execute
  });
}

export const ProjectsHeroBox = defineProjectBox(
  "surface:projects:hero",
  "Projects hero",
  "Projects page header.",
  ["projects", "hero"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(input, null, "Projects page header.")
);

export const ProjectsSearchResultsBox = defineProjectBox(
  "surface:projects:search-results",
  "Search and results",
  "Project browser, filters, and search context.",
  ["projects", "search"],
  (input: WorkbenchNodeExecutionInput) =>
    buildSearchWorkbenchExecution(input, {
      query: "",
      entityTypes: ["project"],
      limit: 20
    })
);

export const ProjectsSummaryBox = defineProjectBox(
  "surface:projects:summary",
  "Collection summary",
  "Collection summary and project state metrics.",
  ["projects", "summary"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(input, null, "Project collection summary.")
);
