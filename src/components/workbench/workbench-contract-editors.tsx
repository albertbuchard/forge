import type { Node } from "@xyflow/react";
import { FlowField } from "@/components/flows/question-flow-dialog";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import {
  PORT_KIND_OPTIONS,
  createPortDefinition,
  createPublicInputDefinition,
  formatWorkbenchParamValue,
  parseWorkbenchParamValue,
  type WorkbenchGraphNodeData
} from "@/components/workbench/workbench-flow-model";
import {
  PortKindBadge,
  WORKBENCH_FIELD_CLASS
} from "@/components/workbench/workbench-node-card";
import type {
  AiConnectorPublicInput,
  ForgeBoxPortDefinition,
  ForgeBoxPortShapeField
} from "@/lib/types";

const contractPanelClassName =
  "grid gap-3 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4";
const contractItemClassName =
  "grid gap-3 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4";
const contractNestedItemClassName =
  "grid gap-3 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4";
const contractEmptyClassName =
  "rounded-[18px] border border-dashed border-[var(--ui-border-strong)] px-4 py-3 text-sm text-[var(--ui-ink-faint)]";
const contractTitleClassName =
  "flex items-center gap-2 text-sm font-medium text-[var(--ui-ink-strong)]";
const contractMutedClassName = "text-sm leading-6 text-[var(--ui-ink-soft)]";
const contractCheckboxClassName =
  "flex items-center gap-2 text-sm text-[var(--ui-ink-medium)]";

function updatePortAt(
  ports: ForgeBoxPortDefinition[],
  index: number,
  next: Partial<ForgeBoxPortDefinition>
) {
  return ports.map((entry, entryIndex) =>
    entryIndex === index ? { ...entry, ...next } : entry
  );
}

function updateShapeAt(
  ports: ForgeBoxPortDefinition[],
  portIndex: number,
  fieldIndex: number,
  next: Partial<ForgeBoxPortShapeField>
) {
  return ports.map((entry, entryIndex) =>
    entryIndex === portIndex
      ? {
          ...entry,
          shape: (entry.shape ?? []).map((shapeEntry, shapeIndex) =>
            shapeIndex === fieldIndex
              ? { ...shapeEntry, ...next }
              : shapeEntry
          )
        }
      : entry
  );
}

function createShapeField(): ForgeBoxPortShapeField {
  return {
    key: `field_${crypto.randomUUID().replaceAll("-", "").slice(0, 4)}`,
    label: "New field",
    kind: "text",
    required: false
  };
}

export function PortDefinitionEditor({
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
    <div className={contractPanelClassName}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className={contractTitleClassName}>
            <span>{title}</span>
            <InfoTooltip
              content={description}
              label={`Explain ${title.toLowerCase()}`}
            />
          </div>
          <div className={`mt-1 ${contractMutedClassName}`}>
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
          <div className={contractEmptyClassName}>No {prefix}s defined yet.</div>
        ) : null}
        {ports.map((port, index) => (
          <div
            key={`${prefix}-${port.key}-${index}`}
            className={contractItemClassName}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <PortKindBadge kind={port.kind} />
                <span className="text-sm font-medium text-[var(--ui-ink-strong)]">
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
                    onChange(updatePortAt(ports, index, { key: event.target.value }))
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
                    onChange(updatePortAt(ports, index, { label: event.target.value }))
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
                      updatePortAt(ports, index, {
                        kind: event.target.value as ForgeBoxPortDefinition["kind"]
                      })
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
                      updatePortAt(ports, index, {
                        modelName: event.target.value || undefined
                      })
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
                      updatePortAt(ports, index, {
                        itemKind: event.target.value || undefined
                      })
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
                      updatePortAt(ports, index, {
                        exampleValue: event.target.value || undefined
                      })
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
                    updatePortAt(ports, index, {
                      description: event.target.value || undefined
                    })
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

            <details className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
              <summary className="cursor-pointer text-sm font-medium text-[var(--ui-ink-strong)]">
                Shape fields
              </summary>
              <div className="mt-3 grid gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className={contractMutedClassName}>
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
                                shape: [...(entry.shape ?? []), createShapeField()]
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
                  <div className={contractEmptyClassName}>
                    No explicit structure fields yet.
                  </div>
                ) : null}
                {(port.shape ?? []).map((field, fieldIndex) => (
                  <div
                    key={`${port.key}-shape-${field.key}-${fieldIndex}`}
                    className={contractNestedItemClassName}
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
                                      (_, shapeIndex) => shapeIndex !== fieldIndex
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
                            updateShapeAt(ports, index, fieldIndex, {
                              key: event.target.value
                            })
                          )
                        }
                        placeholder="field_key"
                        className={WORKBENCH_FIELD_CLASS}
                      />
                      <input
                        value={field.label}
                        onChange={(event) =>
                          onChange(
                            updateShapeAt(ports, index, fieldIndex, {
                              label: event.target.value
                            })
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
                            updateShapeAt(ports, index, fieldIndex, {
                              kind: event.target.value as ForgeBoxPortDefinition["kind"]
                            })
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
                      <label className="flex items-center gap-2 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 text-sm text-[var(--ui-ink-medium)]">
                        <input
                          type="checkbox"
                          checked={Boolean(field.required)}
                          onChange={(event) =>
                            onChange(
                              updateShapeAt(ports, index, fieldIndex, {
                                required: event.target.checked
                              })
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
                          updateShapeAt(ports, index, fieldIndex, {
                            description: event.target.value || undefined
                          })
                        )
                      }
                      placeholder="What should this field contain?"
                      className={WORKBENCH_FIELD_CLASS}
                    />
                  </div>
                ))}
              </div>
            </details>

            <label className={contractCheckboxClassName}>
              <input
                type="checkbox"
                checked={Boolean(port.required)}
                onChange={(event) =>
                  onChange(
                    updatePortAt(ports, index, {
                      required: event.target.checked
                    })
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

export function PublicInputEditor({
  inputs,
  nodes,
  onChange
}: {
  inputs: AiConnectorPublicInput[];
  nodes: Node<WorkbenchGraphNodeData>[];
  onChange: (inputs: AiConnectorPublicInput[]) => void;
}) {
  return (
    <div className={contractPanelClassName}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className={contractTitleClassName}>
            <span>Flow inputs</span>
            <InfoTooltip
              content="These are the typed inputs your Workbench flow exposes to the API and the Run modal."
              label="Explain flow inputs"
            />
          </div>
          <div className={`mt-1 ${contractMutedClassName}`}>
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
        <div className={contractEmptyClassName}>
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
              className={contractItemClassName}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <PortKindBadge kind={input.kind} />
                  <span className="text-sm font-medium text-[var(--ui-ink-strong)]">
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
                        kind: event.target.value as ForgeBoxPortDefinition["kind"]
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

              <label className={contractCheckboxClassName}>
                <input
                  type="checkbox"
                  checked={Boolean(input.required)}
                  onChange={(event) =>
                    updateInput({ required: event.target.checked })
                  }
                />
                Required input
              </label>

              <div className="grid gap-2 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3">
                <div className={contractTitleClassName}>
                  Bindings
                  <InfoTooltip
                    content="Bind this public input to one or more node inputs or parameters. If you leave bindings empty and a node uses the same key, Forge will bind it automatically by key."
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
                      className="grid gap-3 rounded-[16px] bg-[var(--ui-surface-2)] p-3 md:grid-cols-[1.2fr_1fr_1fr_auto]"
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
