import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { buildSearchWorkbenchExecution, buildStaticWorkbenchExecution } from "../../../lib/workbench/runtime.js";
import { createSearchEntitiesTool, createSearchInputs, createSearchOutputs, createSearchParams, createSummaryOutput } from "../../../lib/workbench/contracts.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";
function Slot({ children }) {
    return _jsx(_Fragment, { children: children });
}
function defineHabitBox(id, title, description, tags, execute, output, tools = [], options) {
    const inputs = options?.inputs ?? [];
    const params = options?.params ?? [];
    return defineWorkbenchBox(Slot, {
        id,
        surfaceId: "habits",
        routePath: "/habits",
        title,
        icon: "habit",
        description,
        category: "Habits",
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
export const HabitsHeroBox = defineHabitBox("surface:habits:hero", "Habits hero", "Habits page header and recurring execution context.", ["habits", "hero"], (input) => buildStaticWorkbenchExecution(input, null, "Habits page header."), [createSummaryOutput({ label: "Habits summary", description: "High-level habits page framing." })]);
export const HabitsSearchResultsBox = defineHabitBox("surface:habits:search-results", "Habits list and results", "Habit browser, due habits, and recurring check-in context.", ["habits", "search", "check-ins"], (input) => buildSearchWorkbenchExecution(input, {
    query: "",
    entityTypes: ["habit"],
    limit: 20
}), createSearchOutputs({
    itemKind: "habit",
    itemLabel: "Habit"
}), [createSearchEntitiesTool("Search habit entities by query and entity types.")], {
    inputs: createSearchInputs({
        itemKind: "habit",
        itemLabel: "Habit",
        defaultEntityTypes: ["habit"],
        defaultLimit: 20
    }),
    params: createSearchParams({
        itemKind: "habit",
        defaultEntityTypes: ["habit"],
        defaultLimit: 20
    })
});
export const HabitsSummaryBox = defineHabitBox("surface:habits:summary", "Habits summary", "Habit streaks, due state, and collection-level rhythm context.", ["habits", "summary", "streaks"], (input) => buildStaticWorkbenchExecution(input, null, "Habit collection summary."), [
    createSummaryOutput({
        label: "Habit summary",
        description: "Summary of habit streaks, due state, and collection rhythm."
    })
]);
