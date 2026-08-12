import "@xyflow/react/dist/style.css";
import {
  addEdge,
  Background,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type Node
} from "@xyflow/react";
import {
  ArrowLeft,
  Bug,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Play,
  RotateCcw,
  Save,
  Square,
  Settings2,
  Trash2,
  Undo2
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import type { FacetedTokenOption } from "@/components/search/faceted-token-search";
import { Button } from "@/components/ui/button";
import { EntityBadge } from "@/components/ui/entity-badge";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { ForgeApiError } from "@/lib/api-error";
import { getEntityKindForWorkbenchFlowKind } from "@/lib/entity-visuals";
import { PortDefinitionEditor } from "@/components/workbench/workbench-contract-editors";
import {
  WorkbenchAddNodeDialog,
  WorkbenchFlowSettingsDialog,
  WorkbenchRunFlowDialog,
  WorkbenchDialog
} from "@/components/workbench/workbench-dialogs";
import {
  buildAiNodeOutputsFromKeys,
  buildNodeTemplate,
  buildWorkbenchFlowPatch,
  collectWorkbenchGraphIssues,
  connectorNodeFromGraph,
  formatWorkbenchParamValue,
  formatWorkbenchRunError,
  graphEdgeFromConnector,
  graphNodeFromConnector,
  isAiWorkbenchNode,
  normalizeWorkbenchGraph,
  parseWorkbenchParamValue,
  summarizePortShape,
  summarizeSaveState,
  validateWorkbenchConnection,
  validateWorkbenchGraphBeforeRun,
  validateWorkbenchInputValue,
  type WorkbenchEditorSection,
  type WorkbenchGraphNodeData,
  type WorkbenchSaveState
} from "@/components/workbench/workbench-flow-model";
import {
  WORKBENCH_FIELD_CLASS,
  WorkbenchNodeCard
} from "@/components/workbench/workbench-node-card";
import { buildWorkbenchToolCatalog } from "@/lib/workbench/tool-catalog";
import type {
  AiConnector,
  AiConnectorKind,
  AiConnectorNode,
  AiConnectorPublicInput,
  AiConnectorRunSummary,
  AiModelProvider,
  ForgeBoxCatalogEntry
} from "@/lib/types";
import {
  useGetWorkbenchFlowRunQuery,
  useGetWorkbenchFlowRunNodeQuery,
  useGetWorkbenchFlowRunNodesQuery,
  useGetWorkbenchFlowRunsQuery
} from "@/store/api/forge-api";
import { cn } from "@/lib/utils";

const NODE_TYPES = {
  workbench: WorkbenchNodeCard
};

const WORKBENCH_VALUE_TYPES = [
  "string",
  "number",
  "boolean",
  "null",
  "array",
  "object"
] as const satisfies readonly NonNullable<
  AiConnectorNode["data"]["valueType"]
>[];

const workbenchCanvasButtonClassName =
  "inline-flex h-11 items-center gap-2 rounded-full bg-[color-mix(in_srgb,var(--surface-glass)_94%,transparent)] px-4 text-sm font-medium text-[var(--ui-ink-strong)] shadow-[var(--ui-shadow-soft)] transition hover:bg-[var(--ui-surface-hover)]";

type WorkbenchRunRequest = {
  userInput?: string;
  inputs?: Record<string, unknown>;
  context?: Record<string, unknown>;
  conversationId?: string | null;
  retryOfRunId?: string | null;
  idempotencyKey?: string | null;
  timeoutMs?: number;
  debug?: boolean;
};

function createWorkbenchRunKey() {
  return `workbench_${globalThis.crypto.randomUUID()}`;
}

function saveStateClassName(saveState: WorkbenchSaveState) {
  if (saveState === "error") {
    return "border-[color-mix(in_srgb,var(--danger)_28%,transparent)] bg-[var(--ui-danger-soft)] text-[var(--danger)]";
  }
  if (saveState === "saving") {
    return "border-[color-mix(in_srgb,var(--info)_28%,transparent)] bg-[var(--ui-info-soft)] text-[var(--info)]";
  }
  if (saveState === "dirty") {
    return "border-[color-mix(in_srgb,var(--warning)_28%,transparent)] bg-[var(--ui-warning-soft)] text-[var(--warning)]";
  }
  return "border-[color-mix(in_srgb,var(--success)_28%,transparent)] bg-[var(--ui-success-soft)] text-[var(--success)]";
}

export function WorkbenchFlowEditor({
  flow,
  boxes,
  modelConnections,
  runs,
  onSave,
  onDelete,
  onRun,
  onChat,
  onCancelRun
}: {
  flow: AiConnector;
  boxes: ForgeBoxCatalogEntry[];
  modelConnections: Array<{
    id: string;
    label: string;
    provider: AiModelProvider;
    model: string;
    baseUrl: string;
  }>;
  runs: AiConnectorRunSummary[];
  onSave: (patch: Partial<AiConnector>) => Promise<void>;
  onDelete: () => Promise<void>;
  onRun: (input: WorkbenchRunRequest) => Promise<void>;
  onChat: (input: WorkbenchRunRequest) => Promise<void>;
  onCancelRun: (runId: string, reason: string) => Promise<void>;
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
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [lastDeletedGraph, setLastDeletedGraph] = useState<{
    nodes: Node<WorkbenchGraphNodeData>[];
    edges: Edge[];
  } | null>(null);
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
  const [runTimeoutMs, setRunTimeoutMs] = useState(300_000);
  const [runError, setRunError] = useState<string | null>(null);
  const [runPending, setRunPending] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<WorkbenchSaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(
    runs[0]?.id ?? null
  );
  const [selectedResultNodeId, setSelectedResultNodeId] = useState<
    string | null
  >(null);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [retryPending, setRetryPending] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const runAttemptRef = useRef<
    Record<"run" | "chat", { fingerprint: string; key: string } | null>
  >({ run: null, chat: null });

  function withStableRunKey(
    mode: "run" | "chat",
    request: WorkbenchRunRequest
  ) {
    const { idempotencyKey: _ignored, ...fingerprintInput } = request;
    const fingerprint = JSON.stringify(fingerprintInput);
    const current = runAttemptRef.current[mode];
    const attempt =
      current?.fingerprint === fingerprint
        ? current
        : { fingerprint, key: createWorkbenchRunKey() };
    runAttemptRef.current[mode] = attempt;
    return { ...request, idempotencyKey: attempt.key };
  }

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
    const acknowledgesLocalDraft = flowSnapshot === draftSnapshotRef.current;
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
    setSelectedEdgeId(null);
    setConnectionError(null);
    if (!acknowledgesLocalDraft) {
      setLastDeletedGraph(null);
    }
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
  const activeRun = runs.find((run) => run.status === "running") ?? null;
  const runHistoryQuery = useGetWorkbenchFlowRunsQuery(
    { flowId: flow.id, limit: 12, offset: historyOffset },
    { skip: !traceOpen }
  );
  const historyRuns = useMemo(
    () => runHistoryQuery.data?.runs ?? runs.slice(0, 12),
    [runHistoryQuery.data?.runs, runs]
  );
  const selectedRun =
    historyRuns.find((run) => run.id === selectedRunId) ??
    historyRuns[0] ??
    latestRun ??
    null;
  const runDetailQuery = useGetWorkbenchFlowRunQuery(
    { flowId: flow.id, runId: selectedRunId ?? "" },
    { skip: !selectedRunId || !traceOpen }
  );
  const runNodesQuery = useGetWorkbenchFlowRunNodesQuery(
    {
      flowId: flow.id,
      runId: selectedRunId ?? ""
    },
    {
      skip: !selectedRunId || !traceOpen
    }
  );
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
  const selectedNodeResult = selectedNodeResultQuery.data?.nodeResult ?? null;
  const graphIssues = useMemo(
    () => collectWorkbenchGraphIssues(nodes, edges),
    [nodes, edges]
  );
  const displayedGraphIssues = useMemo(
    () => (connectionError ? [connectionError, ...graphIssues] : graphIssues),
    [connectionError, graphIssues]
  );
  useEffect(() => {
    setConnectionError(null);
  }, [nodes, edges]);
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
  useEffect(() => {
    if (
      historyRuns.length > 0 &&
      !historyRuns.some((run) => run.id === selectedRunId)
    ) {
      setSelectedRunId(historyRuns[0]?.id ?? null);
    }
  }, [historyRuns, selectedRunId]);
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
  }, [draftPatch, draftSnapshot]);
  const deleteSelectedNode = useCallback(
    (nodeId: string) => {
      setLastDeletedGraph({ nodes, edges });
      setNodes((current) => current.filter((node) => node.id !== nodeId));
      setEdges((current) =>
        current.filter(
          (edge) => edge.source !== nodeId && edge.target !== nodeId
        )
      );
      setSelectedNodeId((current) => (current === nodeId ? null : current));
      setSelectedEdgeId(null);
    },
    [edges, nodes]
  );
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
              <div className="rounded-[20px] border border-[color-mix(in_srgb,var(--warning)_28%,transparent)] bg-[var(--ui-warning-soft)] px-4 py-3 text-sm leading-6 text-[var(--warning)]">
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
                      provider: connection?.provider ?? null,
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
                        className="flex items-start gap-3 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-2 text-left"
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
                          <div className="flex items-center gap-2 text-sm text-[var(--ui-ink-strong)]">
                            <span>{tool.label}</span>
                            <span className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                              {tool.accessMode.replace("_", " ")}
                            </span>
                          </div>
                          <div className="text-[12px] leading-5 text-[var(--ui-ink-soft)]">
                            {tool.description}
                          </div>
                          {tool.sources.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {tool.sources.map((source) => (
                                <span
                                  key={`${tool.key}-${source}`}
                                  className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-2 py-1 text-[10px] text-[var(--ui-ink-faint)]"
                                >
                                  {source}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <div className="mt-1 font-mono text-[10px] text-[var(--ui-ink-faint)]">
                            {tool.key}
                          </div>
                          {tool.argsSchema ? (
                            <details className="mt-2 rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-code-bg)] px-3 py-2">
                              <summary className="cursor-pointer text-[11px] text-[var(--ui-ink-soft)]">
                                Preview tool arguments
                              </summary>
                              <pre className="mt-2 overflow-auto whitespace-pre-wrap text-[10px] leading-5 text-[var(--ui-ink-faint)]">
                                {JSON.stringify(tool.argsSchema, null, 2)}
                              </pre>
                            </details>
                          ) : null}
                        </div>
                      </label>
                    );
                  })
                ) : (
                  <div className="text-sm text-[var(--ui-ink-faint)]">
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
                <details className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-code-bg)] px-4 py-3">
                  <summary className="cursor-pointer text-sm text-[var(--ui-ink-medium)]">
                    {selectedAiToolPreview.length > 0
                      ? `${selectedAiToolPreview.length} tool contract${
                          selectedAiToolPreview.length === 1 ? "" : "s"
                        }`
                      : "No tool contract yet"}
                  </summary>
                  <pre className="mt-3 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-[var(--ui-ink-soft)]">
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
                <details className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-code-bg)] px-4 py-3">
                  <summary className="cursor-pointer text-sm text-[var(--ui-ink-medium)]">
                    {(value.outputs ?? []).length} published output
                    {(value.outputs ?? []).length === 1 ? "" : "s"}
                  </summary>
                  <pre className="mt-3 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-[var(--ui-ink-soft)]">
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
            <div className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                Danger zone
              </div>
              <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
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
    deleteSelectedNode,
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

  function deleteSelectedEdge() {
    if (!selectedEdgeId) {
      return;
    }
    setLastDeletedGraph({ nodes, edges });
    setEdges((current) => current.filter((edge) => edge.id !== selectedEdgeId));
    setSelectedEdgeId(null);
  }

  function undoLastDeletion() {
    if (!lastDeletedGraph) {
      return;
    }
    setNodes(lastDeletedGraph.nodes);
    setEdges(lastDeletedGraph.edges);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setLastDeletedGraph(null);
  }

  async function handleSave() {
    await persistDraft();
  }

  async function handleRunAction(mode: "run" | "chat") {
    if (runPending) {
      return;
    }
    setRunPending(true);
    try {
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
      if (mode === "run") {
        await onRun(
          withStableRunKey(mode, {
            userInput: shouldShowLegacyUserInput ? userInput : "",
            inputs: nextInputs,
            timeoutMs: runTimeoutMs,
            debug: debugEnabled
          })
        );
      } else {
        await onChat(
          withStableRunKey(mode, {
            userInput: shouldShowLegacyUserInput ? userInput : "",
            inputs: nextInputs,
            timeoutMs: runTimeoutMs,
            debug: debugEnabled
          })
        );
      }
      runAttemptRef.current[mode] = null;
      setRunOpen(false);
    } catch (error) {
      setRunError(formatWorkbenchRunError(error));
    } finally {
      setRunPending(false);
    }
  }

  async function handleRetrySelectedRun() {
    const failedRun = runDetailQuery.data?.run;
    if (
      retryPending ||
      !failedRun ||
      !["failed", "cancelled", "timed_out"].includes(failedRun.status)
    ) {
      return;
    }
    setRetryPending(true);
    setRetryError(null);
    try {
      const retry = withStableRunKey(failedRun.mode, {
        userInput: failedRun.userInput,
        inputs: failedRun.inputs,
        context: failedRun.context,
        conversationId: failedRun.conversationId,
        retryOfRunId: failedRun.id,
        debug: Boolean(failedRun.result?.debugTrace)
      });
      if (failedRun.mode === "chat") {
        await onChat(retry);
      } else {
        await onRun(retry);
      }
      runAttemptRef.current[failedRun.mode] = null;
    } catch (error) {
      setRetryError(formatWorkbenchRunError(error));
    } finally {
      setRetryPending(false);
    }
  }

  async function handleCancelActiveRun() {
    if (!activeRun || cancelPending) {
      return;
    }
    setCancelPending(true);
    setCancelError(null);
    try {
      await onCancelRun(
        activeRun.id,
        "Stopped from the Workbench flow editor."
      );
    } catch (error) {
      setCancelError(formatWorkbenchRunError(error));
    } finally {
      setCancelPending(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/workbench"
            className="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--ui-surface-1)] px-3 text-sm text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
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
            <div className="truncate font-display text-[1.55rem] tracking-[-0.05em] text-[var(--ui-ink-strong)]">
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
              saveStateClassName(saveState)
            )}
          >
            {summarizeSaveState(saveState, saveError)}
          </div>
          {latestRun ? (
            <button
              type="button"
              className="rounded-full bg-[var(--ui-surface-1)] px-3 py-2 text-[12px] text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
              onClick={() => setTraceOpen(true)}
            >
              Latest {latestRun.mode} · {latestRun.status}
            </button>
          ) : null}
          {activeRun ? (
            <Button
              type="button"
              variant="secondary"
              pending={cancelPending}
              pendingLabel="Stopping…"
              onClick={() => void handleCancelActiveRun()}
            >
              <Square className="size-4" />
              Stop run
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              disabled={runPending}
              onClick={() => setRunOpen(true)}
            >
              <Play className="size-4" />
              Run
            </Button>
          )}
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
      {cancelError ? (
        <div
          role="alert"
          className="rounded-[18px] border border-[color-mix(in_srgb,var(--danger)_28%,transparent)] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
        >
          {cancelError}
        </div>
      ) : null}

      <div className="relative h-[76vh] overflow-hidden rounded-[32px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)]">
        {displayedGraphIssues.length > 0 ? (
          <div className="pointer-events-none absolute left-4 top-4 z-20 max-w-[32rem] rounded-[24px] border border-[color-mix(in_srgb,var(--warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--ui-warning-soft)_82%,var(--surface-glass))] p-4 shadow-[var(--ui-shadow-floating)] backdrop-blur-xl">
            <div className="pointer-events-auto flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--warning)]">
              <span>Graph checks</span>
              <InfoTooltip
                content="These are preflight issues Forge found in the current graph before runtime. Fixing them here should prevent brittle run failures later."
                label="Explain graph checks"
              />
            </div>
            <ul className="mt-3 grid gap-2 text-sm leading-6 text-[var(--ui-ink-strong)]">
              {displayedGraphIssues.map((issue) => (
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
          onConnect={(connection) => {
            const issue = validateWorkbenchConnection(nodes, edges, connection);
            if (issue) {
              setConnectionError(issue);
              return;
            }
            setConnectionError(null);
            setEdges((current) =>
              addEdge<Edge>(
                {
                  ...connection,
                  id: `edge_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
                  style: {
                    stroke:
                      "color-mix(in srgb, var(--primary) 44%, transparent)",
                    strokeWidth: 1.6
                  }
                },
                current
              )
            );
          }}
          onEdgeClick={(_, edge) => {
            setSelectedEdgeId(edge.id);
          }}
          onPaneClick={() => setSelectedEdgeId(null)}
          deleteKeyCode={null}
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
          <Background color="var(--ui-border-subtle)" gap={28} />
        </ReactFlow>

        <div className="pointer-events-none absolute right-4 bottom-4 z-20 flex flex-col gap-2">
          <div className="pointer-events-auto flex flex-col items-end gap-2">
            {selectedEdgeId ? (
              <button
                type="button"
                className={workbenchCanvasButtonClassName}
                onClick={deleteSelectedEdge}
              >
                <Trash2 className="size-4" />
                Delete selected connection
              </button>
            ) : null}
            {lastDeletedGraph ? (
              <button
                type="button"
                className={workbenchCanvasButtonClassName}
                onClick={undoLastDeletion}
              >
                <Undo2 className="size-4" />
                Undo last deletion
              </button>
            ) : null}
            <button
              type="button"
              className={workbenchCanvasButtonClassName}
              onClick={() => setAddNodeOpen(true)}
            >
              <Ellipsis className="size-4" />
              Add node
            </button>
            <button
              type="button"
              className={workbenchCanvasButtonClassName}
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 className="size-4" />
              Flow settings
            </button>
            <button
              type="button"
              className={workbenchCanvasButtonClassName}
              disabled={runPending}
              onClick={() => setRunOpen(true)}
            >
              <Play className="size-4" />
              Run flow
            </button>
            {latestRun ? (
              <button
                type="button"
                className={workbenchCanvasButtonClassName}
                onClick={() => setTraceOpen(true)}
              >
                <Bug className="size-4" />
                Latest trace
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <WorkbenchAddNodeDialog
        open={addNodeOpen}
        onOpenChange={setAddNodeOpen}
        boxQuery={boxQuery}
        onBoxQueryChange={setBoxQuery}
        boxOptions={boxOptions}
        boxFilters={boxFilters}
        onBoxFiltersChange={setBoxFilters}
        filteredBoxes={filteredBoxes}
        onAddNodeType={(nodeType) => {
          setNodes((current) => [
            ...current,
            buildNodeTemplate(nodeType, current)
          ]);
          setAddNodeOpen(false);
        }}
        onAddBox={(box) => {
          setNodes((current) => [
            ...current,
            buildNodeTemplate("box", current, box)
          ]);
          setAddNodeOpen(false);
        }}
      />

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
              <div className="flex flex-wrap gap-2 rounded-full bg-[var(--ui-surface-1)] p-1">
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
                          ? "bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)]"
                          : "text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
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
                      <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
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
                        onChange={(event) => {
                          const valueType = WORKBENCH_VALUE_TYPES.find(
                            (candidate) => candidate === event.target.value
                          );
                          if (!valueType) {
                            return;
                          }
                          updateSelectedNode((node) => ({
                            ...node,
                            data: {
                              ...node.data,
                              valueType
                            }
                          }));
                        }}
                        className={WORKBENCH_FIELD_CLASS}
                      >
                        {WORKBENCH_VALUE_TYPES.map((kind) => (
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
                  <div className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-4 text-sm leading-6 text-[var(--ui-ink-soft)]">
                    This node inherits its contract from the registered Forge
                    box. Edit the box definition in the registry when the
                    contract itself needs to change.
                  </div>
                )
              ) : null}

              {editNodeSection === "parameters" ? (
                <div className="grid gap-3">
                  {(selectedNode.data.params ?? []).length === 0 ? (
                    <div className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-4 text-sm leading-6 text-[var(--ui-ink-soft)]">
                      This node does not expose any configurable parameters.
                    </div>
                  ) : null}
                  {(selectedNode.data.params ?? []).map((param) => (
                    <div key={param.key} className="grid gap-2">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                        {param.label}
                      </div>
                      {param.kind === "boolean" ? (
                        <label className="flex items-center gap-3 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-code-bg)] px-4 py-3 text-sm text-[var(--ui-ink-strong)]">
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

      <WorkbenchFlowSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title={title}
        onTitleChange={setTitle}
        description={description}
        onDescriptionChange={setDescription}
        kind={kind}
        onKindChange={setKind}
        publicInputs={publicInputs}
        onPublicInputsChange={setPublicInputs}
        nodes={nodes}
        flowId={flow.id}
        onDeleteRequest={() => {
          setSettingsOpen(false);
          setDeleteConfirmation("");
          setDeleteError(null);
          setDeleteConfirmOpen(true);
        }}
        onSave={handleSave}
      />

      <QuestionFlowDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          setDeleteConfirmOpen(open);
          if (!open) {
            setDeleteConfirmation("");
            setDeleteError(null);
          }
        }}
        eyebrow="Workbench flow"
        title="Delete flow"
        description="This removes the saved flow. Confirm the exact flow title before continuing."
        value={{ confirmation: deleteConfirmation }}
        onChange={(value) => setDeleteConfirmation(value.confirmation)}
        steps={[
          {
            id: "confirm",
            eyebrow: "Confirmation",
            title: `Delete ${title}?`,
            description:
              "Type the exact title to protect the graph from an accidental delete.",
            render: (value, setValue) => (
              <FlowField label={`Type "${title}" to confirm`}>
                <input
                  value={value.confirmation}
                  onChange={(event) =>
                    setValue({ confirmation: event.target.value })
                  }
                  autoComplete="off"
                  className={WORKBENCH_FIELD_CLASS}
                />
              </FlowField>
            )
          }
        ]}
        submitLabel="Delete flow"
        pending={deletePending}
        pendingLabel="Deleting"
        error={deleteError}
        onSubmit={async () => {
          if (deleteConfirmation !== title) {
            setDeleteError(`Type "${title}" exactly to delete this flow.`);
            return;
          }
          setDeletePending(true);
          setDeleteError(null);
          try {
            await onDelete();
            setDeleteConfirmOpen(false);
          } catch (error) {
            setDeleteError(
              error instanceof Error
                ? error.message
                : "Forge could not delete the flow. Try again."
            );
          } finally {
            setDeletePending(false);
          }
        }}
      />

      <WorkbenchRunFlowDialog
        open={runOpen}
        onOpenChange={(open) => {
          setRunOpen(open);
          if (open) {
            setRunError(null);
          }
        }}
        runError={runError}
        graphIssues={graphIssues}
        hasAiNodes={hasAiNodes}
        modelConnectionCount={modelConnections.length}
        publicInputs={publicInputs}
        runInputs={runInputs}
        onRunInputChange={(key, value) =>
          setRunInputs((current) => ({
            ...current,
            [key]: value
          }))
        }
        shouldShowLegacyUserInput={shouldShowLegacyUserInput}
        userInput={userInput}
        onUserInputChange={setUserInput}
        debugEnabled={debugEnabled}
        onDebugEnabledChange={setDebugEnabled}
        timeoutMs={runTimeoutMs}
        onTimeoutMsChange={setRunTimeoutMs}
        activeRun={activeRun}
        cancelPending={cancelPending}
        cancelError={cancelError}
        onCancelRun={() => void handleCancelActiveRun()}
        onRun={() => void handleRunAction("run")}
        onChat={() => void handleRunAction("chat")}
        pending={runPending}
        runs={runs}
      />

      <WorkbenchDialog
        open={traceOpen}
        onOpenChange={setTraceOpen}
        title="Run inspector"
        description="Inspect whole-flow outputs and stable node-level results for any saved run."
      >
        {selectedRun ? (
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                  Run history
                </div>
                <div className="mt-3 grid gap-2">
                  {historyRuns.map((run) => (
                    <button
                      key={run.id}
                      type="button"
                      className={cn(
                        "rounded-[18px] border px-4 py-3 text-left transition",
                        selectedRunId === run.id
                          ? "border-[var(--secondary)]/40 bg-[var(--secondary)]/12"
                          : "border-[var(--ui-border-subtle)] bg-[var(--ui-code-bg)] hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
                      )}
                      onClick={() => setSelectedRunId(run.id)}
                    >
                      <div className="flex items-center justify-between gap-3 text-[12px] text-[var(--ui-ink-soft)]">
                        <span>{run.mode}</span>
                        <span>{run.status.replace("_", " ")}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-[var(--ui-ink-faint)]">
                        {new Date(run.createdAt).toLocaleString()}
                      </div>
                      <div className="mt-2 text-sm text-[var(--ui-ink-medium)]">
                        {run.outputPreview || run.error || "No output yet."}
                      </div>
                    </button>
                  ))}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={
                        historyOffset === 0 || runHistoryQuery.isFetching
                      }
                      onClick={() =>
                        setHistoryOffset((current) => Math.max(0, current - 12))
                      }
                    >
                      <ChevronLeft className="size-4" />
                      Newer
                    </Button>
                    <span className="text-[11px] text-[var(--ui-ink-faint)]">
                      {runHistoryQuery.data
                        ? `${runHistoryQuery.data.offset + 1}-${
                            runHistoryQuery.data.offset + historyRuns.length
                          } of ${runHistoryQuery.data.total}`
                        : `${historyRuns.length} recent`}
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={
                        !runHistoryQuery.data?.hasMore ||
                        runHistoryQuery.isFetching
                      }
                      onClick={() =>
                        setHistoryOffset((current) => current + 12)
                      }
                    >
                      Older
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>
              <div className="grid gap-3">
                <div className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-[var(--ui-ink-soft)]">
                    <span>{selectedRun.mode}</span>
                    <span>
                      {new Date(selectedRun.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-3 text-sm leading-6 text-[var(--ui-ink-medium)]">
                    {runDetailQuery.isFetching
                      ? "Loading bounded run detail…"
                      : runDetailQuery.data?.run.result?.primaryText ||
                        selectedRun.outputPreview ||
                        selectedRun.error ||
                        "No output yet."}
                  </div>
                  {runDetailQuery.data &&
                  runDetailQuery.data.run.flowSnapshot?.updatedAt !==
                    flow.updatedAt ? (
                    <div className="mt-3 rounded-[16px] border border-[color-mix(in_srgb,var(--warning)_28%,transparent)] bg-[var(--ui-warning-soft)] px-3 py-2 text-[12px] leading-5 text-[var(--warning)]">
                      {runDetailQuery.data.run.flowSnapshot
                        ? "This run used an older saved version of the flow. Its node labels and outputs remain attributed to that version."
                        : "This legacy run predates flow-version snapshots. Its stored node results remain available, but exact graph attribution is unavailable."}
                    </div>
                  ) : null}
                  {runDetailQuery.data?.readMetadata?.redacted ||
                  runDetailQuery.data?.readMetadata?.truncated ? (
                    <div className="mt-3 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-code-bg)] px-3 py-2 text-[12px] leading-5 text-[var(--ui-ink-soft)]">
                      {runDetailQuery.data.readMetadata.redacted
                        ? "Sensitive fields are redacted. "
                        : ""}
                      {runDetailQuery.data.readMetadata.truncated
                        ? "Large values are shown as bounded previews."
                        : ""}
                    </div>
                  ) : null}
                  {runDetailQuery.data?.run.result?.outputs ? (
                    <details className="mt-3 rounded-[16px] bg-[var(--ui-code-bg)] p-3">
                      <summary className="cursor-pointer text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                        Published outputs
                      </summary>
                      <pre className="mt-3 overflow-auto whitespace-pre-wrap text-[12px] leading-5 text-[var(--ui-code-text)]">
                        {JSON.stringify(
                          runDetailQuery.data.run.result.outputs,
                          null,
                          2
                        )}
                      </pre>
                    </details>
                  ) : null}
                  {runDetailQuery.data?.run &&
                  ["failed", "cancelled", "timed_out"].includes(
                    selectedRun.status
                  ) ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={retryPending || !runDetailQuery.data?.run}
                        onClick={() => void handleRetrySelectedRun()}
                      >
                        <RotateCcw className="size-4" />
                        {retryPending ? "Retrying" : "Retry with same input"}
                      </Button>
                      <Link
                        to="/settings/models"
                        className="text-[12px] text-[var(--secondary)] hover:underline"
                      >
                        Check model settings
                      </Link>
                    </div>
                  ) : null}
                  {runDetailQuery.data?.run.cancellationRequestedAt ? (
                    <div className="mt-3 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-code-bg)] px-3 py-2 text-[12px] leading-5 text-[var(--ui-ink-soft)]">
                      Cancelled by{" "}
                      {runDetailQuery.data.run.cancellationActor ||
                        "an authenticated actor"}
                      {runDetailQuery.data.run.cancellationSource
                        ? ` through ${runDetailQuery.data.run.cancellationSource}`
                        : ""}
                      .
                      {runDetailQuery.data.run.cancellationReason
                        ? ` ${runDetailQuery.data.run.cancellationReason}`
                        : ""}
                    </div>
                  ) : selectedRun.status === "timed_out" ? (
                    <div className="mt-3 rounded-[16px] border border-[color-mix(in_srgb,var(--warning)_28%,transparent)] bg-[var(--ui-warning-soft)] px-3 py-2 text-[12px] leading-5 text-[var(--warning)]">
                      The whole-flow deadline was{" "}
                      {new Date(
                        runDetailQuery.data?.run.deadlineAt ??
                          selectedRun.deadlineAt
                      ).toLocaleString()}
                      . Completed-node evidence remains below.
                    </div>
                  ) : null}
                  {retryError ? (
                    <div
                      role="alert"
                      className="mt-2 text-[12px] text-[var(--danger)]"
                    >
                      {retryError}
                    </div>
                  ) : null}
                </div>
                {(runNodesQuery.data?.nodeResults ?? []).length > 0 ? (
                  <div className="grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
                    <div className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
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
                                : "border-[var(--ui-border-subtle)] bg-[var(--ui-code-bg)] hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
                            )}
                            onClick={() => setSelectedResultNodeId(node.nodeId)}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-sm text-[var(--ui-ink-strong)]">
                                  {node.label}
                                </div>
                                <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                                  {node.nodeType}
                                </div>
                              </div>
                              <div className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-1 text-[11px] text-[var(--ui-ink-soft)]">
                                {node.outputKeys.length} outputs
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
                      {selectedNodeResult ? (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                                {selectedNodeResult.label}
                              </div>
                              <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                                {selectedNodeResult.nodeType}
                              </div>
                            </div>
                            <div className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-1 text-[11px] text-[var(--ui-ink-soft)]">
                              {(selectedNodeResult.tools ?? []).length} tool
                              {(selectedNodeResult.tools ?? []).length === 1
                                ? ""
                                : "s"}
                            </div>
                          </div>
                          <div className="mt-3 grid gap-3">
                            <details className="rounded-[16px] bg-[var(--ui-code-bg)] p-3">
                              <summary className="cursor-pointer text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                                Inputs
                              </summary>
                              <pre className="mt-3 overflow-auto whitespace-pre-wrap text-[12px] leading-5 text-[var(--ui-code-text)]">
                                {JSON.stringify(
                                  selectedNodeResult.input ?? [],
                                  null,
                                  2
                                )}
                              </pre>
                            </details>
                            <details className="rounded-[16px] bg-[var(--ui-code-bg)] p-3">
                              <summary className="cursor-pointer text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                                Output map
                              </summary>
                              <pre className="mt-3 overflow-auto whitespace-pre-wrap text-[12px] leading-5 text-[var(--ui-code-text)]">
                                {JSON.stringify(
                                  selectedNodeResult.outputMap ?? {},
                                  null,
                                  2
                                )}
                              </pre>
                            </details>
                            <details className="rounded-[16px] bg-[var(--ui-code-bg)] p-3">
                              <summary className="cursor-pointer text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                                Payload
                              </summary>
                              <pre className="mt-3 overflow-auto whitespace-pre-wrap text-[12px] leading-5 text-[var(--ui-code-text)]">
                                {JSON.stringify(
                                  selectedNodeResult.payload ?? null,
                                  null,
                                  2
                                )}
                              </pre>
                            </details>
                          </div>
                        </>
                      ) : (
                        <div className="text-sm text-[var(--ui-ink-soft)]">
                          Pick a node result to inspect its resolved inputs and
                          outputs.
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4 text-sm text-[var(--ui-ink-soft)]">
                    {runNodesQuery.isFetching
                      ? "Loading node results…"
                      : "This run does not have stored node results yet."}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-[var(--ui-ink-soft)]">
            Run the flow once to inspect its published outputs and node-level
            results here.
          </div>
        )}
      </WorkbenchDialog>
    </div>
  );
}
