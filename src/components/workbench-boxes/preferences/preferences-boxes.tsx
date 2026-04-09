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

function definePreferencesBox(
  id: string,
  title: string,
  description: string,
  tags: string[],
  execute: WorkbenchExecutionFunction,
  entityTypes: string[] = []
) {
  const tools =
    entityTypes.length > 0
      ? [
          {
            key: "forge.search_entities",
            label: "Search Forge entities",
            description: "Search preference contexts and modeled preference items.",
            accessMode: "read" as const
          }
        ]
      : [];
  return defineWorkbenchBox(Slot, {
    id,
    surfaceId: "preferences",
    routePath: "/preferences",
    title,
    icon: "preferences",
    description,
    category: "Preferences",
    tags,
    inputs: [],
    params: [],
    output: [{ key: "primary", label: title, kind: "content" }],
    tools,
    NodeView: createGenericWorkbenchNodeView({
      title,
      description,
      inputs: [],
      params: [],
      output: [{ key: "primary", label: title, kind: "content" }],
      tools
    }),
    execute
  });
}

export const PreferencesWorkspaceBox = definePreferencesBox(
  "surface:preferences:workspace",
  "Preferences workspace",
  "Main preference modeling workspace, including summaries, tradeoffs, and evidence.",
  ["preferences", "workspace"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(
      input,
      {
        surfaces: ["summary", "comparison_game", "evidence"]
      },
      "Preferences workspace with summary, pairwise comparison, and evidence views."
    )
);

export const PreferencesContextsBox = definePreferencesBox(
  "surface:preferences:contexts",
  "Preference contexts",
  "Preference contexts that shape which tradeoffs and evidence are active.",
  ["preferences", "contexts"],
  (input: WorkbenchNodeExecutionInput) =>
    buildSearchWorkbenchExecution(input, {
      query: "",
      entityTypes: ["preference_context"],
      limit: 20
    }),
  ["preference_context"]
);

export const PreferencesItemsBox = definePreferencesBox(
  "surface:preferences:items",
  "Preference items",
  "Preference items scored and compared inside the active context.",
  ["preferences", "items"],
  (input: WorkbenchNodeExecutionInput) =>
    buildSearchWorkbenchExecution(input, {
      query: "",
      entityTypes: ["preference_item"],
      limit: 20
    }),
  ["preference_item"]
);
