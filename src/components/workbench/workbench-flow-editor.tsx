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
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { useWorkbenchNodeDefinition } from "@/components/workbench/workbench-provider";
import { FacetedTokenSearch, type FacetedTokenOption } from "@/components/search/faceted-token-search";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { ForgeApiError } from "@/lib/api-error";
import { buildWorkbenchToolCatalog } from "@/lib/workbench/tool-catalog";
import type {
  AiConnector,
  AiConnectorEdge,
  AiConnectorKind,
  AiConnectorNode,
  AiConnectorNodeType,
  AiConnectorRun,
  ForgeBoxCatalogEntry,
  ForgeBoxPortDefinition
} from "@/lib/types";
import { cn } from "@/lib/utils";

const WORKBENCH_FIELD_CLASS =
  "rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none";

type WorkbenchGraphNodeData = AiConnectorNode["data"] & {
  nodeType: AiConnectorNodeType;
  inputs: ForgeBoxPortDefinition[];
  outputs: ForgeBoxPortDefinition[];
};

function defaultPortsForNodeType(nodeType: AiConnectorNodeType): {
  inputs: ForgeBoxPortDefinition[];
  outputs: ForgeBoxPortDefinition[];
} {
  switch (nodeType) {
    case "box":
    case "box_input":
      return {
        inputs: [],
        outputs: [{ key: "primary", label: "Content", kind: "content" }]
      };
    case "user_input":
      return {
        inputs: [],
        outputs: [{ key: "primary", label: "User input", kind: "text" }]
      };
    case "value":
      return {
        inputs: [],
        outputs: [{ key: "primary", label: "Value", kind: "content" }]
      };
    case "functor":
    case "chat":
      return {
        inputs: [{ key: "input", label: "Input", kind: "content", required: false }],
        outputs: [{ key: "primary", label: "Answer", kind: "content" }]
      };
    case "merge":
      return {
        inputs: [
          { key: "left", label: "Left", kind: "content", required: false },
          { key: "right", label: "Right", kind: "content", required: false }
        ],
        outputs: [{ key: "primary", label: "Merged", kind: "content" }]
      };
    case "template":
      return {
        inputs: [{ key: "input", label: "Input", kind: "content", required: false }],
        outputs: [{ key: "primary", label: "Templated", kind: "content" }]
      };
    case "pick_key":
      return {
        inputs: [{ key: "object", label: "Object", kind: "object", required: false }],
        outputs: [{ key: "primary", label: "Selected value", kind: "content" }]
      };
    case "output":
      return {
        inputs: [{ key: "input", label: "Input", kind: "content", required: false }],
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
  if (node.type === "box" || node.type === "box_input") {
    const box = boxes.find((entry) => entry.id === node.data.boxId);
    return {
      inputs: box?.inputs ?? [],
      outputs:
        box?.output?.length
          ? box.output
          : [{ key: "primary", label: "Content", kind: "content" }],
      enabledToolKeys:
        node.data.enabledToolKeys?.length
          ? node.data.enabledToolKeys
          : (box?.tools ?? []).map((tool) => tool.key),
      boxId: box?.id ?? node.data.boxId ?? null
    };
  }
  const defaults = defaultPortsForNodeType(node.type);
  return {
    inputs: node.data.inputs?.length ? node.data.inputs : defaults.inputs,
    outputs: node.data.outputs?.length ? node.data.outputs : defaults.outputs,
    enabledToolKeys: node.data.enabledToolKeys ?? [],
    boxId: node.data.boxId ?? null
  };
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

function connectorNodeFromGraph(node: Node<WorkbenchGraphNodeData>): AiConnectorNode {
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
      outputKey: "primary",
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
          label={side === "left" ? "Explain node inputs" : "Explain node outputs"}
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
            "relative min-h-6 rounded-full px-3 py-1.5 text-[11px] tracking-[0.01em] text-white/62",
            side === "left" ? "pl-5 text-left" : "pr-5 text-right",
            collapsed ? "bg-white/[0.02]" : "bg-white/[0.04]"
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
          {!collapsed ? port.label : null}
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
  if (definition && props.data.nodeType === "box") {
    const NodeView = definition.NodeView;
    return (
      <NodeView
        nodeId={props.id}
        inputs={undefined}
        params={undefined}
        compact={false}
      />
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
            <div className="truncate text-sm font-semibold">{props.data.label}</div>
          </div>
          {props.data.description ? (
            <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-white/48">
              {props.data.description}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-white/48"
            onClick={() => setPortsCollapsed((current) => !current)}
          >
            {portsCollapsed ? "Show ports" : "Hide labels"}
          </button>
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
        <button
          type="button"
          className="rounded-full bg-white/[0.05] px-3 py-1.5 text-[11px] text-white/56 transition hover:bg-white/[0.08] hover:text-white"
          onClick={() => setSchemaOpen((current) => !current)}
        >
          {schemaOpen ? "Hide schema" : "Preview schema"}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <PortColumn side="left" ports={props.data.inputs ?? []} collapsed={portsCollapsed} />
        <PortColumn side="right" ports={props.data.outputs ?? []} collapsed={portsCollapsed} />
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
                inputs: (props.data.inputs ?? []).map(({ key, kind, required }) => ({
                  key,
                  kind,
                  required: Boolean(required)
                })),
                outputs: (props.data.outputs ?? []).map(({ key, kind, required }) => ({
                  key,
                  kind,
                  required: Boolean(required)
                })),
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
  if (message.includes("No model connection is configured for this connector node.")) {
    return [
      "This flow uses an AI node, but Forge does not have any model connection configured yet.",
      "Open Settings > Models, add a model connection, then run the flow again.",
      "Once a model exists, the node can use the default model automatically or you can pick a specific model inside the node editor."
    ].join("\n\n");
  }
  return message;
}

function summarizePortShape(ports: ForgeBoxPortDefinition[]) {
  return ports.map(({ key, kind, required }) => ({
    key,
    kind,
    required: Boolean(required)
  }));
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
  if (nodes.length === 0) {
    issues.push("Add at least one node before running the flow.");
  }
  const outputNodes = nodes.filter((node) => node.data.nodeType === "output");
  if (outputNodes.length === 0) {
    issues.push("Add an Output node so Forge knows what result the flow should publish.");
  }

  const incomingCounts = new Map<string, number>();
  for (const edge of edges) {
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) ?? 0) + 1);
  }

  for (const node of outputNodes) {
    if ((incomingCounts.get(node.id) ?? 0) === 0) {
      issues.push(
        `Connect something into the output node "${node.data.label}" so the flow has something to return.`
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
    if (node.data.nodeType === "template" && !(node.data.template ?? "").trim()) {
      issues.push(`Add a template string to "${node.data.label}" before running the flow.`);
    }
    if (node.data.nodeType === "pick_key" && !(node.data.selectedKey ?? "").trim()) {
      issues.push(`Choose which key "${node.data.label}" should pick from incoming objects.`);
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
      issues.push(`Add a prompt to the AI node "${node.data.label}" before running the flow.`);
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
  onRun: (input: string, conversationId?: string | null, debug?: boolean) => Promise<void>;
  onChat: (input: string, conversationId?: string | null, debug?: boolean) => Promise<void>;
}) {
  const [title, setTitle] = useState(flow.title);
  const [description, setDescription] = useState(flow.description);
  const [kind, setKind] = useState<AiConnectorKind>(flow.kind);
  const [nodes, setNodes] = useState<Node<WorkbenchGraphNodeData>[]>(() =>
    flow.graph.nodes.map((node) => graphNodeFromConnector(node, boxes))
  );
  const [edges, setEdges] = useState<Edge[]>(() =>
    flow.graph.edges.map(graphEdgeFromConnector)
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [addNodeOpen, setAddNodeOpen] = useState(false);
  const [editNodeOpen, setEditNodeOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [boxQuery, setBoxQuery] = useState("");
  const [boxFilters, setBoxFilters] = useState<string[]>([]);
  const [userInput, setUserInput] = useState("");
  const [debugEnabled, setDebugEnabled] = useState(true);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(flow.title);
    setDescription(flow.description);
    setKind(flow.kind);
    setNodes(flow.graph.nodes.map((node) => graphNodeFromConnector(node, boxes)));
    setEdges(flow.graph.edges.map(graphEdgeFromConnector));
  }, [boxes, flow]);

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
        [box.title, box.description, box.category, box.routePath ?? "", ...box.tags]
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
  const latestTrace = latestRun?.result?.debugTrace ?? null;
  const graphIssues = useMemo(() => collectWorkbenchGraphIssues(nodes, edges), [nodes, edges]);
  const hasAiNodes = useMemo(
    () => nodes.some((node) => isAiWorkbenchNode(node.data.nodeType)),
    [nodes]
  );
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
  const aiNodeSteps = useMemo<QuestionFlowStep<WorkbenchGraphNodeData>[]>(() => {
    if (!selectedNode || !isAiWorkbenchNode(selectedNode.data.nodeType)) {
      return [];
    }
    return [
      {
        id: "overview",
        eyebrow: selectedNode.data.nodeType === "chat" ? "Chat node" : "Functor node",
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
                onChange={(event) => setValue({ description: event.target.value })}
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
                onChange={(event) => setValue({ systemPrompt: event.target.value })}
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
                No model connection is configured yet. Open Settings &gt; Models, add one
                connection, then come back here.
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
                    const enabled = (value.enabledToolKeys ?? []).includes(tool.key);
                    return (
                      <label
                        key={tool.key}
                        className="flex items-start gap-3 rounded-[16px] bg-white/[0.03] px-3 py-2 text-left"
                      >
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(event) => {
                            const current = new Set(value.enabledToolKeys ?? []);
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
                        sources: tool.sources
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
                  .filter((output) => output.key !== "primary")
                  .map((output) => output.key)
                  .join(", ")}
                onChange={(event) =>
                  setValue({
                    outputs: [
                      { key: "primary", label: "Answer", kind: "content" },
                      ...event.target.value
                        .split(",")
                        .map((entry) => entry.trim())
                        .filter(Boolean)
                        .map((key) => ({
                          key,
                          label: key,
                          kind: "content" as const
                        }))
                    ]
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
  }, [availableToolOptions, modelConnections, selectedAiToolPreview, selectedNode]);

  function updateSelectedNode(
    updater: (node: Node<WorkbenchGraphNodeData>) => Node<WorkbenchGraphNodeData>
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
    await onSave({
      title,
      description,
      kind,
      graph: {
        nodes: nodes.map(connectorNodeFromGraph),
        edges: edges.map(connectorEdgeFromGraph)
      }
    });
  }

  async function handleRunAction(mode: "run" | "chat") {
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
    try {
      if (mode === "run") {
        await onRun(userInput, null, debugEnabled);
      } else {
        await onChat(userInput, null, debugEnabled);
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
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/38">
              Workbench flow
            </div>
            <div className="truncate font-display text-[1.55rem] tracking-[-0.05em] text-white">
              {title}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-full bg-white/[0.05] px-3 py-2 text-[12px] text-white/58">
            {kind}
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
          <Button type="button" variant="secondary" onClick={() => setRunOpen(true)}>
            <Play className="size-4" />
            Run
          </Button>
          <Button type="button" variant="primary" onClick={() => void handleSave()}>
            <Save className="size-4" />
            Save
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
          nodes={nodes}
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
                  style: { stroke: "rgba(188, 194, 255, 0.44)", strokeWidth: 1.6 }
                },
                current
              )
            )
          }
          onNodeClick={(_, node) => {
            setSelectedNodeId(node.id);
            setEditNodeOpen(true);
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
              { type: "user_input", label: "User input", icon: <SquareTerminal className="size-4" /> },
              { type: "value", label: "Value", icon: <ListTree className="size-4" /> },
              { type: "functor", label: "Functor", icon: <Sparkles className="size-4" /> },
              { type: "chat", label: "Chat", icon: <Bot className="size-4" /> },
              { type: "merge", label: "Merge", icon: <GitMerge className="size-4" /> },
              { type: "template", label: "Template", icon: <Wand2 className="size-4" /> },
              { type: "pick_key", label: "Pick key", icon: <Braces className="size-4" /> },
              { type: "output", label: "Output", icon: <Send className="size-4" /> }
            ].map((entry) => (
              <button
                key={entry.type}
                type="button"
                className="flex items-center gap-3 rounded-[20px] bg-white/[0.04] px-4 py-3 text-left text-white transition hover:bg-white/[0.08]"
                onClick={() => {
                  setNodes((current) => [
                    ...current,
                    buildNodeTemplate(entry.type as AiConnectorNodeType, current)
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
                  setNodes((current) => [...current, buildNodeTemplate("box", current, box)]);
                  setAddNodeOpen(false);
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm font-medium text-white">{box.title}</div>
                  <div className="flex shrink-0 flex-wrap gap-2 text-[10px] uppercase tracking-[0.14em] text-white/42">
                    <span>{box.output.length} output{box.output.length === 1 ? "" : "s"}</span>
                    <span>{box.tools.length} tool{box.tools.length === 1 ? "" : "s"}</span>
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
          onOpenChange={setEditNodeOpen}
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
          steps={aiNodeSteps}
          onSubmit={async () => {
            setEditNodeOpen(false);
          }}
          submitLabel="Done"
          contentClassName="md:w-[min(60rem,calc(100vw-1.5rem))]"
        />
      ) : (
        <WorkbenchDialog
          open={editNodeOpen}
          onOpenChange={setEditNodeOpen}
          title={selectedNode?.data.label ?? "Edit node"}
          description="Edit the selected node without covering the graph with permanent forms."
        >
          {selectedNode ? (
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
              {(selectedNode.data.nodeType === "box" ||
                selectedNode.data.nodeType === "box_input") ? (
                <select
                  value={selectedNode.data.boxId ?? ""}
                  onChange={(event) => {
                    const box = boxes.find((entry) => entry.id === event.target.value);
                    updateSelectedNode((node) => ({
                      ...node,
                      data: {
                        ...node.data,
                        boxId: event.target.value,
                        label: box?.title ?? node.data.label,
                        description: box?.description ?? node.data.description,
                        inputs: box?.inputs ?? [],
                        outputs: box?.output ?? [],
                        params: box?.params ?? [],
                        enabledToolKeys: (box?.tools ?? []).map((tool) => tool.key)
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
              {(selectedNode.data.params ?? []).map((param) => (
                <div key={param.key} className="grid gap-2">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                    {param.label}
                  </div>
                  {param.kind === "boolean" ? (
                    <label className="flex items-center gap-3 rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedNode.data.paramValues?.[param.key])}
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
                  ) : (
                    <input
                      value={String(selectedNode.data.paramValues?.[param.key] ?? "")}
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
                      className={WORKBENCH_FIELD_CLASS}
                    />
                  )}
                </div>
              ))}
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
                      data: { ...node.data, selectedKey: event.target.value }
                    }))
                  }
                  placeholder="Key to select from object input"
                  className={WORKBENCH_FIELD_CLASS}
                />
              ) : null}
              {selectedNode.data.nodeType === "output" ? (
                <input
                  value={selectedNode.data.outputKey ?? "primary"}
                  onChange={(event) =>
                    updateSelectedNode((node) => ({
                      ...node,
                      data: { ...node.data, outputKey: event.target.value }
                    }))
                  }
                  placeholder="Published output key"
                  className={WORKBENCH_FIELD_CLASS}
                />
              ) : null}
              {selectedNode.data.nodeType === "value" ? (
                <>
                  <select
                    value={selectedNode.data.valueType ?? "string"}
                    onChange={(event) =>
                      updateSelectedNode((node) => ({
                        ...node,
                        data: { ...node.data, valueType: event.target.value as any }
                      }))
                    }
                    className={WORKBENCH_FIELD_CLASS}
                  >
                    {["string", "number", "boolean", "null", "array", "object"].map((kind) => (
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
                        data: { ...node.data, valueLiteral: event.target.value }
                      }))
                    }
                    placeholder="Value literal or JSON"
                    className={WORKBENCH_FIELD_CLASS}
                  />
                </>
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
                <Button type="button" variant="primary" onClick={() => setEditNodeOpen(false)}>
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
              <div className="font-medium">Fix these graph issues before running:</div>
              <ul className="mt-2 grid gap-1">
                {graphIssues.slice(0, 4).map((issue) => (
                  <li key={issue}>• {issue}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {!runError && hasAiNodes && modelConnections.length === 0 ? (
            <div className="rounded-[20px] border border-sky-400/20 bg-sky-400/10 px-4 py-3 text-sm leading-6 text-sky-100">
              This flow contains AI nodes, but Forge does not have a model connection yet.
              Open Settings &gt; Models, add one connection, then come back and run the
              flow.
            </div>
          ) : null}
          <textarea
            rows={5}
            value={userInput}
            onChange={(event) => setUserInput(event.target.value)}
            placeholder="User input"
            className={WORKBENCH_FIELD_CLASS}
          />
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
        title="Latest debug trace"
        description="Inspect node-by-node inputs, outputs, tools, and logs from the latest run."
      >
        {latestRun ? (
          <div className="grid gap-4">
            <div className="rounded-[20px] bg-white/[0.04] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-white/50">
                <span>{latestRun.mode}</span>
                <span>{new Date(latestRun.createdAt).toLocaleString()}</span>
              </div>
              <div className="mt-3 text-sm leading-6 text-white/82">
                {latestRun.result?.primaryText ?? latestRun.error ?? "No output yet."}
              </div>
            </div>
            {latestTrace?.errors?.length ? (
              <div className="rounded-[20px] border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">
                {latestTrace.errors.join("\n")}
              </div>
            ) : null}
            <div className="grid gap-3">
              {(latestTrace?.nodes ?? []).map((node) => (
                <div
                  key={node.nodeId}
                  className="rounded-[20px] border border-white/8 bg-white/[0.04] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">{node.label}</div>
                      <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
                        {node.nodeType}
                      </div>
                    </div>
                    {node.tools.length > 0 ? (
                      <div className="rounded-full bg-white/[0.05] px-3 py-1 text-[11px] text-white/56">
                        {node.tools.length} tool{node.tools.length === 1 ? "" : "s"}
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <details className="rounded-[16px] bg-black/20 p-3">
                      <summary className="flex cursor-pointer items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-white/38">
                        <ListTree className="size-3.5" />
                        Inputs
                      </summary>
                      <pre className="mt-3 overflow-auto whitespace-pre-wrap text-[12px] leading-5 text-white/66">
                        {node.input.length > 0
                          ? JSON.stringify(node.input, null, 2)
                          : "[]"}
                      </pre>
                    </details>
                    <details className="rounded-[16px] bg-black/20 p-3">
                      <summary className="flex cursor-pointer items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-white/38">
                        <Send className="size-3.5" />
                        Output
                      </summary>
                      <pre className="mt-3 overflow-auto whitespace-pre-wrap text-[12px] leading-5 text-white/66">
                        {JSON.stringify(node.output, null, 2)}
                      </pre>
                    </details>
                  </div>
                  {node.tools.length > 0 ? (
                    <details className="mt-3 rounded-[16px] bg-black/20 p-3">
                      <summary className="cursor-pointer text-[11px] uppercase tracking-[0.16em] text-white/38">
                        Tools used by this node
                      </summary>
                      <pre className="mt-3 overflow-auto whitespace-pre-wrap text-[12px] leading-5 text-white/66">
                        {JSON.stringify(node.tools, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                  {node.logs.length > 0 ? (
                    <details className="mt-3 rounded-[16px] bg-black/20 p-3">
                      <summary className="cursor-pointer text-[11px] uppercase tracking-[0.16em] text-white/38">
                        Logs
                      </summary>
                      <pre className="mt-3 overflow-auto whitespace-pre-wrap text-[12px] leading-5 text-white/66">
                        {node.logs.join("\n\n")}
                      </pre>
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-sm text-white/56">
            Run the flow once with debug enabled to inspect the trace here.
          </div>
        )}
      </WorkbenchDialog>
    </div>
  );
}
