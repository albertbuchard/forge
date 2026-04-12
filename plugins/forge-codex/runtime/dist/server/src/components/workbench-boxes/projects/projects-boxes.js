import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { buildSearchWorkbenchExecution, buildStaticWorkbenchExecution } from "../../../lib/workbench/runtime.js";
import { createSearchEntitiesTool, createSearchInputs, createSearchOutputs, createSearchParams, createSummaryOutput } from "../../../lib/workbench/contracts.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";
function Slot({ children }) {
    return _jsx(_Fragment, { children: children });
}
function defineProjectBox(id, title, description, tags, execute, output, tools = [], options) {
    const inputs = options?.inputs ?? [];
    const params = options?.params ?? [];
    return defineWorkbenchBox(Slot, {
        id,
        surfaceId: "projects",
        routePath: "/projects",
        title,
        icon: "projects",
        description,
        category: "Projects",
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
export const ProjectsHeroBox = defineProjectBox("surface:projects:hero", "Projects hero", "Projects page header.", ["projects", "hero"], (input) => buildStaticWorkbenchExecution(input, null, "Projects page header."), [createSummaryOutput({ label: "Projects summary", description: "High-level projects page framing." })]);
export const ProjectsSearchResultsBox = defineProjectBox("surface:projects:search-results", "Search and results", "Project browser, filters, and search context.", ["projects", "search"], (input) => buildSearchWorkbenchExecution(input, {
    query: "",
    entityTypes: ["project"],
    limit: 20
}), createSearchOutputs({
    itemKind: "project",
    itemLabel: "Project"
}), [createSearchEntitiesTool("Search project entities by query and entity types.")], {
    inputs: createSearchInputs({
        itemKind: "project",
        itemLabel: "Project",
        defaultEntityTypes: ["project"],
        defaultLimit: 20
    }),
    params: createSearchParams({
        itemKind: "project",
        defaultEntityTypes: ["project"],
        defaultLimit: 20
    })
});
export const ProjectsSummaryBox = defineProjectBox("surface:projects:summary", "Collection summary", "Collection summary and project state metrics.", ["projects", "summary"], (input) => buildStaticWorkbenchExecution(input, null, "Project collection summary."), [
    createSummaryOutput({
        label: "Project summary",
        description: "Summary of the project collection and current state."
    })
]);
