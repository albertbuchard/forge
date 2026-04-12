import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { buildSearchWorkbenchExecution, buildStaticWorkbenchExecution } from "../../../lib/workbench/runtime.js";
import { createSearchEntitiesTool, createSearchInputs, createSearchOutputs, createSearchParams, createSummaryOutput } from "../../../lib/workbench/contracts.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";
function Slot({ children }) {
    return _jsx(_Fragment, { children: children });
}
function definePsycheBox(id, title, description, tags, execute, output, tools = [], options) {
    const inputs = options?.inputs ?? [];
    const params = options?.params ?? [];
    return defineWorkbenchBox(Slot, {
        id,
        surfaceId: "psyche",
        routePath: "/psyche",
        title,
        icon: "psyche",
        description,
        category: "Psyche",
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
export const PsycheOverviewBox = definePsycheBox("surface:psyche:overview", "Psyche overview", "High-level overview of values, patterns, beliefs, modes, and reports.", ["psyche", "overview"], (input) => buildStaticWorkbenchExecution(input, {
    surfaces: ["values", "patterns", "beliefs", "modes", "reports"]
}, "Psyche overview spanning values, patterns, beliefs, modes, and reports."), [createSummaryOutput({ label: "Psyche summary", description: "Summary of values, patterns, beliefs, modes, and reports." })]);
export const PsycheValuesBox = definePsycheBox("surface:psyche:values", "Psyche values", "Values and long-lived internal directions tracked inside Forge.", ["psyche", "values"], (input) => buildSearchWorkbenchExecution(input, {
    query: "",
    entityTypes: ["psyche_value"],
    limit: 20
}), createSearchOutputs({
    itemKind: "psyche_value",
    itemLabel: "Psyche value"
}), [createSearchEntitiesTool("Search psyche entities and reflective records.")], {
    inputs: createSearchInputs({
        itemKind: "psyche_value",
        itemLabel: "Psyche value",
        defaultEntityTypes: ["psyche_value"],
        defaultLimit: 20
    }),
    params: createSearchParams({
        itemKind: "psyche_value",
        defaultEntityTypes: ["psyche_value"],
        defaultLimit: 20
    })
});
export const PsycheReportsBox = definePsycheBox("surface:psyche:reports", "Trigger reports", "Trigger reports and behavior-pattern signals linked to reflective work.", ["psyche", "reports", "patterns"], (input) => buildSearchWorkbenchExecution(input, {
    query: "",
    entityTypes: ["trigger_report", "behavior_pattern", "belief_entry", "mode_profile"],
    limit: 20
}), createSearchOutputs({
    itemKind: "psyche_record",
    itemLabel: "Psyche record"
}), [createSearchEntitiesTool("Search psyche entities and reflective records.")], {
    inputs: createSearchInputs({
        itemKind: "psyche_record",
        itemLabel: "Psyche record",
        defaultEntityTypes: [
            "trigger_report",
            "behavior_pattern",
            "belief_entry",
            "mode_profile"
        ],
        defaultLimit: 20
    }),
    params: createSearchParams({
        itemKind: "psyche_record",
        defaultEntityTypes: [
            "trigger_report",
            "behavior_pattern",
            "belief_entry",
            "mode_profile"
        ],
        defaultLimit: 20
    })
});
