import type { ComponentType } from "react";

export const WORKBENCH_PORT_KINDS = [
  "text",
  "number",
  "boolean",
  "object",
  "array",
  "json",
  "tool",
  "summary",
  "entity",
  "entity_list",
  "context",
  "metrics",
  "filters",
  "markdown",
  "timeline",
  "selection",
  "record",
  "record_list"
] as const;

export const LEGACY_WORKBENCH_PORT_KINDS = ["content"] as const;

export type WorkbenchPortKind = (typeof WORKBENCH_PORT_KINDS)[number];
export type LegacyWorkbenchPortKind = (typeof LEGACY_WORKBENCH_PORT_KINDS)[number];

export type WorkbenchParamKind =
  | WorkbenchPortKind
  | "textarea"
  | "select"
  | "json";

export type WorkbenchToolAccessMode = "read" | "write" | "read_write" | "exec";

export type WorkbenchNodeType =
  | "box"
  | "value"
  | "user_input"
  | "functor"
  | "chat"
  | "output"
  | "merge"
  | "template"
  | "pick_key";

export interface WorkbenchPortShapeField {
  key: string;
  label: string;
  kind: WorkbenchPortKind;
  description?: string;
  required?: boolean;
}

export interface WorkbenchInputDefinition {
  key: string;
  label: string;
  kind: WorkbenchPortKind;
  description?: string;
  required?: boolean;
  modelName?: string;
  itemKind?: string;
  shape?: WorkbenchPortShapeField[];
  exampleValue?: string;
}

export interface WorkbenchParamOption {
  value: string;
  label: string;
}

export interface WorkbenchParamDefinition {
  key: string;
  label: string;
  kind: WorkbenchParamKind;
  description?: string;
  required?: boolean;
  options?: WorkbenchParamOption[];
}

export interface WorkbenchOutputDefinition {
  key: string;
  label: string;
  kind: WorkbenchPortKind;
  description?: string;
  required?: boolean;
  expandableKeys?: string[];
  modelName?: string;
  itemKind?: string;
  shape?: WorkbenchPortShapeField[];
  exampleValue?: string;
}

export interface WorkbenchToolDefinition {
  key: string;
  label: string;
  description: string;
  accessMode: WorkbenchToolAccessMode;
  argsSchema?: Record<string, unknown>;
}

const ENTITY_PORT_SHAPES: Record<string, WorkbenchPortShapeField[]> = {
  goal: [
    { key: "id", label: "Id", kind: "text", required: true },
    { key: "title", label: "Title", kind: "text", required: true },
    { key: "status", label: "Status", kind: "text" },
    { key: "horizon", label: "Horizon", kind: "text" }
  ],
  project: [
    { key: "id", label: "Id", kind: "text", required: true },
    { key: "title", label: "Title", kind: "text", required: true },
    { key: "status", label: "Status", kind: "text" },
    { key: "goalId", label: "Goal id", kind: "text" }
  ],
  task: [
    { key: "id", label: "Id", kind: "text", required: true },
    { key: "title", label: "Title", kind: "text", required: true },
    { key: "status", label: "Status", kind: "text" },
    { key: "priority", label: "Priority", kind: "text" },
    { key: "projectId", label: "Project id", kind: "text" }
  ],
  strategy: [
    { key: "id", label: "Id", kind: "text", required: true },
    { key: "title", label: "Title", kind: "text", required: true },
    { key: "status", label: "Status", kind: "text" },
    { key: "overview", label: "Overview", kind: "markdown" }
  ],
  habit: [
    { key: "id", label: "Id", kind: "text", required: true },
    { key: "title", label: "Title", kind: "text", required: true },
    { key: "status", label: "Status", kind: "text" },
    { key: "frequency", label: "Frequency", kind: "text" },
    { key: "polarity", label: "Polarity", kind: "text" }
  ],
  note: [
    { key: "id", label: "Id", kind: "text", required: true },
    { key: "title", label: "Title", kind: "text", required: true },
    { key: "summary", label: "Summary", kind: "markdown" },
    { key: "kind", label: "Kind", kind: "text" },
    { key: "updatedAt", label: "Updated at", kind: "text" }
  ],
  insight: [
    { key: "id", label: "Id", kind: "text", required: true },
    { key: "title", label: "Title", kind: "text", required: true },
    { key: "summary", label: "Summary", kind: "markdown" },
    { key: "status", label: "Status", kind: "text" }
  ],
  calendar_event: [
    { key: "id", label: "Id", kind: "text", required: true },
    { key: "title", label: "Title", kind: "text", required: true },
    { key: "startsAt", label: "Starts at", kind: "text" },
    { key: "endsAt", label: "Ends at", kind: "text" },
    { key: "origin", label: "Origin", kind: "text" }
  ],
  wiki_page: [
    { key: "id", label: "Id", kind: "text", required: true },
    { key: "title", label: "Title", kind: "text", required: true },
    { key: "slug", label: "Slug", kind: "text" },
    { key: "summary", label: "Summary", kind: "markdown" }
  ],
  sleep_session: [
    { key: "id", label: "Id", kind: "text", required: true },
    { key: "startAt", label: "Start", kind: "text" },
    { key: "endAt", label: "End", kind: "text" },
    { key: "totalSleepMinutes", label: "Total sleep minutes", kind: "number" }
  ],
  workout_session: [
    { key: "id", label: "Id", kind: "text", required: true },
    { key: "type", label: "Type", kind: "text" },
    { key: "startedAt", label: "Started at", kind: "text" },
    { key: "durationMinutes", label: "Duration minutes", kind: "number" }
  ]
};

const MODEL_PORT_SHAPES: Record<string, WorkbenchPortShapeField[]> = {
  WorkbenchUserMessage: [{ key: "message", label: "Message", kind: "text", required: true }],
  WorkbenchUserContext: [{ key: "context", label: "Context", kind: "record" }],
  WorkbenchMergedContext: [{ key: "merged", label: "Merged", kind: "record", required: true }],
  WorkbenchTemplateOutput: [{ key: "rendered", label: "Rendered", kind: "markdown", required: true }],
  WorkbenchSelectedValue: [{ key: "selected", label: "Selected", kind: "record", required: true }],
  WorkbenchPublishedOutput: [{ key: "published", label: "Published", kind: "record", required: true }],
  WeeklyReviewPayload: [
    { key: "wins", label: "Wins", kind: "record_list" },
    { key: "trends", label: "Trends", kind: "record_list" }
  ],
  InsightsPayload: [
    { key: "insights", label: "Insights", kind: "record_list" },
    { key: "heatmap", label: "Heatmap", kind: "record_list" }
  ],
  OperatorOverviewPayload: [
    { key: "summary", label: "Summary", kind: "markdown" },
    { key: "currentWork", label: "Current work", kind: "record_list" }
  ],
  OperatorContextPayload: [
    { key: "tasks", label: "Tasks", kind: "record_list" },
    { key: "focus", label: "Focus", kind: "record_list" }
  ],
  SleepViewData: [
    { key: "sessions", label: "Sessions", kind: "record_list" },
    { key: "metrics", label: "Metrics", kind: "metrics" }
  ]
};

export function inferWorkbenchPortKind(input: {
  kind?: string | null;
  key?: string | null;
  modelName?: string | null;
  itemKind?: string | null;
}) {
  const rawKind = input.kind?.trim().toLowerCase();
  if (rawKind && WORKBENCH_PORT_KINDS.includes(rawKind as WorkbenchPortKind)) {
    return rawKind as WorkbenchPortKind;
  }
  const key = input.key?.trim().toLowerCase() ?? "";
  const modelName = input.modelName?.trim().toLowerCase() ?? "";
  if (rawKind === "content") {
    if (key === "summary" || modelName.includes("summary")) {
      return "summary";
    }
    if (
      key === "answer" ||
      key === "rendered" ||
      modelName.includes("answer") ||
      modelName.includes("markdown") ||
      modelName.includes("template")
    ) {
      return "markdown";
    }
    if (
      key === "message" ||
      key === "query" ||
      key === "title" ||
      modelName.includes("message")
    ) {
      return "text";
    }
    if (input.itemKind) {
      return "entity_list";
    }
    return "record";
  }
  if (key.endsWith("count") || key === "limit") {
    return "number";
  }
  if (key === "summary") {
    return "summary";
  }
  if (key === "answer" || key === "rendered") {
    return "markdown";
  }
  if (key === "message" || key === "query") {
    return "text";
  }
  if (input.itemKind) {
    return "entity_list";
  }
  return "record";
}

export function normalizeWorkbenchPortKind(input: {
  kind?: string | null;
  key?: string | null;
  modelName?: string | null;
  itemKind?: string | null;
}) {
  return inferWorkbenchPortKind(input);
}

export function getWorkbenchEntityPortShape(itemKind?: string | null) {
  if (!itemKind) {
    return [];
  }
  return ENTITY_PORT_SHAPES[itemKind] ?? [];
}

export function getWorkbenchModelPortShape(modelName?: string | null) {
  if (!modelName) {
    return [];
  }
  return MODEL_PORT_SHAPES[modelName] ?? [];
}

export function normalizeWorkbenchPortDefinition<
  T extends {
    key: string;
    label: string;
    kind?: string;
    description?: string;
    required?: boolean;
    expandableKeys?: string[];
    modelName?: string;
    itemKind?: string;
    shape?: WorkbenchPortShapeField[];
    exampleValue?: string;
  }
>(port: T): T & { kind: WorkbenchPortKind; shape: WorkbenchPortShapeField[] } {
  const kind = inferWorkbenchPortKind(port);
  const entityShape = getWorkbenchEntityPortShape(port.itemKind);
  const modelShape = getWorkbenchModelPortShape(port.modelName);
  const inferredShape =
    port.shape && port.shape.length > 0
      ? port.shape
      : entityShape.length > 0
        ? entityShape
        : modelShape;
  return {
    ...port,
    kind,
    shape: inferredShape.length > 0 ? inferredShape : []
  };
}

export function normalizeWorkbenchPortDefinitions<T extends {
  key: string;
  label: string;
  kind?: string;
  description?: string;
  required?: boolean;
  expandableKeys?: string[];
  modelName?: string;
  itemKind?: string;
  shape?: WorkbenchPortShapeField[];
  exampleValue?: string;
}>(ports: T[]) {
  return ports.map((port) => normalizeWorkbenchPortDefinition(port));
}

export interface WorkbenchNodeExecutionValue {
  primaryText: string;
  payload: Record<string, unknown> | null;
  logs: string[];
  outputMap?: Record<
    string,
    {
      text: string;
      json: Record<string, unknown> | null;
    }
  >;
}

export interface WorkbenchToolSearchInput {
  query: string;
  entityTypes?: string[];
  limit?: number;
}

export interface WorkbenchRuntimeServices {
  entities: {
    search: (input: { searches: WorkbenchToolSearchInput[] }) => {
      results: Array<{
        ok?: boolean;
        matches?: Array<Record<string, unknown>>;
      }>;
    };
  };
  notes: {
    create?: (input: Record<string, unknown>) => unknown;
    list?: (input?: Record<string, unknown>) => Array<Record<string, unknown>>;
  };
  movement: {
    listPlaces?: (input?: Record<string, unknown>) => Array<Record<string, unknown>>;
  };
  health: {
    getSleepViewData?: () => Record<string, unknown>;
    getFitnessViewData?: () => Record<string, unknown>;
  };
  overview: {
    getContext?: () => Record<string, unknown>;
    getWeeklyReview?: () => Record<string, unknown>;
    getInsights?: () => Record<string, unknown>;
  };
  wiki: {
    listPages?: (input?: Record<string, unknown>) => Array<Record<string, unknown>>;
    getHealth?: () => Record<string, unknown>;
  };
  tasks: {
    update?: (taskId: string, patch: Record<string, unknown>) => unknown;
  };
}

export interface WorkbenchRuntimeContext {
  actor: {
    userIds: string[] | null;
    source: "ui" | "api" | "agent";
  };
  services: WorkbenchRuntimeServices;
  routeParams?: Record<string, string>;
  filters?: Record<string, unknown>;
  now: string;
}

export interface WorkbenchNodeExecutionInput {
  nodeId: string;
  definition: WorkbenchNodeDefinition;
  inputs: Record<string, unknown>;
  params: Record<string, unknown>;
  context: WorkbenchRuntimeContext;
}

export interface WorkbenchNodeComponentProps {
  nodeId?: string | null;
  inputs?: Record<string, unknown>;
  params?: Record<string, unknown>;
  compact?: boolean;
}

export type WorkbenchExecutionFunction = (
  input: WorkbenchNodeExecutionInput
) => Promise<WorkbenchNodeExecutionValue> | WorkbenchNodeExecutionValue;

export interface WorkbenchNodeDefinition {
  id: string;
  surfaceId: string | null;
  routePath: string | null;
  title: string;
  icon?: string;
  description: string;
  category: string;
  tags: string[];
  inputs: WorkbenchInputDefinition[];
  params: WorkbenchParamDefinition[];
  output: WorkbenchOutputDefinition[];
  tools: WorkbenchToolDefinition[];
  WebView: ComponentType<Record<string, unknown>>;
  NodeView: ComponentType<WorkbenchNodeComponentProps>;
  execute: WorkbenchExecutionFunction;
}

export type WorkbenchRegisteredComponent<Props = Record<string, unknown>> =
  ComponentType<Props> & {
    workbench: WorkbenchNodeDefinition;
  };

export function defineWorkbenchComponent<Props>(
  component: ComponentType<Props>,
  workbench: Omit<WorkbenchNodeDefinition, "WebView">
) {
  return Object.assign(component, {
    workbench: {
      ...workbench,
      WebView: component as ComponentType<Record<string, unknown>>
    }
  }) as WorkbenchRegisteredComponent<Props>;
}

export function isWorkbenchRegisteredComponent(
  value: unknown
): value is WorkbenchRegisteredComponent {
  const candidate = value as { workbench?: { id?: unknown } } | null;
  return Boolean(
    candidate &&
      typeof value === "function" &&
      candidate.workbench &&
      typeof candidate.workbench.id === "string"
  );
}
