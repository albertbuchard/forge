import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { buildSearchWorkbenchExecution, buildStaticWorkbenchExecution } from "../../../lib/workbench/runtime.js";
import { createSearchEntitiesTool, createSearchInputs, createSearchOutputs, createSearchParams, createSummaryOutput } from "../../../lib/workbench/contracts.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";
function Slot({ children }) {
    return _jsx(_Fragment, { children: children });
}
function defineCalendarBox(id, title, description, tags, execute, output, tools, options) {
    const inputs = options?.inputs ?? [];
    const params = options?.params ?? [];
    return defineWorkbenchBox(Slot, {
        id,
        surfaceId: "calendar",
        routePath: "/calendar",
        title,
        icon: "calendar",
        description,
        category: "Calendar",
        tags,
        inputs,
        params,
        output,
        tools,
        NodeView: createGenericWorkbenchNodeView({
            title,
            description,
            inputs,
            params,
            output,
            tools
        }),
        execute
    });
}
export const CalendarOverviewBox = defineCalendarBox("surface:calendar:overview", "Calendar overview", "Main calendar surface for mirrored events, work blocks, and planned timeboxes.", ["calendar", "overview"], (input) => buildStaticWorkbenchExecution(input, {
    surfaces: ["events", "work_blocks", "timeboxes"]
}, "Calendar overview spanning mirrored events, work blocks, and timeboxes."), [createSummaryOutput({ label: "Calendar summary", description: "Summary of mirrored events, work blocks, and timeboxes." })], []);
export const CalendarEventsBox = defineCalendarBox("surface:calendar:events", "Calendar events", "Mirrored calendar events and Forge-managed calendar records.", ["calendar", "events", "mirrored"], (input) => buildSearchWorkbenchExecution(input, {
    query: "",
    entityTypes: ["calendar_event"],
    limit: 20
}), createSearchOutputs({
    itemKind: "calendar_event",
    itemLabel: "Calendar event"
}), [createSearchEntitiesTool("Search calendar-backed Forge entities and planning records.")], {
    inputs: createSearchInputs({
        itemKind: "calendar_event",
        itemLabel: "Calendar event",
        defaultEntityTypes: ["calendar_event"],
        defaultLimit: 20
    }),
    params: createSearchParams({
        itemKind: "calendar_event",
        defaultEntityTypes: ["calendar_event"],
        defaultLimit: 20
    })
});
export const CalendarPlanningBox = defineCalendarBox("surface:calendar:planning", "Planning blocks", "Planned task timeboxes and reusable work block templates.", ["calendar", "planning", "timeboxes"], (input) => buildSearchWorkbenchExecution(input, {
    query: "",
    entityTypes: ["task_timebox", "work_block_template"],
    limit: 20
}), createSearchOutputs({
    itemKind: "calendar_plan",
    itemLabel: "Planning record"
}), [createSearchEntitiesTool("Search calendar-backed Forge entities and planning records.")], {
    inputs: createSearchInputs({
        itemKind: "calendar_plan",
        itemLabel: "Planning record",
        defaultEntityTypes: ["task_timebox", "work_block_template"],
        defaultLimit: 20
    }),
    params: createSearchParams({
        itemKind: "calendar_plan",
        defaultEntityTypes: ["task_timebox", "work_block_template"],
        defaultLimit: 20
    })
});
