import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { buildSearchWorkbenchExecution, buildStaticWorkbenchExecution } from "../../../lib/workbench/runtime.js";
import { createSearchEntitiesTool, createSearchInputs, createSearchOutputs, createSearchParams, createSummaryOutput } from "../../../lib/workbench/contracts.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";
function Slot({ children }) {
    return _jsx(_Fragment, { children: children });
}
function defineStrategyBox(id, title, description, tags, execute, output, tools = [], options) {
    const inputs = options?.inputs ?? [];
    const params = options?.params ?? [];
    return defineWorkbenchBox(Slot, {
        id,
        surfaceId: "strategies",
        routePath: "/strategies",
        title,
        icon: "strategy",
        description,
        category: "Strategies",
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
export const StrategiesHeroBox = defineStrategyBox("surface:strategies:hero", "Strategies hero", "Strategies page header and sequencing context.", ["strategies", "hero"], (input) => buildStaticWorkbenchExecution(input, null, "Strategies page header."), [createSummaryOutput({ label: "Strategies summary", description: "High-level strategies page framing." })]);
export const StrategiesSearchResultsBox = defineStrategyBox("surface:strategies:search-results", "Strategies list and results", "Strategy browser and structured operating context.", ["strategies", "search"], (input) => buildSearchWorkbenchExecution(input, {
    query: "",
    entityTypes: ["strategy"],
    limit: 20
}), createSearchOutputs({
    itemKind: "strategy",
    itemLabel: "Strategy"
}), [createSearchEntitiesTool("Search strategy entities by query and entity types.")], {
    inputs: createSearchInputs({
        itemKind: "strategy",
        itemLabel: "Strategy",
        defaultEntityTypes: ["strategy"],
        defaultLimit: 20
    }),
    params: createSearchParams({
        itemKind: "strategy",
        defaultEntityTypes: ["strategy"],
        defaultLimit: 20
    })
});
export const StrategiesSummaryBox = defineStrategyBox("surface:strategies:summary", "Strategies summary", "Strategy collection summary and state context.", ["strategies", "summary"], (input) => buildStaticWorkbenchExecution(input, null, "Strategy collection summary."), [
    createSummaryOutput({
        label: "Strategy summary",
        description: "Summary of strategy state and collection context."
    })
]);
