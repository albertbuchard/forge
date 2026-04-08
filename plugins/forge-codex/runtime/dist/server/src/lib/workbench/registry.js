import { MiniCalendarWidget, QuickCaptureWidget, SpotifyWidget, TimeWidget, WeatherWidget } from "../../components/customization/utility-widgets.js";
import { KanbanBoardBox, KanbanFiltersBox, KanbanSummaryBox } from "../../components/workbench-boxes/kanban/kanban-boxes.js";
import { SleepBrowserBox, SleepPatternsBox, SleepSummaryBox, SportsBrowserBox, SportsCompositionBox, SportsSummaryBox } from "../../components/workbench-boxes/health/health-boxes.js";
import { MovementDataBrowserBox, MovementPlacesBox, MovementSelectionBox, MovementSummaryBox, MovementTimelineBox } from "../../components/workbench-boxes/movement/movement-boxes.js";
import { NoteComposerBox, NoteFiltersBox, NotesLibraryBox } from "../../components/workbench-boxes/notes/notes-boxes.js";
import { ProjectsHeroBox, ProjectsSearchResultsBox, ProjectsSummaryBox } from "../../components/workbench-boxes/projects/projects-boxes.js";
import { TodayCalendarBox, TodayFocusBox, TodayHeroBox, TodayMetricsBox, TodayRunwayBox } from "../../components/workbench-boxes/today/today-boxes.js";
export const WORKBENCH_COMPONENT_AUTOLOAD = [
    TimeWidget,
    MiniCalendarWidget,
    SpotifyWidget,
    WeatherWidget,
    QuickCaptureWidget,
    KanbanSummaryBox,
    KanbanFiltersBox,
    KanbanBoardBox,
    NoteFiltersBox,
    NoteComposerBox,
    NotesLibraryBox,
    MovementSummaryBox,
    MovementSelectionBox,
    MovementTimelineBox,
    MovementPlacesBox,
    MovementDataBrowserBox,
    SleepSummaryBox,
    SleepPatternsBox,
    SleepBrowserBox,
    SportsSummaryBox,
    SportsCompositionBox,
    SportsBrowserBox,
    ProjectsHeroBox,
    ProjectsSearchResultsBox,
    ProjectsSummaryBox,
    TodayHeroBox,
    TodayMetricsBox,
    TodayRunwayBox,
    TodayCalendarBox,
    TodayFocusBox
];
const REGISTRY = new Map(WORKBENCH_COMPONENT_AUTOLOAD
    .filter((component) => component.workbench)
    .map((component) => [component.workbench.id, component.workbench]));
export function listWorkbenchNodeDefinitions() {
    return Array.from(REGISTRY.values());
}
export function getWorkbenchNodeDefinition(nodeId) {
    return REGISTRY.get(nodeId) ?? null;
}
export function getWorkbenchNodeCatalog() {
    return listWorkbenchNodeDefinitions().map((definition) => ({
        id: definition.id,
        boxId: definition.id,
        surfaceId: definition.surfaceId,
        routePath: definition.routePath,
        title: definition.title,
        label: definition.title,
        icon: definition.icon ?? null,
        description: definition.description,
        category: definition.category,
        tags: definition.tags,
        capabilityModes: [
            "content",
            ...(definition.tools.length > 0 ? ["tool"] : [])
        ],
        inputs: definition.inputs,
        params: definition.params,
        output: definition.output,
        tools: definition.tools,
        outputs: definition.output,
        toolAdapters: definition.tools,
        snapshotResolverKey: undefined
    }));
}
