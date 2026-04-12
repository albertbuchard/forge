import type { ReactNode } from "react";
import {
  buildSleepWorkbenchExecution,
  buildSportsWorkbenchExecution
} from "../../../lib/workbench/runtime.js";
import type {
  WorkbenchExecutionFunction,
  WorkbenchNodeExecutionInput,
  WorkbenchOutputDefinition
} from "../../../lib/workbench/nodes.js";
import {
  createContextOutput,
  createSummaryOutput
} from "../../../lib/workbench/contracts.js";
import { createGenericWorkbenchNodeView } from "../shared/generic-node-view.js";
import { defineWorkbenchBox } from "../shared/define-workbench-box.js";

type SlotProps = { children: ReactNode };
function Slot({ children }: SlotProps) {
  return <>{children}</>;
}

function defineHealthBox(input: {
  id: string;
  surfaceId: string;
  routePath: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  execute: WorkbenchExecutionFunction;
  output: WorkbenchOutputDefinition[];
}) {
  return defineWorkbenchBox(Slot, {
    id: input.id,
    surfaceId: input.surfaceId,
    routePath: input.routePath,
    title: input.title,
    icon: input.surfaceId,
    description: input.description,
    category: input.category,
    tags: input.tags,
    inputs: [],
    params: [],
    output: input.output,
    tools: [],
    NodeView: createGenericWorkbenchNodeView({
      title: input.title,
      description: input.description,
      inputs: [],
      params: [],
      output: input.output,
      tools: []
    }),
    execute: input.execute
  });
}

export const SleepSummaryBox = defineHealthBox({
  id: "surface:sleep-index:summary",
  surfaceId: "sleep-index",
  routePath: "/sleep",
  title: "Sleep summary",
  description: "Recent nightly sleep metrics and recovery posture.",
  category: "Sleep",
  tags: ["sleep", "summary"],
  execute: (input: WorkbenchNodeExecutionInput) => buildSleepWorkbenchExecution(input),
  output: [
    createSummaryOutput({ label: "Sleep summary", description: "Summary of recent sleep and recovery posture." }),
    createContextOutput({
      key: "sleepView",
      label: "Sleep view",
      description: "Structured sleep history and derived sleep patterns.",
      modelName: "ForgeSleepView"
    })
  ]
});

export const SleepPatternsBox = defineHealthBox({
  id: "surface:sleep-index:patterns",
  surfaceId: "sleep-index",
  routePath: "/sleep",
  title: "Sleep patterns",
  description: "Trend, stage averages, recovery state, and timing patterns.",
  category: "Sleep",
  tags: ["sleep", "patterns"],
  execute: (input: WorkbenchNodeExecutionInput) => buildSleepWorkbenchExecution(input),
  output: [
    createSummaryOutput({ label: "Sleep pattern summary", description: "Summary of trend, stage averages, and recovery state." }),
    createContextOutput({
      key: "sleepView",
      label: "Sleep view",
      description: "Structured sleep trend, stage averages, and recovery signals.",
      modelName: "ForgeSleepView"
    })
  ]
});

export const SleepBrowserBox = defineHealthBox({
  id: "surface:sleep-index:browser",
  surfaceId: "sleep-index",
  routePath: "/sleep",
  title: "Night browser",
  description: "Searchable and virtualized sleep history browser.",
  category: "Sleep",
  tags: ["sleep", "browser", "history"],
  execute: (input: WorkbenchNodeExecutionInput) => buildSleepWorkbenchExecution(input),
  output: [
    createSummaryOutput({ label: "Night browser summary", description: "Summary of searchable sleep history." }),
    createContextOutput({
      key: "sleepView",
      label: "Sleep view",
      description: "Structured sleep history for browsing and analysis.",
      modelName: "ForgeSleepView"
    })
  ]
});

export const SportsSummaryBox = defineHealthBox({
  id: "surface:sports-index:summary",
  surfaceId: "sports-index",
  routePath: "/sports",
  title: "Sports summary",
  description: "Recent workout metrics, streaks, and linked-session totals.",
  category: "Sports",
  tags: ["sports", "summary"],
  execute: (input: WorkbenchNodeExecutionInput) => buildSportsWorkbenchExecution(input),
  output: [
    createSummaryOutput({ label: "Sports summary", description: "Summary of recent workout metrics and streaks." }),
    createContextOutput({
      key: "sportsView",
      label: "Sports view",
      description: "Structured workout metrics, streaks, and linked session totals.",
      modelName: "ForgeSportsView"
    })
  ]
});

export const SportsCompositionBox = defineHealthBox({
  id: "surface:sports-index:composition",
  surfaceId: "sports-index",
  routePath: "/sports",
  title: "Training composition",
  description: "Workout mix, trend, and session composition context.",
  category: "Sports",
  tags: ["sports", "composition", "trend"],
  execute: (input: WorkbenchNodeExecutionInput) => buildSportsWorkbenchExecution(input),
  output: [
    createSummaryOutput({ label: "Composition summary", description: "Summary of workout mix, trend, and session composition." }),
    createContextOutput({
      key: "sportsView",
      label: "Sports view",
      description: "Structured workout mix, trend, and session composition data.",
      modelName: "ForgeSportsView"
    })
  ]
});

export const SportsBrowserBox = defineHealthBox({
  id: "surface:sports-index:browser",
  surfaceId: "sports-index",
  routePath: "/sports",
  title: "Session browser",
  description: "Searchable and virtualized workout history browser.",
  category: "Sports",
  tags: ["sports", "browser", "history"],
  execute: (input: WorkbenchNodeExecutionInput) => buildSportsWorkbenchExecution(input),
  output: [
    createSummaryOutput({ label: "Session browser summary", description: "Summary of searchable workout history." }),
    createContextOutput({
      key: "sportsView",
      label: "Sports view",
      description: "Structured workout history for browsing and analysis.",
      modelName: "ForgeSportsView"
    })
  ]
});
