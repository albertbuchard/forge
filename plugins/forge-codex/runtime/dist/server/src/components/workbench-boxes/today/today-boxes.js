import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { buildSearchWorkbenchExecution, buildStaticWorkbenchExecution } from "../../../lib/workbench/runtime.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";
function Slot({ children }) {
    return _jsx(_Fragment, { children: children });
}
function defineTodayBox(id, title, description, tags, execute, withSearchTool = false) {
    return defineWorkbenchBox(Slot, {
        id,
        surfaceId: "today",
        routePath: "/today",
        title,
        icon: "today",
        description,
        category: "Today",
        tags,
        inputs: [],
        params: [],
        output: [{ key: "primary", label: title, kind: "content" }],
        tools: withSearchTool
            ? [
                {
                    key: "forge.search_entities",
                    label: "Search Forge entities",
                    description: "Search Forge entities by query and entity types.",
                    accessMode: "read"
                }
            ]
            : [],
        NodeView: createGenericWorkbenchNodeView({
            title,
            description,
            inputs: [],
            params: [],
            output: [{ key: "primary", label: title, kind: "content" }],
            tools: withSearchTool
                ? [
                    {
                        key: "forge.search_entities",
                        label: "Search Forge entities",
                        description: "Search Forge entities by query and entity types.",
                        accessMode: "read"
                    }
                ]
                : []
        }),
        execute
    });
}
export const TodayHeroBox = defineTodayBox("surface:today:hero", "Today hero", "Daily execution header and directive.", ["today", "hero"], (input) => buildStaticWorkbenchExecution(input, null, "Daily execution header."));
export const TodayMetricsBox = defineTodayBox("surface:today:metrics", "Live metrics", "Daily XP, level, and momentum metrics.", ["today", "metrics"], (input) => buildStaticWorkbenchExecution(input, null, "Daily metrics."));
export const TodayRunwayBox = defineTodayBox("surface:today:runway", "Runway", "Execution lane and current work.", ["today", "execution"], (input) => buildSearchWorkbenchExecution(input, {
    query: "",
    entityTypes: ["task", "habit"],
    limit: 16
}), true);
export const TodayCalendarBox = defineTodayBox("surface:today:calendar", "Calendar", "Calendar context for today.", ["today", "calendar"], (input) => buildStaticWorkbenchExecution(input, null, "Today's calendar context."));
export const TodayFocusBox = defineTodayBox("surface:today:focus", "Current focus", "Today priorities and focus context.", ["today", "focus"], (input) => buildSearchWorkbenchExecution(input, {
    query: "",
    entityTypes: ["task", "habit"],
    limit: 16
}), true);
