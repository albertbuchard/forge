import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { buildSearchWorkbenchExecution, buildStaticWorkbenchExecution } from "../../../lib/workbench/runtime.js";
import { createSearchEntitiesTool, createSearchInputs, createSearchOutputs, createSearchParams, createSummaryOutput } from "../../../lib/workbench/contracts.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";
function Slot({ children }) {
    return _jsx(_Fragment, { children: children });
}
function defineTodayBox(id, title, description, tags, execute, output, tools = [], options) {
    const inputs = options?.inputs ?? [];
    const params = options?.params ?? [];
    return defineWorkbenchBox(Slot, {
        id,
        surfaceId: "today",
        routePath: "/today",
        title,
        icon: "today",
        description,
        category: "Today",
        tags,
        inputs,
        params,
        output,
        tools,
        NodeView: createGenericWorkbenchNodeView({
            title,
            description,
            inputs,
            params,
            output,
            tools
        }),
        execute
    });
}
export const TodayHeroBox = defineTodayBox("surface:today:hero", "Today hero", "Daily execution header and directive.", ["today", "hero"], (input) => buildStaticWorkbenchExecution(input, null, "Daily execution header."), [createSummaryOutput({ label: "Today summary", description: "High-level framing for today's execution." })]);
export const TodayMetricsBox = defineTodayBox("surface:today:metrics", "Live metrics", "Daily XP, level, and momentum metrics.", ["today", "metrics"], (input) => buildStaticWorkbenchExecution(input, null, "Daily metrics."), [createSummaryOutput({ label: "Metrics summary", description: "Summary of today's XP, level, and momentum metrics." })]);
export const TodayRunwayBox = defineTodayBox("surface:today:runway", "Runway", "Execution lane and current work.", ["today", "execution"], (input) => buildSearchWorkbenchExecution(input, {
    query: "",
    entityTypes: ["task", "habit"],
    limit: 16
}), createSearchOutputs({
    itemKind: "execution_item",
    itemLabel: "Execution item"
}), [createSearchEntitiesTool("Search today's active tasks and habits by query and entity types.")], {
    inputs: createSearchInputs({
        itemKind: "execution_item",
        itemLabel: "Execution item",
        defaultEntityTypes: ["task", "habit"],
        defaultLimit: 16
    }),
    params: createSearchParams({
        itemKind: "execution_item",
        defaultEntityTypes: ["task", "habit"],
        defaultLimit: 16
    })
});
export const TodayCalendarBox = defineTodayBox("surface:today:calendar", "Calendar", "Calendar context for today.", ["today", "calendar"], (input) => buildStaticWorkbenchExecution(input, null, "Today's calendar context."), [createSummaryOutput({ label: "Calendar summary", description: "Summary of today's calendar context." })]);
export const TodayFocusBox = defineTodayBox("surface:today:focus", "Current focus", "Today priorities and focus context.", ["today", "focus"], (input) => buildSearchWorkbenchExecution(input, {
    query: "",
    entityTypes: ["task", "habit"],
    limit: 16
}), createSearchOutputs({
    itemKind: "focus_item",
    itemLabel: "Focus item"
}), [createSearchEntitiesTool("Search today's priority tasks and habits by query and entity types.")], {
    inputs: createSearchInputs({
        itemKind: "focus_item",
        itemLabel: "Focus item",
        defaultEntityTypes: ["task", "habit"],
        defaultLimit: 16
    }),
    params: createSearchParams({
        itemKind: "focus_item",
        defaultEntityTypes: ["task", "habit"],
        defaultLimit: 16
    })
});
