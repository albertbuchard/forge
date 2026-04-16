import "@xyflow/react/dist/style.css";
import * as Dialog from "@radix-ui/react-dialog";
import {
  addEdge,
  Background,
  Handle,
  Position,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeProps
} from "@xyflow/react";
import {
  ArrowLeft,
  Bug,
  Bot,
  Braces,
  Database,
  Ellipsis,
  GitMerge,
  ListTree,
  MessageSquare,
  Play,
  Save,
  Send,
  Settings2,
  Sparkles,
  SquareTerminal,
  Trash2,
  Wand2
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { Link } from "react-router-dom";
import {
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { useWorkbenchNodeDefinition } from "@/components/workbench/workbench-provider";
import {
  FacetedTokenSearch,
  type FacetedTokenOption
} from "@/components/search/faceted-token-search";
import { Button } from "@/components/ui/button";
import { EntityBadge } from "@/components/ui/entity-badge";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { ForgeApiError } from "@/lib/api-error";
import { getEntityKindForWorkbenchFlowKind } from "@/lib/entity-visuals";
import { buildWorkbenchToolCatalog } from "@/lib/workbench/tool-catalog";
import {
  WORKBENCH_PORT_KINDS,
  normalizeWorkbenchPortDefinition
} from "@/lib/workbench/nodes";
import type {
  AiConnector,
  AiConnectorEdge,
  AiConnectorKind,
  AiConnectorNode,
  AiConnectorNodeType,
  AiConnectorPublicInput,
  AiConnectorRun,
  ForgeBoxCatalogEntry,
  ForgeBoxPortDefinition,
  ForgeBoxPortShapeField
} from "@/lib/types";
import {
  useGetWorkbenchFlowRunNodeQuery,
  useGetWorkbenchFlowRunNodesQuery
} from "@/store/api/forge-api";
import { cn } from "@/lib/utils";

const WORKBENCH_FIELD_CLASS =
  "rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none";

type WorkbenchGraphNodeData = AiConnectorNode["data"] & {
  nodeType: AiConnectorNodeType;
  inputs: ForgeBoxPortDefinition[];
  outputs: ForgeBoxPortDefinition[];
  onEditRequest?: (() => void) | null;
  onParameterEditRequest?: (() => void) | null;
  onContractEditRequest?: (() => void) | null;
};

type WorkbenchEditorSection = "overview" | "contracts" | "parameters";
type WorkbenchSaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const PORT_KIND_OPTIONS: Array<ForgeBoxPortDefinition["kind"]> = [
  ...WORKBENCH_PORT_KINDS
];

const PORT_KIND_TONES: Record<string, string> = {
  summary: "border-amber-300/28 bg-amber-300/12 text-amber-100",
  markdown: "border-violet-300/28 bg-violet-300/12 text-violet-100",
  text: "border-sky-300/28 bg-sky-300/12 text-sky-100",
  number: "border-emerald-300/28 bg-emerald-300/12 text-emerald-100",
  boolean: "border-lime-300/28 bg-lime-300/12 text-lime-100",
  entity: "border-fuchsia-300/28 bg-fuchsia-300/12 text-fuchsia-100",
  entity_list: "border-pink-300/28 bg-pink-300/12 text-pink-100",
  context: "border-cyan-300/28 bg-cyan-300/12 text-cyan-100",
  metrics: "border-teal-300/28 bg-teal-300/12 text-teal-100",
  filters: "border-orange-300/28 bg-orange-300/12 text-orange-100",
  record: "border-indigo-300/28 bg-indigo-300/12 text-indigo-100",
  record_list: "border-purple-300/28 bg-purple-300/12 text-purple-100",
  selection: "border-rose-300/28 bg-rose-300/12 text-rose-100",
  timeline: "border-blue-300/28 bg-blue-300/12 text-blue-100",
  json: "border-slate-300/28 bg-slate-300/12 text-slate-100",
  object: "border-slate-300/28 bg-slate-300/12 text-slate-100",
  array: "border-zinc-300/28 bg-zinc-300/12 text-zinc-100",
  tool: "border-red-300/28 bg-red-300/12 text-red-100"
};

function formatWorkbenchParamValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value) || (value && typeof value === "object")) {
    return JSON.stringify(value, null, 2);
  }
  return "";
}

function parseWorkbenchParamValue(kind: string, raw: string) {
  if (
    kind === "array" ||
    kind === "entity_list" ||
    kind === "record_list" ||
    kind === "object" ||
    kind === "json" ||
    kind === "record" ||
    kind === "context" ||
    kind === "filters" ||
    kind === "metrics" ||
    kind === "timeline" ||
    kind === "selection" ||
    kind === "entity"
  ) {
    if (!raw.trim()) {
      return "";
    }
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (kind === "boolean") {
    if (!raw.trim()) {
      return "";
    }
    if (raw.trim().toLowerCase() === "true") {
      return true;
    }
    if (raw.trim().toLowerCase() === "false") {
      return false;
    }
    return raw;
  }
  if (kind === "number") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return "";
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : raw;
  }
  return raw;
}

function validateWorkbenchInputValue(
  definition: Pick<AiConnectorPublicInput, "kind" | "label" | "required">,
  value: unknown
) {
  if (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0)
  ) {
    return !definition.required;
  }
  switch (definition.kind) {
    case "text":
    case "markdown":
    case "summary":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
    case "entity_list":
    case "record_list":
      return Array.isArray(value);
    case "object":
    case "json":
    case "record":
    case "context":
    case "filters":
    case "metrics":
    case "timeline":
    case "selection":
    case "entity":
      return Boolean(value) && typeof value === "object";
    default:
      return true;
  }
}

function defaultPortsForNodeType(nodeType: AiConnectorNodeType): {
  inputs: ForgeBoxPortDefinition[];
  outputs: ForgeBoxPortDefinition[];
} {
  switch (nodeType) {
    case "box":
    case "box_input":
      return {
        inputs: [],
        outputs: [
          {
            key: "summary",
            label: "Summary",
            kind: "summary",
            description: "Human-readable summary of the box snapshot.",
            modelName: "WorkbenchBoxSummary"
          }
        ]
      };
    case "user_input":
      return {
        inputs: [],
        outputs: [
          {
            key: "message",
            label: "Message",
            kind: "text",
            description: "Raw user message passed into the flow.",
            modelName: "WorkbenchUserMessage"
          },
          {
            key: "context",
            label: "Structured context",
            kind: "context",
            description:
              "Structured context fields that arrived with the user input.",
            modelName: "WorkbenchUserContext"
          }
        ]
      };
    case "value":
      return {
        inputs: [],
        outputs: [
          {
            key: "value",
            label: "Value",
            kind: "record",
            description: "Literal value emitted by this node.",
            modelName: "WorkbenchLiteralValue"
          }
        ]
      };
    case "functor":
    case "chat":
      return {
        inputs: [
          {
            key: "input",
            label: "Flow input",
            kind: "context",
            required: false,
            description: "Context gathered from upstream nodes."
          }
        ],
        outputs: [
          {
            key: "answer",
            label: "Answer",
            kind: "markdown",
            description: "Primary answer returned by this AI node.",
            modelName: "WorkbenchAiAnswer"
          }
        ]
      };
    case "merge":
      return {
        inputs: [
          {
            key: "left",
            label: "Left input",
            kind: "context",
            required: false,
            description: "First context record to merge."
          },
          {
            key: "right",
            label: "Right input",
            kind: "context",
            required: false,
            description: "Second context record to merge."
          }
        ],
        outputs: [
          {
            key: "merged",
            label: "Merged context",
            kind: "context",
            description: "Combined context assembled from upstream nodes.",
            modelName: "WorkbenchMergedContext"
          }
        ]
      };
    case "template":
      return {
        inputs: [
          {
            key: "input",
            label: "Template input",
            kind: "context",
            required: false,
            description: "Structured context available to the template."
          }
        ],
        outputs: [
          {
            key: "rendered",
            label: "Rendered output",
            kind: "markdown",
            description: "Rendered text produced by the template node.",
            modelName: "WorkbenchTemplateOutput"
          }
        ]
      };
    case "pick_key":
      return {
        inputs: [
          {
            key: "object",
            label: "Source object",
            kind: "object",
            required: false,
            description: "Object record the node should read from."
          }
        ],
        outputs: [
          {
            key: "selected",
            label: "Selected value",
            kind: "record",
            description: "Value extracted from the chosen key.",
            modelName: "WorkbenchSelectedValue"
          }
        ]
      };
    case "output":
      return {
        inputs: [
          {
            key: "result",
            label: "Published result",
            kind: "context",
            required: false,
            description: "Final value the flow should publish."
          }
        ],
        outputs: []
      };
  }
}

function nodeTone(nodeType: AiConnectorNodeType) {
  switch (nodeType) {
    case "box":
    case "box_input":
      return {
        icon: <Database className="size-4" />,
        badge: "box"
      };
    case "chat":
      return {
        icon: <MessageSquare className="size-4" />,
        badge: "chat"
      };
    case "functor":
      return {
        icon: <Sparkles className="size-4" />,
        badge: "functor"
      };
    case "output":
      return {
        icon: <Send className="size-4" />,
        badge: "output"
      };
    case "value":
      return {
        icon: <ListTree className="size-4" />,
        badge: "value"
      };
    case "merge":
      return {
        icon: <GitMerge className="size-4" />,
        badge: "merge"
      };
    case "template":
      return {
        icon: <Wand2 className="size-4" />,
        badge: "template"
      };
    case "pick_key":
      return {
        icon: <Braces className="size-4" />,
        badge: "pick key"
      };
    default:
      return {
        icon: <SquareTerminal className="size-4" />,
        badge: "input"
      };
  }
}

function resolveNodePorts(
  node: AiConnectorNode,
  boxes: ForgeBoxCatalogEntry[]
): {
  inputs: ForgeBoxPortDefinition[];
  outputs: ForgeBoxPortDefinition[];
  enabledToolKeys: string[];
  boxId: string | null;
} {
  const normalizePorts = (
    ports: ForgeBoxPortDefinition[],
    direction: "input" | "output"
  ) =>
    ports.map((port, index) => {
      const normalized = normalizeWorkbenchPortDefinition(port);
      const key =
        normalized.key === "primary"
          ? direction === "output"
            ? node.type === "functor" || node.type === "chat"
              ? "answer"
              : node.type === "box" || node.type === "box_input"
                ? "summary"
                : node.type === "value"
                  ? "value"
                  : node.type === "merge"
                    ? "merged"
                    : node.type === "template"
                      ? "rendered"
                      : node.type === "pick_key"
                        ? "selected"
                        : "result"
            : node.type === "functor" || node.type === "chat"
              ? "input"
              : node.type === "output"
                ? "result"
                : normalized.key
          : normalized.key;
      return normalizeWorkbenchPortDefinition({
        ...normalized,
        key,
        kind: key === normalized.key ? normalized.kind : undefined
      });
    });
  if (node.type === "box" || node.type === "box_input") {
    const box = boxes.find((entry) => entry.id === node.data.boxId);
    return {
      inputs: normalizePorts(box?.inputs ?? [], "input"),
      outputs: box?.output?.length
        ? normalizePorts(box.output, "output")
        : normalizePorts(
            [
              {
                key: "summary",
                label: "Summary",
                kind: "summary",
                description: "Human-readable summary of the box snapshot.",
                modelName: "WorkbenchBoxSummary"
              }
            ],
            "output"
          ),
      enabledToolKeys: node.data.enabledToolKeys?.length
        ? node.data.enabledToolKeys
        : (box?.tools ?? []).map((tool) => tool.key),
      boxId: box?.id ?? node.data.boxId ?? null
    };
  }
  const defaults = defaultPortsForNodeType(node.type);
  return {
    inputs: normalizePorts(
      node.data.inputs?.length ? node.data.inputs : defaults.inputs,
      "input"
    ),
    outputs: normalizePorts(
      node.data.outputs?.length ? node.data.outputs : defaults.outputs,
      "output"
    ),
    enabledToolKeys: node.data.enabledToolKeys ?? [],
    boxId: node.data.boxId ?? null
  };
}

function normalizeNodeOutputKey(
  node: AiConnectorNode,
  outputs: ForgeBoxPortDefinition[]
) {
  const current = node.data.outputKey?.trim();
  if (!current || current === "primary") {
    return outputs[0]?.key ?? "";
  }
  if (outputs.some((output) => output.key === current)) {
    return current;
  }
  return outputs[0]?.key ?? current;
}

function canonicalHandleFromLegacy(
  handle: string | null | undefined,
  ports: ForgeBoxPortDefinition[],
  preferred?: string
) {
  if (ports.length === 0) {
    return null;
  }
  if (!handle || handle === "primary") {
    if (preferred && ports.some((port) => port.key === preferred)) {
      return preferred;
    }
    return ports[0]?.key ?? null;
  }
  if (ports.some((port) => port.key === handle)) {
    return handle;
  }
  if (preferred && ports.some((port) => port.key === preferred)) {
    return preferred;
  }
  return ports[0]?.key ?? null;
}

function normalizeWorkbenchGraph(
  connector: Pick<AiConnector, "graph">,
  boxes: ForgeBoxCatalogEntry[]
) {
  const nodes = connector.graph.nodes.map((node) => {
    const resolved = resolveNodePorts(node, boxes);
    const normalizedNode: AiConnectorNode = {
      ...node,
      data: {
        ...node.data,
        inputs: resolved.inputs,
        outputs: resolved.outputs,
        outputKey: normalizeNodeOutputKey(node, resolved.outputs)
      }
    };
    return graphNodeFromConnector(normalizedNode, boxes);
  });
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edges = connector.graph.edges.map((edge) => {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    const normalizedSourceHandle = canonicalHandleFromLegacy(
      edge.sourceHandle,
      sourceNode?.data.outputs ?? [],
      sourceNode?.data.outputs?.[0]?.key
    );
    const normalizedTargetHandle = canonicalHandleFromLegacy(
      edge.targetHandle,
      targetNode?.data.inputs ?? [],
      targetNode?.data.inputs?.[0]?.key
    );
    return graphEdgeFromConnector({
      ...edge,
      sourceHandle: normalizedSourceHandle,
      targetHandle: normalizedTargetHandle
    });
  });
  return { nodes, edges };
}

function graphNodeFromConnector(
  node: AiConnectorNode,
  boxes: ForgeBoxCatalogEntry[]
): Node<WorkbenchGraphNodeData> {
  const resolved = resolveNodePorts(node, boxes);
  return {
    id: node.id,
    type: "workbench",
    position: node.position,
    data: {
      ...node.data,
      nodeType: node.type === "box_input" ? "box" : node.type,
      boxId: resolved.boxId,
      enabledToolKeys: resolved.enabledToolKeys,
      inputs: resolved.inputs,
      outputs: resolved.outputs,
      params: node.data.params ?? [],
      paramValues: node.data.paramValues ?? {}
    }
  };
}

function graphEdgeFromConnector(edge: AiConnectorEdge): Edge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
    label: edge.label ?? undefined,
    style: { stroke: "rgba(188, 194, 255, 0.44)", strokeWidth: 1.6 }
  };
}

function connectorNodeFromGraph(
  node: Node<WorkbenchGraphNodeData>
): AiConnectorNode {
  return {
    id: node.id,
    type: node.data.nodeType === "box" ? "box" : node.data.nodeType,
    position: node.position,
    data: {
      label: node.data.label,
      description: node.data.description,
      boxId: node.data.boxId ?? null,
      prompt: node.data.prompt ?? "",
      promptTemplate: node.data.promptTemplate ?? "",
      systemPrompt: node.data.systemPrompt ?? "",
      outputKey: node.data.outputKey ?? "",
      enabledToolKeys: node.data.enabledToolKeys ?? [],
      inputs: node.data.inputs ?? [],
      outputs: node.data.outputs ?? [],
      params: node.data.params ?? [],
      paramValues: node.data.paramValues ?? {},
      template: node.data.template ?? "",
      selectedKey: node.data.selectedKey ?? "",
      valueType: node.data.valueType ?? "string",
      valueLiteral: node.data.valueLiteral ?? "",
      modelConfig: node.data.modelConfig
    }
  };
}

function connectorEdgeFromGraph(edge: Edge): AiConnectorEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
    label: typeof edge.label === "string" ? edge.label : null
  };
}

function buildNodeTemplate(
  nodeType: AiConnectorNodeType,
  nodes: Node<WorkbenchGraphNodeData>[],
  box?: ForgeBoxCatalogEntry
): Node<WorkbenchGraphNodeData> {
  const defaults = defaultPortsForNodeType(nodeType);
  return {
    id: `node_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
    type: "workbench",
    position: {
      x: 120 + (nodes.length % 3) * 320,
      y: 80 + Math.floor(nodes.length / 3) * 220
    },
    data: {
      nodeType,
      label:
        box?.title ??
        (nodeType === "functor"
          ? "Functor"
          : nodeType === "chat"
            ? "Chat node"
            : nodeType === "output"
              ? "Output"
              : nodeType === "value"
                ? "Value"
                : nodeType === "template"
                  ? "Template"
                  : nodeType === "pick_key"
                    ? "Pick key"
                    : nodeType === "merge"
                      ? "Merge"
                      : "User input"),
      description:
        box?.description ??
        (nodeType === "box"
          ? "Registered Forge box."
          : nodeType === "chat"
            ? "Conversational flow node."
            : nodeType === "functor"
              ? "Single transformation node."
              : "Workbench node."),
      boxId: box?.id ?? null,
      enabledToolKeys: (box?.tools ?? []).map((tool) => tool.key),
      inputs: box?.inputs ?? defaults.inputs,
      outputs: box?.output ?? defaults.outputs,
      params: box?.params ?? [],
      paramValues: {},
      prompt: "",
      promptTemplate: "",
      systemPrompt: "",
      template: "",
      selectedKey: "",
      valueType: "string",
      valueLiteral: "",
      outputKey: (box?.output ?? defaults.outputs)[0]?.key ?? "summary",
      modelConfig: {
        connectionId: null,
        provider: null,
        baseUrl: null,
        model: "",
        thinking: null,
        verbosity: null
      }
    }
  };
}

function formatPortMeta(port: ForgeBoxPortDefinition) {
  return [
    port.kind,
    port.modelName,
    port.itemKind ? `item:${port.itemKind}` : null
  ]
    .filter(Boolean)
    .join(" · ");
}

function summarizeSaveState(state: WorkbenchSaveState, error: string | null) {
  switch (state) {
    case "dirty":
      return "Unsaved changes";
    case "saving":
      return "Saving…";
    case "saved":
      return "All changes saved";
    case "error":
      return error ? `Save failed: ${error}` : "Save failed";
    default:
      return "Saved";
  }
}

function createPortDefinition(
  prefix: "input" | "output"
): ForgeBoxPortDefinition {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 4);
  return {
    key: `${prefix}_${suffix}`,
    label: prefix === "input" ? "New input" : "New output",
    kind: prefix === "input" ? "context" : "record",
    description: "",
    required: false,
    modelName:
      prefix === "input" ? "WorkbenchInputContract" : "WorkbenchOutputContract"
  };
}

function createPublicInputDefinition(): AiConnectorPublicInput {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 4);
  return {
    key: `flow_input_${suffix}`,
    label: "New flow input",
    kind: "text",
    description: "",
    required: false,
    modelName: "WorkbenchFlowInput",
    bindings: []
  };
}

function PortKindBadge({ kind }: { kind: ForgeBoxPortDefinition["kind"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em]",
        PORT_KIND_TONES[kind] ?? "border-white/12 bg-white/[0.05] text-white/60"
      )}
    >
      {kind.replaceAll("_", " ")}
    </span>
  );
}

function NodeActionButton({
  label,
  onClick,
  emphasis = false
}: {
  label: string;
  onClick: () => void;
  emphasis?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-full border px-3 py-1.5 text-[11px] font-medium transition",
        emphasis
          ? "border-[rgba(192,193,255,0.32)] bg-[rgba(192,193,255,0.18)] text-white hover:bg-[rgba(192,193,255,0.24)]"
          : "border-white/10 bg-white/[0.05] text-white/60 hover:bg-white/[0.08] hover:text-white"
      )}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {label}
    </button>
  );
}

function PortDefinitionEditor({
  title,
  description,
  ports,
  onChange,
  prefix
}: {
  title: string;
  description: string;
  ports: ForgeBoxPortDefinition[];
  onChange: (ports: ForgeBoxPortDefinition[]) => void;
  prefix: "input" | "output";
}) {
  return (
    <div className="grid gap-3 rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <span>{title}</span>
            <InfoTooltip
              content={description}
              label={`Explain ${title.toLowerCase()}`}
            />
          </div>
          <div className="mt-1 text-sm leading-6 text-white/54">
            {description}
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            onChange([...(ports ?? []), createPortDefinition(prefix)])
          }
        >
          Add {prefix}
        </Button>
      </div>

      <div className="grid gap-3">
        {ports.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-white/10 px-4 py-3 text-sm text-white/42">
            No {prefix}s defined yet.
          </div>
        ) : null}
        {ports.map((port, index) => (
          <div
            key={`${prefix}-${port.key}-${index}`}
            className="grid gap-3 rounded-[20px] border border-white/8 bg-black/20 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <PortKindBadge kind={port.kind} />
                <span className="text-sm font-medium text-white">
                  {port.label}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  onChange(ports.filter((_, portIndex) => portIndex !== index))
                }
              >
                Remove
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <FlowField
                label="Key"
                description="Downstream nodes reference this exact key."
                labelHelp="Keep keys stable once edges depend on them. Use snake_case names that describe the value clearly."
              >
                <input
                  value={port.key}
                  onChange={(event) =>
                    onChange(
                      ports.map((entry, entryIndex) =>
                        entryIndex === index
                          ? { ...entry, key: event.target.value }
                          : entry
                      )
                    )
                  }
                  className={WORKBENCH_FIELD_CLASS}
                />
              </FlowField>
              <FlowField
                label="Label"
                description="Readable name shown in the graph editor."
              >
                <input
                  value={port.label}
                  onChange={(event) =>
                    onChange(
                      ports.map((entry, entryIndex) =>
                        entryIndex === index
                          ? { ...entry, label: event.target.value }
                          : entry
                      )
                    )
                  }
                  className={WORKBENCH_FIELD_CLASS}
                />
              </FlowField>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <FlowField
                label="Value type"
                description="This colors the port and tells the flow what sort of value should move through it."
              >
                <select
                  value={port.kind}
                  onChange={(event) =>
                    onChange(
                      ports.map((entry, entryIndex) =>
                        entryIndex === index
                          ? {
                              ...entry,
                              kind: event.target
                                .value as ForgeBoxPortDefinition["kind"]
                            }
                          : entry
                      )
                    )
                  }
                  className={WORKBENCH_FIELD_CLASS}
                >
                  {PORT_KIND_OPTIONS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </FlowField>
              <FlowField
                label="Model name"
                description="Semantic model name for this port, used in previews and runtime contracts."
              >
                <input
                  value={port.modelName ?? ""}
                  onChange={(event) =>
                    onChange(
                      ports.map((entry, entryIndex) =>
                        entryIndex === index
                          ? {
                              ...entry,
                              modelName: event.target.value || undefined
                            }
                          : entry
                      )
                    )
                  }
                  placeholder="WorkbenchTaskSearchResults"
                  className={WORKBENCH_FIELD_CLASS}
                />
              </FlowField>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <FlowField
                label="Item kind"
                description="Optional entity or item subtype when this port carries a collection."
              >
                <input
                  value={port.itemKind ?? ""}
                  onChange={(event) =>
                    onChange(
                      ports.map((entry, entryIndex) =>
                        entryIndex === index
                          ? {
                              ...entry,
                              itemKind: event.target.value || undefined
                            }
                          : entry
                      )
                    )
                  }
                  placeholder="task"
                  className={WORKBENCH_FIELD_CLASS}
                />
              </FlowField>
              <FlowField
                label="Example value"
                description="Short example shown in collapsed previews."
              >
                <input
                  value={port.exampleValue ?? ""}
                  onChange={(event) =>
                    onChange(
                      ports.map((entry, entryIndex) =>
                        entryIndex === index
                          ? {
                              ...entry,
                              exampleValue: event.target.value || undefined
                            }
                          : entry
                      )
                    )
                  }
                  placeholder={
                    prefix === "input"
                      ? "task ids and filters"
                      : "summarized result"
                  }
                  className={WORKBENCH_FIELD_CLASS}
                />
              </FlowField>
            </div>
            <FlowField
              label="Expectation"
              description="Describe what should actually be inside this value so the graph stays legible."
            >
              <textarea
                rows={3}
                value={port.description ?? ""}
                onChange={(event) =>
                  onChange(
                    ports.map((entry, entryIndex) =>
                      entryIndex === index
                        ? {
                            ...entry,
                            description: event.target.value || undefined
                          }
                        : entry
                    )
                  )
                }
                placeholder={
                  prefix === "input"
                    ? "Explain what upstream nodes should provide here."
                    : "Explain what downstream nodes can expect from this output."
                }
                className={WORKBENCH_FIELD_CLASS}
              />
            </FlowField>
            <details className="rounded-[18px] border border-white/8 bg-white/[0.03] p-4">
              <summary className="cursor-pointer text-sm font-medium text-white">
                Shape fields
              </summary>
              <div className="mt-3 grid gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="text-sm leading-6 text-white/54">
                    Describe the object structure or list item shape this port
                    carries.
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      onChange(
                        ports.map((entry, entryIndex) =>
                          entryIndex === index
                            ? {
                                ...entry,
                                shape: [
                                  ...(entry.shape ?? []),
                                  {
                                    key: `field_${crypto.randomUUID().replaceAll("-", "").slice(0, 4)}`,
                                    label: "New field",
                                    kind: "text",
                                    required: false
                                  } satisfies ForgeBoxPortShapeField
                                ]
                              }
                            : entry
                        )
                      )
                    }
                  >
                    Add field
                  </Button>
                </div>
                {(port.shape ?? []).length === 0 ? (
                  <div className="rounded-[16px] border border-dashed border-white/10 px-4 py-3 text-sm text-white/42">
                    No explicit structure fields yet.
                  </div>
                ) : null}
                {(port.shape ?? []).map((field, fieldIndex) => (
                  <div
                    key={`${port.key}-shape-${field.key}-${fieldIndex}`}
                    className="grid gap-3 rounded-[16px] border border-white/8 bg-black/20 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <PortKindBadge kind={field.kind} />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          onChange(
                            ports.map((entry, entryIndex) =>
                              entryIndex === index
                                ? {
                                    ...entry,
                                    shape: (entry.shape ?? []).filter(
                                      (_, shapeIndex) =>
                                        shapeIndex !== fieldIndex
                                    )
                                  }
                                : entry
                            )
                          )
                        }
                      >
                        Remove field
                      </Button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <input
                        value={field.key}
                        onChange={(event) =>
                          onChange(
                            ports.map((entry, entryIndex) =>
                              entryIndex === index
                                ? {
                                    ...entry,
                                    shape: (entry.shape ?? []).map(
                                      (shapeEntry, shapeIndex) =>
                                        shapeIndex === fieldIndex
                                          ? {
                                              ...shapeEntry,
                                              key: event.target.value
                                            }
                                          : shapeEntry
                                    )
                                  }
                                : entry
                            )
                          )
                        }
                        placeholder="field_key"
                        className={WORKBENCH_FIELD_CLASS}
                      />
                      <input
                        value={field.label}
                        onChange={(event) =>
                          onChange(
                            ports.map((entry, entryIndex) =>
                              entryIndex === index
                                ? {
                                    ...entry,
                                    shape: (entry.shape ?? []).map(
                                      (shapeEntry, shapeIndex) =>
                                        shapeIndex === fieldIndex
                                          ? {
                                              ...shapeEntry,
                                              label: event.target.value
                                            }
                                          : shapeEntry
                                    )
                                  }
                                : entry
                            )
                          )
                        }
                        placeholder="Field label"
                        className={WORKBENCH_FIELD_CLASS}
                      />
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <select
                        value={field.kind}
                        onChange={(event) =>
                          onChange(
                            ports.map((entry, entryIndex) =>
                              entryIndex === index
                                ? {
                                    ...entry,
                                    shape: (entry.shape ?? []).map(
                                      (shapeEntry, shapeIndex) =>
                                        shapeIndex === fieldIndex
                                          ? {
                                              ...shapeEntry,
                                              kind: event.target
                                                .value as ForgeBoxPortDefinition["kind"]
                                            }
                                          : shapeEntry
                                    )
                                  }
                                : entry
                            )
                          )
                        }
                        className={WORKBENCH_FIELD_CLASS}
                      >
                        {PORT_KIND_OPTIONS.map((kind) => (
                          <option key={kind} value={kind}>
                            {kind.replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-2 rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/64">
                        <input
                          type="checkbox"
                          checked={Boolean(field.required)}
                          onChange={(event) =>
                            onChange(
                              ports.map((entry, entryIndex) =>
                                entryIndex === index
                                  ? {
                                      ...entry,
                                      shape: (entry.shape ?? []).map(
                                        (shapeEntry, shapeIndex) =>
                                          shapeIndex === fieldIndex
                                            ? {
                                                ...shapeEntry,
                                                required: event.target.checked
                                              }
                                            : shapeEntry
                                      )
                                    }
                                  : entry
                              )
                            )
                          }
                        />
                        Required field
                      </label>
                    </div>
                    <textarea
                      rows={2}
                      value={field.description ?? ""}
                      onChange={(event) =>
                        onChange(
                          ports.map((entry, entryIndex) =>
                            entryIndex === index
                              ? {
                                  ...entry,
                                  shape: (entry.shape ?? []).map(
                                    (shapeEntry, shapeIndex) =>
                                      shapeIndex === fieldIndex
                                        ? {
                                            ...shapeEntry,
                                            description:
                                              event.target.value || undefined
                                          }
                                        : shapeEntry
                                  )
                                }
                              : entry
                          )
                        )
                      }
                      placeholder="What should this field contain?"
                      className={WORKBENCH_FIELD_CLASS}
                    />
                  </div>
                ))}
              </div>
            </details>
            <label className="flex items-center gap-2 text-sm text-white/64">
              <input
                type="checkbox"
                checked={Boolean(port.required)}
                onChange={(event) =>
                  onChange(
                    ports.map((entry, entryIndex) =>
                      entryIndex === index
                        ? { ...entry, required: event.target.checked }
                        : entry
                    )
                  )
                }
              />
              Required port
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

function PublicInputEditor({
  inputs,
  nodes,
  onChange
}: {
  inputs: AiConnectorPublicInput[];
  nodes: Node<WorkbenchGraphNodeData>[];
  onChange: (inputs: AiConnectorPublicInput[]) => void;
}) {
  return (
    <div className="grid gap-3 rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <span>Flow inputs</span>
            <InfoTooltip
              content="These are the typed inputs your Workbench flow exposes to the API and the Run modal."
              label="Explain flow inputs"
            />
          </div>
          <div className="mt-1 text-sm leading-6 text-white/54">
            Define the external contract once, then bind each input to the node
            inputs or parameters that should consume it.
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            onChange([...(inputs ?? []), createPublicInputDefinition()])
          }
        >
          Add flow input
        </Button>
      </div>
      {inputs.length === 0 ? (
        <div className="rounded-[18px] border border-dashed border-white/10 px-4 py-3 text-sm text-white/42">
          No public flow inputs defined yet.
        </div>
      ) : null}
      <div className="grid gap-3">
        {inputs.map((input, index) => {
          const compatibleNodes = nodes.filter(
            (node) =>
              (node.data.inputs ?? []).length > 0 ||
              (node.data.params ?? []).length > 0
          );
          const updateInput = (next: Partial<AiConnectorPublicInput>) =>
            onChange(
              inputs.map((entry, entryIndex) =>
                entryIndex === index ? { ...entry, ...next } : entry
              )
            );
          return (
            <div
              key={`${input.key}-${index}`}
              className="grid gap-3 rounded-[20px] border border-white/8 bg-black/20 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <PortKindBadge kind={input.kind} />
                  <span className="text-sm font-medium text-white">
                    {input.label}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onChange(
                      inputs.filter((_, inputIndex) => inputIndex !== index)
                    )
                  }
                >
                  Remove
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <FlowField
                  label="Key"
                  description="External API key callers will send."
                >
                  <input
                    value={input.key}
                    onChange={(event) =>
                      updateInput({ key: event.target.value })
                    }
                    className={WORKBENCH_FIELD_CLASS}
                  />
                </FlowField>
                <FlowField
                  label="Label"
                  description="Human-readable name used in the Run modal."
                >
                  <input
                    value={input.label}
                    onChange={(event) =>
                      updateInput({ label: event.target.value })
                    }
                    className={WORKBENCH_FIELD_CLASS}
                  />
                </FlowField>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <FlowField
                  label="Value type"
                  description="Expected type for this flow input."
                >
                  <select
                    value={input.kind}
                    onChange={(event) =>
                      updateInput({
                        kind: event.target
                          .value as ForgeBoxPortDefinition["kind"]
                      })
                    }
                    className={WORKBENCH_FIELD_CLASS}
                  >
                    {PORT_KIND_OPTIONS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </FlowField>
                <FlowField
                  label="Default value"
                  description="Used when a caller omits this input."
                >
                  <textarea
                    rows={3}
                    value={formatWorkbenchParamValue(input.defaultValue)}
                    onChange={(event) =>
                      updateInput({
                        defaultValue: parseWorkbenchParamValue(
                          input.kind,
                          event.target.value
                        )
                      })
                    }
                    className={WORKBENCH_FIELD_CLASS}
                  />
                </FlowField>
              </div>
              <FlowField
                label="Description"
                description="Explain what callers should send here."
              >
                <textarea
                  rows={3}
                  value={input.description ?? ""}
                  onChange={(event) =>
                    updateInput({ description: event.target.value })
                  }
                  className={WORKBENCH_FIELD_CLASS}
                />
              </FlowField>
              <label className="flex items-center gap-2 text-sm text-white/64">
                <input
                  type="checkbox"
                  checked={Boolean(input.required)}
                  onChange={(event) =>
                    updateInput({ required: event.target.checked })
                  }
                />
                Required input
              </label>
              <div className="grid gap-2 rounded-[18px] border border-white/8 bg-white/[0.03] p-3">
                <div className="flex items-center gap-2 text-sm text-white">
                  Bindings
                  <InfoTooltip
                    content="Bind this public input to one or more node inputs or parameters. If you leave bindings empty and a node uses the same key, Forge will auto-bind it by key."
                    label="Explain bindings"
                  />
                </div>
                {(input.bindings ?? []).map((binding, bindingIndex) => {
                  const targetNode =
                    nodes.find((node) => node.id === binding.nodeId) ?? null;
                  const targetPorts =
                    binding.targetKind === "param"
                      ? (targetNode?.data.params ?? [])
                      : (targetNode?.data.inputs ?? []);
                  return (
                    <div
                      key={`${binding.nodeId}-${binding.targetKey}-${bindingIndex}`}
                      className="grid gap-3 rounded-[16px] bg-black/20 p-3 md:grid-cols-[1.2fr_1fr_1fr_auto]"
                    >
                      <select
                        value={binding.nodeId}
                        onChange={(event) =>
                          updateInput({
                            bindings: (input.bindings ?? []).map(
                              (entry, entryIndex) =>
                                entryIndex === bindingIndex
                                  ? {
                                      ...entry,
                                      nodeId: event.target.value,
                                      targetKey: ""
                                    }
                                  : entry
                            )
                          })
                        }
                        className={WORKBENCH_FIELD_CLASS}
                      >
                        <option value="">Select node</option>
                        {compatibleNodes.map((node) => (
                          <option key={node.id} value={node.id}>
                            {node.data.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={binding.targetKind}
                        onChange={(event) =>
                          updateInput({
                            bindings: (input.bindings ?? []).map(
                              (entry, entryIndex) =>
                                entryIndex === bindingIndex
                                  ? {
                                      ...entry,
                                      targetKind: event.target.value as
                                        | "input"
                                        | "param",
                                      targetKey: ""
                                    }
                                  : entry
                            )
                          })
                        }
                        className={WORKBENCH_FIELD_CLASS}
                      >
                        <option value="input">Node input</option>
                        <option value="param">Node parameter</option>
                      </select>
                      <select
                        value={binding.targetKey}
                        onChange={(event) =>
                          updateInput({
                            bindings: (input.bindings ?? []).map(
                              (entry, entryIndex) =>
                                entryIndex === bindingIndex
                                  ? { ...entry, targetKey: event.target.value }
                                  : entry
                            )
                          })
                        }
                        className={WORKBENCH_FIELD_CLASS}
                      >
                        <option value="">Select target</option>
                        {targetPorts.map((port) => (
                          <option key={port.key} value={port.key}>
                            {port.label}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          updateInput({
                            bindings: (input.bindings ?? []).filter(
                              (_, entryIndex) => entryIndex !== bindingIndex
                            )
                          })
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    updateInput({
                      bindings: [
                        ...(input.bindings ?? []),
                        { nodeId: "", targetKind: "input", targetKey: "" }
                      ]
                    })
                  }
                >
                  Add binding
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PortColumn({
  side,
  ports,
  collapsed
}: {
  side: "left" | "right";
  ports: ForgeBoxPortDefinition[];
  collapsed: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <div
        className={cn(
          "flex items-center gap-1 px-1 text-[10px] font-medium uppercase tracking-[0.18em] text-white/34",
          side === "left" ? "text-left" : "text-right"
        )}
      >
        <span>{side === "left" ? "Inputs" : "Outputs"}</span>
        <InfoTooltip
          content={
            side === "left"
              ? "Inputs are values this node expects from earlier nodes in the flow."
              : "Outputs are the values this node publishes for later nodes to consume."
          }
          label={
            side === "left" ? "Explain node inputs" : "Explain node outputs"
          }
        />
      </div>
      {ports.length === 0 ? (
        <div
          className={cn(
            "rounded-full border border-dashed border-white/8 px-3 py-1.5 text-[11px] text-white/28",
            side === "left" ? "text-left" : "text-right"
          )}
        >
          None
        </div>
      ) : null}
      {ports.map((port) => (
        <div
          key={`${side}-${port.key}`}
          className={cn(
            "relative min-h-6 rounded-[16px] border px-3 py-2 text-[11px] tracking-[0.01em] text-white/62",
            side === "left" ? "pl-5 text-left" : "pr-5 text-right",
            collapsed ? "bg-white/[0.02]" : "bg-white/[0.04]",
            PORT_KIND_TONES[port.kind] ?? "border-white/8"
          )}
        >
          <Handle
            type={side === "left" ? "target" : "source"}
            position={side === "left" ? Position.Left : Position.Right}
            id={port.key}
            className="!size-2.5 !border !border-white/80 !bg-[#b8c5ff]"
            style={{
              [side]: 6
            }}
          />
          {!collapsed ? (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span>{port.label}</span>
                <PortKindBadge kind={port.kind} />
              </div>
              <div className="mt-1 text-[10px] text-white/36">
                {formatPortMeta(port)}
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function WorkbenchNodeCard(props: NodeProps<Node<WorkbenchGraphNodeData>>) {
  const definition = useWorkbenchNodeDefinition(props.data.boxId ?? null);
  const [portsCollapsed, setPortsCollapsed] = useState(false);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const tone = nodeTone(props.data.nodeType);
  const parameterCount = props.data.params?.length ?? 0;
  const contractLabel = `${props.data.inputs?.length ?? 0} in · ${props.data.outputs?.length ?? 0} out`;
  if (definition && props.data.nodeType === "box") {
    const NodeView = definition.NodeView;
    return (
      <div className="relative">
        <div className="absolute right-3 top-3 z-10 flex flex-wrap items-center justify-end gap-2">
          <NodeActionButton
            label="Edit"
            onClick={() => props.data.onEditRequest?.()}
          />
          <NodeActionButton
            label={contractLabel}
            onClick={() => props.data.onContractEditRequest?.()}
          />
          {parameterCount > 0 ? (
            <NodeActionButton
              label={`${parameterCount} parameter${parameterCount === 1 ? "" : "s"}`}
              onClick={() => props.data.onParameterEditRequest?.()}
              emphasis
            />
          ) : null}
        </div>
        <div
          className={cn(
            "rounded-[28px] p-[2px] transition",
            props.selected
              ? "bg-[linear-gradient(135deg,rgba(191,198,255,0.6),rgba(67,98,255,0.28))]"
              : "bg-transparent"
          )}
        >
          <NodeView
            nodeId={props.id}
            inputs={undefined}
            params={undefined}
            compact={false}
          />
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "min-w-[270px] rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(20,28,45,0.98),rgba(11,16,29,0.98))] p-3 shadow-[0_26px_80px_rgba(0,0,0,0.4)]",
        props.selected && "border-[rgba(191,198,255,0.52)]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-white">
            {tone.icon}
            <div className="truncate text-sm font-semibold">
              {props.data.label}
            </div>
          </div>
          {props.data.description ? (
            <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-white/48">
              {props.data.description}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <NodeActionButton
            label={portsCollapsed ? "Show ports" : "Hide labels"}
            onClick={() => setPortsCollapsed((current) => !current)}
          />
          <div className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-white/56">
            {tone.badge}
          </div>
        </div>
      </div>

      {props.data.boxId ? (
        <div className="mt-3 rounded-full bg-white/[0.05] px-3 py-1.5 text-[11px] text-white/56">
          {props.data.boxId}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {props.data.enabledToolKeys?.length ? (
          <div className="rounded-full bg-white/[0.05] px-3 py-1.5 text-[11px] text-white/56">
            {props.data.enabledToolKeys.length} tool
            {props.data.enabledToolKeys.length === 1 ? "" : "s"} enabled
          </div>
        ) : null}
        <NodeActionButton
          label={schemaOpen ? "Hide schema" : "Preview schema"}
          onClick={() => setSchemaOpen((current) => !current)}
        />
        <NodeActionButton
          label="Edit"
          onClick={() => props.data.onEditRequest?.()}
        />
        <NodeActionButton
          label={contractLabel}
          onClick={() => props.data.onContractEditRequest?.()}
        />
        {parameterCount > 0 ? (
          <NodeActionButton
            label={`${parameterCount} parameter${parameterCount === 1 ? "" : "s"}`}
            onClick={() => props.data.onParameterEditRequest?.()}
            emphasis
          />
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <PortColumn
          side="left"
          ports={props.data.inputs ?? []}
          collapsed={portsCollapsed}
        />
        <PortColumn
          side="right"
          ports={props.data.outputs ?? []}
          collapsed={portsCollapsed}
        />
      </div>
      {schemaOpen ? (
        <div className="mt-3 rounded-[18px] border border-white/8 bg-black/20 p-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-white/38">
            <span>Node contract</span>
            <InfoTooltip
              content="This preview shows the shape of the values and tools this node exposes inside the flow graph."
              label="Explain node contract preview"
            />
          </div>
          <pre className="mt-2 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-white/64">
            {JSON.stringify(
              {
                inputs: (props.data.inputs ?? []).map(
                  ({ key, kind, required }) => ({
                    key,
                    kind,
                    required: Boolean(required)
                  })
                ),
                outputs: (props.data.outputs ?? []).map(
                  ({ key, kind, required }) => ({
                    key,
                    kind,
                    required: Boolean(required)
                  })
                ),
                tools: props.data.enabledToolKeys ?? []
              },
              null,
              2
            )}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

const NODE_TYPES = {
  workbench: WorkbenchNodeCard
};

function isAiWorkbenchNode(
  nodeType: AiConnectorNodeType
): nodeType is "functor" | "chat" {
  return nodeType === "functor" || nodeType === "chat";
}

function formatWorkbenchRunError(error: unknown) {
  const message =
    error instanceof ForgeApiError || error instanceof Error
      ? error.message
      : String(error);
  if (
    message.includes(
      "No model connection is configured for this connector node."
    )
  ) {
    return [
      "This flow uses an AI node, but Forge does not have any model connection configured yet.",
      "Open Settings > Models, add a model connection, then run the flow again.",
      "Once a model exists, the node can use the default model automatically or you can pick a specific model inside the node editor."
    ].join("\n\n");
  }
  return message;
}

function summarizePortShape(ports: ForgeBoxPortDefinition[]) {
  return ports.map(
    ({
      key,
      kind,
      required,
      description,
      modelName,
      itemKind,
      shape,
      exampleValue
    }) => ({
      key,
      kind,
      required: Boolean(required),
      description,
      modelName,
      itemKind,
      shape,
      exampleValue
    })
  );
}

function buildAiNodeOutputsFromKeys(keys: string[]) {
  const normalizedKeys = Array.from(
    new Set(keys.map((entry) => entry.trim()).filter(Boolean))
  );
  const orderedKeys = normalizedKeys.includes("answer")
    ? normalizedKeys
    : ["answer", ...normalizedKeys];
  return orderedKeys.map((key) => ({
    key,
    label:
      key === "answer"
        ? "Answer"
        : key
            .split(/[_-]+/)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" "),
    kind: key === "answer" ? "markdown" : "record",
    description:
      key === "answer"
        ? "Primary answer returned by this AI node."
        : `Named output published for downstream nodes under "${key}".`,
    modelName:
      key === "answer"
        ? "WorkbenchAiAnswer"
        : `Workbench${key
            .split(/[_-]+/)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join("")}`,
    exampleValue: key === "answer" ? "Concise answer" : undefined
  })) satisfies ForgeBoxPortDefinition[];
}

function validateWorkbenchGraphBeforeRun(
  nodes: Node<WorkbenchGraphNodeData>[],
  edges: Edge[]
) {
  const issues = collectWorkbenchGraphIssues(nodes, edges);
  return issues[0] ?? null;
}

function collectWorkbenchGraphIssues(
  nodes: Node<WorkbenchGraphNodeData>[],
  edges: Edge[]
) {
  const issues: string[] = [];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  if (nodes.length === 0) {
    issues.push("Add at least one node before running the flow.");
  }
  const outputNodes = nodes.filter((node) => node.data.nodeType === "output");
  if (outputNodes.length === 0) {
    issues.push(
      "Add an Output node so Forge knows what result the flow should publish."
    );
  }

  const incomingCounts = new Map<string, number>();
  for (const edge of edges) {
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) ?? 0) + 1);
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    const sourceOutputs = sourceNode?.data.outputs ?? [];
    const targetInputs = targetNode?.data.inputs ?? [];
    if (sourceNode) {
      if (
        edge.sourceHandle &&
        !sourceOutputs.some((output) => output.key === edge.sourceHandle)
      ) {
        issues.push(
          `Edge from "${sourceNode.data.label}" points to missing output "${edge.sourceHandle}". Update the edge or restore that output contract.`
        );
      } else if (!edge.sourceHandle && sourceOutputs.length > 1) {
        issues.push(
          `Edge from "${sourceNode.data.label}" does not name which output it should use. Pick one explicit output handle.`
        );
      }
    }
    if (targetNode) {
      if (
        edge.targetHandle &&
        !targetInputs.some((input) => input.key === edge.targetHandle)
      ) {
        issues.push(
          `Edge into "${targetNode.data.label}" points to missing input "${edge.targetHandle}". Update the edge or restore that input contract.`
        );
      } else if (!edge.targetHandle && targetInputs.length > 1) {
        issues.push(
          `Edge into "${targetNode.data.label}" does not name which input it should feed. Pick one explicit input handle.`
        );
      }
    }
  }

  for (const node of outputNodes) {
    if ((incomingCounts.get(node.id) ?? 0) === 0) {
      issues.push(
        `Connect something into the output node "${node.data.label}" so the flow has something to return.`
      );
    }
    const incomingOutputKeys = edges
      .filter((edge) => edge.target === node.id)
      .flatMap((edge) => {
        const sourceNode = nodeMap.get(edge.source);
        const sourcePorts = sourceNode?.data.outputs ?? [];
        if (edge.sourceHandle) {
          return sourcePorts
            .filter((port) => port.key === edge.sourceHandle)
            .map((port) => port.key);
        }
        return sourcePorts.map((port) => port.key);
      });
    if (
      node.data.outputKey &&
      incomingOutputKeys.length > 0 &&
      !incomingOutputKeys.includes(node.data.outputKey)
    ) {
      issues.push(
        `Output node "${node.data.label}" is configured to publish "${node.data.outputKey}", but that key is not arriving from its upstream nodes.`
      );
    }
  }

  for (const node of nodes) {
    const incoming = incomingCounts.get(node.id) ?? 0;
    const outgoing = edges.filter((edge) => edge.source === node.id).length;
    if (
      node.data.nodeType !== "user_input" &&
      node.data.nodeType !== "value" &&
      incoming === 0 &&
      node.data.nodeType !== "box"
    ) {
      issues.push(
        `Connect an upstream source into "${node.data.label}" so it has real input to work with.`
      );
    }
    if (node.data.nodeType === "merge" && incoming < 2) {
      issues.push(
        `Merge node "${node.data.label}" should receive both left and right inputs before you run it.`
      );
    }
    if (
      node.data.nodeType === "template" &&
      !(node.data.template ?? "").trim()
    ) {
      issues.push(
        `Add a template string to "${node.data.label}" before running the flow.`
      );
    }
    if (
      node.data.nodeType === "pick_key" &&
      !(node.data.selectedKey ?? "").trim()
    ) {
      issues.push(
        `Choose which key "${node.data.label}" should pick from incoming objects.`
      );
    }
    if (node.data.nodeType !== "output" && outgoing === 0) {
      issues.push(
        `Connect the output of "${node.data.label}" somewhere useful or remove the node from the graph.`
      );
    }
  }

  for (const node of nodes) {
    if (
      isAiWorkbenchNode(node.data.nodeType) &&
      !(node.data.promptTemplate?.trim() || node.data.prompt?.trim())
    ) {
      issues.push(
        `Add a prompt to the AI node "${node.data.label}" before running the flow.`
      );
    }
  }

  return issues;
}

function WorkbenchDialog({
  open,
  onOpenChange,
  title,
  description,
  children
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgba(3,7,18,0.72)] backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-x-4 bottom-4 top-4 z-50 mx-auto flex max-w-[min(44rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,18,33,0.985),rgba(8,13,24,0.985))] shadow-[0_36px_96px_rgba(0,0,0,0.46)] md:left-1/2 md:right-auto md:top-[8vh] md:h-[min(82vh,58rem)] md:w-[min(44rem,calc(100vw-1.25rem))] md:-translate-x-1/2 md:bottom-auto">
          <div className="flex items-start justify-between gap-4 border-b border-white/8 px-5 py-4 backdrop-blur-xl">
            <div>
              <Dialog.Title className="font-display text-[1.28rem] tracking-[-0.04em] text-white">
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm leading-6 text-white/54">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <ModalCloseButton aria-label="Close workbench flow dialog" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function buildWorkbenchFlowPatch({
  title,
  description,
  kind,
  publicInputs,
  nodes,
  edges
}: {
  title: string;
  description: string;
  kind: AiConnectorKind;
  publicInputs: AiConnectorPublicInput[];
  nodes: Node<WorkbenchGraphNodeData>[];
  edges: Edge[];
}): Partial<AiConnector> {
  return {
    title,
    description,
    kind,
    publicInputs,
    graph: {
      nodes: nodes.map(connectorNodeFromGraph),
      edges: edges.map(connectorEdgeFromGraph)
    }
  };
}

export function WorkbenchFlowEditor({
  flow,
  boxes,
  modelConnections,
  runs,
  onSave,
  onDelete,
  onRun,
  onChat
}: {
  flow: AiConnector;
  boxes: ForgeBoxCatalogEntry[];
  modelConnections: Array<{
    id: string;
    label: string;
    provider: string;
    model: string;
    baseUrl: string;
  }>;
  runs: AiConnectorRun[];
  onSave: (patch: Partial<AiConnector>) => Promise<void>;
  onDelete: () => Promise<void>;
  onRun: (input: {
    userInput?: string;
    inputs?: Record<string, unknown>;
    debug?: boolean;
  }) => Promise<void>;
  onChat: (input: {
    userInput?: string;
    inputs?: Record<string, unknown>;
    debug?: boolean;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState(flow.title);
  const [description, setDescription] = useState(flow.description);
  const [kind, setKind] = useState<AiConnectorKind>(flow.kind);
  const [publicInputs, setPublicInputs] = useState<AiConnectorPublicInput[]>(
    flow.publicInputs ?? []
  );
  const [nodes, setNodes] = useState<Node<WorkbenchGraphNodeData>[]>(
    () => normalizeWorkbenchGraph(flow, boxes).nodes
  );
  const [edges, setEdges] = useState<Edge[]>(
    () => normalizeWorkbenchGraph(flow, boxes).edges
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [addNodeOpen, setAddNodeOpen] = useState(false);
  const [editNodeOpen, setEditNodeOpen] = useState(false);
  const [editNodeSection, setEditNodeSection] =
    useState<WorkbenchEditorSection>("overview");
  const [aiNodeInitialStepId, setAiNodeInitialStepId] = useState<
    string | undefined
  >(undefined);
  const [runOpen, setRunOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [boxQuery, setBoxQuery] = useState("");
  const [boxFilters, setBoxFilters] = useState<string[]>([]);
  const [userInput, setUserInput] = useState("");
  const [runInputs, setRunInputs] = useState<Record<string, unknown>>({});
  const [debugEnabled, setDebugEnabled] = useState(true);
  const [runError, setRunError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<WorkbenchSaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(
    runs[0]?.id ?? null
  );
  const [selectedResultNodeId, setSelectedResultNodeId] = useState<
    string | null
  >(null);

  const flowSnapshot = useMemo(
    () =>
      JSON.stringify(
        buildWorkbenchFlowPatch({
          title: flow.title,
          description: flow.description,
          kind: flow.kind,
          publicInputs: flow.publicInputs ?? [],
          nodes: flow.graph.nodes.map((node) =>
            graphNodeFromConnector(node, boxes)
          ),
          edges: flow.graph.edges.map(graphEdgeFromConnector)
        })
      ),
    [boxes, flow]
  );
  const lastSavedSnapshotRef = useRef(flowSnapshot);
  const lastHydratedSnapshotRef = useRef(flowSnapshot);
  const draftPatchRef = useRef<Partial<AiConnector>>({});
  const draftSnapshotRef = useRef(flowSnapshot);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const queuedSaveRef = useRef(false);

  useEffect(() => {
    if (flowSnapshot === lastHydratedSnapshotRef.current) {
      return;
    }
    lastHydratedSnapshotRef.current = flowSnapshot;
    lastSavedSnapshotRef.current = flowSnapshot;
    draftSnapshotRef.current = flowSnapshot;
    setTitle(flow.title);
    setDescription(flow.description);
    setKind(flow.kind);
    setPublicInputs(flow.publicInputs ?? []);
    const normalized = normalizeWorkbenchGraph(flow, boxes);
    setNodes(normalized.nodes);
    setEdges(normalized.edges);
    setSaveState("idle");
    setSaveError(null);
  }, [boxes, flow, flowSnapshot]);

  useEffect(() => {
    setRunInputs(
      Object.fromEntries(
        (flow.publicInputs ?? [])
          .filter((entry) => entry.defaultValue !== undefined)
          .map((entry) => [entry.key, entry.defaultValue])
      )
    );
  }, [flow.publicInputs]);

  useEffect(() => {
    setSelectedRunId(runs[0]?.id ?? null);
  }, [runs]);

  useEffect(() => {
    setNodes((current) =>
      current.map((node) => {
        if (node.data.nodeType !== "box" || !node.data.boxId) {
          return node;
        }
        return graphNodeFromConnector(connectorNodeFromGraph(node), boxes);
      })
    );
  }, [boxes]);

  const boxOptions = useMemo<FacetedTokenOption[]>(() => {
    const categories = Array.from(new Set(boxes.map((box) => box.category)));
    return categories.map((category) => ({
      id: `category:${category}`,
      label: category,
      description: "Workbench box category"
    }));
  }, [boxes]);

  const filteredBoxes = useMemo(() => {
    const normalizedQuery = boxQuery.trim().toLowerCase();
    return boxes.filter((box) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [
          box.title,
          box.description,
          box.category,
          box.routePath ?? "",
          ...box.tags
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      const matchesFilters = boxFilters.every((token) =>
        token.startsWith("category:")
          ? box.category === token.replace("category:", "")
          : true
      );
      return matchesQuery && matchesFilters;
    });
  }, [boxFilters, boxQuery, boxes]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );
  const latestRun = runs[0] ?? null;
  const selectedRun =
    runs.find((run) => run.id === selectedRunId) ?? latestRun ?? null;
  const runNodesQuery = useGetWorkbenchFlowRunNodesQuery(
    {
      flowId: flow.id,
      runId: selectedRunId ?? ""
    },
    {
      skip: !selectedRunId || !traceOpen
    }
  );
  const selectedNodeResult =
    runNodesQuery.data?.nodeResults.find(
      (entry) => entry.nodeId === selectedResultNodeId
    ) ?? null;
  const selectedNodeResultQuery = useGetWorkbenchFlowRunNodeQuery(
    {
      flowId: flow.id,
      runId: selectedRunId ?? "",
      nodeId: selectedResultNodeId ?? ""
    },
    {
      skip: !selectedRunId || !selectedResultNodeId || !traceOpen
    }
  );
  const graphIssues = useMemo(
    () => collectWorkbenchGraphIssues(nodes, edges),
    [nodes, edges]
  );
  const hasAiNodes = useMemo(
    () => nodes.some((node) => isAiWorkbenchNode(node.data.nodeType)),
    [nodes]
  );
  const shouldShowLegacyUserInput = useMemo(
    () =>
      nodes.some((node) => node.data.nodeType === "user_input") ||
      (publicInputs ?? []).length === 0,
    [nodes, publicInputs]
  );
  useEffect(() => {
    const nextNodeId = runNodesQuery.data?.nodeResults[0]?.nodeId ?? null;
    setSelectedResultNodeId(nextNodeId);
  }, [runNodesQuery.data?.nodeResults]);
  const selectedNodeSupportsContractEditing = useMemo(
    () =>
      Boolean(
        selectedNode &&
        selectedNode.data.nodeType !== "box" &&
        selectedNode.data.nodeType !== "box_input"
      ),
    [selectedNode]
  );
  const selectedNodeUpstreamOutputs = useMemo(() => {
    if (!selectedNode) {
      return [];
    }
    return edges
      .filter((edge) => edge.target === selectedNode.id)
      .flatMap((edge) => {
        const sourceNode = nodes.find((node) => node.id === edge.source);
        const sourcePorts = sourceNode?.data.outputs ?? [];
        if (edge.sourceHandle) {
          return sourcePorts.filter((port) => port.key === edge.sourceHandle);
        }
        return sourcePorts;
      });
  }, [edges, nodes, selectedNode]);
  const availableToolOptions = useMemo(
    () => buildWorkbenchToolCatalog(boxes),
    [boxes]
  );
  const selectedAiToolPreview = useMemo(() => {
    if (!selectedNode || !isAiWorkbenchNode(selectedNode.data.nodeType)) {
      return [];
    }
    const enabled = new Set(selectedNode.data.enabledToolKeys ?? []);
    return availableToolOptions.filter((tool) => enabled.has(tool.key));
  }, [availableToolOptions, selectedNode]);
  const draftPatch = useMemo(
    () =>
      buildWorkbenchFlowPatch({
        title,
        description,
        kind,
        publicInputs,
        nodes,
        edges
      }),
    [description, edges, kind, nodes, publicInputs, title]
  );
  const draftSnapshot = useMemo(() => JSON.stringify(draftPatch), [draftPatch]);
  const isDirty = draftSnapshot !== lastSavedSnapshotRef.current;

  useEffect(() => {
    draftPatchRef.current = draftPatch;
    draftSnapshotRef.current = draftSnapshot;
    if (draftSnapshot === lastSavedSnapshotRef.current) {
      setSaveError(null);
      setSaveState((current) => (current === "saved" ? current : "idle"));
      return;
    }
    setSaveState((current) => (current === "saving" ? current : "dirty"));
  }, [draftSnapshot]);
  const aiNodeSteps = useMemo<
    QuestionFlowStep<WorkbenchGraphNodeData>[]
  >(() => {
    if (!selectedNode || !isAiWorkbenchNode(selectedNode.data.nodeType)) {
      return [];
    }
    return [
      {
        id: "overview",
        eyebrow:
          selectedNode.data.nodeType === "chat" ? "Chat node" : "Functor node",
        title: "Define what this node is responsible for",
        description:
          "Give the node a clear role in the flow before configuring prompts and models.",
        render: (value, setValue) => (
          <>
            <FlowField
              label="Label"
              description="This is the name shown on the canvas and in debug traces."
            >
              <input
                value={value.label}
                onChange={(event) => setValue({ label: event.target.value })}
                className={WORKBENCH_FIELD_CLASS}
              />
            </FlowField>
            <FlowField
              label="Description"
              description="Explain what this node should do with the incoming flow context."
            >
              <textarea
                rows={4}
                value={value.description}
                onChange={(event) =>
                  setValue({ description: event.target.value })
                }
                className={WORKBENCH_FIELD_CLASS}
              />
            </FlowField>
          </>
        )
      },
      {
        id: "prompts",
        eyebrow: "Prompts",
        title: "Set the prompt contract",
        description:
          "Separate the main prompt from the system instruction so this node stays easier to maintain.",
        render: (value, setValue) => (
          <>
            <FlowField
              label="Prompt template"
              description="This is the main instruction the node sends with the current flow input."
            >
              <textarea
                rows={8}
                value={value.promptTemplate ?? value.prompt ?? ""}
                onChange={(event) =>
                  setValue({
                    promptTemplate: event.target.value,
                    prompt: event.target.value
                  })
                }
                className={WORKBENCH_FIELD_CLASS}
              />
            </FlowField>
            <FlowField
              label="System prompt"
              description="Use this for durable behavior and output rules that should stay consistent."
            >
              <textarea
                rows={5}
                value={value.systemPrompt ?? ""}
                onChange={(event) =>
                  setValue({ systemPrompt: event.target.value })
                }
                className={WORKBENCH_FIELD_CLASS}
              />
            </FlowField>
          </>
        )
      },
      {
        id: "model",
        eyebrow: "Model",
        title: "Choose how this node reaches a model",
        description:
          "Pick a specific model connection or leave it on the Forge default once models are configured.",
        render: (value, setValue) => (
          <>
            {modelConnections.length === 0 ? (
              <div className="rounded-[20px] border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm leading-6 text-amber-100">
                No model connection is configured yet. Open Settings &gt;
                Models, add one connection, then come back here.
              </div>
            ) : null}
            <FlowField
              label="Model connection"
              description="This can stay empty if you want the node to use Forge's default configured model."
            >
              <select
                value={value.modelConfig?.connectionId ?? ""}
                onChange={(event) => {
                  const connection = modelConnections.find(
                    (entry) => entry.id === event.target.value
                  );
                  setValue({
                    modelConfig: {
                      connectionId: connection?.id ?? null,
                      provider: (connection?.provider ?? null) as any,
                      baseUrl: connection?.baseUrl ?? null,
                      model: connection?.model ?? "",
                      thinking: value.modelConfig?.thinking ?? null,
                      verbosity: value.modelConfig?.verbosity ?? null
                    }
                  });
                }}
                className={WORKBENCH_FIELD_CLASS}
              >
                <option value="">Use Forge default model</option>
                {modelConnections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.label}
                  </option>
                ))}
              </select>
            </FlowField>
            <div className="grid gap-4 md:grid-cols-2">
              <FlowField
                label="Thinking effort"
                description="Optional reasoning setting for models that support it."
              >
                <select
                  value={value.modelConfig?.thinking ?? ""}
                  onChange={(event) =>
                    setValue({
                      modelConfig: {
                        connectionId: value.modelConfig?.connectionId ?? null,
                        provider: value.modelConfig?.provider ?? null,
                        baseUrl: value.modelConfig?.baseUrl ?? null,
                        model: value.modelConfig?.model ?? "",
                        thinking: event.target.value || null,
                        verbosity: value.modelConfig?.verbosity ?? null
                      }
                    })
                  }
                  className={WORKBENCH_FIELD_CLASS}
                >
                  <option value="">Default</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </FlowField>
              <FlowField
                label="Verbosity"
                description="Optional output detail setting for models that support it."
              >
                <select
                  value={value.modelConfig?.verbosity ?? ""}
                  onChange={(event) =>
                    setValue({
                      modelConfig: {
                        connectionId: value.modelConfig?.connectionId ?? null,
                        provider: value.modelConfig?.provider ?? null,
                        baseUrl: value.modelConfig?.baseUrl ?? null,
                        model: value.modelConfig?.model ?? "",
                        thinking: value.modelConfig?.thinking ?? null,
                        verbosity: event.target.value || null
                      }
                    })
                  }
                  className={WORKBENCH_FIELD_CLASS}
                >
                  <option value="">Default</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </FlowField>
            </div>
          </>
        )
      },
      {
        id: "contracts",
        eyebrow: "Contracts",
        title: "Define the input and output contract",
        description:
          "Give this AI node truthful port names, value types, and expectations so the graph stays readable.",
        render: (value, setValue) => (
          <div className="grid gap-4">
            <PortDefinitionEditor
              title="Inputs"
              description="Name the upstream values this AI node expects to receive."
              ports={value.inputs ?? []}
              onChange={(ports) => setValue({ inputs: ports })}
              prefix="input"
            />
            <PortDefinitionEditor
              title="Outputs"
              description="Describe exactly what this AI node will publish for later nodes."
              ports={value.outputs ?? []}
              onChange={(ports) => setValue({ outputs: ports })}
              prefix="output"
            />
          </div>
        )
      },
      {
        id: "tools",
        eyebrow: "Outputs and tools",
        title: "Control what this node can call and publish",
        description:
          "Keep tool access tight and name any extra outputs the rest of the flow should consume.",
        render: (value, setValue) => (
          <>
            <FlowField
              label="Enabled tools"
              description="Only checked tools will be available to this AI node during execution."
            >
              <div className="grid max-h-[18rem] gap-2 overflow-y-auto pr-1">
                {availableToolOptions.length > 0 ? (
                  availableToolOptions.map((tool) => {
                    const enabled = (value.enabledToolKeys ?? []).includes(
                      tool.key
                    );
                    return (
                      <label
                        key={tool.key}
                        className="flex items-start gap-3 rounded-[16px] bg-white/[0.03] px-3 py-2 text-left"
                      >
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(event) => {
                            const current = new Set(
                              value.enabledToolKeys ?? []
                            );
                            if (event.target.checked) {
                              current.add(tool.key);
                            } else {
                              current.delete(tool.key);
                            }
                            setValue({ enabledToolKeys: [...current] });
                          }}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm text-white">
                            <span>{tool.label}</span>
                            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-white/48">
                              {tool.accessMode.replace("_", " ")}
                            </span>
                          </div>
                          <div className="text-[12px] leading-5 text-white/46">
                            {tool.description}
                          </div>
                          {tool.sources.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {tool.sources.map((source) => (
                                <span
                                  key={`${tool.key}-${source}`}
                                  className="rounded-full bg-white/[0.05] px-2 py-1 text-[10px] text-white/44"
                                >
                                  {source}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <div className="mt-1 font-mono text-[10px] text-white/32">
                            {tool.key}
                          </div>
                          {tool.argsSchema ? (
                            <details className="mt-2 rounded-[14px] border border-white/8 bg-black/20 px-3 py-2">
                              <summary className="cursor-pointer text-[11px] text-white/56">
                                Preview tool arguments
                              </summary>
                              <pre className="mt-2 overflow-auto whitespace-pre-wrap text-[10px] leading-5 text-white/44">
                                {JSON.stringify(tool.argsSchema, null, 2)}
                              </pre>
                            </details>
                          ) : null}
                        </div>
                      </label>
                    );
                  })
                ) : (
                  <div className="text-sm text-white/48">
                    No registered Forge tools are available yet.
                  </div>
                )}
              </div>
            </FlowField>
            <div className="grid gap-4 md:grid-cols-2">
              <FlowField
                label="Enabled tool preview"
                description="Collapsed by default in the node card, this is the contract the AI node can call at run time."
              >
                <details className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
                  <summary className="cursor-pointer text-sm text-white/70">
                    {selectedAiToolPreview.length > 0
                      ? `${selectedAiToolPreview.length} tool contract${
                          selectedAiToolPreview.length === 1 ? "" : "s"
                        }`
                      : "No tool contract yet"}
                  </summary>
                  <pre className="mt-3 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-white/58">
                    {JSON.stringify(
                      selectedAiToolPreview.map((tool) => ({
                        key: tool.key,
                        label: tool.label,
                        accessMode: tool.accessMode,
                        sources: tool.sources,
                        argsSchema: tool.argsSchema
                      })),
                      null,
                      2
                    )}
                  </pre>
                </details>
              </FlowField>
              <FlowField
                label="Output preview"
                description="This is the structure downstream nodes will see from this AI node."
              >
                <details className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
                  <summary className="cursor-pointer text-sm text-white/70">
                    {(value.outputs ?? []).length} published output
                    {(value.outputs ?? []).length === 1 ? "" : "s"}
                  </summary>
                  <pre className="mt-3 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-white/58">
                    {JSON.stringify(
                      summarizePortShape(value.outputs ?? []),
                      null,
                      2
                    )}
                  </pre>
                </details>
              </FlowField>
            </div>
            <FlowField
              label="Named outputs"
              description="Add comma-separated output keys when later nodes should read more than the primary answer."
            >
              <input
                value={(value.outputs ?? [])
                  .filter((output) => output.key !== "answer")
                  .map((output) => output.key)
                  .join(", ")}
                onChange={(event) =>
                  setValue({
                    outputs: buildAiNodeOutputsFromKeys([
                      "answer",
                      ...event.target.value.split(",")
                    ])
                  })
                }
                placeholder="summary, plan, next_steps"
                className={WORKBENCH_FIELD_CLASS}
              />
            </FlowField>
            <div className="rounded-[20px] border border-white/8 bg-white/[0.03] p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                Danger zone
              </div>
              <div className="mt-2 text-sm leading-6 text-white/58">
                Remove this node from the graph if you no longer need it.
              </div>
              <Button
                type="button"
                variant="secondary"
                className="mt-4"
                onClick={() => {
                  deleteSelectedNode(selectedNode.id);
                  setEditNodeOpen(false);
                }}
              >
                <Trash2 className="size-4" />
                Delete node
              </Button>
            </div>
          </>
        )
      }
    ];
  }, [
    availableToolOptions,
    modelConnections,
    selectedAiToolPreview,
    selectedNode
  ]);

  const persistDraft = useCallback(async () => {
    const snapshot = draftSnapshotRef.current;
    const patch = draftPatchRef.current;
    if (snapshot === lastSavedSnapshotRef.current) {
      setSaveState("saved");
      return true;
    }
    if (savePromiseRef.current) {
      queuedSaveRef.current = true;
      return savePromiseRef.current;
    }
    setSaveState("saving");
    setSaveError(null);
    const promise = onSave(patch)
      .then(() => {
        lastSavedSnapshotRef.current = snapshot;
        lastHydratedSnapshotRef.current = snapshot;
        setSaveState("saved");
        return true;
      })
      .catch((error) => {
        const message =
          error instanceof ForgeApiError || error instanceof Error
            ? error.message
            : String(error);
        setSaveError(message);
        setSaveState("error");
        return false;
      })
      .finally(() => {
        savePromiseRef.current = null;
        if (
          queuedSaveRef.current &&
          draftSnapshotRef.current !== lastSavedSnapshotRef.current
        ) {
          queuedSaveRef.current = false;
          void persistDraft();
        } else {
          queuedSaveRef.current = false;
        }
      });
    savePromiseRef.current = promise;
    return promise;
  }, [onSave]);

  useEffect(() => {
    if (!isDirty) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void persistDraft();
    }, 2000);
    return () => window.clearTimeout(timeoutId);
  }, [isDirty, persistDraft, draftSnapshot]);

  const openNodeEditor = useCallback(
    (nodeId: string, section: WorkbenchEditorSection = "overview") => {
      setSelectedNodeId(nodeId);
      setEditNodeSection(section);
      setAiNodeInitialStepId(
        section === "contracts" ? "contracts" : "overview"
      );
      setEditNodeOpen(true);
    },
    []
  );
  const canvasNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          onEditRequest: () => openNodeEditor(node.id, "overview"),
          onContractEditRequest: () => openNodeEditor(node.id, "contracts"),
          onParameterEditRequest: () => openNodeEditor(node.id, "parameters")
        }
      })),
    [nodes, openNodeEditor]
  );

  function updateSelectedNode(
    updater: (
      node: Node<WorkbenchGraphNodeData>
    ) => Node<WorkbenchGraphNodeData>
  ) {
    if (!selectedNodeId) {
      return;
    }
    setNodes((current) =>
      current.map((node) => (node.id === selectedNodeId ? updater(node) : node))
    );
  }

  function deleteSelectedNode(nodeId: string) {
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) =>
      current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
    );
    setSelectedNodeId((current) => (current === nodeId ? null : current));
  }

  async function handleSave() {
    await persistDraft();
  }

  async function handleRunAction(mode: "run" | "chat") {
    const saved = await persistDraft();
    if (!saved) {
      setRunError(
        "Forge could not save the latest flow changes before running. Fix the save error and try again."
      );
      return;
    }
    const graphIssue = validateWorkbenchGraphBeforeRun(nodes, edges);
    if (graphIssue) {
      setRunError(graphIssue);
      return;
    }
    if (hasAiNodes && modelConnections.length === 0) {
      setRunError(
        [
          "This flow includes an AI node, but no model is configured in Forge yet.",
          "Open Settings > Models, add a model connection, then try again."
        ].join("\n\n")
      );
      return;
    }
    setRunError(null);
    const nextInputs: Record<string, unknown> = {};
    for (const inputDefinition of publicInputs) {
      const value = runInputs[inputDefinition.key];
      if (!validateWorkbenchInputValue(inputDefinition, value)) {
        setRunError(
          `Flow input "${inputDefinition.label}" must match the ${inputDefinition.kind} type.`
        );
        return;
      }
      if (
        value !== undefined &&
        value !== null &&
        !(typeof value === "string" && value.trim().length === 0)
      ) {
        nextInputs[inputDefinition.key] = value;
      }
    }
    try {
      if (mode === "run") {
        await onRun({
          userInput: shouldShowLegacyUserInput ? userInput : "",
          inputs: nextInputs,
          debug: debugEnabled
        });
      } else {
        await onChat({
          userInput: shouldShowLegacyUserInput ? userInput : "",
          inputs: nextInputs,
          debug: debugEnabled
        });
      }
      setRunOpen(false);
    } catch (error) {
      setRunError(formatWorkbenchRunError(error));
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/workbench"
            className="inline-flex h-9 items-center gap-2 rounded-full bg-white/[0.05] px-3 text-sm text-white/68 transition hover:bg-white/[0.08] hover:text-white"
          >
            <ArrowLeft className="size-4" />
            Flows
          </Link>
          <div className="min-w-0">
            <EntityBadge
              kind="workbench"
              label="Workbench Flow"
              compact
              gradient={false}
            />
            <div className="truncate font-display text-[1.55rem] tracking-[-0.05em] text-white">
              {title}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EntityBadge
            kind={getEntityKindForWorkbenchFlowKind(kind)}
            label={kind === "chat" ? "Chat flow" : "Functor flow"}
            compact
            gradient={false}
          />
          <div
            className={cn(
              "rounded-full border px-3 py-2 text-[12px]",
              saveState === "error"
                ? "border-rose-300/20 bg-rose-300/10 text-rose-100"
                : saveState === "saving"
                  ? "border-sky-300/20 bg-sky-300/10 text-sky-100"
                  : saveState === "dirty"
                    ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
                    : "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
            )}
          >
            {summarizeSaveState(saveState, saveError)}
          </div>
          {latestRun ? (
            <button
              type="button"
              className="rounded-full bg-white/[0.05] px-3 py-2 text-[12px] text-white/58 transition hover:bg-white/[0.08] hover:text-white"
              onClick={() => setTraceOpen(true)}
            >
              Latest {latestRun.mode} · {latestRun.status}
            </button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            onClick={() => setRunOpen(true)}
          >
            <Play className="size-4" />
            Run
          </Button>
          <Button
            type="button"
            variant="primary"
            pending={saveState === "saving"}
            pendingLabel="Saving…"
            onClick={() => void handleSave()}
          >
            <Save className="size-4" />
            Save now
          </Button>
        </div>
      </div>

      <div className="relative h-[76vh] overflow-hidden rounded-[32px] border border-white/8 bg-[linear-gradient(180deg,rgba(10,15,26,0.98),rgba(7,11,20,0.98))]">
        {graphIssues.length > 0 ? (
          <div className="pointer-events-none absolute left-4 top-4 z-20 max-w-[32rem] rounded-[24px] border border-amber-300/20 bg-[rgba(61,40,9,0.88)] p-4 shadow-[0_18px_48px_rgba(0,0,0,0.35)] backdrop-blur-xl">
            <div className="pointer-events-auto flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-amber-100/76">
              <span>Graph checks</span>
              <InfoTooltip
                content="These are preflight issues Forge found in the current graph before runtime. Fixing them here should prevent brittle run failures later."
                label="Explain graph checks"
              />
            </div>
            <ul className="mt-3 grid gap-2 text-sm leading-6 text-amber-50">
              {graphIssues.map((issue) => (
                <li key={issue} className="list-inside list-disc">
                  {issue}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <ReactFlow
          nodeTypes={NODE_TYPES}
          nodes={canvasNodes}
          edges={edges}
          onNodesChange={(changes) =>
            setNodes((current) =>
              applyNodeChanges<Node<WorkbenchGraphNodeData>>(changes, current)
            )
          }
          onEdgesChange={(changes) =>
            setEdges((current) => applyEdgeChanges<Edge>(changes, current))
          }
          onConnect={(connection) =>
            setEdges((current) =>
              addEdge<Edge>(
                {
                  ...connection,
                  id: `edge_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
                  style: {
                    stroke: "rgba(188, 194, 255, 0.44)",
                    strokeWidth: 1.6
                  }
                },
                current
              )
            )
          }
          onEdgeClick={(_, edge) => {
            setEdges((current) =>
              current.filter((entry) => entry.id !== edge.id)
            );
          }}
          onNodeClick={(_, node) => {
            setSelectedNodeId(node.id);
          }}
          onNodeDoubleClick={(_, node) => {
            openNodeEditor(node.id, "overview");
          }}
          fitView
          proOptions={{ hideAttribution: true }}
          className="bg-transparent"
        >
          <Background color="rgba(255,255,255,0.055)" gap={28} />
        </ReactFlow>

        <div className="pointer-events-none absolute right-4 bottom-4 z-20 flex flex-col gap-2">
          <div className="pointer-events-auto flex flex-col items-end gap-2">
            <button
              type="button"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-[rgba(31,41,69,0.92)] px-4 text-sm font-medium text-white shadow-[0_18px_42px_rgba(0,0,0,0.35)] transition hover:bg-[rgba(42,54,88,0.96)]"
              onClick={() => setAddNodeOpen(true)}
            >
              <Ellipsis className="size-4" />
              Add node
            </button>
            <button
              type="button"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-[rgba(31,41,69,0.92)] px-4 text-sm font-medium text-white shadow-[0_18px_42px_rgba(0,0,0,0.35)] transition hover:bg-[rgba(42,54,88,0.96)]"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 className="size-4" />
              Flow settings
            </button>
            <button
              type="button"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-[rgba(31,41,69,0.92)] px-4 text-sm font-medium text-white shadow-[0_18px_42px_rgba(0,0,0,0.35)] transition hover:bg-[rgba(42,54,88,0.96)]"
              onClick={() => setRunOpen(true)}
            >
              <Play className="size-4" />
              Run flow
            </button>
            {latestRun ? (
              <button
                type="button"
                className="inline-flex h-11 items-center gap-2 rounded-full bg-[rgba(31,41,69,0.92)] px-4 text-sm font-medium text-white shadow-[0_18px_42px_rgba(0,0,0,0.35)] transition hover:bg-[rgba(42,54,88,0.96)]"
                onClick={() => setTraceOpen(true)}
              >
                <Bug className="size-4" />
                Latest trace
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <WorkbenchDialog
        open={addNodeOpen}
        onOpenChange={setAddNodeOpen}
        title="Add node"
        description="Add a Forge box, AI node, or utility node to the flow."
      >
        <div className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              {
                type: "user_input",
                label: "User input",
                icon: <SquareTerminal className="size-4" />
              },
              {
                type: "value",
                label: "Value",
                icon: <ListTree className="size-4" />
              },
              {
                type: "functor",
                label: "Functor",
                icon: <Sparkles className="size-4" />
              },
              { type: "chat", label: "Chat", icon: <Bot className="size-4" /> },
              {
                type: "merge",
                label: "Merge",
                icon: <GitMerge className="size-4" />
              },
              {
                type: "template",
                label: "Template",
                icon: <Wand2 className="size-4" />
              },
              {
                type: "pick_key",
                label: "Pick key",
                icon: <Braces className="size-4" />
              },
              {
                type: "output",
                label: "Output",
                icon: <Send className="size-4" />
              }
            ].map((entry) => (
              <button
                key={entry.type}
                type="button"
                className="flex items-center gap-3 rounded-[20px] bg-white/[0.04] px-4 py-3 text-left text-white transition hover:bg-white/[0.08]"
                onClick={() => {
                  setNodes((current) => [
                    ...current,
                    buildNodeTemplate(
                      entry.type as AiConnectorNodeType,
                      current
                    )
                  ]);
                  setAddNodeOpen(false);
                }}
              >
                {entry.icon}
                <span>{entry.label}</span>
              </button>
            ))}
          </div>

          <FacetedTokenSearch
            title="Forge boxes"
            description=""
            query={boxQuery}
            onQueryChange={setBoxQuery}
            options={boxOptions}
            selectedOptionIds={boxFilters}
            onSelectedOptionIdsChange={setBoxFilters}
            resultSummary={`${filteredBoxes.length} boxes`}
            placeholder="Search visible Forge boxes by title, route, or category"
            emptyStateMessage="No boxes match the current query."
          />
          <div className="grid max-h-[18rem] gap-2 overflow-auto pr-1">
            {filteredBoxes.map((box) => (
              <button
                key={box.id}
                type="button"
                className="rounded-[20px] bg-white/[0.04] px-4 py-3 text-left transition hover:bg-white/[0.08]"
                onClick={() => {
                  setNodes((current) => [
                    ...current,
                    buildNodeTemplate("box", current, box)
                  ]);
                  setAddNodeOpen(false);
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm font-medium text-white">
                    {box.title}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 text-[10px] uppercase tracking-[0.14em] text-white/42">
                    <span>
                      {box.output.length} output
                      {box.output.length === 1 ? "" : "s"}
                    </span>
                    <span>
                      {box.tools.length} tool{box.tools.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
                <div className="mt-1 text-[12px] leading-5 text-white/50">
                  {box.description}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <div className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/56">
                    {box.category}
                  </div>
                  {box.routePath ? (
                    <div className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/56">
                      {box.routePath}
                    </div>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        </div>
      </WorkbenchDialog>

      {selectedNode && isAiWorkbenchNode(selectedNode.data.nodeType) ? (
        <QuestionFlowDialog
          open={editNodeOpen}
          onOpenChange={(open) => {
            setEditNodeOpen(open);
            if (!open) {
              setAiNodeInitialStepId(undefined);
            }
          }}
          eyebrow={`Workbench · ${selectedNode.data.nodeType === "chat" ? "Chat node" : "Functor node"}`}
          title={selectedNode.data.label ?? "Edit node"}
          description="Configure this AI node with the same paged editor Forge uses elsewhere."
          value={selectedNode.data}
          onChange={(nextValue) =>
            updateSelectedNode((node) => ({
              ...node,
              data: nextValue
            }))
          }
          draftPersistenceKey={`workbench.ai-node.${selectedNode.id}`}
          steps={aiNodeSteps}
          initialStepId={aiNodeInitialStepId}
          onSubmit={async () => {
            setEditNodeOpen(false);
            setAiNodeInitialStepId(undefined);
          }}
          submitLabel="Done"
          contentClassName="md:w-[min(60rem,calc(100vw-1.5rem))]"
        />
      ) : (
        <WorkbenchDialog
          open={editNodeOpen}
          onOpenChange={(open) => {
            setEditNodeOpen(open);
            if (!open) {
              setEditNodeSection("overview");
            }
          }}
          title={selectedNode?.data.label ?? "Edit node"}
          description="Edit the selected node without covering the graph with permanent forms."
        >
          {selectedNode ? (
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-2 rounded-full bg-white/[0.04] p-1">
                {[
                  { id: "overview", label: "Overview" },
                  { id: "contracts", label: "Contracts" },
                  { id: "parameters", label: "Parameters" }
                ]
                  .filter(
                    (section) =>
                      section.id !== "contracts" ||
                      selectedNodeSupportsContractEditing
                  )
                  .filter(
                    (section) =>
                      section.id !== "parameters" ||
                      (selectedNode.data.params?.length ?? 0) > 0
                  )
                  .map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      className={cn(
                        "rounded-full px-3 py-2 text-sm transition",
                        editNodeSection === section.id
                          ? "bg-[rgba(192,193,255,0.18)] text-white"
                          : "text-white/58 hover:bg-white/[0.05] hover:text-white"
                      )}
                      onClick={() =>
                        setEditNodeSection(section.id as WorkbenchEditorSection)
                      }
                    >
                      {section.label}
                    </button>
                  ))}
              </div>

              {editNodeSection === "overview" ? (
                <div className="grid gap-3">
                  <input
                    value={selectedNode.data.label}
                    onChange={(event) =>
                      updateSelectedNode((node) => ({
                        ...node,
                        data: { ...node.data, label: event.target.value }
                      }))
                    }
                    className={WORKBENCH_FIELD_CLASS}
                  />
                  <textarea
                    rows={3}
                    value={selectedNode.data.description}
                    onChange={(event) =>
                      updateSelectedNode((node) => ({
                        ...node,
                        data: { ...node.data, description: event.target.value }
                      }))
                    }
                    className={WORKBENCH_FIELD_CLASS}
                  />
                  {selectedNode.data.nodeType === "box" ||
                  selectedNode.data.nodeType === "box_input" ? (
                    <select
                      value={selectedNode.data.boxId ?? ""}
                      onChange={(event) => {
                        const box = boxes.find(
                          (entry) => entry.id === event.target.value
                        );
                        updateSelectedNode((node) => ({
                          ...node,
                          data: {
                            ...node.data,
                            boxId: event.target.value,
                            label: box?.title ?? node.data.label,
                            description:
                              box?.description ?? node.data.description,
                            inputs: box?.inputs ?? [],
                            outputs: box?.output ?? [],
                            params: box?.params ?? [],
                            enabledToolKeys: (box?.tools ?? []).map(
                              (tool) => tool.key
                            )
                          }
                        }));
                      }}
                      className={WORKBENCH_FIELD_CLASS}
                    >
                      <option value="">Select Forge box</option>
                      {boxes.map((box) => (
                        <option key={box.id} value={box.id}>
                          {box.title}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {selectedNode.data.nodeType === "template" ? (
                    <textarea
                      rows={4}
                      value={selectedNode.data.template ?? ""}
                      onChange={(event) =>
                        updateSelectedNode((node) => ({
                          ...node,
                          data: { ...node.data, template: event.target.value }
                        }))
                      }
                      placeholder="Template string"
                      className={WORKBENCH_FIELD_CLASS}
                    />
                  ) : null}
                  {selectedNode.data.nodeType === "pick_key" ? (
                    <input
                      value={selectedNode.data.selectedKey ?? ""}
                      onChange={(event) =>
                        updateSelectedNode((node) => ({
                          ...node,
                          data: {
                            ...node.data,
                            selectedKey: event.target.value
                          }
                        }))
                      }
                      placeholder="Key to select from object input"
                      className={WORKBENCH_FIELD_CLASS}
                    />
                  ) : null}
                  {selectedNode.data.nodeType === "output" ? (
                    <div className="grid gap-3">
                      <select
                        value={selectedNode.data.outputKey ?? "answer"}
                        onChange={(event) =>
                          updateSelectedNode((node) => ({
                            ...node,
                            data: {
                              ...node.data,
                              outputKey: event.target.value
                            }
                          }))
                        }
                        className={WORKBENCH_FIELD_CLASS}
                      >
                        {selectedNodeUpstreamOutputs.length > 0 ? (
                          selectedNodeUpstreamOutputs.map((port) => (
                            <option key={port.key} value={port.key}>
                              {port.label} ({port.key})
                            </option>
                          ))
                        ) : (
                          <option
                            value={selectedNode.data.outputKey ?? "answer"}
                          >
                            {selectedNode.data.outputKey ?? "answer"}
                          </option>
                        )}
                      </select>
                      <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm leading-6 text-white/58">
                        Publish one upstream output as the flow result. If the
                        output key is missing from the graph, Forge will flag it
                        in graph checks.
                      </div>
                    </div>
                  ) : null}
                  {selectedNode.data.nodeType === "value" ? (
                    <>
                      <select
                        value={selectedNode.data.valueType ?? "string"}
                        onChange={(event) =>
                          updateSelectedNode((node) => ({
                            ...node,
                            data: {
                              ...node.data,
                              valueType: event.target.value as any
                            }
                          }))
                        }
                        className={WORKBENCH_FIELD_CLASS}
                      >
                        {[
                          "string",
                          "number",
                          "boolean",
                          "null",
                          "array",
                          "object"
                        ].map((kind) => (
                          <option key={kind} value={kind}>
                            {kind}
                          </option>
                        ))}
                      </select>
                      <textarea
                        rows={4}
                        value={selectedNode.data.valueLiteral ?? ""}
                        onChange={(event) =>
                          updateSelectedNode((node) => ({
                            ...node,
                            data: {
                              ...node.data,
                              valueLiteral: event.target.value
                            }
                          }))
                        }
                        placeholder="Value literal or JSON"
                        className={WORKBENCH_FIELD_CLASS}
                      />
                    </>
                  ) : null}
                </div>
              ) : null}

              {editNodeSection === "contracts" ? (
                selectedNodeSupportsContractEditing ? (
                  <div className="grid gap-4">
                    <PortDefinitionEditor
                      title="Inputs"
                      description="Name the values this node expects so upstream wiring stays obvious."
                      ports={selectedNode.data.inputs ?? []}
                      onChange={(ports) =>
                        updateSelectedNode((node) => ({
                          ...node,
                          data: { ...node.data, inputs: ports }
                        }))
                      }
                      prefix="input"
                    />
                    <PortDefinitionEditor
                      title="Outputs"
                      description="Describe exactly what this node publishes, including semantic model names."
                      ports={selectedNode.data.outputs ?? []}
                      onChange={(ports) =>
                        updateSelectedNode((node) => ({
                          ...node,
                          data: { ...node.data, outputs: ports }
                        }))
                      }
                      prefix="output"
                    />
                  </div>
                ) : (
                  <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-4 text-sm leading-6 text-white/58">
                    This node inherits its contract from the registered Forge
                    box. Edit the box definition in the registry when the
                    contract itself needs to change.
                  </div>
                )
              ) : null}

              {editNodeSection === "parameters" ? (
                <div className="grid gap-3">
                  {(selectedNode.data.params ?? []).length === 0 ? (
                    <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-4 text-sm leading-6 text-white/58">
                      This node does not expose any configurable parameters.
                    </div>
                  ) : null}
                  {(selectedNode.data.params ?? []).map((param) => (
                    <div key={param.key} className="grid gap-2">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                        {param.label}
                      </div>
                      {param.kind === "boolean" ? (
                        <label className="flex items-center gap-3 rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                          <input
                            type="checkbox"
                            checked={Boolean(
                              selectedNode.data.paramValues?.[param.key]
                            )}
                            onChange={(event) =>
                              updateSelectedNode((node) => ({
                                ...node,
                                data: {
                                  ...node.data,
                                  paramValues: {
                                    ...(node.data.paramValues ?? {}),
                                    [param.key]: event.target.checked
                                  }
                                }
                              }))
                            }
                          />
                          {param.description ?? "Enabled"}
                        </label>
                      ) : param.kind === "array" || param.kind === "json" ? (
                        <textarea
                          value={formatWorkbenchParamValue(
                            selectedNode.data.paramValues?.[param.key]
                          )}
                          onChange={(event) =>
                            updateSelectedNode((node) => ({
                              ...node,
                              data: {
                                ...node.data,
                                paramValues: {
                                  ...(node.data.paramValues ?? {}),
                                  [param.key]: event.target.value
                                }
                              }
                            }))
                          }
                          placeholder={param.description ?? param.label}
                          className={cn(
                            WORKBENCH_FIELD_CLASS,
                            "min-h-[104px] resize-y"
                          )}
                        />
                      ) : (
                        <input
                          type={param.kind === "number" ? "number" : "text"}
                          value={formatWorkbenchParamValue(
                            selectedNode.data.paramValues?.[param.key]
                          )}
                          onChange={(event) =>
                            updateSelectedNode((node) => ({
                              ...node,
                              data: {
                                ...node.data,
                                paramValues: {
                                  ...(node.data.paramValues ?? {}),
                                  [param.key]: parseWorkbenchParamValue(
                                    param.kind,
                                    event.target.value
                                  )
                                }
                              }
                            }))
                          }
                          placeholder={param.description ?? param.label}
                          className={WORKBENCH_FIELD_CLASS}
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="flex flex-wrap justify-between gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    deleteSelectedNode(selectedNode.id);
                    setEditNodeOpen(false);
                  }}
                >
                  <Trash2 className="size-4" />
                  Delete node
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    setEditNodeOpen(false);
                    setEditNodeSection("overview");
                  }}
                >
                  Done
                </Button>
              </div>
            </div>
          ) : null}
        </WorkbenchDialog>
      )}

      <WorkbenchDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title="Flow settings"
        description="Edit the flow identity and persistence without covering the graph with permanent forms."
      >
        <div className="grid gap-3">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Flow title"
            className={WORKBENCH_FIELD_CLASS}
          />
          <textarea
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Flow description"
            className={WORKBENCH_FIELD_CLASS}
          />
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as AiConnectorKind)}
            className={WORKBENCH_FIELD_CLASS}
          >
            <option value="functor">Functor flow</option>
            <option value="chat">Chat flow</option>
          </select>
          <PublicInputEditor
            inputs={publicInputs}
            nodes={nodes}
            onChange={setPublicInputs}
          />
          <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/58">
            {flow.id}
          </div>
          <div className="flex flex-wrap justify-between gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                await onDelete();
              }}
            >
              <Trash2 className="size-4" />
              Delete flow
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={async () => {
                await handleSave();
                setSettingsOpen(false);
              }}
            >
              <Save className="size-4" />
              Save settings
            </Button>
          </div>
        </div>
      </WorkbenchDialog>

      <WorkbenchDialog
        open={runOpen}
        onOpenChange={(open) => {
          setRunOpen(open);
          if (open) {
            setRunError(null);
          }
        }}
        title="Run flow"
        description="Run the flow or chat with it and keep the debug trace for every node."
      >
        <div className="grid gap-3">
          {runError ? (
            <div className="rounded-[20px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm leading-6 text-rose-100">
              {runError}
            </div>
          ) : null}
          {!runError && graphIssues.length > 0 ? (
            <div className="rounded-[20px] border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm leading-6 text-amber-100">
              <div className="font-medium">
                Fix these graph issues before running:
              </div>
              <ul className="mt-2 grid gap-1">
                {graphIssues.slice(0, 4).map((issue) => (
                  <li key={issue}>• {issue}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {!runError && hasAiNodes && modelConnections.length === 0 ? (
            <div className="rounded-[20px] border border-sky-400/20 bg-sky-400/10 px-4 py-3 text-sm leading-6 text-sky-100">
              This flow contains AI nodes, but Forge does not have a model
              connection yet. Open Settings &gt; Models, add one connection,
              then come back and run the flow.
            </div>
          ) : null}
          {publicInputs.length > 0 ? (
            <div className="grid gap-3 rounded-[20px] border border-white/8 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-sm text-white">
                Flow inputs
                <InfoTooltip
                  content="These are the typed inputs this flow exposes through the API and the Run modal."
                  label="Explain flow inputs"
                />
              </div>
              <div className="grid gap-3">
                {publicInputs.map((inputDefinition) => (
                  <FlowField
                    key={inputDefinition.key}
                    label={inputDefinition.label}
                    description={
                      inputDefinition.description ||
                      "Typed input for this flow."
                    }
                  >
                    {inputDefinition.kind === "boolean" ? (
                      <label className="flex items-center gap-2 text-sm text-white/68">
                        <input
                          type="checkbox"
                          checked={Boolean(runInputs[inputDefinition.key])}
                          onChange={(event) =>
                            setRunInputs((current) => ({
                              ...current,
                              [inputDefinition.key]: event.target.checked
                            }))
                          }
                        />
                        {inputDefinition.label}
                      </label>
                    ) : inputDefinition.kind === "number" ? (
                      <input
                        type="number"
                        value={
                          typeof runInputs[inputDefinition.key] === "number"
                            ? String(runInputs[inputDefinition.key])
                            : ""
                        }
                        onChange={(event) =>
                          setRunInputs((current) => ({
                            ...current,
                            [inputDefinition.key]:
                              event.target.value.trim().length === 0
                                ? undefined
                                : Number(event.target.value)
                          }))
                        }
                        className={WORKBENCH_FIELD_CLASS}
                      />
                    ) : inputDefinition.kind === "array" ||
                      inputDefinition.kind === "entity_list" ||
                      inputDefinition.kind === "record_list" ||
                      inputDefinition.kind === "object" ||
                      inputDefinition.kind === "json" ||
                      inputDefinition.kind === "record" ||
                      inputDefinition.kind === "context" ||
                      inputDefinition.kind === "filters" ||
                      inputDefinition.kind === "metrics" ||
                      inputDefinition.kind === "timeline" ||
                      inputDefinition.kind === "selection" ||
                      inputDefinition.kind === "entity" ? (
                      <textarea
                        rows={4}
                        value={formatWorkbenchParamValue(
                          runInputs[inputDefinition.key]
                        )}
                        onChange={(event) => {
                          const raw = event.target.value;
                          let parsed: unknown = raw;
                          if (!raw.trim()) {
                            parsed = undefined;
                          } else {
                            try {
                              parsed = JSON.parse(raw);
                            } catch {
                              parsed = raw;
                            }
                          }
                          setRunInputs((current) => ({
                            ...current,
                            [inputDefinition.key]: parsed
                          }));
                        }}
                        placeholder='{"key":"value"}'
                        className={WORKBENCH_FIELD_CLASS}
                      />
                    ) : (
                      <input
                        value={
                          typeof runInputs[inputDefinition.key] === "string"
                            ? (runInputs[inputDefinition.key] as string)
                            : ""
                        }
                        onChange={(event) =>
                          setRunInputs((current) => ({
                            ...current,
                            [inputDefinition.key]: event.target.value
                          }))
                        }
                        placeholder={
                          inputDefinition.exampleValue || inputDefinition.label
                        }
                        className={WORKBENCH_FIELD_CLASS}
                      />
                    )}
                  </FlowField>
                ))}
              </div>
            </div>
          ) : null}
          {shouldShowLegacyUserInput ? (
            <textarea
              rows={5}
              value={userInput}
              onChange={(event) => setUserInput(event.target.value)}
              placeholder="User input"
              className={WORKBENCH_FIELD_CLASS}
            />
          ) : null}
          <label className="flex items-center gap-2 text-sm text-white/64">
            <input
              type="checkbox"
              checked={debugEnabled}
              onChange={(event) => setDebugEnabled(event.target.checked)}
            />
            Return debug trace
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              onClick={() => void handleRunAction("run")}
            >
              <Play className="size-4" />
              Run
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleRunAction("chat")}
            >
              <MessageSquare className="size-4" />
              Chat
            </Button>
          </div>
          <div className="grid gap-2 pt-2">
            {runs.slice(0, 5).map((run) => (
              <div
                key={run.id}
                className="rounded-[18px] border border-white/8 bg-white/[0.04] px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3 text-[12px] text-white/48">
                  <span>{run.mode}</span>
                  <span>{new Date(run.createdAt).toLocaleString()}</span>
                </div>
                <div className="mt-2 text-sm text-white/78">
                  {run.result?.primaryText ?? run.error ?? "No output yet."}
                </div>
              </div>
            ))}
          </div>
        </div>
      </WorkbenchDialog>

      <WorkbenchDialog
        open={traceOpen}
        onOpenChange={setTraceOpen}
        title="Run inspector"
        description="Inspect whole-flow outputs and stable node-level results for any saved run."
      >
        {selectedRun ? (
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-[20px] border border-white/8 bg-white/[0.04] p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                  Run history
                </div>
                <div className="mt-3 grid gap-2">
                  {runs.slice(0, 12).map((run) => (
                    <button
                      key={run.id}
                      type="button"
                      className={cn(
                        "rounded-[18px] border px-4 py-3 text-left transition",
                        selectedRunId === run.id
                          ? "border-[var(--secondary)]/40 bg-[var(--secondary)]/12"
                          : "border-white/8 bg-black/20 hover:bg-white/[0.05]"
                      )}
                      onClick={() => setSelectedRunId(run.id)}
                    >
                      <div className="flex items-center justify-between gap-3 text-[12px] text-white/50">
                        <span>{run.mode}</span>
                        <span>{new Date(run.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="mt-2 text-sm text-white/80">
                        {run.result?.primaryText ??
                          run.error ??
                          "No output yet."}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-3">
                <div className="rounded-[20px] border border-white/8 bg-white/[0.04] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-white/50">
                    <span>{selectedRun.mode}</span>
                    <span>
                      {new Date(selectedRun.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-3 text-sm leading-6 text-white/82">
                    {selectedRun.result?.primaryText ??
                      selectedRun.error ??
                      "No output yet."}
                  </div>
                  {selectedRun.result?.outputs ? (
                    <details className="mt-3 rounded-[16px] bg-black/20 p-3">
                      <summary className="cursor-pointer text-[11px] uppercase tracking-[0.16em] text-white/38">
                        Published outputs
                      </summary>
                      <pre className="mt-3 overflow-auto whitespace-pre-wrap text-[12px] leading-5 text-white/66">
                        {JSON.stringify(selectedRun.result.outputs, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </div>
                {(runNodesQuery.data?.nodeResults ?? []).length > 0 ? (
                  <div className="grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
                    <div className="rounded-[20px] border border-white/8 bg-white/[0.04] p-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                        Node results
                      </div>
                      <div className="mt-3 grid gap-2">
                        {(runNodesQuery.data?.nodeResults ?? []).map((node) => (
                          <button
                            key={node.nodeId}
                            type="button"
                            className={cn(
                              "rounded-[18px] border px-4 py-3 text-left transition",
                              selectedResultNodeId === node.nodeId
                                ? "border-[var(--secondary)]/40 bg-[var(--secondary)]/12"
                                : "border-white/8 bg-black/20 hover:bg-white/[0.05]"
                            )}
                            onClick={() => setSelectedResultNodeId(node.nodeId)}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-sm text-white">
                                  {node.label}
                                </div>
                                <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
                                  {node.nodeType}
                                </div>
                              </div>
                              <div className="rounded-full bg-white/[0.05] px-3 py-1 text-[11px] text-white/56">
                                {Object.keys(node.outputMap).length} outputs
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-[20px] border border-white/8 bg-white/[0.04] p-4">
                      {selectedNodeResult ||
                      selectedNodeResultQuery.data?.nodeResult ? (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-white">
                                {
                                  (
                                    selectedNodeResultQuery.data?.nodeResult ??
                                    selectedNodeResult
                                  )?.label
                                }
                              </div>
                              <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
                                {
                                  (
                                    selectedNodeResultQuery.data?.nodeResult ??
                                    selectedNodeResult
                                  )?.nodeType
                                }
                              </div>
                            </div>
                            <div className="rounded-full bg-white/[0.05] px-3 py-1 text-[11px] text-white/56">
                              {
                                (
                                  (
                                    selectedNodeResultQuery.data?.nodeResult ??
                                    selectedNodeResult
                                  )?.tools ?? []
                                ).length
                              }{" "}
                              tool
                              {(
                                (
                                  selectedNodeResultQuery.data?.nodeResult ??
                                  selectedNodeResult
                                )?.tools ?? []
                              ).length === 1
                                ? ""
                                : "s"}
                            </div>
                          </div>
                          <div className="mt-3 grid gap-3">
                            <details className="rounded-[16px] bg-black/20 p-3">
                              <summary className="cursor-pointer text-[11px] uppercase tracking-[0.16em] text-white/38">
                                Inputs
                              </summary>
                              <pre className="mt-3 overflow-auto whitespace-pre-wrap text-[12px] leading-5 text-white/66">
                                {JSON.stringify(
                                  (
                                    selectedNodeResultQuery.data?.nodeResult ??
                                    selectedNodeResult
                                  )?.input ?? [],
                                  null,
                                  2
                                )}
                              </pre>
                            </details>
                            <details className="rounded-[16px] bg-black/20 p-3">
                              <summary className="cursor-pointer text-[11px] uppercase tracking-[0.16em] text-white/38">
                                Output map
                              </summary>
                              <pre className="mt-3 overflow-auto whitespace-pre-wrap text-[12px] leading-5 text-white/66">
                                {JSON.stringify(
                                  (
                                    selectedNodeResultQuery.data?.nodeResult ??
                                    selectedNodeResult
                                  )?.outputMap ?? {},
                                  null,
                                  2
                                )}
                              </pre>
                            </details>
                            <details className="rounded-[16px] bg-black/20 p-3">
                              <summary className="cursor-pointer text-[11px] uppercase tracking-[0.16em] text-white/38">
                                Payload
                              </summary>
                              <pre className="mt-3 overflow-auto whitespace-pre-wrap text-[12px] leading-5 text-white/66">
                                {JSON.stringify(
                                  (
                                    selectedNodeResultQuery.data?.nodeResult ??
                                    selectedNodeResult
                                  )?.payload ?? null,
                                  null,
                                  2
                                )}
                              </pre>
                            </details>
                          </div>
                        </>
                      ) : (
                        <div className="text-sm text-white/56">
                          Pick a node result to inspect its resolved inputs and
                          outputs.
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[20px] border border-white/8 bg-white/[0.04] p-4 text-sm text-white/56">
                    {runNodesQuery.isFetching
                      ? "Loading node results…"
                      : "This run does not have stored node results yet."}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-white/56">
            Run the flow once to inspect its published outputs and node-level
            results here.
          </div>
        )}
      </WorkbenchDialog>
    </div>
  );
}
