import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { buildSearchWorkbenchExecution } from "../../../lib/workbench/runtime.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";
function Slot({ children }) {
    return _jsx(_Fragment, { children: children });
}
export const KanbanSummaryBox = defineWorkbenchBox(Slot, {
    id: "surface:kanban-index:summary",
    surfaceId: "kanban-index",
    routePath: "/kanban",
    title: "Kanban summary",
    icon: "kanban",
    description: "Board summary and execution posture.",
    category: "Execution",
    tags: ["kanban", "summary"],
    inputs: [],
    params: [],
    output: [{ key: "primary", label: "Kanban summary", kind: "content" }],
    tools: [],
    NodeView: createGenericWorkbenchNodeView({
        title: "Kanban summary",
        description: "Board summary and execution posture.",
        inputs: [],
        params: [],
        output: [{ key: "primary", label: "Kanban summary", kind: "content" }],
        tools: []
    }),
    execute: (input) => buildSearchWorkbenchExecution(input, {
        query: "",
        entityTypes: ["task"],
        limit: 24
    })
});
export const KanbanFiltersBox = defineWorkbenchBox(Slot, {
    id: "surface:kanban-index:filters",
    surfaceId: "kanban-index",
    routePath: "/kanban",
    title: "Kanban filters",
    icon: "filter",
    description: "Goal, owner, and tag filters for board scope.",
    category: "Execution",
    tags: ["kanban", "filters"],
    inputs: [],
    params: [],
    output: [{ key: "primary", label: "Kanban filters", kind: "content" }],
    tools: [
        {
            key: "forge.search_entities",
            label: "Search Forge entities",
            description: "Search Forge entities by query and entity types.",
            accessMode: "read"
        }
    ],
    NodeView: createGenericWorkbenchNodeView({
        title: "Kanban filters",
        description: "Goal, owner, and tag filters for board scope.",
        inputs: [],
        params: [],
        output: [{ key: "primary", label: "Kanban filters", kind: "content" }],
        tools: [
            {
                key: "forge.search_entities",
                label: "Search Forge entities",
                description: "Search Forge entities by query and entity types.",
                accessMode: "read"
            }
        ]
    }),
    execute: (input) => buildSearchWorkbenchExecution(input, {
        query: "",
        entityTypes: ["task"],
        limit: 24
    })
});
export const KanbanBoardBox = defineWorkbenchBox(Slot, {
    id: "surface:kanban-index:board",
    surfaceId: "kanban-index",
    routePath: "/kanban",
    title: "Kanban board",
    icon: "board",
    description: "Task board with move and execution actions.",
    category: "Execution",
    tags: ["kanban", "board", "tasks"],
    inputs: [],
    params: [],
    output: [{ key: "primary", label: "Kanban board", kind: "content" }],
    tools: [
        {
            key: "forge.search_entities",
            label: "Search Forge entities",
            description: "Search Forge entities by query and entity types.",
            accessMode: "read"
        },
        {
            key: "forge.update_task_status",
            label: "Move task",
            description: "Update a task status.",
            accessMode: "write"
        }
    ],
    NodeView: createGenericWorkbenchNodeView({
        title: "Kanban board",
        description: "Task board with move and execution actions.",
        inputs: [],
        params: [],
        output: [{ key: "primary", label: "Kanban board", kind: "content" }],
        tools: [
            {
                key: "forge.search_entities",
                label: "Search Forge entities",
                description: "Search Forge entities by query and entity types.",
                accessMode: "read"
            },
            {
                key: "forge.update_task_status",
                label: "Move task",
                description: "Update a task status.",
                accessMode: "write"
            }
        ]
    }),
    execute: (input) => buildSearchWorkbenchExecution(input, {
        query: "",
        entityTypes: ["task"],
        limit: 24
    })
});
