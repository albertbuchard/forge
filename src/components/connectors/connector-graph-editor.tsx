import "@xyflow/react/dist/style.css";
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps
} from "@xyflow/react";
import { Cpu, Database, MessageSquare, SendHorizontal, SquareTerminal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  AiConnector,
  AiConnectorEdge,
  AiConnectorKind,
  AiConnectorNode,
  AiConnectorRun,
  ForgeBoxCatalogEntry
} from "@/lib/types";
import { cn } from "@/lib/utils";

type ConnectorNodeData = AiConnectorNode["data"] & {
  nodeType: AiConnectorNode["type"];
};

function graphNodeFromConnector(node: AiConnectorNode): Node<ConnectorNodeData> {
  return {
    id: node.id,
    type: "connector",
    position: node.position,
    data: {
      ...node.data,
      nodeType: node.type
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
    animated: false,
    style: {
      stroke: "rgba(194, 198, 255, 0.42)",
      strokeWidth: 1.8
    }
  };
}

function connectorNodeFromGraph(node: Node<ConnectorNodeData>): AiConnectorNode {
  return {
    id: node.id,
    type: node.data.nodeType,
    position: node.position,
    data: {
      label: node.data.label,
      description: node.data.description,
      boxId: node.data.boxId ?? null,
      prompt: node.data.prompt ?? "",
      systemPrompt: node.data.systemPrompt ?? "",
      outputKey: node.data.outputKey ?? "",
      enabledToolKeys: node.data.enabledToolKeys ?? [],
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

function nodeTone(nodeType: AiConnectorNode["type"]) {
  switch (nodeType) {
    case "box_input":
      return {
        icon: <Database className="size-4" />,
        badge: "box",
        accent: "rgba(121, 196, 255, 0.7)"
      };
    case "chat":
      return {
        icon: <MessageSquare className="size-4" />,
        badge: "chat",
        accent: "rgba(117, 255, 201, 0.7)"
      };
    case "functor":
      return {
        icon: <Cpu className="size-4" />,
        badge: "functor",
        accent: "rgba(255, 210, 121, 0.72)"
      };
    case "output":
      return {
        icon: <SendHorizontal className="size-4" />,
        badge: "output",
        accent: "rgba(213, 160, 255, 0.78)"
      };
    default:
      return {
        icon: <SquareTerminal className="size-4" />,
        badge: "input",
        accent: "rgba(255, 255, 255, 0.56)"
      };
  }
}

function ConnectorNodeCard(props: NodeProps<Node<ConnectorNodeData>>) {
  const tone = nodeTone(props.data.nodeType);
  return (
    <div
      className="min-w-[240px] rounded-[22px] border border-white/10 bg-[#11172b]/95 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.38)] backdrop-blur"
      style={{
        boxShadow: props.selected
          ? `0 0 0 1px ${tone.accent}, 0 24px 80px rgba(0,0,0,0.38)`
          : undefined
      }}
    >
      {props.data.nodeType !== "output" ? (
        <Handle
          type="target"
          position={Position.Left}
          className="!size-3 !border !border-white/90 !bg-[#9fb3ff]"
        />
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-white">
            {tone.icon}
            <div className="text-sm font-semibold">{props.data.label}</div>
          </div>
          <div className="text-[12px] text-white/48">{props.data.description}</div>
        </div>
        <div
          className="rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-950"
          style={{ backgroundColor: tone.accent }}
        >
          {tone.badge}
        </div>
      </div>
      {props.data.boxId ? (
        <div className="mt-3 rounded-full bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/68">
          {props.data.boxId}
        </div>
      ) : null}
      {props.data.prompt ? (
        <div className="mt-3 line-clamp-3 rounded-[16px] bg-white/[0.04] px-3 py-2 text-[12px] leading-5 text-white/72">
          {props.data.prompt}
        </div>
      ) : null}
      {props.data.enabledToolKeys?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {props.data.enabledToolKeys.map((toolKey) => (
            <span
              key={toolKey}
              className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/68"
            >
              {toolKey}
            </span>
          ))}
        </div>
      ) : null}
      {props.data.nodeType !== "user_input" ? (
        <Handle
          type="source"
          position={Position.Right}
          className="!size-3 !border !border-white/90 !bg-[#9fb3ff]"
        />
      ) : null}
    </div>
  );
}

const NODE_TYPES = {
  connector: ConnectorNodeCard
};

function nextPosition(nodes: Node[]) {
  return {
    x: 80 + (nodes.length % 3) * 280,
    y: 80 + Math.floor(nodes.length / 3) * 180
  };
}

function createNodeTemplate(
  nodeType: AiConnectorNode["type"],
  label: string,
  nodes: Node[],
  extras: Partial<ConnectorNodeData> = {}
): Node<ConnectorNodeData> {
  return {
    id: `node_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
    type: "connector",
    position: nextPosition(nodes),
    data: {
      nodeType,
      label,
      description:
        nodeType === "box_input"
          ? "Registered Forge box input."
          : nodeType === "functor"
            ? "Single transformation node."
            : nodeType === "chat"
              ? "Conversational connector node."
              : nodeType === "output"
                ? "Published connector output."
                : "Manual runtime input.",
      prompt: "",
      systemPrompt: "",
      outputKey: nodeType === "output" ? "primary" : "",
      enabledToolKeys: [],
      modelConfig: {
        connectionId: null,
        provider: null,
        baseUrl: null,
        model: "",
        thinking: null,
        verbosity: null
      },
      ...extras
    }
  };
}

export function ConnectorGraphEditor({
  connector,
  boxes,
  modelConnections,
  onSave,
  onDelete,
  onRun,
  onChat,
  runs
}: {
  connector: AiConnector;
  boxes: ForgeBoxCatalogEntry[];
  modelConnections: Array<{
    id: string;
    label: string;
    provider: string;
    model: string;
    baseUrl: string;
  }>;
  onSave: (patch: Partial<AiConnector>) => Promise<void>;
  onDelete: () => Promise<void>;
  onRun: (input: string, conversationId?: string | null) => Promise<void>;
  onChat: (input: string, conversationId?: string | null) => Promise<void>;
  runs: AiConnectorRun[];
}) {
  const [title, setTitle] = useState(connector.title);
  const [description, setDescription] = useState(connector.description);
  const [kind, setKind] = useState<AiConnectorKind>(connector.kind);
  const [nodes, setNodes] = useState<Node<ConnectorNodeData>[]>(() =>
    connector.graph.nodes.map(graphNodeFromConnector)
  );
  const [edges, setEdges] = useState<Edge[]>(() =>
    connector.graph.edges.map(graphEdgeFromConnector)
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [userInput, setUserInput] = useState("");

  useEffect(() => {
    setTitle(connector.title);
    setDescription(connector.description);
    setKind(connector.kind);
    setNodes(connector.graph.nodes.map(graphNodeFromConnector));
    setEdges(connector.graph.edges.map(graphEdgeFromConnector));
  }, [connector]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  const filteredBoxes = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) {
      return boxes;
    }
    return boxes.filter((box) =>
      [box.label, box.description, box.category, box.routePath ?? "", box.surfaceId ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [boxes, search]);

  function updateSelectedNode(
    updater: (node: Node<ConnectorNodeData>) => Node<ConnectorNodeData>
  ) {
    if (!selectedNodeId) {
      return;
    }
    setNodes((current) =>
      current.map((node) => (node.id === selectedNodeId ? updater(node) : node))
    );
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

  return (
    <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
      <div className="grid gap-4">
        <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
          <div className="text-[12px] uppercase tracking-[0.16em] text-white/40">
            Add nodes
          </div>
          <div className="mt-3 grid gap-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search boxes"
              className="w-full rounded-[16px] border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-white/28"
            />
            <div className="grid gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setNodes((current) => [
                    ...current,
                    createNodeTemplate("user_input", "User input", current)
                  ])
                }
              >
                Add user input
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setNodes((current) => [
                    ...current,
                    createNodeTemplate("functor", "Functor", current)
                  ])
                }
              >
                Add functor
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setNodes((current) => [
                    ...current,
                    createNodeTemplate("chat", "Chat connector", current)
                  ])
                }
              >
                Add chat node
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setNodes((current) => [
                    ...current,
                    createNodeTemplate("output", "Output", current)
                  ])
                }
              >
                Add output
              </Button>
            </div>
            <div className="mt-3 text-[12px] uppercase tracking-[0.16em] text-white/40">
              Forge boxes
            </div>
            <div className="grid max-h-[28rem] gap-2 overflow-auto pr-1">
              {filteredBoxes.map((box) => (
                <button
                  key={box.boxId}
                  type="button"
                  className="rounded-[18px] border border-white/8 bg-white/[0.04] px-3 py-3 text-left transition hover:bg-white/[0.07]"
                  onClick={() =>
                    setNodes((current) => [
                      ...current,
                      createNodeTemplate("box_input", box.label, current, {
                        description: box.description,
                        boxId: box.boxId,
                        enabledToolKeys: box.toolAdapters.map((tool) => tool.key)
                      })
                    ])
                  }
                >
                  <div className="text-sm font-medium text-white">{box.label}</div>
                  <div className="mt-1 text-[12px] leading-5 text-white/50">
                    {box.description}
                  </div>
                  <div className="mt-2 text-[11px] uppercase tracking-[0.14em] text-white/34">
                    {box.category}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="min-w-[16rem] flex-1 rounded-[16px] border border-white/10 bg-black/20 px-4 py-2.5 text-white outline-none placeholder:text-white/28"
          />
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as AiConnectorKind)}
            className="rounded-[16px] border border-white/10 bg-black/20 px-4 py-2.5 text-white outline-none"
          >
            <option value="functor">Functor</option>
            <option value="chat">Chat</option>
          </select>
          <Button type="button" variant="primary" onClick={() => void handleSave()}>
            Save connector
          </Button>
          <Button type="button" variant="secondary" onClick={() => void onDelete()}>
            Delete
          </Button>
        </div>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          placeholder="Connector description"
          className="w-full rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-white/28"
        />
        <div className="h-[70vh] overflow-hidden rounded-[28px] border border-white/8 bg-[#0d1324]">
          <ReactFlow
            nodeTypes={NODE_TYPES}
            nodes={nodes}
            edges={edges}
            onNodesChange={(changes) =>
              setNodes((current) =>
                applyNodeChanges<Node<ConnectorNodeData>>(changes, current)
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
                    style: { stroke: "rgba(194, 198, 255, 0.42)", strokeWidth: 1.8 }
                  },
                  current
                )
              )
            }
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            fitView
            className="bg-transparent"
          >
            <Background color="rgba(255,255,255,0.08)" gap={22} />
            <MiniMap
              pannable
              zoomable
              nodeColor={() => "rgba(154, 168, 255, 0.55)"}
              maskColor="rgba(7,10,20,0.52)"
            />
            <Controls />
          </ReactFlow>
        </div>
      </div>

      <div className="grid gap-4">
        <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
          <div className="text-[12px] uppercase tracking-[0.16em] text-white/40">
            Node inspector
          </div>
          {selectedNode ? (
            <div className="mt-3 grid gap-3">
              <input
                value={selectedNode.data.label}
                onChange={(event) =>
                  updateSelectedNode((node) => ({
                    ...node,
                    data: { ...node.data, label: event.target.value }
                  }))
                }
                className="w-full rounded-[16px] border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
              />
              <textarea
                rows={2}
                value={selectedNode.data.description}
                onChange={(event) =>
                  updateSelectedNode((node) => ({
                    ...node,
                    data: { ...node.data, description: event.target.value }
                  }))
                }
                className="w-full rounded-[16px] border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
              />
              {selectedNode.data.nodeType === "box_input" ? (
                <>
                  <select
                    value={selectedNode.data.boxId ?? ""}
                    onChange={(event) => {
                      const nextBox = boxes.find((box) => box.boxId === event.target.value);
                      updateSelectedNode((node) => ({
                        ...node,
                        data: {
                          ...node.data,
                          boxId: event.target.value,
                          label: nextBox?.label ?? node.data.label,
                          description: nextBox?.description ?? node.data.description,
                          enabledToolKeys:
                            nextBox?.toolAdapters.map((tool) => tool.key) ?? []
                        }
                      }));
                    }}
                    className="rounded-[16px] border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                  >
                    <option value="">Select Forge box</option>
                    {boxes.map((box) => (
                      <option key={box.boxId} value={box.boxId}>
                        {box.label}
                      </option>
                    ))}
                  </select>
                  {selectedNode.data.boxId ? (
                    <div className="rounded-[16px] bg-white/[0.04] p-3 text-[12px] leading-5 text-white/62">
                      {(boxes.find((box) => box.boxId === selectedNode.data.boxId)?.toolAdapters ?? []).map((tool) => (
                        <div key={tool.key}>{tool.key}</div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
              {(selectedNode.data.nodeType === "functor" ||
                selectedNode.data.nodeType === "chat") ? (
                <>
                  <textarea
                    rows={5}
                    value={selectedNode.data.prompt ?? ""}
                    onChange={(event) =>
                      updateSelectedNode((node) => ({
                        ...node,
                        data: { ...node.data, prompt: event.target.value }
                      }))
                    }
                    placeholder="Prompt"
                    className="w-full rounded-[16px] border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                  />
                  <textarea
                    rows={3}
                    value={selectedNode.data.systemPrompt ?? ""}
                    onChange={(event) =>
                      updateSelectedNode((node) => ({
                        ...node,
                        data: { ...node.data, systemPrompt: event.target.value }
                      }))
                    }
                    placeholder="System prompt"
                    className="w-full rounded-[16px] border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                  />
                  <select
                    value={selectedNode.data.modelConfig?.connectionId ?? ""}
                    onChange={(event) => {
                      const nextConnection = modelConnections.find(
                        (connection) => connection.id === event.target.value
                      );
                      updateSelectedNode((node) => ({
                        ...node,
                        data: {
                          ...node.data,
                          modelConfig: {
                            connectionId: nextConnection?.id ?? null,
                            provider: (nextConnection?.provider as any) ?? null,
                            baseUrl: nextConnection?.baseUrl ?? null,
                            model: nextConnection?.model ?? "",
                            thinking: node.data.modelConfig?.thinking ?? null,
                            verbosity: node.data.modelConfig?.verbosity ?? null
                          }
                        }
                      }));
                    }}
                    className="rounded-[16px] border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                  >
                    <option value="">Select model connection</option>
                    {modelConnections.map((connection) => (
                      <option key={connection.id} value={connection.id}>
                        {connection.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={selectedNode.data.modelConfig?.thinking ?? ""}
                    onChange={(event) =>
                      updateSelectedNode((node) => ({
                        ...node,
                        data: {
                          ...node.data,
                          modelConfig: {
                            ...node.data.modelConfig,
                            connectionId:
                              node.data.modelConfig?.connectionId ?? null,
                            provider: node.data.modelConfig?.provider ?? null,
                            baseUrl: node.data.modelConfig?.baseUrl ?? null,
                            model: node.data.modelConfig?.model ?? "",
                            thinking: event.target.value || null,
                            verbosity: node.data.modelConfig?.verbosity ?? null
                          }
                        }
                      }))
                    }
                    placeholder="Thinking effort"
                    className="rounded-[16px] border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                  />
                  <input
                    value={selectedNode.data.modelConfig?.verbosity ?? ""}
                    onChange={(event) =>
                      updateSelectedNode((node) => ({
                        ...node,
                        data: {
                          ...node.data,
                          modelConfig: {
                            ...node.data.modelConfig,
                            connectionId:
                              node.data.modelConfig?.connectionId ?? null,
                            provider: node.data.modelConfig?.provider ?? null,
                            baseUrl: node.data.modelConfig?.baseUrl ?? null,
                            model: node.data.modelConfig?.model ?? "",
                            thinking: node.data.modelConfig?.thinking ?? null,
                            verbosity: event.target.value || null
                          }
                        }
                      }))
                    }
                    placeholder="Verbosity"
                    className="rounded-[16px] border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                  />
                  <textarea
                    rows={3}
                    value={(selectedNode.data.enabledToolKeys ?? []).join(", ")}
                    onChange={(event) =>
                      updateSelectedNode((node) => ({
                        ...node,
                        data: {
                          ...node.data,
                          enabledToolKeys: event.target.value
                            .split(",")
                            .map((entry) => entry.trim())
                            .filter(Boolean)
                        }
                      }))
                    }
                    placeholder="Enabled tool keys, comma separated"
                    className="w-full rounded-[16px] border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                  />
                </>
              ) : null}
              {selectedNode.data.nodeType === "output" ? (
                <input
                  value={selectedNode.data.outputKey ?? ""}
                  onChange={(event) =>
                    updateSelectedNode((node) => ({
                      ...node,
                      data: { ...node.data, outputKey: event.target.value }
                    }))
                  }
                  placeholder="Output key"
                  className="rounded-[16px] border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                />
              ) : null}
            </div>
          ) : (
            <div className="mt-3 text-sm text-white/56">
              Select a node to edit its label, prompt, model, or box binding.
            </div>
          )}
        </div>

        <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
          <div className="text-[12px] uppercase tracking-[0.16em] text-white/40">
            Run connector
          </div>
          <textarea
            rows={4}
            value={userInput}
            onChange={(event) => setUserInput(event.target.value)}
            placeholder="User input for run or chat"
            className="mt-3 w-full rounded-[16px] border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="primary" onClick={() => void onRun(userInput)}>
              Run
            </Button>
            <Button type="button" variant="secondary" onClick={() => void onChat(userInput)}>
              Chat
            </Button>
          </div>
          <div className="mt-4 grid gap-3">
            {runs.slice(0, 4).map((run) => (
              <div
                key={run.id}
                className={cn(
                  "rounded-[18px] border p-3",
                  run.status === "failed"
                    ? "border-rose-400/20 bg-rose-500/5"
                    : "border-white/8 bg-white/[0.04]"
                )}
              >
                <div className="flex items-center justify-between gap-3 text-[12px] text-white/50">
                  <span>{run.mode}</span>
                  <span>{new Date(run.createdAt).toLocaleString()}</span>
                </div>
                <div className="mt-2 text-sm text-white">{run.result?.primaryText ?? run.error ?? "No output yet."}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
