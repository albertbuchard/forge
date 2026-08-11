import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import type {
  GoalMutationInput,
  ProjectMutationInput,
  QuickTaskInput
} from "@/lib/schemas";
import type {
  CalendarSchedulingRules,
  ForgeSnapshot,
  SettingsPayload,
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
  applyForgeDoctorFixes,
  focusTaskRun,
  getForgeSnapshot,
  getForgeDoctor,
  getSettings,
  getSleepView,
  getXpMetrics,
  getWorkbenchFlow,
  listWorkbenchFlowVersions,
  getWorkbenchFlowNodeOutput,
  getWorkbenchFlowRun,
  getWorkbenchFlowRunNode,
  getWorkbenchFlowRunNodes,
  getWorkbenchFlowRuns,
  listWorkbenchFlows,
  heartbeatTaskRun,
  listBehaviorPatterns,
  listBehaviors,
  listBeliefs,
  listPsycheValues,
  listTriggerReports,
  listWikiIngestJobs,
  markGamificationCelebrationSeen,
  patchGoal,
  patchProject,
  patchSleepSession,
  patchTask,
  revokeOperatorSession,
  runWorkbenchFlow,
  releaseTaskRun,
  restoreWorkbenchFlowVersion,
  updateWorkbenchFlow
} from "@/lib/api";
import type {
  Behavior,
  BehaviorPattern,
  BeliefEntry,
  PsycheValue,
  TriggerReport
} from "@/lib/psyche-types";
import { getRuntimeTimeZone } from "@/lib/date-keys";

type ForgeApiQueryError = unknown;
type AsyncResult<T> = T extends (...args: never[]) => infer TResult
  ? Awaited<TResult>
  : never;

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
    "Gamification",
    "Doctor",
    "Sleep",
    "Psyche",
    "WikiIngestJobs",
    "WorkbenchFlow",
    "WorkbenchFlows"
  ],
  endpoints: (builder) => ({
    getOperatorSession: builder.query<
      AsyncResult<typeof ensureOperatorSession>,
      void
    >({
      queryFn: () => resolveResult(ensureOperatorSession),
      providesTags: ["OperatorSession"]
    }),
    getSettings: builder.query<{ settings: SettingsPayload }, void>({
      queryFn: () => resolveResult(getSettings),
      providesTags: ["Settings"]
    }),
    getForgeDoctor: builder.query<AsyncResult<typeof getForgeDoctor>, void>({
      queryFn: () => resolveResult(getForgeDoctor),
      providesTags: ["Doctor"]
    }),
    applyForgeDoctorFixes: builder.mutation<
      AsyncResult<typeof applyForgeDoctorFixes>,
      { fixIds?: string[]; applyAllSafe?: boolean }
    >({
      queryFn: (input) => resolveResult(() => applyForgeDoctorFixes(input)),
      invalidatesTags: ["Doctor", "Settings"]
    }),
    listWorkbenchFlows: builder.query<
      AsyncResult<typeof listWorkbenchFlows>,
      void
    >({
      queryFn: () => resolveResult(() => listWorkbenchFlows()),
      providesTags: ["WorkbenchFlows"]
    }),
    getWorkbenchFlow: builder.query<
      AsyncResult<typeof getWorkbenchFlow>,
      string
    >({
      queryFn: (flowId) => resolveResult(() => getWorkbenchFlow(flowId)),
      providesTags: (_result, _error, flowId) => [
        { type: "WorkbenchFlow", id: flowId },
        "WorkbenchFlows"
      ]
    }),
    listWorkbenchFlowVersions: builder.query<
      AsyncResult<typeof listWorkbenchFlowVersions>,
      { flowId: string; limit?: number; offset?: number }
    >({
      queryFn: ({ flowId, limit, offset }) =>
        resolveResult(() =>
          listWorkbenchFlowVersions(flowId, { limit, offset })
        ),
      providesTags: (_result, _error, { flowId }) => [
        { type: "WorkbenchFlow", id: flowId }
      ]
    }),
    getWorkbenchFlowRun: builder.query<
      AsyncResult<typeof getWorkbenchFlowRun>,
      { flowId: string; runId: string }
    >({
      queryFn: ({ flowId, runId }) =>
        resolveResult(() => getWorkbenchFlowRun(flowId, runId)),
      providesTags: (_result, _error, { flowId }) => [
        { type: "WorkbenchFlow", id: flowId }
      ]
    }),
    getWorkbenchFlowRuns: builder.query<
      AsyncResult<typeof getWorkbenchFlowRuns>,
      { flowId: string; limit?: number; offset?: number }
    >({
      queryFn: ({ flowId, limit, offset }) =>
        resolveResult(() => getWorkbenchFlowRuns(flowId, { limit, offset })),
      providesTags: (_result, _error, { flowId }) => [
        { type: "WorkbenchFlow", id: flowId }
      ]
    }),
    getWorkbenchFlowRunNodes: builder.query<
      AsyncResult<typeof getWorkbenchFlowRunNodes>,
      { flowId: string; runId: string }
    >({
      queryFn: ({ flowId, runId }) =>
        resolveResult(() => getWorkbenchFlowRunNodes(flowId, runId)),
      providesTags: (_result, _error, { flowId }) => [
        { type: "WorkbenchFlow", id: flowId }
      ]
    }),
    getWorkbenchFlowRunNode: builder.query<
      AsyncResult<typeof getWorkbenchFlowRunNode>,
      { flowId: string; runId: string; nodeId: string }
    >({
      queryFn: ({ flowId, runId, nodeId }) =>
        resolveResult(() => getWorkbenchFlowRunNode(flowId, runId, nodeId)),
      providesTags: (_result, _error, { flowId }) => [
        { type: "WorkbenchFlow", id: flowId }
      ]
    }),
    getWorkbenchFlowNodeOutput: builder.query<
      AsyncResult<typeof getWorkbenchFlowNodeOutput>,
      { flowId: string; nodeId: string }
    >({
      queryFn: ({ flowId, nodeId }) =>
        resolveResult(() => getWorkbenchFlowNodeOutput(flowId, nodeId)),
      providesTags: (_result, _error, { flowId }) => [
        { type: "WorkbenchFlow", id: flowId }
      ]
    }),
    getSnapshot: builder.query<ForgeSnapshot, string[] | void>({
      queryFn: (userIds) => resolveResult(() => getForgeSnapshot(userIds)),
      providesTags: ["Snapshot"]
    }),
    getXpMetrics: builder.query<
      AsyncResult<typeof getXpMetrics>,
      string[] | void
    >({
      queryFn: (userIds) =>
        resolveResult(() => getXpMetrics(userIds, getRuntimeTimeZone())),
      providesTags: ["Gamification"]
    }),
    markGamificationCelebrationSeen: builder.mutation<
      AsyncResult<typeof markGamificationCelebrationSeen>,
      string
    >({
      queryFn: (celebrationId) =>
        resolveResult(() => markGamificationCelebrationSeen(celebrationId)),
      invalidatesTags: ["Gamification"]
    }),
    revokeOperatorSession: builder.mutation<
      AsyncResult<typeof revokeOperatorSession>,
      void
    >({
      queryFn: () => resolveResult(revokeOperatorSession),
      invalidatesTags: [
        "OperatorSession",
        "Settings",
        "Snapshot",
        "Gamification"
      ]
    }),
    listWikiIngestJobs: builder.query<{ jobs: WikiIngestJobPayload[] }, void>({
      queryFn: () => resolveResult(() => listWikiIngestJobs()),
      providesTags: ["WikiIngestJobs"]
    }),
    createTask: builder.mutation<
      AsyncResult<typeof createTask>,
      QuickTaskInput
    >({
      queryFn: (input) => resolveResult(() => createTask(input)),
      invalidatesTags: ["Snapshot"]
    }),
    createGoal: builder.mutation<
      AsyncResult<typeof createGoal>,
      GoalMutationInput
    >({
      queryFn: (input) => resolveResult(() => createGoal(input)),
      invalidatesTags: ["Snapshot"]
    }),
    createProject: builder.mutation<
      AsyncResult<typeof createProject>,
      ProjectMutationInput
    >({
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
    patchTask: builder.mutation<
      AsyncResult<typeof patchTask>,
      {
        taskId: string;
        patch: Parameters<typeof patchTask>[1];
      }
    >({
      queryFn: ({ taskId, patch }) =>
        resolveResult(() => patchTask(taskId, patch)),
      invalidatesTags: ["Snapshot"]
    }),
    patchTaskStatus: builder.mutation<
      AsyncResult<typeof patchTask>,
      {
        taskId: string;
        status: "backlog" | "focus" | "in_progress" | "blocked" | "done";
        completedAt?: string;
        enforceTodayWorkLog?: boolean;
        completedTodayWorkSeconds?: number;
      }
    >({
      queryFn: ({
        taskId,
        status,
        completedAt,
        enforceTodayWorkLog,
        completedTodayWorkSeconds
      }) =>
        resolveResult(() =>
          patchTask(taskId, {
            status,
            completedAt,
            enforceTodayWorkLog,
            completedTodayWorkSeconds
          })
        ),
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
    getSleepView: builder.query<
      AsyncResult<typeof getSleepView>,
      string[] | void
    >({
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
      queryFn: (userIds) => resolveResult(() => listBehaviorPatterns(userIds)),
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
    restoreWorkbenchFlowVersion: builder.mutation<
      AsyncResult<typeof restoreWorkbenchFlowVersion>,
      { flowId: string; revision: number; expectedRevision: number }
    >({
      queryFn: ({ flowId, revision, expectedRevision }) =>
        resolveResult(() =>
          restoreWorkbenchFlowVersion(flowId, {
            revision,
            expectedRevision
          })
        ),
      invalidatesTags: (_result, _error, { flowId }) => [
        { type: "WorkbenchFlow", id: flowId },
        "WorkbenchFlows"
      ]
    }),
    deleteWorkbenchFlow: builder.mutation<
      AsyncResult<typeof deleteWorkbenchFlow>,
      { flowId: string; expectedRevision: number }
    >({
      queryFn: ({ flowId, expectedRevision }) =>
        resolveResult(() => deleteWorkbenchFlow(flowId, expectedRevision)),
      invalidatesTags: (_result, _error, { flowId }) => [
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
  useGetForgeDoctorQuery,
  useGetOperatorSessionQuery,
  useGetXpMetricsQuery,
  useGetPsycheValuesQuery,
  useGetSettingsQuery,
  useGetSleepViewQuery,
  useGetSnapshotQuery,
  useGetWorkbenchFlowNodeOutputQuery,
  useGetTriggerReportsQuery,
  useGetWorkbenchFlowQuery,
  useListWorkbenchFlowVersionsQuery,
  useGetWorkbenchFlowRunNodeQuery,
  useGetWorkbenchFlowRunNodesQuery,
  useGetWorkbenchFlowRunQuery,
  useGetWorkbenchFlowRunsQuery,
  useListWikiIngestJobsQuery,
  useListWorkbenchFlowsQuery,
  useHeartbeatTaskRunMutation,
  useChatWorkbenchFlowMutation,
  useDeleteWorkbenchFlowMutation,
  usePatchGoalMutation,
  usePatchProjectMutation,
  usePatchSleepSessionMutation,
  usePatchTaskMutation,
  usePatchTaskStatusMutation,
  useReleaseTaskRunMutation,
  useMarkGamificationCelebrationSeenMutation,
  useApplyForgeDoctorFixesMutation,
  useRevokeOperatorSessionMutation,
  useRunWorkbenchFlowMutation,
  useRestoreWorkbenchFlowVersionMutation,
  useUpdateWorkbenchFlowMutation
} = forgeApi;
