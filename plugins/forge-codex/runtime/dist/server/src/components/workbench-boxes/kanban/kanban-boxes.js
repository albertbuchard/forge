import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { buildSearchWorkbenchExecution } from "../../../lib/workbench/runtime.js";
import { createSearchEntitiesTool, createSearchInputs, createSearchOutputs, createSearchParams, createSummaryOutput, createTaskStatusTool } from "../../../lib/workbench/contracts.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";
function Slot({ children }) {
    return _jsx(_Fragment, { children: children });
}
const kanbanSearchInputs = createSearchInputs({
    itemKind: "task",
    itemLabel: "Task",
    defaultEntityTypes: ["task"],
    defaultLimit: 24
});
const kanbanSearchParams = createSearchParams({
    itemKind: "task",
    defaultEntityTypes: ["task"],
    defaultLimit: 24
});
export const KanbanSummaryBox = defineWorkbenchBox(Slot, {
    id: "surface:kanban-index:summary",
    surfaceId: "kanban-index",
    routePath: "/kanban",
    title: "Kanban summary",
    icon: "kanban",
    description: "Board summary and execution posture.",
    category: "Execution",
    tags: ["kanban", "summary"],
    inputs: kanbanSearchInputs,
    params: kanbanSearchParams,
    output: [
        createSummaryOutput({
            label: "Kanban summary",
            description: "Summary of board posture and execution pressure."
        })
    ],
    tools: [],
    NodeView: createGenericWorkbenchNodeView({
        title: "Kanban summary",
        description: "Board summary and execution posture.",
        inputs: kanbanSearchInputs,
        params: kanbanSearchParams,
        output: [
            createSummaryOutput({
                label: "Kanban summary",
                description: "Summary of board posture and execution pressure."
            })
        ],
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
    inputs: kanbanSearchInputs,
    params: kanbanSearchParams,
    output: [
        createSummaryOutput({
            label: "Filter summary",
            description: "Summary of the current Kanban filters and scope."
        })
    ],
    tools: [
        createSearchEntitiesTool("Search Forge entities by query and entity types.")
    ],
    NodeView: createGenericWorkbenchNodeView({
        title: "Kanban filters",
        description: "Goal, owner, and tag filters for board scope.",
        inputs: kanbanSearchInputs,
        params: kanbanSearchParams,
        output: [
            createSummaryOutput({
                label: "Filter summary",
                description: "Summary of the current Kanban filters and scope."
            })
        ],
        tools: [
            createSearchEntitiesTool("Search Forge entities by query and entity types.")
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
    inputs: kanbanSearchInputs,
    params: kanbanSearchParams,
    output: createSearchOutputs({
        itemKind: "kanban_task",
        itemLabel: "Kanban task"
    }),
    tools: [
        createSearchEntitiesTool("Search Forge entities by query and entity types."),
        createTaskStatusTool("Update a task status.")
    ],
    NodeView: createGenericWorkbenchNodeView({
        title: "Kanban board",
        description: "Task board with move and execution actions.",
        inputs: kanbanSearchInputs,
        params: kanbanSearchParams,
        output: createSearchOutputs({
            itemKind: "kanban_task",
            itemLabel: "Kanban task"
        }),
        tools: [
            createSearchEntitiesTool("Search Forge entities by query and entity types."),
            createTaskStatusTool("Update a task status.")
        ]
    }),
    execute: (input) => buildSearchWorkbenchExecution(input, {
        query: "",
        entityTypes: ["task"],
        limit: 24
    })
});
