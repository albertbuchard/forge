import {
  MiniCalendarWidget,
  QuickCaptureWidget,
  SpotifyWidget,
  TimeWidget,
  WeatherWidget
} from "../../components/customization/utility-widgets.js";
import {
  InsightsCoachingBox,
  InsightsFeedBox
} from "../../components/workbench-boxes/insights/insights-boxes.js";
import {
  KanbanBoardBox,
  KanbanFiltersBox,
  KanbanSummaryBox
} from "../../components/workbench-boxes/kanban/kanban-boxes.js";
import {
  CalendarEventsBox,
  CalendarOverviewBox,
  CalendarPlanningBox
} from "../../components/workbench-boxes/calendar/calendar-boxes.js";
import {
  GoalsHeroBox,
  GoalsSearchResultsBox,
  GoalsSummaryBox
} from "../../components/workbench-boxes/goals/goals-boxes.js";
import {
  HabitsHeroBox,
  HabitsSearchResultsBox,
  HabitsSummaryBox
} from "../../components/workbench-boxes/habits/habits-boxes.js";
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
  OverviewInsightsBox,
  OverviewMomentumBox,
  OverviewSnapshotBox
} from "../../components/workbench-boxes/overview/overview-boxes.js";
import {
  ProjectsHeroBox,
  ProjectsSearchResultsBox,
  ProjectsSummaryBox
} from "../../components/workbench-boxes/projects/projects-boxes.js";
import {
  PreferencesContextsBox,
  PreferencesItemsBox,
  PreferencesWorkspaceBox
} from "../../components/workbench-boxes/preferences/preferences-boxes.js";
import {
  PsycheOverviewBox,
  PsycheReportsBox,
  PsycheValuesBox
} from "../../components/workbench-boxes/psyche/psyche-boxes.js";
import {
  QuestionnairesDraftingBox,
  QuestionnairesLibraryBox,
  QuestionnairesObservationBox
} from "../../components/workbench-boxes/questionnaires/questionnaires-boxes.js";
import {
  WeeklyReviewRewardBox,
  WeeklyReviewSummaryBox
} from "../../components/workbench-boxes/review/review-boxes.js";
import {
  StrategiesHeroBox,
  StrategiesSearchResultsBox,
  StrategiesSummaryBox
} from "../../components/workbench-boxes/strategies/strategies-boxes.js";
import {
  TasksFocusBox,
  TasksInboxBox,
  TasksSummaryBox
} from "../../components/workbench-boxes/tasks/tasks-boxes.js";
import {
  TodayCalendarBox,
  TodayFocusBox,
  TodayHeroBox,
  TodayMetricsBox,
  TodayRunwayBox
} from "../../components/workbench-boxes/today/today-boxes.js";
import {
  WikiAuthoringBox,
  WikiHealthBox,
  WikiPagesBox
} from "../../components/workbench-boxes/wiki/wiki-boxes.js";
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
  CalendarOverviewBox,
  CalendarEventsBox,
  CalendarPlanningBox,
  GoalsHeroBox,
  GoalsSearchResultsBox,
  GoalsSummaryBox,
  HabitsHeroBox,
  HabitsSearchResultsBox,
  HabitsSummaryBox,
  InsightsFeedBox,
  InsightsCoachingBox,
  KanbanSummaryBox,
  KanbanFiltersBox,
  KanbanBoardBox,
  NoteFiltersBox,
  NoteComposerBox,
  NotesLibraryBox,
  OverviewSnapshotBox,
  OverviewMomentumBox,
  OverviewInsightsBox,
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
  PreferencesWorkspaceBox,
  PreferencesContextsBox,
  PreferencesItemsBox,
  PsycheOverviewBox,
  PsycheValuesBox,
  PsycheReportsBox,
  QuestionnairesLibraryBox,
  QuestionnairesDraftingBox,
  QuestionnairesObservationBox,
  WeeklyReviewSummaryBox,
  WeeklyReviewRewardBox,
  StrategiesHeroBox,
  StrategiesSearchResultsBox,
  StrategiesSummaryBox,
  TasksInboxBox,
  TasksFocusBox,
  TasksSummaryBox,
  TodayHeroBox,
  TodayMetricsBox,
  TodayRunwayBox,
  TodayCalendarBox,
  TodayFocusBox,
  WikiPagesBox,
  WikiHealthBox,
  WikiAuthoringBox
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
