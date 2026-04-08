import {
  MiniCalendarWidget,
  QuickCaptureWidget,
  SpotifyWidget,
  TimeWidget,
  WeatherWidget
} from "../../components/customization/utility-widgets.js";
import {
  KanbanBoardBox,
  KanbanFiltersBox,
  KanbanSummaryBox
} from "../../components/workbench-boxes/kanban/kanban-boxes.js";
import {
  SleepBrowserBox,
  SleepPatternsBox,
  SleepSummaryBox,
  SportsBrowserBox,
  SportsCompositionBox,
  SportsSummaryBox
} from "../../components/workbench-boxes/health/health-boxes.js";
import {
  MovementDataBrowserBox,
  MovementPlacesBox,
  MovementSelectionBox,
  MovementSummaryBox,
  MovementTimelineBox
} from "../../components/workbench-boxes/movement/movement-boxes.js";
import {
  NoteComposerBox,
  NoteFiltersBox,
  NotesLibraryBox
} from "../../components/workbench-boxes/notes/notes-boxes.js";
import {
  ProjectsHeroBox,
  ProjectsSearchResultsBox,
  ProjectsSummaryBox
} from "../../components/workbench-boxes/projects/projects-boxes.js";
import {
  TodayCalendarBox,
  TodayFocusBox,
  TodayHeroBox,
  TodayMetricsBox,
  TodayRunwayBox
} from "../../components/workbench-boxes/today/today-boxes.js";
import type {
  WorkbenchNodeDefinition,
  WorkbenchRegisteredComponent
} from "./nodes.js";

export const WORKBENCH_COMPONENT_AUTOLOAD: Array<WorkbenchRegisteredComponent<any>> = [
  TimeWidget as WorkbenchRegisteredComponent,
  MiniCalendarWidget as WorkbenchRegisteredComponent,
  SpotifyWidget as WorkbenchRegisteredComponent,
  WeatherWidget as WorkbenchRegisteredComponent,
  QuickCaptureWidget as WorkbenchRegisteredComponent,
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

const REGISTRY = new Map<string, WorkbenchNodeDefinition>(
  WORKBENCH_COMPONENT_AUTOLOAD
    .filter((component) => component.workbench)
    .map((component) => [component.workbench.id, component.workbench])
);

export function listWorkbenchNodeDefinitions() {
  return Array.from(REGISTRY.values());
}

export function getWorkbenchNodeDefinition(nodeId: string) {
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
      "content" as const,
      ...(definition.tools.length > 0 ? (["tool"] as const) : [])
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
