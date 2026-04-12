import type { ReactNode } from "react";
import {
  buildStaticWorkbenchExecution,
  buildWikiHealthWorkbenchExecution,
  buildWikiPagesWorkbenchExecution
} from "../../../lib/workbench/runtime.js";
import type {
  WorkbenchExecutionFunction,
  WorkbenchNodeExecutionInput,
  WorkbenchOutputDefinition
} from "../../../lib/workbench/nodes.js";
import {
  createContextOutput,
  createRecordListOutput,
  createSummaryOutput
} from "../../../lib/workbench/contracts.js";
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
  execute: WorkbenchExecutionFunction,
  output: WorkbenchOutputDefinition[]
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
    output,
    tools: [],
    NodeView: createGenericWorkbenchNodeView({
      title,
      description,
      inputs: [],
      params: [],
      output,
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
  (input: WorkbenchNodeExecutionInput) => buildWikiPagesWorkbenchExecution(input),
  [
    createSummaryOutput({ label: "Wiki page summary", description: "Summary of the currently available wiki pages." }),
    createRecordListOutput({
      key: "pages",
      label: "Wiki pages",
      description: "Structured wiki page records available in Forge memory.",
      modelName: "ForgeWikiPages",
      itemKind: "wiki_page"
    })
  ]
);

export const WikiHealthBox = defineWikiBox(
  "surface:wiki:health",
  "Wiki health",
  "Index health, unresolved links, and orphaned-page signals for the wiki.",
  ["wiki", "health"],
  (input: WorkbenchNodeExecutionInput) => buildWikiHealthWorkbenchExecution(input),
  [
    createSummaryOutput({ label: "Wiki health summary", description: "Summary of unresolved links and orphaned-page signals." }),
    createContextOutput({
      key: "health",
      label: "Wiki health",
      description: "Structured wiki health payload returned by Forge.",
      modelName: "ForgeWikiHealth"
    })
  ]
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
    ),
  [
    createSummaryOutput({
      label: "Wiki authoring summary",
      description: "Summary of wiki authoring and ingest actions available on this surface."
    })
  ]
);
