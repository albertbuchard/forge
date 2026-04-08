import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { buildSleepWorkbenchExecution, buildSportsWorkbenchExecution } from "../../../lib/workbench/runtime.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";
function Slot({ children }) {
    return _jsx(_Fragment, { children: children });
}
function defineHealthBox(input) {
    return defineWorkbenchBox(Slot, {
        id: input.id,
        surfaceId: input.surfaceId,
        routePath: input.routePath,
        title: input.title,
        icon: input.surfaceId,
        description: input.description,
        category: input.category,
        tags: input.tags,
        inputs: [],
        params: [],
        output: [{ key: "primary", label: input.title, kind: "content" }],
        tools: [],
        NodeView: createGenericWorkbenchNodeView({
            title: input.title,
            description: input.description,
            inputs: [],
            params: [],
            output: [{ key: "primary", label: input.title, kind: "content" }],
            tools: []
        }),
        execute: input.execute
    });
}
export const SleepSummaryBox = defineHealthBox({
    id: "surface:sleep-index:summary",
    surfaceId: "sleep-index",
    routePath: "/sleep",
    title: "Sleep summary",
    description: "Recent nightly sleep metrics and recovery posture.",
    category: "Sleep",
    tags: ["sleep", "summary"],
    execute: (input) => buildSleepWorkbenchExecution(input)
});
export const SleepPatternsBox = defineHealthBox({
    id: "surface:sleep-index:patterns",
    surfaceId: "sleep-index",
    routePath: "/sleep",
    title: "Sleep patterns",
    description: "Trend, stage averages, recovery state, and timing patterns.",
    category: "Sleep",
    tags: ["sleep", "patterns"],
    execute: (input) => buildSleepWorkbenchExecution(input)
});
export const SleepBrowserBox = defineHealthBox({
    id: "surface:sleep-index:browser",
    surfaceId: "sleep-index",
    routePath: "/sleep",
    title: "Night browser",
    description: "Searchable and virtualized sleep history browser.",
    category: "Sleep",
    tags: ["sleep", "browser", "history"],
    execute: (input) => buildSleepWorkbenchExecution(input)
});
export const SportsSummaryBox = defineHealthBox({
    id: "surface:sports-index:summary",
    surfaceId: "sports-index",
    routePath: "/sports",
    title: "Sports summary",
    description: "Recent workout metrics, streaks, and linked-session totals.",
    category: "Sports",
    tags: ["sports", "summary"],
    execute: (input) => buildSportsWorkbenchExecution(input)
});
export const SportsCompositionBox = defineHealthBox({
    id: "surface:sports-index:composition",
    surfaceId: "sports-index",
    routePath: "/sports",
    title: "Training composition",
    description: "Workout mix, trend, and session composition context.",
    category: "Sports",
    tags: ["sports", "composition", "trend"],
    execute: (input) => buildSportsWorkbenchExecution(input)
});
export const SportsBrowserBox = defineHealthBox({
    id: "surface:sports-index:browser",
    surfaceId: "sports-index",
    routePath: "/sports",
    title: "Session browser",
    description: "Searchable and virtualized workout history browser.",
    category: "Sports",
    tags: ["sports", "browser", "history"],
    execute: (input) => buildSportsWorkbenchExecution(input)
});
