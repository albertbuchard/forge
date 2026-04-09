import type { ReactNode } from "react";
import {
  buildInsightsWorkbenchExecution,
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

function defineInsightsBox(
  id: string,
  title: string,
  description: string,
  tags: string[],
  execute: WorkbenchExecutionFunction
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

export const InsightsFeedBox = defineInsightsBox(
  "surface:insights:feed",
  "Insights feed",
  "Current coaching feed, status summary, and evidence-backed insight stream.",
  ["insights", "feed"],
  (input: WorkbenchNodeExecutionInput) => buildInsightsWorkbenchExecution(input)
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
    )
);
