import type { ReactNode } from "react";
import {
  buildInsightsWorkbenchExecution,
  buildOverviewWorkbenchExecution,
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

function defineOverviewBox(
  id: string,
  title: string,
  description: string,
  tags: string[],
  execute: WorkbenchExecutionFunction
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
    output: [{ key: "primary", label: title, kind: "content" }],
    tools: [],
    NodeView: createGenericWorkbenchNodeView({
      title,
      description,
      inputs: [],
      params: [],
      output: [{ key: "primary", label: title, kind: "content" }],
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
  (input: WorkbenchNodeExecutionInput) => buildOverviewWorkbenchExecution(input)
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
    )
);

export const OverviewInsightsBox = defineOverviewBox(
  "surface:overview:insights",
  "Overview insights",
  "Insight-oriented summary of the current Forge operating picture.",
  ["overview", "insights"],
  (input: WorkbenchNodeExecutionInput) => buildInsightsWorkbenchExecution(input)
);
