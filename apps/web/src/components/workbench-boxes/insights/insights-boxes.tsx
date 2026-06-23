import type { ReactNode } from "react";
import {
  buildInsightsWorkbenchExecution,
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

function defineInsightsBox(
  id: string,
  title: string,
  description: string,
  tags: string[],
  execute: WorkbenchExecutionFunction,
  output: WorkbenchOutputDefinition[]
) {
  return defineWorkbenchBox(Slot, {
    id,
    surfaceId: "insights",
    routePath: "/insights",
    title,
    icon: "insights",
    description,
    category: "Insights",
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

export const InsightsFeedBox = defineInsightsBox(
  "surface:insights:feed",
  "Insights feed",
  "Current coaching feed, status summary, and evidence-backed insight stream.",
  ["insights", "feed"],
  (input: WorkbenchNodeExecutionInput) => buildInsightsWorkbenchExecution(input),
  [
    createSummaryOutput({ label: "Insight summary", description: "Summary of the current coaching feed and evidence-backed insight stream." }),
    createContextOutput({
      key: "insights",
      label: "Insight payload",
      description: "Structured status and coaching payload returned by Forge insights.",
      modelName: "ForgeInsightsPayload"
    })
  ]
);

export const InsightsCoachingBox = defineInsightsBox(
  "surface:insights:coaching",
  "Coaching recommendation",
  "Single-action coaching summary for what Forge thinks matters next.",
  ["insights", "coaching"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(
      input,
      {
        focus: "coaching_recommendation"
      },
      "Coaching recommendation surface for the highest-leverage next move."
    ),
  [
    createSummaryOutput({
      label: "Coaching recommendation",
      description: "Summary of the highest-leverage coaching recommendation."
    })
  ]
);
