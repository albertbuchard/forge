import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { buildMovementPlacesExecution, buildStaticWorkbenchExecution } from "../../../lib/workbench/runtime.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";
function Slot({ children }) {
    return _jsx(_Fragment, { children: children });
}
function defineMovementBox(id, title, description, tags, execute) {
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
export const MovementSummaryBox = defineMovementBox("surface:movement-index:summary", "Movement summary", "Tracking mode, daily totals, and passive capture posture.", ["movement", "summary"], (input) => buildStaticWorkbenchExecution(input, null, "Movement summary is available."));
export const MovementSelectionBox = defineMovementBox("surface:movement-index:selection", "Movement selection aggregate", "Selected-stay and selected-trip aggregate totals.", ["movement", "selection", "aggregate"], (input) => buildStaticWorkbenchExecution(input, null, "Selected stay and trip aggregate totals."));
export const MovementTimelineBox = defineMovementBox("surface:movement-index:timeline", "Movement life timeline", "Life-scale stay and trip timeline with edit access.", ["movement", "timeline", "life"], (input) => buildStaticWorkbenchExecution(input, null, "Movement life timeline with stay and trip history."));
export const MovementPlacesBox = defineMovementBox("surface:movement-index:places", "Known places", "Known places, aliases, and category tags.", ["movement", "places"], (input) => buildMovementPlacesExecution(input));
export const MovementDataBrowserBox = defineMovementBox("surface:movement-index:data-browser", "Movement data browser", "Datapoint browsing, invalid records, and movement data cleanup.", ["movement", "data", "browser"], (input) => buildStaticWorkbenchExecution(input, null, "Movement datapoint browser with cleanup actions."));
