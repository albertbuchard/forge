import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { buildSleepWorkbenchExecution, buildSportsWorkbenchExecution } from "../../../lib/workbench/runtime.js";
import { createContextOutput, createSummaryOutput } from "../../../lib/workbench/contracts.js";
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
        output: input.output,
        tools: [],
        NodeView: createGenericWorkbenchNodeView({
            title: input.title,
            description: input.description,
            inputs: [],
            params: [],
            output: input.output,
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
    execute: (input) => buildSleepWorkbenchExecution(input),
    output: [
        createSummaryOutput({ label: "Sleep summary", description: "Summary of recent sleep and recovery posture." }),
        createContextOutput({
            key: "sleepView",
            label: "Sleep view",
            description: "Structured sleep history and derived sleep patterns.",
            modelName: "ForgeSleepView"
        })
    ]
});
export const SleepPatternsBox = defineHealthBox({
    id: "surface:sleep-index:patterns",
    surfaceId: "sleep-index",
    routePath: "/sleep",
    title: "Sleep patterns",
    description: "Weekly baseline, stage mix, and timing patterns around canonical nights.",
    category: "Sleep",
    tags: ["sleep", "patterns"],
    execute: (input) => buildSleepWorkbenchExecution(input),
    output: [
        createSummaryOutput({ label: "Sleep pattern summary", description: "Summary of trend, stage averages, and recovery state." }),
        createContextOutput({
            key: "sleepView",
            label: "Sleep view",
            description: "Structured sleep trend, stage averages, and recovery signals.",
            modelName: "ForgeSleepView"
        })
    ]
});
export const SleepBrowserBox = defineHealthBox({
    id: "surface:sleep-index:browser",
    surfaceId: "sleep-index",
    routePath: "/sleep",
    title: "Night detail",
    description: "Interactive sleep calendar, selected-night detail, and optional raw evidence.",
    category: "Sleep",
    tags: ["sleep", "browser", "history"],
    execute: (input) => buildSleepWorkbenchExecution(input),
    output: [
        createSummaryOutput({ label: "Night detail summary", description: "Summary of the sleep calendar and selected-night detail." }),
        createContextOutput({
            key: "sleepView",
            label: "Sleep view",
            description: "Structured canonical nights, calendar summaries, and phase detail.",
            modelName: "ForgeSleepView"
        })
    ]
});
export const SportsSummaryBox = defineHealthBox({
    id: "surface:sports-index:summary",
    surfaceId: "sports-index",
    routePath: "/sports",
    title: "Sports summary",
    description: "Recent workout metrics, streaks, and linked-session totals.",
    category: "Sports",
    tags: ["sports", "summary"],
    execute: (input) => buildSportsWorkbenchExecution(input),
    output: [
        createSummaryOutput({ label: "Sports summary", description: "Summary of recent workout metrics and streaks." }),
        createContextOutput({
            key: "sportsView",
            label: "Sports view",
            description: "Structured workout metrics, streaks, and linked session totals.",
            modelName: "ForgeSportsView"
        })
    ]
});
export const SportsCompositionBox = defineHealthBox({
    id: "surface:sports-index:composition",
    surfaceId: "sports-index",
    routePath: "/sports",
    title: "Training composition",
    description: "Workout mix, trend, and session composition context.",
    category: "Sports",
    tags: ["sports", "composition", "trend"],
    execute: (input) => buildSportsWorkbenchExecution(input),
    output: [
        createSummaryOutput({ label: "Composition summary", description: "Summary of workout mix, trend, and session composition." }),
        createContextOutput({
            key: "sportsView",
            label: "Sports view",
            description: "Structured workout mix, trend, and session composition data.",
            modelName: "ForgeSportsView"
        })
    ]
});
export const SportsBrowserBox = defineHealthBox({
    id: "surface:sports-index:browser",
    surfaceId: "sports-index",
    routePath: "/sports",
    title: "Session browser",
    description: "Searchable and virtualized workout history browser.",
    category: "Sports",
    tags: ["sports", "browser", "history"],
    execute: (input) => buildSportsWorkbenchExecution(input),
    output: [
        createSummaryOutput({ label: "Session browser summary", description: "Summary of searchable workout history." }),
        createContextOutput({
            key: "sportsView",
            label: "Sports view",
            description: "Structured workout history for browsing and analysis.",
            modelName: "ForgeSportsView"
        })
    ]
});
