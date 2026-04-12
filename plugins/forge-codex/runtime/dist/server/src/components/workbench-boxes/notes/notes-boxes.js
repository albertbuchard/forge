import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { buildSearchWorkbenchExecution, buildStaticWorkbenchExecution } from "../../../lib/workbench/runtime.js";
import { createNoteTool, createSearchEntitiesTool, createSearchInputs, createSearchOutputs, createSearchParams, createSummaryOutput } from "../../../lib/workbench/contracts.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";
function Slot({ children }) {
    return _jsx(_Fragment, { children: children });
}
const noteSearchInputs = createSearchInputs({
    itemKind: "note",
    itemLabel: "Note",
    defaultEntityTypes: ["note"],
    defaultLimit: 20
});
const noteSearchParams = createSearchParams({
    itemKind: "note",
    defaultEntityTypes: ["note"],
    defaultLimit: 20
});
export const NoteFiltersBox = defineWorkbenchBox(Slot, {
    id: "surface:notes-index:filters",
    surfaceId: "notes-index",
    routePath: "/notes",
    title: "Note filters",
    icon: "filter",
    description: "Entity, tag, text, author, and date filters for notes.",
    category: "Notes",
    tags: ["notes", "filters", "search"],
    inputs: noteSearchInputs,
    params: noteSearchParams,
    output: [
        createSummaryOutput({
            label: "Filter summary",
            description: "Summary of the current note filters and search scope."
        })
    ],
    tools: [
        createSearchEntitiesTool("Search Forge entities by query and entity types.")
    ],
    NodeView: createGenericWorkbenchNodeView({
        title: "Note filters",
        description: "Entity, tag, text, author, and date filters for notes.",
        inputs: noteSearchInputs,
        params: noteSearchParams,
        output: [
            createSummaryOutput({
                label: "Filter summary",
                description: "Summary of the current note filters and search scope."
            })
        ],
        tools: [
            createSearchEntitiesTool("Search Forge entities by query and entity types.")
        ]
    }),
    execute: (input) => buildSearchWorkbenchExecution(input, {
        query: "",
        entityTypes: ["note"],
        limit: 20
    })
});
export const NoteComposerBox = defineWorkbenchBox(Slot, {
    id: "surface:notes-index:composer",
    surfaceId: "notes-index",
    routePath: "/notes",
    title: "Note composer",
    icon: "write",
    description: "Markdown note composer with links, tags, and capture actions.",
    category: "Notes",
    tags: ["notes", "composer", "capture"],
    inputs: noteSearchInputs,
    params: noteSearchParams,
    output: [
        createSummaryOutput({
            label: "Draft summary",
            description: "Summary of the current note drafting surface."
        })
    ],
    tools: [
        createNoteTool("Create an evidence note from markdown content.")
    ],
    NodeView: createGenericWorkbenchNodeView({
        title: "Note composer",
        description: "Markdown note composer with links, tags, and capture actions.",
        inputs: noteSearchInputs,
        params: noteSearchParams,
        output: [
            createSummaryOutput({
                label: "Draft summary",
                description: "Summary of the current note drafting surface."
            })
        ],
        tools: [
            createNoteTool("Create an evidence note from markdown content.")
        ]
    }),
    execute: (input) => buildStaticWorkbenchExecution(input, {
        draftable: true
    }, "This node can draft or create a note.")
});
export const NotesLibraryBox = defineWorkbenchBox(Slot, {
    id: "surface:notes-index:library",
    surfaceId: "notes-index",
    routePath: "/notes",
    title: "Notes library",
    icon: "library",
    description: "Filtered library of Forge notes and linked evidence.",
    category: "Notes",
    tags: ["notes", "library", "history"],
    inputs: [],
    params: [],
    output: createSearchOutputs({
        itemKind: "note",
        itemLabel: "Note"
    }),
    tools: [],
    NodeView: createGenericWorkbenchNodeView({
        title: "Notes library",
        description: "Filtered library of Forge notes and linked evidence.",
        inputs: [],
        params: [],
        output: createSearchOutputs({
            itemKind: "note",
            itemLabel: "Note"
        }),
        tools: []
    }),
    execute: (input) => buildSearchWorkbenchExecution(input, {
        query: "",
        entityTypes: ["note"],
        limit: 20
    })
});
