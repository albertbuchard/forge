import * as Dialog from "@radix-ui/react-dialog";
import type { Node } from "@xyflow/react";
import {
  Bot,
  Braces,
  GitMerge,
  ListTree,
  MessageSquare,
  Play,
  Save,
  Send,
  Sparkles,
  SquareTerminal,
  Trash2,
  Wand2
} from "lucide-react";
import type { ReactNode } from "react";
import {
  FacetedTokenSearch,
  type FacetedTokenOption
} from "@/components/search/faceted-token-search";
import { FlowField } from "@/components/flows/question-flow-dialog";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { PublicInputEditor } from "@/components/workbench/workbench-contract-editors";
import {
  formatWorkbenchParamValue,
  type WorkbenchGraphNodeData
} from "@/components/workbench/workbench-flow-model";
import { WORKBENCH_FIELD_CLASS } from "@/components/workbench/workbench-node-card";
import type {
  AiConnectorKind,
  AiConnectorNodeType,
  AiConnectorPublicInput,
  AiConnectorRun,
  ForgeBoxCatalogEntry
} from "@/lib/types";

export function WorkbenchDialog({
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
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--ui-overlay-backdrop)] backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-x-4 bottom-4 top-4 z-50 mx-auto flex max-w-[min(44rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-[32px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-modal)] shadow-[var(--ui-shadow-floating)] md:left-1/2 md:right-auto md:top-[8vh] md:h-[min(82vh,58rem)] md:w-[min(44rem,calc(100vw-1.25rem))] md:-translate-x-1/2 md:bottom-auto">
          <div className="flex items-start justify-between gap-4 border-b border-[var(--ui-border-subtle)] px-5 py-4 backdrop-blur-xl">
            <div>
              <Dialog.Title className="font-display text-[1.28rem] tracking-[-0.04em] text-[var(--ui-ink-strong)]">
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
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

const nodeTypeOptions: Array<{
  type: AiConnectorNodeType;
  label: string;
  icon: ReactNode;
}> = [
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
  {
    type: "chat",
    label: "Chat",
    icon: <Bot className="size-4" />
  },
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
];

export function WorkbenchAddNodeDialog({
  open,
  onOpenChange,
  boxQuery,
  onBoxQueryChange,
  boxOptions,
  boxFilters,
  onBoxFiltersChange,
  filteredBoxes,
  onAddNodeType,
  onAddBox
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boxQuery: string;
  onBoxQueryChange: (query: string) => void;
  boxOptions: FacetedTokenOption[];
  boxFilters: string[];
  onBoxFiltersChange: (filters: string[]) => void;
  filteredBoxes: ForgeBoxCatalogEntry[];
  onAddNodeType: (nodeType: AiConnectorNodeType) => void;
  onAddBox: (box: ForgeBoxCatalogEntry) => void;
}) {
  return (
    <WorkbenchDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add node"
      description="Add a Forge box, AI node, or utility node to the flow."
    >
      <div className="grid gap-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {nodeTypeOptions.map((entry) => (
            <button
              key={entry.type}
              type="button"
              className="flex items-center gap-3 rounded-[20px] bg-white/[0.04] px-4 py-3 text-left text-white transition hover:bg-white/[0.08]"
              onClick={() => onAddNodeType(entry.type)}
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
          onQueryChange={onBoxQueryChange}
          options={boxOptions}
          selectedOptionIds={boxFilters}
          onSelectedOptionIdsChange={onBoxFiltersChange}
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
              onClick={() => onAddBox(box)}
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
  );
}

export function WorkbenchFlowSettingsDialog({
  open,
  onOpenChange,
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  kind,
  onKindChange,
  publicInputs,
  onPublicInputsChange,
  nodes,
  flowId,
  onDelete,
  onSave
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onTitleChange: (title: string) => void;
  description: string;
  onDescriptionChange: (description: string) => void;
  kind: AiConnectorKind;
  onKindChange: (kind: AiConnectorKind) => void;
  publicInputs: AiConnectorPublicInput[];
  onPublicInputsChange: (inputs: AiConnectorPublicInput[]) => void;
  nodes: Node<WorkbenchGraphNodeData>[];
  flowId: string;
  onDelete: () => Promise<void>;
  onSave: () => Promise<void>;
}) {
  return (
    <WorkbenchDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Flow settings"
      description="Edit the flow identity and persistence without covering the graph with permanent forms."
    >
      <div className="grid gap-3">
        <input
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="Flow title"
          className={WORKBENCH_FIELD_CLASS}
        />
        <textarea
          rows={4}
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder="Flow description"
          className={WORKBENCH_FIELD_CLASS}
        />
        <select
          value={kind}
          onChange={(event) =>
            onKindChange(event.target.value as AiConnectorKind)
          }
          className={WORKBENCH_FIELD_CLASS}
        >
          <option value="functor">Functor flow</option>
          <option value="chat">Chat flow</option>
        </select>
        <PublicInputEditor
          inputs={publicInputs}
          nodes={nodes}
          onChange={onPublicInputsChange}
        />
        <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/58">
          {flowId}
        </div>
        <div className="flex flex-wrap justify-between gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void onDelete();
            }}
          >
            <Trash2 className="size-4" />
            Delete flow
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              void onSave().then(() => onOpenChange(false));
            }}
          >
            <Save className="size-4" />
            Save settings
          </Button>
        </div>
      </div>
    </WorkbenchDialog>
  );
}

function parseRunInputValue(raw: string) {
  if (!raw.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function WorkbenchRunFlowDialog({
  open,
  onOpenChange,
  runError,
  graphIssues,
  hasAiNodes,
  modelConnectionCount,
  publicInputs,
  runInputs,
  onRunInputChange,
  shouldShowLegacyUserInput,
  userInput,
  onUserInputChange,
  debugEnabled,
  onDebugEnabledChange,
  onRun,
  onChat,
  runs
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runError: string | null;
  graphIssues: string[];
  hasAiNodes: boolean;
  modelConnectionCount: number;
  publicInputs: AiConnectorPublicInput[];
  runInputs: Record<string, unknown>;
  onRunInputChange: (key: string, value: unknown) => void;
  shouldShowLegacyUserInput: boolean;
  userInput: string;
  onUserInputChange: (userInput: string) => void;
  debugEnabled: boolean;
  onDebugEnabledChange: (debugEnabled: boolean) => void;
  onRun: () => void;
  onChat: () => void;
  runs: AiConnectorRun[];
}) {
  return (
    <WorkbenchDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Run flow"
      description="Run the flow or chat with it and keep the debug trace for every node."
    >
      <div className="grid gap-3">
        {runError ? (
          <div className="rounded-[20px] border border-[color-mix(in_srgb,var(--danger)_28%,transparent)] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm leading-6 text-[var(--danger)]">
            {runError}
          </div>
        ) : null}
        {!runError && graphIssues.length > 0 ? (
          <div className="rounded-[20px] border border-[color-mix(in_srgb,var(--warning)_28%,transparent)] bg-[var(--ui-warning-soft)] px-4 py-3 text-sm leading-6 text-[var(--warning)]">
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
        {!runError && hasAiNodes && modelConnectionCount === 0 ? (
          <div className="rounded-[20px] border border-[color-mix(in_srgb,var(--info)_28%,transparent)] bg-[var(--ui-info-soft)] px-4 py-3 text-sm leading-6 text-[var(--info)]">
            This flow contains AI nodes, but Forge does not have a model
            connection yet. Open Settings &gt; Models, add one connection, then
            come back and run the flow.
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
                    inputDefinition.description || "Typed input for this flow."
                  }
                >
                  {inputDefinition.kind === "boolean" ? (
                    <label className="flex items-center gap-2 text-sm text-white/68">
                      <input
                        type="checkbox"
                        checked={Boolean(runInputs[inputDefinition.key])}
                        onChange={(event) =>
                          onRunInputChange(
                            inputDefinition.key,
                            event.target.checked
                          )
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
                        onRunInputChange(
                          inputDefinition.key,
                          event.target.value.trim().length === 0
                            ? undefined
                            : Number(event.target.value)
                        )
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
                      onChange={(event) =>
                        onRunInputChange(
                          inputDefinition.key,
                          parseRunInputValue(event.target.value)
                        )
                      }
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
                        onRunInputChange(
                          inputDefinition.key,
                          event.target.value
                        )
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
            onChange={(event) => onUserInputChange(event.target.value)}
            placeholder="User input"
            className={WORKBENCH_FIELD_CLASS}
          />
        ) : null}
        <label className="flex items-center gap-2 text-sm text-white/64">
          <input
            type="checkbox"
            checked={debugEnabled}
            onChange={(event) => onDebugEnabledChange(event.target.checked)}
          />
          Return debug trace
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="primary" onClick={onRun}>
            <Play className="size-4" />
            Run
          </Button>
          <Button type="button" variant="secondary" onClick={onChat}>
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
  );
}
