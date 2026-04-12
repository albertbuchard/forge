import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { buildStaticWorkbenchExecution, buildWeeklyReviewWorkbenchExecution } from "../../../lib/workbench/runtime.js";
import { createContextOutput, createSummaryOutput } from "../../../lib/workbench/contracts.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";
function Slot({ children }) {
    return _jsx(_Fragment, { children: children });
}
function defineReviewBox(id, title, description, tags, execute, output) {
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
export const WeeklyReviewSummaryBox = defineReviewBox("surface:review:weekly-summary", "Weekly review summary", "Weekly review payload with momentum, wins, calibration, and completion state.", ["review", "weekly"], (input) => buildWeeklyReviewWorkbenchExecution(input), [
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
]);
export const WeeklyReviewRewardBox = defineReviewBox("surface:review:reward", "Review reward", "Reward framing and completion incentive for closing the current review cycle.", ["review", "reward"], (input) => buildStaticWorkbenchExecution(input, {
    reward: "weekly_review_completion"
}, "Weekly review reward surface for locking the current cycle into evidence."), [
    createSummaryOutput({
        label: "Review reward summary",
        description: "Summary of the reward framing for closing the current review cycle."
    })
]);
