import type { ComponentType } from "react";

export type WorkbenchPortKind =
  | "content"
  | "text"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "json"
  | "tool";

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

export interface WorkbenchInputDefinition {
  key: string;
  label: string;
  kind: WorkbenchPortKind;
  description?: string;
  required?: boolean;
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
  required?: boolean;
  expandableKeys?: string[];
}

export interface WorkbenchToolDefinition {
  key: string;
  label: string;
  description: string;
  accessMode: WorkbenchToolAccessMode;
  argsSchema?: Record<string, unknown>;
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
