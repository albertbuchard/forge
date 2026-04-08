import type { ReactNode } from "react";
import {
  buildSearchWorkbenchExecution,
  buildStaticWorkbenchExecution
} from "../../../lib/workbench/runtime.js";
import type { WorkbenchNodeExecutionInput } from "../../../lib/workbench/nodes.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";

type SlotProps = { children: ReactNode };
function Slot({ children }: SlotProps) {
  return <>{children}</>;
}

export const NoteFiltersBox = defineWorkbenchBox(Slot, {
  id: "surface:notes-index:filters",
  surfaceId: "notes-index",
  routePath: "/notes",
  title: "Note filters",
  icon: "filter",
  description: "Entity, tag, text, author, and date filters for notes.",
  category: "Notes",
  tags: ["notes", "filters", "search"],
  inputs: [],
  params: [],
  output: [{ key: "primary", label: "Note filters", kind: "content" }],
  tools: [
    {
      key: "forge.search_entities",
      label: "Search Forge entities",
      description: "Search Forge entities by query and entity types.",
      accessMode: "read"
    }
  ],
  NodeView: createGenericWorkbenchNodeView({
    title: "Note filters",
    description: "Entity, tag, text, author, and date filters for notes.",
    inputs: [],
    params: [],
    output: [{ key: "primary", label: "Note filters", kind: "content" }],
    tools: [
      {
        key: "forge.search_entities",
        label: "Search Forge entities",
        description: "Search Forge entities by query and entity types.",
        accessMode: "read"
      }
    ]
  }),
  execute: (input: WorkbenchNodeExecutionInput) =>
    buildSearchWorkbenchExecution(input, {
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
  inputs: [],
  params: [],
  output: [{ key: "primary", label: "Note draft", kind: "content" }],
  tools: [
    {
      key: "forge.create_note",
      label: "Create note",
      description: "Create an evidence note from markdown content.",
      accessMode: "write"
    }
  ],
  NodeView: createGenericWorkbenchNodeView({
    title: "Note composer",
    description: "Markdown note composer with links, tags, and capture actions.",
    inputs: [],
    params: [],
    output: [{ key: "primary", label: "Note draft", kind: "content" }],
    tools: [
      {
        key: "forge.create_note",
        label: "Create note",
        description: "Create an evidence note from markdown content.",
        accessMode: "write"
      }
    ]
  }),
  execute: (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(
      input,
      {
        draftable: true
      },
      "This node can draft or create a note."
    )
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
  output: [{ key: "primary", label: "Notes library", kind: "content" }],
  tools: [],
  NodeView: createGenericWorkbenchNodeView({
    title: "Notes library",
    description: "Filtered library of Forge notes and linked evidence.",
    inputs: [],
    params: [],
    output: [{ key: "primary", label: "Notes library", kind: "content" }],
    tools: []
  }),
  execute: (input: WorkbenchNodeExecutionInput) =>
    buildSearchWorkbenchExecution(input, {
      query: "",
      entityTypes: ["note"],
      limit: 20
    })
});
