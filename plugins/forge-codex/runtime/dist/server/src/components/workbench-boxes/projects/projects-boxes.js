import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { buildSearchWorkbenchExecution, buildStaticWorkbenchExecution } from "../../../lib/workbench/runtime.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";
function Slot({ children }) {
    return _jsx(_Fragment, { children: children });
}
function defineProjectBox(id, title, description, tags, execute) {
    return defineWorkbenchBox(Slot, {
        id,
        surfaceId: "projects",
        routePath: "/projects",
        title,
        icon: "projects",
        description,
        category: "Projects",
        tags,
        inputs: [],
        params: [],
        output: [{ key: "primary", label: title, kind: "content" }],
        tools: id === "surface:projects:search-results"
            ? [
                {
                    key: "forge.search_entities",
                    label: "Search Forge entities",
                    description: "Search Forge entities by query and entity types.",
                    accessMode: "read"
                }
            ]
            : [],
        NodeView: createGenericWorkbenchNodeView({
            title,
            description,
            inputs: [],
            params: [],
            output: [{ key: "primary", label: title, kind: "content" }],
            tools: id === "surface:projects:search-results"
                ? [
                    {
                        key: "forge.search_entities",
                        label: "Search Forge entities",
                        description: "Search Forge entities by query and entity types.",
                        accessMode: "read"
                    }
                ]
                : []
        }),
        execute
    });
}
export const ProjectsHeroBox = defineProjectBox("surface:projects:hero", "Projects hero", "Projects page header.", ["projects", "hero"], (input) => buildStaticWorkbenchExecution(input, null, "Projects page header."));
export const ProjectsSearchResultsBox = defineProjectBox("surface:projects:search-results", "Search and results", "Project browser, filters, and search context.", ["projects", "search"], (input) => buildSearchWorkbenchExecution(input, {
    query: "",
    entityTypes: ["project"],
    limit: 20
}));
export const ProjectsSummaryBox = defineProjectBox("surface:projects:summary", "Collection summary", "Collection summary and project state metrics.", ["projects", "summary"], (input) => buildStaticWorkbenchExecution(input, null, "Project collection summary."));
