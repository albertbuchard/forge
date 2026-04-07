import { useEffect, useMemo, useState } from "react";
import { Bot, Play, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  AgentIdentity,
  AiModelConnection,
  AiProcessor,
  AiProcessorAgentConfig
} from "@/lib/types";

export function AiProcessorWidget({
  processor,
  agents,
  modelConnections,
  editing,
  compact,
  onSave,
  onRun
}: {
  processor: AiProcessor;
  agents: AgentIdentity[];
  modelConnections: AiModelConnection[];
  editing: boolean;
  compact: boolean;
  onSave: (patch: Partial<AiProcessor>) => Promise<void>;
  onRun: (input: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(processor.title);
  const [promptFlow, setPromptFlow] = useState(processor.promptFlow);
  const [contextInput, setContextInput] = useState(processor.contextInput);
  const [triggerMode, setTriggerMode] = useState(processor.triggerMode);
  const [agentIds, setAgentIds] = useState<string[]>(processor.agentIds);
  const [agentConfigs, setAgentConfigs] = useState<AiProcessorAgentConfig[]>(
    processor.agentConfigs
  );
  const [runInput, setRunInput] = useState("");

  useEffect(() => {
    setTitle(processor.title);
    setPromptFlow(processor.promptFlow);
    setContextInput(processor.contextInput);
    setTriggerMode(processor.triggerMode);
    setAgentIds(processor.agentIds);
    setAgentConfigs(processor.agentConfigs);
  }, [processor]);

  const activeAgentLabels = useMemo(() => {
    const byId = new Map(agents.map((agent) => [agent.id, agent.label]));
    const labels = (agentIds.length > 0 ? agentIds : ["agt_forge_default"])
      .map((id) => byId.get(id) ?? (id === "agt_forge_default" ? "Forge Agent" : id));
    return labels.join(", ");
  }, [agentIds, agents]);

  const modelConnectionsByAgent = useMemo(() => {
    const output = new Map<string, AiModelConnection[]>();
    for (const connection of modelConnections) {
      const current = output.get(connection.agentId) ?? [];
      current.push(connection);
      output.set(connection.agentId, current);
    }
    return output;
  }, [modelConnections]);

  function updateAgentConfig(
    agentId: string,
    patch: Partial<AiProcessorAgentConfig>
  ) {
    setAgentConfigs((current) => {
      const existing =
        current.find((entry) => entry.agentId === agentId) ?? {
          agentId,
          connectionId: null,
          model: ""
        };
      return [
        ...current.filter((entry) => entry.agentId !== agentId),
        {
          ...existing,
          ...patch
        }
      ];
    });
  }

  if (!editing) {
    return (
      <div className="grid h-full gap-3 rounded-[20px] bg-white/[0.03] p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-white">
            <Bot className="size-4 text-[var(--secondary)]" />
            <span className="text-sm font-semibold">{processor.title}</span>
          </div>
          <Button size="sm" onClick={() => void onRun(runInput)}>
            <Play className="size-4" />
            Run
          </Button>
        </div>
        <div className="text-[12px] leading-5 text-white/50">
          Agents: {activeAgentLabels}
        </div>
        <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
          `/api/v1/aiproc/{processor.slug}/run`
        </div>
        <textarea
          value={runInput}
          onChange={(event) => setRunInput(event.target.value)}
          className="min-h-20 rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white outline-none"
          placeholder="Optional runtime input"
        />
        <div className="rounded-[18px] bg-black/20 p-3 text-sm leading-6 text-white/72">
          {processor.lastRunOutput?.concatenated ||
            "No output yet. Run the processor to execute the current prompt flow."}
        </div>
        {!compact && processor.promptFlow.trim() ? (
          <div className="text-[12px] leading-5 text-white/48">
            {processor.promptFlow}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid h-full gap-3 rounded-[20px] bg-white/[0.03] p-4">
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none"
        placeholder="Processor title"
      />
      <textarea
        value={promptFlow}
        onChange={(event) => setPromptFlow(event.target.value)}
        className="min-h-28 rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white outline-none"
        placeholder="Prompt flow"
      />
      <textarea
        value={contextInput}
        onChange={(event) => setContextInput(event.target.value)}
        className="min-h-20 rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white outline-none"
        placeholder="Context"
      />
      <select
        value={triggerMode}
        onChange={(event) =>
          setTriggerMode(event.target.value as AiProcessor["triggerMode"])
        }
        className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white"
      >
        <option value="manual">Manual refresh</option>
        <option value="route">Route endpoint</option>
        <option value="cron">Cron</option>
      </select>
      <div className="grid gap-2 rounded-[18px] bg-white/[0.03] p-3">
        <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
          Agents
        </div>
        <div className="grid gap-2">
          {agents.map((agent) => {
            const checked = agentIds.includes(agent.id);
            const config =
              agentConfigs.find((entry) => entry.agentId === agent.id) ?? null;
            const agentConnections = modelConnectionsByAgent.get(agent.id) ?? [];
            return (
              <div
                key={agent.id}
                className="grid gap-2 rounded-[16px] bg-white/[0.03] px-3 py-3 text-sm text-white/72"
              >
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      setAgentIds((current) =>
                        event.target.checked
                          ? [...current, agent.id]
                          : current.filter((value) => value !== agent.id)
                      );
                    }}
                  />
                  <span>{agent.label}</span>
                </label>
                {checked ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    <select
                      value={config?.connectionId ?? ""}
                      onChange={(event) =>
                        updateAgentConfig(agent.id, {
                          connectionId: event.target.value || null
                        })
                      }
                      className="rounded-[14px] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white"
                    >
                      <option value="">Default connection</option>
                      {agentConnections.map((connection) => (
                        <option key={connection.id} value={connection.id}>
                          {connection.label}
                        </option>
                      ))}
                    </select>
                    <input
                      value={config?.model ?? ""}
                      onChange={(event) =>
                        updateAgentConfig(agent.id, {
                          model: event.target.value
                        })
                      }
                      className="rounded-[14px] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
                      placeholder="Model override"
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() =>
            void onSave({
              title,
              promptFlow,
              contextInput,
              triggerMode,
              agentIds,
              agentConfigs
            })
          }
        >
          <Save className="size-4" />
          Save
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void onRun(runInput)}>
          <Play className="size-4" />
          Run
        </Button>
      </div>
    </div>
  );
}
