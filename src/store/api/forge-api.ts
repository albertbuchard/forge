import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import type {
  GoalMutationInput,
  ProjectMutationInput,
  QuickTaskInput
} from "@/lib/schemas";
import type {
  CalendarSchedulingRules,
  ForgeSnapshot,
  OperatorSession,
  SettingsPayload,
  SleepViewData,
  WikiIngestJobPayload
} from "@/lib/types";
import {
  chatWorkbenchFlow,
  claimTaskRun,
  completeTaskRun,
  createGoal,
  createProject,
  createTask,
  deleteWorkbenchFlow,
  ensureOperatorSession,
  focusTaskRun,
  getForgeSnapshot,
  getSettings,
  getSleepView,
  getWorkbenchFlow,
  listWorkbenchFlows,
  heartbeatTaskRun,
  listBehaviorPatterns,
  listBehaviors,
  listBeliefs,
  listPsycheValues,
  listTriggerReports,
  listWikiIngestJobs,
  patchGoal,
  patchProject,
  patchSleepSession,
  patchTask,
  runWorkbenchFlow,
  releaseTaskRun,
  updateWorkbenchFlow
} from "@/lib/api";
import type {
  Behavior,
  BehaviorPattern,
  BeliefEntry,
  PsycheValue,
  TriggerReport
} from "@/lib/psyche-types";

type ForgeApiQueryError = unknown;
type AsyncResult<T extends (...args: any[]) => Promise<any>> = Awaited<
  ReturnType<T>
>;

async function resolveResult<T>(run: () => Promise<T>) {
  try {
    return { data: await run() };
  } catch (error) {
    return { error: error as ForgeApiQueryError };
  }
}

export const forgeApi = createApi({
  reducerPath: "forgeApi",
  baseQuery: fakeBaseQuery<ForgeApiQueryError>(),
  tagTypes: [
    "OperatorSession",
    "Settings",
    "Snapshot",
    "Sleep",
    "Psyche",
    "WikiIngestJobs",
    "WorkbenchFlow",
    "WorkbenchFlows"
  ],
  endpoints: (builder) => ({
    getOperatorSession: builder.query<AsyncResult<typeof ensureOperatorSession>, void>({
      queryFn: () => resolveResult(ensureOperatorSession),
      providesTags: ["OperatorSession"]
    }),
    getSettings: builder.query<{ settings: SettingsPayload }, void>({
      queryFn: () => resolveResult(getSettings),
      providesTags: ["Settings"]
    }),
    listWorkbenchFlows: builder.query<AsyncResult<typeof listWorkbenchFlows>, void>({
      queryFn: () => resolveResult(() => listWorkbenchFlows()),
      providesTags: ["WorkbenchFlows"]
    }),
    getWorkbenchFlow: builder.query<AsyncResult<typeof getWorkbenchFlow>, string>({
      queryFn: (flowId) => resolveResult(() => getWorkbenchFlow(flowId)),
      providesTags: (_result, _error, flowId) => [
        { type: "WorkbenchFlow", id: flowId },
        "WorkbenchFlows"
      ]
    }),
    getSnapshot: builder.query<ForgeSnapshot, string[] | void>({
      queryFn: (userIds) => resolveResult(() => getForgeSnapshot(userIds)),
      providesTags: ["Snapshot"]
    }),
    listWikiIngestJobs: builder.query<{ jobs: WikiIngestJobPayload[] }, void>({
      queryFn: () => resolveResult(() => listWikiIngestJobs()),
      providesTags: ["WikiIngestJobs"]
    }),
    createTask: builder.mutation<AsyncResult<typeof createTask>, QuickTaskInput>({
      queryFn: (input) => resolveResult(() => createTask(input)),
      invalidatesTags: ["Snapshot"]
    }),
    createGoal: builder.mutation<AsyncResult<typeof createGoal>, GoalMutationInput>({
      queryFn: (input) => resolveResult(() => createGoal(input)),
      invalidatesTags: ["Snapshot"]
    }),
    createProject: builder.mutation<AsyncResult<typeof createProject>, ProjectMutationInput>({
      queryFn: (input) => resolveResult(() => createProject(input)),
      invalidatesTags: ["Snapshot"]
    }),
    patchGoal: builder.mutation<
      AsyncResult<typeof patchGoal>,
      { goalId: string; patch: Partial<GoalMutationInput> }
    >({
      queryFn: ({ goalId, patch }) =>
        resolveResult(() => patchGoal(goalId, patch)),
      invalidatesTags: ["Snapshot"]
    }),
    patchProject: builder.mutation<
      AsyncResult<typeof patchProject>,
      {
        projectId: string;
        patch: Partial<ProjectMutationInput> & {
          schedulingRules?: CalendarSchedulingRules | null;
        };
      }
    >({
      queryFn: ({ projectId, patch }) =>
        resolveResult(() => patchProject(projectId, patch)),
      invalidatesTags: ["Snapshot"]
    }),
    patchTaskStatus: builder.mutation<
      AsyncResult<typeof patchTask>,
      {
        taskId: string;
        status: "backlog" | "focus" | "in_progress" | "blocked" | "done";
      }
    >({
      queryFn: ({ taskId, status }) =>
        resolveResult(() => patchTask(taskId, { status })),
      invalidatesTags: ["Snapshot"]
    }),
    claimTaskRun: builder.mutation<
      AsyncResult<typeof claimTaskRun>,
      {
        taskId: string;
        input: Parameters<typeof claimTaskRun>[1];
      }
    >({
      queryFn: ({ taskId, input }) =>
        resolveResult(() => claimTaskRun(taskId, input)),
      invalidatesTags: ["Snapshot"]
    }),
    heartbeatTaskRun: builder.mutation<
      AsyncResult<typeof heartbeatTaskRun>,
      { runId: string; input: Parameters<typeof heartbeatTaskRun>[1] }
    >({
      queryFn: ({ runId, input }) =>
        resolveResult(() => heartbeatTaskRun(runId, input)),
      invalidatesTags: ["Snapshot"]
    }),
    focusTaskRun: builder.mutation<AsyncResult<typeof focusTaskRun>, string>({
      queryFn: (runId) => resolveResult(() => focusTaskRun(runId)),
      invalidatesTags: ["Snapshot"]
    }),
    releaseTaskRun: builder.mutation<
      AsyncResult<typeof releaseTaskRun>,
      { runId: string; input: Parameters<typeof releaseTaskRun>[1] }
    >({
      queryFn: ({ runId, input }) =>
        resolveResult(() => releaseTaskRun(runId, input)),
      invalidatesTags: ["Snapshot"]
    }),
    completeTaskRun: builder.mutation<
      AsyncResult<typeof completeTaskRun>,
      { runId: string; input: Parameters<typeof completeTaskRun>[1] }
    >({
      queryFn: ({ runId, input }) =>
        resolveResult(() => completeTaskRun(runId, input)),
      invalidatesTags: ["Snapshot"]
    }),
    getSleepView: builder.query<AsyncResult<typeof getSleepView>, string[] | void>({
      queryFn: (userIds) => resolveResult(() => getSleepView(userIds)),
      providesTags: ["Sleep"]
    }),
    getPsycheValues: builder.query<{ values: PsycheValue[] }, string[] | void>({
      queryFn: (userIds) => resolveResult(() => listPsycheValues(userIds)),
      providesTags: ["Psyche"]
    }),
    getBehaviorPatterns: builder.query<
      { patterns: BehaviorPattern[] },
      string[] | void
    >({
      queryFn: (userIds) =>
        resolveResult(() => listBehaviorPatterns(userIds)),
      providesTags: ["Psyche"]
    }),
    getBehaviors: builder.query<{ behaviors: Behavior[] }, string[] | void>({
      queryFn: (userIds) => resolveResult(() => listBehaviors(userIds)),
      providesTags: ["Psyche"]
    }),
    getBeliefs: builder.query<{ beliefs: BeliefEntry[] }, string[] | void>({
      queryFn: (userIds) => resolveResult(() => listBeliefs(userIds)),
      providesTags: ["Psyche"]
    }),
    getTriggerReports: builder.query<
      { reports: TriggerReport[] },
      string[] | void
    >({
      queryFn: (userIds) => resolveResult(() => listTriggerReports(userIds)),
      providesTags: ["Psyche"]
    }),
    patchSleepSession: builder.mutation<
      AsyncResult<typeof patchSleepSession>,
      {
        sleepId: string;
        patch: Parameters<typeof patchSleepSession>[1];
      }
    >({
      queryFn: ({ sleepId, patch }) =>
        resolveResult(() => patchSleepSession(sleepId, patch)),
      invalidatesTags: ["Sleep"]
    }),
    updateWorkbenchFlow: builder.mutation<
      AsyncResult<typeof updateWorkbenchFlow>,
      {
        flowId: string;
        patch: Parameters<typeof updateWorkbenchFlow>[1];
      }
    >({
      queryFn: ({ flowId, patch }) =>
        resolveResult(() => updateWorkbenchFlow(flowId, patch)),
      invalidatesTags: (_result, _error, { flowId }) => [
        { type: "WorkbenchFlow", id: flowId },
        "WorkbenchFlows"
      ]
    }),
    deleteWorkbenchFlow: builder.mutation<AsyncResult<typeof deleteWorkbenchFlow>, string>({
      queryFn: (flowId) => resolveResult(() => deleteWorkbenchFlow(flowId)),
      invalidatesTags: (_result, _error, flowId) => [
        { type: "WorkbenchFlow", id: flowId },
        "WorkbenchFlows"
      ]
    }),
    runWorkbenchFlow: builder.mutation<
      AsyncResult<typeof runWorkbenchFlow>,
      {
        flowId: string;
        input: Parameters<typeof runWorkbenchFlow>[1];
      }
    >({
      queryFn: ({ flowId, input }) =>
        resolveResult(() => runWorkbenchFlow(flowId, input)),
      invalidatesTags: (_result, _error, { flowId }) => [
        { type: "WorkbenchFlow", id: flowId }
      ]
    }),
    chatWorkbenchFlow: builder.mutation<
      AsyncResult<typeof chatWorkbenchFlow>,
      {
        flowId: string;
        input: Parameters<typeof chatWorkbenchFlow>[1];
      }
    >({
      queryFn: ({ flowId, input }) =>
        resolveResult(() => chatWorkbenchFlow(flowId, input)),
      invalidatesTags: (_result, _error, { flowId }) => [
        { type: "WorkbenchFlow", id: flowId }
      ]
    })
  })
});

export const {
  useClaimTaskRunMutation,
  useCompleteTaskRunMutation,
  useCreateGoalMutation,
  useCreateProjectMutation,
  useCreateTaskMutation,
  useFocusTaskRunMutation,
  useGetBehaviorPatternsQuery,
  useGetBehaviorsQuery,
  useGetBeliefsQuery,
  useGetOperatorSessionQuery,
  useGetPsycheValuesQuery,
  useGetSettingsQuery,
  useGetSleepViewQuery,
  useGetSnapshotQuery,
  useGetTriggerReportsQuery,
  useGetWorkbenchFlowQuery,
  useListWikiIngestJobsQuery,
  useListWorkbenchFlowsQuery,
  useHeartbeatTaskRunMutation,
  useChatWorkbenchFlowMutation,
  useDeleteWorkbenchFlowMutation,
  usePatchGoalMutation,
  usePatchProjectMutation,
  usePatchSleepSessionMutation,
  usePatchTaskStatusMutation,
  useReleaseTaskRunMutation,
  useRunWorkbenchFlowMutation,
  useUpdateWorkbenchFlowMutation
} = forgeApi;
