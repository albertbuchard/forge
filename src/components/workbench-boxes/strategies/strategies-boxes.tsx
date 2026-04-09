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

function defineStrategyBox(
  id: string,
  title: string,
  description: string,
  tags: string[],
  execute: WorkbenchExecutionFunction,
  withSearchTool = false
) {
  return defineWorkbenchBox(Slot, {
    id,
    surfaceId: "strategies",
    routePath: "/strategies",
    title,
    icon: "strategy",
    description,
    category: "Strategies",
    tags,
    inputs: [],
    params: [],
    output: [{ key: "primary", label: title, kind: "content" }],
    tools: withSearchTool
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
      tools: withSearchTool
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

export const StrategiesHeroBox = defineStrategyBox(
  "surface:strategies:hero",
  "Strategies hero",
  "Strategies page header and sequencing context.",
  ["strategies", "hero"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(input, null, "Strategies page header.")
);

export const StrategiesSearchResultsBox = defineStrategyBox(
  "surface:strategies:search-results",
  "Strategies list and results",
  "Strategy browser and structured operating context.",
  ["strategies", "search"],
  (input: WorkbenchNodeExecutionInput) =>
    buildSearchWorkbenchExecution(input, {
      query: "",
      entityTypes: ["strategy"],
      limit: 20
    }),
  true
);

export const StrategiesSummaryBox = defineStrategyBox(
  "surface:strategies:summary",
  "Strategies summary",
  "Strategy collection summary and state context.",
  ["strategies", "summary"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(input, null, "Strategy collection summary.")
);
