import type { Edge, Node } from "@xyflow/react";
import { ForgeApiError } from "@/lib/api-error";
import {
  MAX_WORKBENCH_GRAPH_EDGES,
  MAX_WORKBENCH_GRAPH_NODES,
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
  ForgeBoxCatalogEntry,
  ForgeBoxPortDefinition
} from "@/lib/types";

export type WorkbenchGraphNodeData = AiConnectorNode["data"] & {
  nodeType: AiConnectorNodeType;
  inputs: ForgeBoxPortDefinition[];
  outputs: ForgeBoxPortDefinition[];
  onEditRequest?: (() => void) | null;
  onParameterEditRequest?: (() => void) | null;
  onContractEditRequest?: (() => void) | null;
};

export type WorkbenchEditorSection = "overview" | "contracts" | "parameters";
export type WorkbenchSaveState =
  | "idle"
  | "dirty"
  | "saving"
  | "saved"
  | "error";

export const PORT_KIND_OPTIONS: Array<ForgeBoxPortDefinition["kind"]> = [
  ...WORKBENCH_PORT_KINDS
];

export function formatWorkbenchParamValue(value: unknown) {
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

export function parseWorkbenchParamValue(kind: string, raw: string) {
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

export function validateWorkbenchInputValue(
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

export function defaultPortsForNodeType(nodeType: AiConnectorNodeType): {
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

export function resolveNodePorts(
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
    ports.map((port) => {
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

export function normalizeNodeOutputKey(
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

export function canonicalHandleFromLegacy(
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

export function normalizeWorkbenchGraph(
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

export function graphNodeFromConnector(
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

export function graphEdgeFromConnector(edge: AiConnectorEdge): Edge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
    label: edge.label ?? undefined,
    style: {
      stroke: "color-mix(in srgb, var(--primary) 44%, transparent)",
      strokeWidth: 1.6
    }
  };
}

export function connectorNodeFromGraph(
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

export function connectorEdgeFromGraph(edge: Edge): AiConnectorEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
    label: typeof edge.label === "string" ? edge.label : null
  };
}

export function buildNodeTemplate(
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

export function formatPortMeta(port: ForgeBoxPortDefinition) {
  return [
    port.kind,
    port.modelName,
    port.itemKind ? `item:${port.itemKind}` : null
  ]
    .filter(Boolean)
    .join(" · ");
}

export function summarizeSaveState(
  state: WorkbenchSaveState,
  error: string | null
) {
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

export function createPortDefinition(
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

export function createPublicInputDefinition(): AiConnectorPublicInput {
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

export function isAiWorkbenchNode(
  nodeType: AiConnectorNodeType
): nodeType is "functor" | "chat" {
  return nodeType === "functor" || nodeType === "chat";
}

export function formatWorkbenchRunError(error: unknown) {
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

export function summarizePortShape(ports: ForgeBoxPortDefinition[]) {
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

export function buildAiNodeOutputsFromKeys(keys: string[]) {
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

export function validateWorkbenchGraphBeforeRun(
  nodes: Node<WorkbenchGraphNodeData>[],
  edges: Edge[]
) {
  const issues = collectWorkbenchGraphIssues(nodes, edges);
  return issues[0] ?? null;
}

export function collectWorkbenchGraphIssues(
  nodes: Node<WorkbenchGraphNodeData>[],
  edges: Edge[]
) {
  const issues: string[] = [];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  if (nodes.length === 0) {
    issues.push("Add at least one node before running the flow.");
  }
  if (nodes.length > MAX_WORKBENCH_GRAPH_NODES) {
    issues.push(
      `Reduce this flow to at most ${MAX_WORKBENCH_GRAPH_NODES} nodes before saving it.`
    );
  }
  if (edges.length > MAX_WORKBENCH_GRAPH_EDGES) {
    issues.push(
      `Reduce this flow to at most ${MAX_WORKBENCH_GRAPH_EDGES} connections before saving it.`
    );
  }
  if (nodeMap.size !== nodes.length) {
    issues.push("Give every node a unique id before saving the flow.");
  }
  if (new Set(edges.map((edge) => edge.id)).size !== edges.length) {
    issues.push("Give every connection a unique id before saving the flow.");
  }
  for (const node of nodes) {
    const inputKeys = (node.data.inputs ?? []).map((input) => input.key);
    const outputKeys = (node.data.outputs ?? []).map((output) => output.key);
    if (new Set(inputKeys).size !== inputKeys.length) {
      issues.push(`Give every input on "${node.data.label}" a unique key.`);
    }
    if (new Set(outputKeys).size !== outputKeys.length) {
      issues.push(`Give every output on "${node.data.label}" a unique key.`);
    }
  }
  const outputNodes = nodes.filter((node) => node.data.nodeType === "output");
  if (outputNodes.length === 0) {
    issues.push(
      "Add an Output node so Forge knows what result the flow should publish."
    );
  }

  const incomingCounts = new Map<string, number>();
  const outgoingCounts = new Map<string, number>();
  const incomingOutputKeys = new Map<string, string[]>();
  const adjacency = new Map<string, string[]>();
  const indegrees = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
      issues.push(
        `Connection "${edge.id}" points to a node that no longer exists. Remove or repair that connection.`
      );
      continue;
    }
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) ?? 0) + 1);
    outgoingCounts.set(edge.source, (outgoingCounts.get(edge.source) ?? 0) + 1);
    const downstream = adjacency.get(edge.source) ?? [];
    downstream.push(edge.target);
    adjacency.set(edge.source, downstream);
    indegrees.set(edge.target, (indegrees.get(edge.target) ?? 0) + 1);
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
      const selectedOutputs = edge.sourceHandle
        ? sourceOutputs.filter((output) => output.key === edge.sourceHandle)
        : sourceOutputs;
      incomingOutputKeys.set(edge.target, [
        ...(incomingOutputKeys.get(edge.target) ?? []),
        ...selectedOutputs.map((output) => output.key)
      ]);
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

  const ready = nodes
    .filter((node) => (indegrees.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  let visitedCount = 0;
  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    const nodeId = ready[cursor]!;
    visitedCount += 1;
    for (const target of adjacency.get(nodeId) ?? []) {
      const nextIndegree = (indegrees.get(target) ?? 0) - 1;
      indegrees.set(target, nextIndegree);
      if (nextIndegree === 0) {
        ready.push(target);
      }
    }
  }
  if (visitedCount !== nodes.length) {
    issues.push(
      "Remove the circular connection before saving or running this flow. Workbench flows must be acyclic."
    );
  }

  for (const node of outputNodes) {
    if ((incomingCounts.get(node.id) ?? 0) === 0) {
      issues.push(
        `Connect something into the output node "${node.data.label}" so the flow has something to return.`
      );
    }
    const arrivingOutputKeys = incomingOutputKeys.get(node.id) ?? [];
    if (
      node.data.outputKey &&
      arrivingOutputKeys.length > 0 &&
      !arrivingOutputKeys.includes(node.data.outputKey)
    ) {
      issues.push(
        `Output node "${node.data.label}" is configured to publish "${node.data.outputKey}", but that key is not arriving from its upstream nodes.`
      );
    }
  }

  for (const node of nodes) {
    const incoming = incomingCounts.get(node.id) ?? 0;
    const outgoing = outgoingCounts.get(node.id) ?? 0;
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

export function validateWorkbenchConnection(
  nodes: Node<WorkbenchGraphNodeData>[],
  edges: Edge[],
  connection: {
    source: string | null;
    target: string | null;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }
) {
  if (!connection.source || !connection.target) {
    return "Choose both a source and a destination for this connection.";
  }
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const sourceNode = nodeMap.get(connection.source);
  const targetNode = nodeMap.get(connection.target);
  if (!sourceNode || !targetNode) {
    return "This connection points to a node that no longer exists.";
  }
  const sourceOutputs = sourceNode.data.outputs ?? [];
  const targetInputs = targetNode.data.inputs ?? [];
  if (
    connection.sourceHandle &&
    !sourceOutputs.some((output) => output.key === connection.sourceHandle)
  ) {
    return `Choose an existing output on "${sourceNode.data.label}" before connecting it.`;
  }
  if (!connection.sourceHandle && sourceOutputs.length > 1) {
    return `Choose one explicit output on "${sourceNode.data.label}" before connecting it.`;
  }
  if (
    connection.targetHandle &&
    !targetInputs.some((input) => input.key === connection.targetHandle)
  ) {
    return `Choose an existing input on "${targetNode.data.label}" before connecting it.`;
  }
  if (!connection.targetHandle && targetInputs.length > 1) {
    return `Choose one explicit input on "${targetNode.data.label}" before connecting it.`;
  }
  if (
    edges.some(
      (edge) =>
        edge.source === connection.source &&
        edge.target === connection.target &&
        (edge.sourceHandle ?? null) === (connection.sourceHandle ?? null) &&
        (edge.targetHandle ?? null) === (connection.targetHandle ?? null)
    )
  ) {
    return "That exact connection already exists.";
  }
  if (edges.length >= MAX_WORKBENCH_GRAPH_EDGES) {
    return `This flow already has the maximum ${MAX_WORKBENCH_GRAPH_EDGES} connections.`;
  }

  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = adjacency.get(edge.source) ?? [];
    targets.push(edge.target);
    adjacency.set(edge.source, targets);
  }
  const pending = [connection.target];
  const visited = new Set<string>();
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const nodeId = pending[cursor]!;
    if (nodeId === connection.source) {
      return "This connection would create a cycle. Workbench flows must remain acyclic.";
    }
    if (visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);
    pending.push(...(adjacency.get(nodeId) ?? []));
  }
  return null;
}

export function buildWorkbenchFlowPatch({
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
