import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { SettingsSectionNav } from "@/components/settings/settings-section-nav";
import { XpCommandDeck } from "@/components/xp/xp-command-deck";
import { PageHero } from "@/components/shell/page-hero";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MetricTile } from "@/components/ui/metric-tile";
import { ErrorState } from "@/components/ui/page-state";
import { Textarea } from "@/components/ui/textarea";
import {
  createManualRewardGrant,
  ensureOperatorSession,
  getXpMetrics,
  listRewardLedger,
  listRewardRules,
  patchRewardRule
} from "@/lib/api";
import type { RewardRule } from "@/lib/types";

type RewardRuleFormValues = {
  title: string;
  description: string;
  active: boolean;
  configJson: string;
};

type BonusGrantFormValues = {
  entityType: string;
  entityId: string;
  deltaXp: number;
  reasonTitle: string;
  reasonSummary: string;
  metadataJson: string;
};

function prettyRecord(value: Record<string, string | number | boolean | null>) {
  return JSON.stringify(value, null, 2);
}

function parseRecordJson(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object.");
  }
  return parsed as Record<string, string | number | boolean | null>;
}

export function SettingsRewardsPage() {
  const queryClient = useQueryClient();
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [ruleConfigError, setRuleConfigError] = useState<string | null>(null);
  const [bonusMetadataError, setBonusMetadataError] = useState<string | null>(null);

  const operatorSessionQuery = useQuery({
    queryKey: ["forge-operator-session"],
    queryFn: ensureOperatorSession
  });
  const operatorReady = operatorSessionQuery.isSuccess;

  const xpQuery = useQuery({
    queryKey: ["forge-xp-metrics"],
    queryFn: getXpMetrics
  });
  const rewardRulesQuery = useQuery({
    queryKey: ["forge-reward-rules"],
    queryFn: listRewardRules,
    enabled: operatorReady
  });
  const rewardLedgerQuery = useQuery({
    queryKey: ["forge-reward-ledger"],
    queryFn: () => listRewardLedger(30),
    enabled: operatorReady
  });

  const rewardRuleForm = useForm<RewardRuleFormValues>({
    defaultValues: {
      title: "",
      description: "",
      active: true,
      configJson: "{}"
    }
  });

  const bonusForm = useForm<BonusGrantFormValues>({
    defaultValues: {
      entityType: "task",
      entityId: "",
      deltaXp: 15,
      reasonTitle: "Operator bonus",
      reasonSummary: "Manual boost for a meaningful action captured with good provenance.",
      metadataJson: "{}"
    }
  });

  const invalidateRewards = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["forge-xp-metrics"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-reward-rules"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-reward-ledger"] })
    ]);
  };

  const rewardRuleMutation = useMutation({
    mutationFn: (input: { ruleId: string; title: string; description: string; active: boolean; config: RewardRule["config"] }) =>
      patchRewardRule(input.ruleId, {
        title: input.title,
        description: input.description,
        active: input.active,
        config: input.config
      }),
    onSuccess: invalidateRewards
  });

  const bonusMutation = useMutation({
    mutationFn: createManualRewardGrant,
    onSuccess: invalidateRewards
  });

  const rewardRules = rewardRulesQuery.data?.rules ?? [];

  useEffect(() => {
    if (!rewardRules.length) return;
    if (!selectedRuleId || !rewardRules.some((rule) => rule.id === selectedRuleId)) {
      setSelectedRuleId(rewardRules[0].id);
    }
  }, [rewardRules, selectedRuleId]);

  const selectedRule = rewardRules.find((rule) => rule.id === selectedRuleId) ?? rewardRules[0] ?? null;

  useEffect(() => {
    if (!selectedRule) return;
    rewardRuleForm.reset({
      title: selectedRule.title,
      description: selectedRule.description,
      active: selectedRule.active,
      configJson: prettyRecord(selectedRule.config)
    });
    setRuleConfigError(null);
  }, [selectedRule, rewardRuleForm]);

  const xpMetrics = xpQuery.data?.metrics;
  const rewardLedger = rewardLedgerQuery.data?.ledger ?? [];
  const manualBonusEvents = rewardLedger.filter((event) => event.metadata.manual === true).slice(0, 8);

  if (operatorSessionQuery.isLoading) {
    return (
      <SurfaceSkeleton
        eyebrow="Settings · Rewards"
        title="Loading reward controls"
        description="Establishing the operator session and fetching reward configuration."
        columns={2}
        blocks={6}
      />
    );
  }

  if (operatorSessionQuery.isError) {
    return <ErrorState eyebrow="Settings · Rewards" error={operatorSessionQuery.error} onRetry={() => void operatorSessionQuery.refetch()} />;
  }

  return (
    <div className="mx-auto grid w-full max-w-[1220px] gap-5">
      <PageHero
        title="Rewards"
        description="XP command deck, reward rule editor, manual bonus grants, and ledger history."
      />

      <SettingsSectionNav />

      <div className="grid gap-5">
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Reward operations</div>
          <div className="mt-4 grid gap-4">
            {xpMetrics ? (
              <XpCommandDeck
                profile={xpMetrics.profile}
                achievements={xpMetrics.achievements}
                milestoneRewards={xpMetrics.milestoneRewards}
                momentumPulse={xpMetrics.momentumPulse}
                recentLedger={xpMetrics.recentLedger}
              />
            ) : null}

            {xpMetrics ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <MetricTile label="Total XP" value={xpMetrics.profile.totalXp} tone="core" />
                <MetricTile label="Daily ambient" value={`${xpMetrics.dailyAmbientXp} / ${xpMetrics.dailyAmbientCap}`} tone="core" />
              </div>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-2">
              {/* Reward rule editor */}
              <div className="rounded-[22px] bg-white/[0.04] p-4">
                <div className="font-medium text-white">Reward rule editor</div>
                {rewardRules.length > 0 ? (
                  <form
                    className="mt-4 grid gap-4"
                    onSubmit={rewardRuleForm.handleSubmit(async (values) => {
                      try {
                        setRuleConfigError(null);
                        const config = parseRecordJson(values.configJson);
                        if (!selectedRule) return;
                        await rewardRuleMutation.mutateAsync({
                          ruleId: selectedRule.id,
                          title: values.title,
                          description: values.description,
                          active: values.active,
                          config
                        });
                      } catch (error) {
                        setRuleConfigError(error instanceof Error ? error.message : "Invalid reward rule config.");
                      }
                    })}
                  >
                    <label className="grid gap-2">
                      <span className="text-sm text-white/58">Rule</span>
                      <select
                        className="rounded-[14px] bg-white/[0.06] px-3 py-3 text-white"
                        value={selectedRuleId}
                        onChange={(event) => setSelectedRuleId(event.target.value)}
                      >
                        {rewardRules.map((rule) => (
                          <option key={rule.id} value={rule.id}>{rule.title}</option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm text-white/58">Title</span>
                      <Input {...rewardRuleForm.register("title")} />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm text-white/58">Description</span>
                      <Textarea className="min-h-24" {...rewardRuleForm.register("description")} />
                    </label>
                    <label className="flex items-center justify-between rounded-[18px] bg-[rgba(8,13,28,0.68)] px-4 py-3">
                      <span className="text-white/72">Rule is active</span>
                      <input type="checkbox" {...rewardRuleForm.register("active")} />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm text-white/58">Config JSON</span>
                      <Textarea className="min-h-28 font-mono text-xs" {...rewardRuleForm.register("configJson")} />
                    </label>
                    {ruleConfigError ? <div className="text-sm text-amber-300">{ruleConfigError}</div> : null}
                    <Button type="submit" pending={rewardRuleMutation.isPending} pendingLabel="Saving rule">
                      Save reward rule
                    </Button>
                  </form>
                ) : (
                  <div className="mt-4 text-sm text-white/58">Loading reward rules…</div>
                )}
              </div>

              {/* Manual bonus XP */}
              <div className="rounded-[22px] bg-white/[0.04] p-4">
                <div className="font-medium text-white">Manual bonus XP</div>
                <form
                  className="mt-4 grid gap-4"
                  onSubmit={bonusForm.handleSubmit(async (values) => {
                    try {
                      setBonusMetadataError(null);
                      const metadata = parseRecordJson(values.metadataJson);
                      await bonusMutation.mutateAsync({
                        entityType: values.entityType,
                        entityId: values.entityId,
                        deltaXp: values.deltaXp,
                        reasonTitle: values.reasonTitle,
                        reasonSummary: values.reasonSummary,
                        metadata
                      });
                      bonusForm.reset({
                        ...values,
                        entityId: "",
                        reasonTitle: "Operator bonus",
                        reasonSummary: "Manual boost for a meaningful action captured with good provenance.",
                        metadataJson: "{}"
                      });
                    } catch (error) {
                      setBonusMetadataError(error instanceof Error ? error.message : "Invalid metadata payload.");
                    }
                  })}
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2">
                      <span className="text-sm text-white/58">Entity type</span>
                      <Input {...bonusForm.register("entityType")} />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm text-white/58">Entity id</span>
                      <Input placeholder="task_123" {...bonusForm.register("entityId")} />
                    </label>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2">
                      <span className="text-sm text-white/58">Delta XP</span>
                      <Input type="number" {...bonusForm.register("deltaXp", { valueAsNumber: true })} />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm text-white/58">Reason title</span>
                      <Input {...bonusForm.register("reasonTitle")} />
                    </label>
                  </div>
                  <label className="grid gap-2">
                    <span className="text-sm text-white/58">Reason summary</span>
                    <Textarea className="min-h-24" {...bonusForm.register("reasonSummary")} />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm text-white/58">Metadata JSON</span>
                    <Textarea className="min-h-24 font-mono text-xs" {...bonusForm.register("metadataJson")} />
                  </label>
                  {bonusMetadataError ? <div className="text-sm text-amber-300">{bonusMetadataError}</div> : null}
                  <Button type="submit" pending={bonusMutation.isPending} pendingLabel="Issuing bonus">
                    Issue bonus XP
                  </Button>
                </form>
                {bonusMutation.data ? (
                  <div className="mt-4 rounded-[18px] bg-[rgba(192,193,255,0.12)] p-4 text-sm text-white">
                    Granted {bonusMutation.data.reward.deltaXp > 0 ? "+" : ""}
                    {bonusMutation.data.reward.deltaXp} XP for <strong>{bonusMutation.data.reward.reasonTitle}</strong>.
                  </div>
                ) : null}
              </div>
            </div>

            {/* Manual bonus history */}
            <div className="rounded-[22px] bg-white/[0.04] p-4">
              <div className="font-medium text-white">Manual bonus history</div>
              <div className="mt-4 grid gap-3">
                {manualBonusEvents.length === 0 ? (
                  <div className="rounded-[18px] bg-[rgba(8,13,28,0.68)] p-4 text-sm text-white/58">No manual bonus grants yet.</div>
                ) : (
                  manualBonusEvents.map((event) => (
                    <div key={event.id} className="rounded-[18px] bg-[rgba(8,13,28,0.68)] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium text-white">{event.reasonTitle}</div>
                        <Badge className={event.deltaXp >= 0 ? "text-emerald-300" : "text-amber-300"}>
                          {event.deltaXp > 0 ? "+" : ""}{event.deltaXp} XP
                        </Badge>
                      </div>
                      <div className="mt-2 text-sm leading-6 text-white/58">{event.reasonSummary || "No summary supplied."}</div>
                      <div className="mt-2 text-xs uppercase tracking-[0.16em] text-white/38">
                        {event.entityType} · {event.entityId} · {new Date(event.createdAt).toLocaleString()}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
