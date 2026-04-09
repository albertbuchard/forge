import type { ReactNode } from "react";
import {
  buildStaticWorkbenchExecution,
  buildWeeklyReviewWorkbenchExecution
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

function defineReviewBox(
  id: string,
  title: string,
  description: string,
  tags: string[],
  execute: WorkbenchExecutionFunction
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

export const WeeklyReviewSummaryBox = defineReviewBox(
  "surface:review:weekly-summary",
  "Weekly review summary",
  "Weekly review payload with momentum, wins, calibration, and completion state.",
  ["review", "weekly"],
  (input: WorkbenchNodeExecutionInput) => buildWeeklyReviewWorkbenchExecution(input)
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
    )
);
