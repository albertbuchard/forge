import {
  Handle,
  Position,
  type Node,
  type NodeProps
} from "@xyflow/react";
import {
  Braces,
  Database,
  GitMerge,
  ListTree,
  MessageSquare,
  Send,
  Sparkles,
  SquareTerminal,
  Wand2
} from "lucide-react";
import { useState } from "react";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { useWorkbenchNodeDefinition } from "@/components/workbench/workbench-provider";
import { formatPortMeta, type WorkbenchGraphNodeData } from "@/components/workbench/workbench-flow-model";
import type { AiConnectorNodeType, ForgeBoxPortDefinition } from "@/lib/types";
import { cn } from "@/lib/utils";

export const WORKBENCH_FIELD_CLASS =
  "rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 text-sm text-[var(--ui-ink-strong)] outline-none transition placeholder:text-[var(--ui-ink-faint)] focus:border-[color-mix(in_srgb,var(--primary)_40%,transparent)] focus:bg-[var(--ui-surface-2)]";

const PORT_KIND_TONES: Record<string, string> = {
  summary:
    "border-[color-mix(in_srgb,var(--warning)_30%,transparent)] bg-[var(--ui-warning-soft)] text-[var(--warning)]",
  markdown:
    "border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[var(--ui-accent-soft)] text-[var(--primary)]",
  text: "border-[color-mix(in_srgb,var(--info)_30%,transparent)] bg-[var(--ui-info-soft)] text-[var(--info)]",
  number:
    "border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[var(--ui-success-soft)] text-[var(--success)]",
  boolean:
    "border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[var(--ui-success-soft)] text-[var(--success)]",
  entity:
    "border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[var(--ui-accent-soft)] text-[var(--primary)]",
  entity_list:
    "border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[var(--ui-accent-soft)] text-[var(--primary)]",
  context:
    "border-[color-mix(in_srgb,var(--info)_30%,transparent)] bg-[var(--ui-info-soft)] text-[var(--info)]",
  metrics:
    "border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[var(--ui-success-soft)] text-[var(--success)]",
  filters:
    "border-[color-mix(in_srgb,var(--warning)_30%,transparent)] bg-[var(--ui-warning-soft)] text-[var(--warning)]",
  record:
    "border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[var(--ui-accent-soft)] text-[var(--primary)]",
  record_list:
    "border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[var(--ui-accent-soft)] text-[var(--primary)]",
  selection:
    "border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[var(--ui-danger-soft)] text-[var(--danger)]",
  timeline:
    "border-[color-mix(in_srgb,var(--info)_30%,transparent)] bg-[var(--ui-info-soft)] text-[var(--info)]",
  json: "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]",
  object:
    "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]",
  array: "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]",
  tool: "border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[var(--ui-danger-soft)] text-[var(--danger)]"
};

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

export function PortKindBadge({
  kind
}: {
  kind: ForgeBoxPortDefinition["kind"];
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em]",
        PORT_KIND_TONES[kind] ??
          "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]"
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
          ? "border-[color-mix(in_srgb,var(--primary)_32%,transparent)] bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)] hover:bg-[var(--ui-surface-active)]"
          : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
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
          "flex items-center gap-1 px-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]",
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
            "rounded-full border border-dashed border-[var(--ui-border-subtle)] px-3 py-1.5 text-[11px] text-[var(--ui-ink-faint)]",
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
            "relative min-h-6 rounded-[16px] border px-3 py-2 text-[11px] tracking-[0.01em]",
            side === "left" ? "pl-5 text-left" : "pr-5 text-right",
            collapsed ? "bg-[var(--ui-surface-1)]" : "bg-[var(--ui-surface-2)]",
            PORT_KIND_TONES[port.kind] ??
              "border-[var(--ui-border-subtle)] text-[var(--ui-ink-soft)]"
          )}
        >
          <Handle
            type={side === "left" ? "target" : "source"}
            position={side === "left" ? Position.Left : Position.Right}
            id={port.key}
            className="!size-2.5 !border"
            style={{
              [side]: 6,
              background: "var(--primary)",
              borderColor: "var(--ui-ink-strong)"
            }}
          />
          {!collapsed ? (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span>{port.label}</span>
                <PortKindBadge kind={port.kind} />
              </div>
              <div className="mt-1 text-[10px] text-[var(--ui-ink-faint)]">
                {formatPortMeta(port)}
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function WorkbenchNodeCard(
  props: NodeProps<Node<WorkbenchGraphNodeData>>
) {
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
              ? "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--primary)_60%,transparent),color-mix(in_srgb,var(--primary)_28%,transparent))]"
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
        "min-w-[270px] rounded-[24px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-modal)] p-3 shadow-[var(--ui-shadow-floating)]",
        props.selected && "border-[color-mix(in_srgb,var(--primary)_52%,transparent)]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[var(--ui-ink-strong)]">
            {tone.icon}
            <div className="truncate text-sm font-semibold">
              {props.data.label}
            </div>
          </div>
          {props.data.description ? (
            <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--ui-ink-soft)]">
              {props.data.description}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <NodeActionButton
            label={portsCollapsed ? "Show ports" : "Hide labels"}
            onClick={() => setPortsCollapsed((current) => !current)}
          />
          <div className="rounded-full bg-[var(--ui-surface-2)] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-[var(--ui-ink-soft)]">
            {tone.badge}
          </div>
        </div>
      </div>

      {props.data.boxId ? (
        <div className="mt-3 rounded-full bg-[var(--ui-surface-2)] px-3 py-1.5 text-[11px] text-[var(--ui-ink-soft)]">
          {props.data.boxId}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {props.data.enabledToolKeys?.length ? (
          <div className="rounded-full bg-[var(--ui-surface-2)] px-3 py-1.5 text-[11px] text-[var(--ui-ink-soft)]">
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
        <div className="mt-3 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            <span>Node contract</span>
            <InfoTooltip
              content="This preview shows the shape of the values and tools this node exposes inside the flow graph."
              label="Explain node contract preview"
            />
          </div>
          <pre className="mt-2 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-[var(--ui-ink-soft)]">
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
