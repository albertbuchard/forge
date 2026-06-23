import type { ReactNode } from "react";
import {
  buildStaticWorkbenchExecution,
  buildWeeklyReviewWorkbenchExecution
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

function defineReviewBox(
  id: string,
  title: string,
  description: string,
  tags: string[],
  execute: WorkbenchExecutionFunction,
  output: WorkbenchOutputDefinition[]
) {
  return defineWorkbenchBox(Slot, {
    id,
    surfaceId: "review",
    routePath: "/review/weekly",
    title,
    icon: "review",
    description,
    category: "Review",
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

export const WeeklyReviewSummaryBox = defineReviewBox(
  "surface:review:weekly-summary",
  "Weekly review summary",
  "Weekly review payload with momentum, wins, calibration, and completion state.",
  ["review", "weekly"],
  (input: WorkbenchNodeExecutionInput) => buildWeeklyReviewWorkbenchExecution(input),
  [
    createSummaryOutput({
      label: "Weekly review summary",
      description: "Summary of momentum, wins, calibration, and review completion state."
    }),
    createContextOutput({
      key: "weeklyReview",
      label: "Weekly review payload",
      description: "Structured weekly review payload returned by Forge.",
      modelName: "ForgeWeeklyReview"
    })
  ]
);

export const WeeklyReviewRewardBox = defineReviewBox(
  "surface:review:reward",
  "Review reward",
  "Reward framing and completion incentive for closing the current review cycle.",
  ["review", "reward"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(
      input,
      {
        reward: "weekly_review_completion"
      },
      "Weekly review reward surface for locking the current cycle into evidence."
    ),
  [
    createSummaryOutput({
      label: "Review reward summary",
      description: "Summary of the reward framing for closing the current review cycle."
    })
  ]
);
