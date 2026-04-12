import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { buildInsightsWorkbenchExecution, buildStaticWorkbenchExecution } from "../../../lib/workbench/runtime.js";
import { createContextOutput, createSummaryOutput } from "../../../lib/workbench/contracts.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";
function Slot({ children }) {
    return _jsx(_Fragment, { children: children });
}
function defineInsightsBox(id, title, description, tags, execute, output) {
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
export const InsightsFeedBox = defineInsightsBox("surface:insights:feed", "Insights feed", "Current coaching feed, status summary, and evidence-backed insight stream.", ["insights", "feed"], (input) => buildInsightsWorkbenchExecution(input), [
    createSummaryOutput({ label: "Insight summary", description: "Summary of the current coaching feed and evidence-backed insight stream." }),
    createContextOutput({
        key: "insights",
        label: "Insight payload",
        description: "Structured status and coaching payload returned by Forge insights.",
        modelName: "ForgeInsightsPayload"
    })
]);
export const InsightsCoachingBox = defineInsightsBox("surface:insights:coaching", "Coaching recommendation", "Single-action coaching summary for what Forge thinks matters next.", ["insights", "coaching"], (input) => buildStaticWorkbenchExecution(input, {
    focus: "coaching_recommendation"
}, "Coaching recommendation surface for the highest-leverage next move."), [
    createSummaryOutput({
        label: "Coaching recommendation",
        description: "Summary of the highest-leverage coaching recommendation."
    })
]);
