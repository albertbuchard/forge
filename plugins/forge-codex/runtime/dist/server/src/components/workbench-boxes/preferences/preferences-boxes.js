import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { buildSearchWorkbenchExecution, buildStaticWorkbenchExecution } from "../../../lib/workbench/runtime.js";
import { createSearchEntitiesTool, createSearchInputs, createSearchOutputs, createSearchParams, createSummaryOutput } from "../../../lib/workbench/contracts.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";
function Slot({ children }) {
    return _jsx(_Fragment, { children: children });
}
function definePreferencesBox(id, title, description, tags, execute, output, tools = [], options) {
    const inputs = options?.inputs ?? [];
    const params = options?.params ?? [];
    return defineWorkbenchBox(Slot, {
        id,
        surfaceId: "preferences",
        routePath: "/preferences",
        title,
        icon: "preferences",
        description,
        category: "Preferences",
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
export const PreferencesWorkspaceBox = definePreferencesBox("surface:preferences:workspace", "Preferences workspace", "Main preference modeling workspace, including summaries, tradeoffs, and evidence.", ["preferences", "workspace"], (input) => buildStaticWorkbenchExecution(input, {
    surfaces: ["summary", "comparison_game", "evidence"]
}, "Preferences workspace with summary, pairwise comparison, and evidence views."), [createSummaryOutput({ label: "Preference summary", description: "Summary of the active preference modeling workspace." })]);
export const PreferencesContextsBox = definePreferencesBox("surface:preferences:contexts", "Preference contexts", "Preference contexts that shape which tradeoffs and evidence are active.", ["preferences", "contexts"], (input) => buildSearchWorkbenchExecution(input, {
    query: "",
    entityTypes: ["preference_context"],
    limit: 20
}), createSearchOutputs({
    itemKind: "preference_context",
    itemLabel: "Preference context"
}), [createSearchEntitiesTool("Search preference contexts and modeled preference items.")], {
    inputs: createSearchInputs({
        itemKind: "preference_context",
        itemLabel: "Preference context",
        defaultEntityTypes: ["preference_context"],
        defaultLimit: 20
    }),
    params: createSearchParams({
        itemKind: "preference_context",
        defaultEntityTypes: ["preference_context"],
        defaultLimit: 20
    })
});
export const PreferencesItemsBox = definePreferencesBox("surface:preferences:items", "Preference items", "Preference items scored and compared inside the active context.", ["preferences", "items"], (input) => buildSearchWorkbenchExecution(input, {
    query: "",
    entityTypes: ["preference_item"],
    limit: 20
}), createSearchOutputs({
    itemKind: "preference_item",
    itemLabel: "Preference item"
}), [createSearchEntitiesTool("Search preference contexts and modeled preference items.")], {
    inputs: createSearchInputs({
        itemKind: "preference_item",
        itemLabel: "Preference item",
        defaultEntityTypes: ["preference_item"],
        defaultLimit: 20
    }),
    params: createSearchParams({
        itemKind: "preference_item",
        defaultEntityTypes: ["preference_item"],
        defaultLimit: 20
    })
});
