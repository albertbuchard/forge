import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { buildMovementPlacesExecution, buildStaticWorkbenchExecution } from "../../../lib/workbench/runtime.js";
import { createRecordListOutput, createSummaryOutput } from "../../../lib/workbench/contracts.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";
function Slot({ children }) {
    return _jsx(_Fragment, { children: children });
}
function defineMovementBox(id, title, description, tags, execute, output) {
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
export const MovementSummaryBox = defineMovementBox("surface:movement-index:summary", "Movement summary", "Tracking mode, daily totals, and passive capture posture.", ["movement", "summary"], (input) => buildStaticWorkbenchExecution(input, null, "Movement summary is available."), [createSummaryOutput({ label: "Movement summary", description: "Summary of tracking mode, daily totals, and passive capture posture." })]);
export const MovementSelectionBox = defineMovementBox("surface:movement-index:selection", "Movement selection aggregate", "Selected-stay and selected-trip aggregate totals.", ["movement", "selection", "aggregate"], (input) => buildStaticWorkbenchExecution(input, null, "Selected stay and trip aggregate totals."), [createSummaryOutput({ label: "Selection summary", description: "Summary of selected-stay and selected-trip aggregates." })]);
export const MovementTimelineBox = defineMovementBox("surface:movement-index:timeline", "Movement life timeline", "Life-scale stay and trip timeline with edit access.", ["movement", "timeline", "life"], (input) => buildStaticWorkbenchExecution(input, null, "Movement life timeline with stay and trip history."), [createSummaryOutput({ label: "Timeline summary", description: "Summary of the movement life timeline and trip history." })]);
export const MovementPlacesBox = defineMovementBox("surface:movement-index:places", "Known places", "Known places, aliases, and category tags.", ["movement", "places"], (input) => buildMovementPlacesExecution(input), [
    createSummaryOutput({ label: "Places summary", description: "Summary of known places, aliases, and category tags." }),
    createRecordListOutput({
        key: "places",
        label: "Known places",
        description: "Structured list of places known to Forge movement tracking.",
        modelName: "ForgeMovementPlaces",
        itemKind: "movement_place"
    })
]);
export const MovementDataBrowserBox = defineMovementBox("surface:movement-index:data-browser", "Movement data browser", "Datapoint browsing, invalid records, and movement data cleanup.", ["movement", "data", "browser"], (input) => buildStaticWorkbenchExecution(input, null, "Movement datapoint browser with cleanup actions."), [createSummaryOutput({ label: "Data browser summary", description: "Summary of movement datapoint browsing and cleanup." })]);
