import type { ReactNode } from "react";
import {
  buildStaticWorkbenchExecution,
  buildWikiHealthWorkbenchExecution,
  buildWikiPagesWorkbenchExecution
} from "../../../lib/workbench/runtime.js";
import type {
  WorkbenchExecutionFunction,
  WorkbenchNodeExecutionInput
} from "../../../lib/workbench/nodes.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";

type SlotProps = { children: ReactNode };
function Slot({ children }: SlotProps) {
  return <>{children}</>;
}

function defineWikiBox(
  id: string,
  title: string,
  description: string,
  tags: string[],
  execute: WorkbenchExecutionFunction
) {
  return defineWorkbenchBox(Slot, {
    id,
    surfaceId: "wiki",
    routePath: "/wiki",
    title,
    icon: "wiki",
    description,
    category: "Wiki",
    tags,
    inputs: [],
    params: [],
    output: [{ key: "primary", label: title, kind: "content" }],
    tools: [],
    NodeView: createGenericWorkbenchNodeView({
      title,
      description,
      inputs: [],
      params: [],
      output: [{ key: "primary", label: title, kind: "content" }],
      tools: []
    }),
    execute
  });
}

export const WikiPagesBox = defineWikiBox(
  "surface:wiki:pages",
  "Wiki pages",
  "Live list of wiki pages that can be used as memory or authored knowledge.",
  ["wiki", "pages"],
  (input: WorkbenchNodeExecutionInput) => buildWikiPagesWorkbenchExecution(input)
);

export const WikiHealthBox = defineWikiBox(
  "surface:wiki:health",
  "Wiki health",
  "Index health, unresolved links, and orphaned-page signals for the wiki.",
  ["wiki", "health"],
  (input: WorkbenchNodeExecutionInput) => buildWikiHealthWorkbenchExecution(input)
);

export const WikiAuthoringBox = defineWikiBox(
  "surface:wiki:authoring",
  "Wiki authoring",
  "Authoring and ingest surface for creating or refining Forge memory.",
  ["wiki", "authoring", "ingest"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(
      input,
      {
        actions: ["upsert", "ingest", "reindex"]
      },
      "Wiki authoring surface for ingesting sources and maintaining memory pages."
    )
);
