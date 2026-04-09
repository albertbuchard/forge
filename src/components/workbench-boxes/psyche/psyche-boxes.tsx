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

function definePsycheBox(
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
            description: "Search psyche entities and reflective records.",
            accessMode: "read" as const
          }
        ]
      : [];
  return defineWorkbenchBox(Slot, {
    id,
    surfaceId: "psyche",
    routePath: "/psyche",
    title,
    icon: "psyche",
    description,
    category: "Psyche",
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

export const PsycheOverviewBox = definePsycheBox(
  "surface:psyche:overview",
  "Psyche overview",
  "High-level overview of values, patterns, beliefs, modes, and reports.",
  ["psyche", "overview"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(
      input,
      {
        surfaces: ["values", "patterns", "beliefs", "modes", "reports"]
      },
      "Psyche overview spanning values, patterns, beliefs, modes, and reports."
    )
);

export const PsycheValuesBox = definePsycheBox(
  "surface:psyche:values",
  "Psyche values",
  "Values and long-lived internal directions tracked inside Forge.",
  ["psyche", "values"],
  (input: WorkbenchNodeExecutionInput) =>
    buildSearchWorkbenchExecution(input, {
      query: "",
      entityTypes: ["psyche_value"],
      limit: 20
    }),
  ["psyche_value"]
);

export const PsycheReportsBox = definePsycheBox(
  "surface:psyche:reports",
  "Trigger reports",
  "Trigger reports and behavior-pattern signals linked to reflective work.",
  ["psyche", "reports", "patterns"],
  (input: WorkbenchNodeExecutionInput) =>
    buildSearchWorkbenchExecution(input, {
      query: "",
      entityTypes: ["trigger_report", "behavior_pattern", "belief_entry", "mode_profile"],
      limit: 20
    }),
  ["trigger_report", "behavior_pattern", "belief_entry", "mode_profile"]
);
