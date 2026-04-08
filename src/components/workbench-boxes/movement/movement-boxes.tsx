import type { ReactNode } from "react";
import {
  buildMovementPlacesExecution,
  buildStaticWorkbenchExecution
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

function defineMovementBox(
  id: string,
  title: string,
  description: string,
  tags: string[],
  execute: WorkbenchExecutionFunction
) {
  return defineWorkbenchBox(Slot, {
    id,
    surfaceId: "movement-index",
    routePath: "/movement",
    title,
    icon: "movement",
    description,
    category: "Movement",
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

export const MovementSummaryBox = defineMovementBox(
  "surface:movement-index:summary",
  "Movement summary",
  "Tracking mode, daily totals, and passive capture posture.",
  ["movement", "summary"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(input, null, "Movement summary is available.")
);

export const MovementSelectionBox = defineMovementBox(
  "surface:movement-index:selection",
  "Movement selection aggregate",
  "Selected-stay and selected-trip aggregate totals.",
  ["movement", "selection", "aggregate"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(
      input,
      null,
      "Selected stay and trip aggregate totals."
    )
);

export const MovementTimelineBox = defineMovementBox(
  "surface:movement-index:timeline",
  "Movement life timeline",
  "Life-scale stay and trip timeline with edit access.",
  ["movement", "timeline", "life"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(
      input,
      null,
      "Movement life timeline with stay and trip history."
    )
);

export const MovementPlacesBox = defineMovementBox(
  "surface:movement-index:places",
  "Known places",
  "Known places, aliases, and category tags.",
  ["movement", "places"],
  (input: WorkbenchNodeExecutionInput) => buildMovementPlacesExecution(input)
);

export const MovementDataBrowserBox = defineMovementBox(
  "surface:movement-index:data-browser",
  "Movement data browser",
  "Datapoint browsing, invalid records, and movement data cleanup.",
  ["movement", "data", "browser"],
  (input: WorkbenchNodeExecutionInput) =>
    buildStaticWorkbenchExecution(
      input,
      null,
      "Movement datapoint browser with cleanup actions."
    )
);
