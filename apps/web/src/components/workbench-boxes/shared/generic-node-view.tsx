import { Handle, Position } from "@xyflow/react";
import { useState } from "react";
import type {
  WorkbenchNodeComponentProps,
  WorkbenchNodeDefinition,
  WorkbenchOutputDefinition
} from "../../../lib/workbench/nodes.js";
import { InfoTooltip } from "../../../components/ui/info-tooltip.js";
import { cn } from "../../../lib/utils.js";

const nodeEyebrowClass =
  "flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]";
const nodePillClass =
  "rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-[var(--ui-ink-soft)]";
const nodeSoftPanelClass =
  "rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-2 text-[11px] text-[var(--ui-ink-soft)]";
const nodeCodePanelClass =
  "rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-code-bg)] p-3 text-[var(--ui-code-text)]";

function describePort(port: {
  key: string;
  label: string;
  kind: string;
  modelName?: string;
  itemKind?: string;
  description?: string;
}) {
  return [
    port.kind,
    port.modelName,
    port.itemKind ? `item:${port.itemKind}` : null
  ]
    .filter(Boolean)
    .join(" · ");
}

function PortList({
  title,
  ports,
  align
}: {
  title: string;
  ports: Array<{
    key: string;
    label: string;
    kind: string;
    modelName?: string;
    itemKind?: string;
    description?: string;
  }>;
  align: "left" | "right";
}) {
  return (
    <div className="grid gap-1.5">
      <div
        className={cn(
          nodeEyebrowClass,
          align === "left" ? "text-left" : "text-right"
        )}
      >
        <span>{title}</span>
        <InfoTooltip
          content={
            align === "left"
              ? "Inputs are values this box expects from upstream nodes."
              : "Outputs are values this box publishes for downstream nodes."
          }
          label={
            align === "left" ? "Explain box inputs" : "Explain box outputs"
          }
        />
      </div>
      {ports.length === 0 ? (
        <div className="rounded-full border border-dashed border-[var(--ui-border-subtle)] px-3 py-1.5 text-[11px] text-[var(--ui-ink-faint)]">
          None
        </div>
      ) : null}
      {ports.map((port) => (
        <div
          key={port.key}
          className={cn(
            "relative rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-2 text-[11px] text-[var(--ui-ink-soft)]",
            align === "left" ? "pl-5 text-left" : "pr-5 text-right"
          )}
        >
          <Handle
            type={align === "left" ? "target" : "source"}
            position={align === "left" ? Position.Left : Position.Right}
            id={port.key}
            className="!size-2.5 !border !border-[var(--ui-surface-1)] !bg-[var(--primary)]"
            style={{
              [align]: 6
            }}
          />
          <div>{port.label}</div>
          <div className="mt-1 text-[10px] text-[var(--ui-ink-faint)]">
            {describePort(port)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function createGenericWorkbenchNodeView(
  definition: Pick<
    WorkbenchNodeDefinition,
    "title" | "description" | "inputs" | "params" | "output" | "tools"
  >
) {
  return function GenericWorkbenchNodeView(
    _props: WorkbenchNodeComponentProps
  ) {
    const [schemaOpen, setSchemaOpen] = useState(false);
    return (
      <div className="min-w-[280px] rounded-[24px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-modal)] p-3 shadow-[var(--ui-shadow-floating)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[var(--ui-ink-strong)]">
              {definition.title}
            </div>
            <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--ui-ink-soft)]">
              {definition.description}
            </div>
          </div>
          <div className={nodePillClass}>box</div>
        </div>

        {definition.params.length > 0 ? (
          <div className={`mt-3 ${nodeSoftPanelClass}`}>
            {definition.params.length} param
            {definition.params.length === 1 ? "" : "s"} configurable in the flow
            editor
          </div>
        ) : null}

        {definition.tools.length > 0 ? (
          <div className={`mt-2 ${nodeSoftPanelClass}`}>
            {definition.tools.length} tool
            {definition.tools.length === 1 ? "" : "s"} available
          </div>
        ) : null}
        <div className="mt-2">
          <button
            type="button"
            className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-1.5 text-[11px] text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
            onClick={() => setSchemaOpen((current) => !current)}
          >
            {schemaOpen ? "Hide schema" : "Preview schema"}
          </button>
        </div>

        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <PortList title="Inputs" ports={definition.inputs} align="left" />
          <PortList title="Outputs" ports={definition.output} align="right" />
        </div>
        {schemaOpen ? (
          <div className={`mt-3 ${nodeCodePanelClass}`}>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              <span>Box contract</span>
              <InfoTooltip
                content="This preview summarizes what the box consumes, publishes, and what tools it can expose to AI nodes."
                label="Explain box contract preview"
              />
            </div>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap text-[11px] leading-5">
              {JSON.stringify(
                {
                  inputs: definition.inputs.map(
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
                  ),
                  outputs: definition.output.map(
                    ({
                      key,
                      kind,
                      required,
                      description,
                      modelName,
                      itemKind,
                      shape,
                      exampleValue
                    }: WorkbenchOutputDefinition) => ({
                      key,
                      kind,
                      required: Boolean(required),
                      description,
                      modelName,
                      itemKind,
                      shape,
                      exampleValue
                    })
                  ),
                  tools: definition.tools.map(
                    ({ key, accessMode, argsSchema }) => ({
                      key,
                      accessMode,
                      argsSchema
                    })
                  )
                },
                null,
                2
              )}
            </pre>
          </div>
        ) : null}
      </div>
    );
  };
}
