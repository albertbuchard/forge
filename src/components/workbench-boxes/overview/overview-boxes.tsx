import type { ReactNode } from "react";
import {
  buildInsightsWorkbenchExecution,
  buildOverviewWorkbenchExecution,
  buildStaticWorkbenchExecution
} from "../../../lib/workbench/runtime.js";
import type {
  WorkbenchExecutionFunction,
  WorkbenchNodeExecutionInput,
  WorkbenchOutputDefinition
} from "../../../lib/workbench/nodes.js";
import {
  createContextOutput,
  createSummaryOutput
} from "../../../lib/workbench/contracts.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";

type SlotProps = { children: ReactNode };
function Slot({ children }: SlotProps) {
  return <>{children}</>;
}

function defineOverviewBox(
  id: string,
  title: string,
  description: string,
  tags: string[],
  execute: WorkbenchExecutionFunction,
  output: WorkbenchOutputDefinition[]
) {
  return defineWorkbenchBox(Slot, {
    id,
    surfaceId: "overview",
    routePath: "/overview",
    title,
    icon: "overview",
    description,
    category: "Overview",
    tags,
    inputs: [],
    params: [],
    output,
    tools: [],
    NodeView: createGenericWorkbenchNodeView({
      title,
      description,
      inputs: [],
      params: [],
      output,
      tools: []
    }),
    execute
  });
}

export const OverviewSnapshotBox = defineOverviewBox(
  "surface:overview:snapshot",
  "Forge snapshot",
  "Live overview of goals, projects, tasks, habits, and current operating pressure.",
  ["overview", "snapshot"],
  (input: WorkbenchNodeExecutionInput) => buildOverviewWorkbenchExecution(input),
  [
    createSummaryOutput({
      label: "Overview summary",
      description: "Compact summary of goals, projects, tasks, and habits."
    }),
    createContextOutput({
      key: "context",
      label: "Overview context",
      description: "Structured Forge overview context for the current operating picture.",
      modelName: "ForgeOverviewContext"
    })
  ]
);

export const OverviewMomentumBox = defineOverviewBox(
  "surface:overview:momentum",
  "Momentum and health",
  "Momentum-focused summary of streaks, neglected areas, and active execution pressure.",
  ["overview", "momentum"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(
      input,
      {
        dimensions: ["momentum", "neglected_goals", "domain_balance"]
      },
      "Overview momentum surface tracking neglected goals, domain balance, and execution pressure."
    ),
  [
    createSummaryOutput({
      label: "Momentum summary",
      description: "Summary of momentum, neglected goals, and execution pressure."
    })
  ]
);

export const OverviewInsightsBox = defineOverviewBox(
  "surface:overview:insights",
  "Overview insights",
  "Insight-oriented summary of the current Forge operating picture.",
  ["overview", "insights"],
  (input: WorkbenchNodeExecutionInput) => buildInsightsWorkbenchExecution(input),
  [
    createSummaryOutput({
      label: "Insight summary",
      description: "Compact explanation of the current insight payload."
    }),
    createContextOutput({
      key: "insights",
      label: "Insight payload",
      description: "Structured insight and coaching payload returned by Forge.",
      modelName: "ForgeInsightsPayload"
    })
  ]
);
