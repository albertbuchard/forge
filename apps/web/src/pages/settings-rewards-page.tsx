import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { SettingsSectionNav } from "@/components/settings/settings-section-nav";
import { XpCommandDeck } from "@/components/xp/xp-command-deck";
import { PageHero } from "@/components/shell/page-hero";
import { useForgeShell } from "@/components/shell/app-shell";
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
  getPsycheOverview,
  getXpMetrics,
  listRewardLedger,
  listRewardRules,
  patchRewardRule
} from "@/lib/api";
import type { RewardRule, RewardableEntityType } from "@/lib/types";

type RewardableOption = {
  id: string;
  label: string;
};

type RewardRuleFormValues = {
  title: string;
  description: string;
  active: boolean;
  configJson: string;
};

type BonusGrantFormValues = {
  entityType: RewardableEntityType;
  entityId: string;
  deltaXp: number;
  reasonTitle: string;
  reasonSummary: string;
  metadataJson: string;
};

const rewardPanelClass =
  "min-w-0 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4";
const rewardInsetClass =
  "min-w-0 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4";
const rewardSelectClass =
  "min-w-0 rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-3 text-sm text-[var(--ui-ink-strong)] outline-none transition focus:border-[var(--primary)]/35 focus:bg-[var(--ui-surface-3)]";
const rewardEyebrowClass =
  "font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]";
const rewardTitleClass = "text-[var(--ui-ink-strong)]";
const rewardBodyClass = "text-[var(--ui-ink-soft)]";
const rewardFaintClass = "text-[var(--ui-ink-faint)]";
const rewardWarningClass =
  "text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]";
const rewardSuccessPanelClass =
  "mt-4 rounded-[18px] border border-[color-mix(in_srgb,var(--success)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-success-soft)] p-4 text-sm text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]";

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
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [ruleConfigError, setRuleConfigError] = useState<string | null>(null);
  const [bonusMetadataError, setBonusMetadataError] = useState<string | null>(
    null
  );

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
  const psycheOverviewQuery = useQuery({
    queryKey: ["forge-psyche-overview"],
    queryFn: async () => (await getPsycheOverview()).overview
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
      reasonSummary:
        "Manual boost for a meaningful action captured with good provenance.",
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
    mutationFn: (input: {
      ruleId: string;
      title: string;
      description: string;
      active: boolean;
      config: RewardRule["config"];
    }) =>
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

  const rewardRules = useMemo(
    () => rewardRulesQuery.data?.rules ?? [],
    [rewardRulesQuery.data?.rules]
  );
  const rewardableOptionsByType = useMemo<
    Record<RewardableEntityType, RewardableOption[]>
  >(
    () => ({
      system: [
        { id: "operator_manual_reward", label: "Operator reward ledger" }
      ],
      goal: shell.snapshot.goals.map((goal) => ({
        id: goal.id,
        label: goal.title
      })),
      project: shell.snapshot.dashboard.projects.map((project) => ({
        id: project.id,
        label: project.title
      })),
      task: shell.snapshot.tasks.map((task) => ({
        id: task.id,
        label: task.title
      })),
      habit: shell.snapshot.habits.map((habit) => ({
        id: habit.id,
        label: habit.title
      })),
      tag: shell.snapshot.tags.map((tag) => ({ id: tag.id, label: tag.name })),
      note: [],
      insight: [],
      psyche_value: (psycheOverviewQuery.data?.values ?? []).map((value) => ({
        id: value.id,
        label: value.title
      })),
      behavior_pattern: (psycheOverviewQuery.data?.patterns ?? []).map(
        (pattern) => ({ id: pattern.id, label: pattern.title })
      ),
      behavior: (psycheOverviewQuery.data?.behaviors ?? []).map((behavior) => ({
        id: behavior.id,
        label: behavior.title
      })),
      belief_entry: (psycheOverviewQuery.data?.beliefs ?? []).map((belief) => ({
        id: belief.id,
        label: belief.statement
      })),
      mode_profile: (psycheOverviewQuery.data?.modes ?? []).map((mode) => ({
        id: mode.id,
        label: mode.title
      })),
      flashcard: (psycheOverviewQuery.data?.flashcards ?? []).map(
        (flashcard) => ({
          id: flashcard.id,
          label: flashcard.title || flashcard.message
        })
      ),
      trigger_report: (psycheOverviewQuery.data?.reports ?? []).map(
        (report) => ({ id: report.id, label: report.title })
      )
    }),
    [
      psycheOverviewQuery.data,
      shell.snapshot.dashboard.projects,
      shell.snapshot.goals,
      shell.snapshot.habits,
      shell.snapshot.tags,
      shell.snapshot.tasks
    ]
  );

  useEffect(() => {
    const currentType = bonusForm.getValues("entityType");
    const currentId = bonusForm.getValues("entityId");
    const options = rewardableOptionsByType[currentType] ?? [];
    if (currentId && options.some((option) => option.id === currentId)) {
      return;
    }
    bonusForm.setValue("entityId", options[0]?.id ?? "");
  }, [bonusForm, rewardableOptionsByType]);

  useEffect(() => {
    if (!rewardRules.length) return;
    if (
      !selectedRuleId ||
      !rewardRules.some((rule) => rule.id === selectedRuleId)
    ) {
      setSelectedRuleId(rewardRules[0].id);
    }
  }, [rewardRules, selectedRuleId]);

  const selectedRule =
    rewardRules.find((rule) => rule.id === selectedRuleId) ??
    rewardRules[0] ??
    null;

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
  const manualBonusEvents = rewardLedger
    .filter((event) => event.metadata.manual === true)
    .slice(0, 8);

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
    return (
      <ErrorState
        eyebrow="Settings · Rewards"
        error={operatorSessionQuery.error}
        onRetry={() => void operatorSessionQuery.refetch()}
      />
    );
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
          <div className={rewardEyebrowClass}>Reward operations</div>
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
                <MetricTile
                  label="Total XP"
                  value={xpMetrics.profile.totalXp}
                  tone="core"
                />
                <MetricTile
                  label="Daily ambient"
                  value={`${xpMetrics.dailyAmbientXp} / ${xpMetrics.dailyAmbientCap}`}
                  tone="core"
                />
              </div>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-2">
              {/* Reward rule editor */}
              <div className={rewardPanelClass}>
                <div className={`font-medium ${rewardTitleClass}`}>
                  Reward rule editor
                </div>
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
                        setRuleConfigError(
                          error instanceof Error
                            ? error.message
                            : "Invalid reward rule config."
                        );
                      }
                    })}
                  >
                    <label className="grid gap-2">
                      <span className={`text-sm ${rewardBodyClass}`}>Rule</span>
                      <select
                        className={rewardSelectClass}
                        value={selectedRuleId}
                        onChange={(event) =>
                          setSelectedRuleId(event.target.value)
                        }
                      >
                        {rewardRules.map((rule) => (
                          <option key={rule.id} value={rule.id}>
                            {rule.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-2">
                      <span className={`text-sm ${rewardBodyClass}`}>
                        Title
                      </span>
                      <Input {...rewardRuleForm.register("title")} />
                    </label>
                    <label className="grid gap-2">
                      <span className={`text-sm ${rewardBodyClass}`}>
                        Description
                      </span>
                      <Textarea
                        className="min-h-24"
                        {...rewardRuleForm.register("description")}
                      />
                    </label>
                    <label className="flex min-w-0 items-center justify-between gap-3 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3">
                      <span className={rewardBodyClass}>Rule is active</span>
                      <input
                        type="checkbox"
                        {...rewardRuleForm.register("active")}
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className={`text-sm ${rewardBodyClass}`}>
                        Config JSON
                      </span>
                      <Textarea
                        className="min-h-28 font-mono text-xs"
                        {...rewardRuleForm.register("configJson")}
                      />
                    </label>
                    {ruleConfigError ? (
                      <div className={`text-sm ${rewardWarningClass}`}>
                        {ruleConfigError}
                      </div>
                    ) : null}
                    <Button
                      type="submit"
                      pending={rewardRuleMutation.isPending}
                      pendingLabel="Saving rule"
                    >
                      Save reward rule
                    </Button>
                  </form>
                ) : (
                  <div className={`mt-4 text-sm ${rewardBodyClass}`}>
                    Loading reward rules...
                  </div>
                )}
              </div>

              {/* Manual bonus XP */}
              <div className={rewardPanelClass}>
                <div className={`font-medium ${rewardTitleClass}`}>
                  Manual bonus XP
                </div>
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
                        reasonSummary:
                          "Manual boost for a meaningful action captured with good provenance.",
                        metadataJson: "{}"
                      });
                    } catch (error) {
                      setBonusMetadataError(
                        error instanceof Error
                          ? error.message
                          : "Invalid metadata payload."
                      );
                    }
                  })}
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2">
                      <span className={`text-sm ${rewardBodyClass}`}>
                        Entity type
                      </span>
                      <select
                        className={rewardSelectClass}
                        {...bonusForm.register("entityType")}
                      >
                        {Object.keys(rewardableOptionsByType).map(
                          (entityType) => (
                            <option key={entityType} value={entityType}>
                              {entityType.replaceAll("_", " ")}
                            </option>
                          )
                        )}
                      </select>
                    </label>
                    <label className="grid gap-2">
                      <span className={`text-sm ${rewardBodyClass}`}>
                        Entity id
                      </span>
                      <select
                        className={rewardSelectClass}
                        {...bonusForm.register("entityId")}
                      >
                        {(
                          rewardableOptionsByType[
                            bonusForm.watch("entityType")
                          ] ?? []
                        ).map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2">
                      <span className={`text-sm ${rewardBodyClass}`}>
                        Delta XP
                      </span>
                      <Input
                        type="number"
                        {...bonusForm.register("deltaXp", {
                          valueAsNumber: true
                        })}
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className={`text-sm ${rewardBodyClass}`}>
                        Reason title
                      </span>
                      <Input {...bonusForm.register("reasonTitle")} />
                    </label>
                  </div>
                  <label className="grid gap-2">
                    <span className={`text-sm ${rewardBodyClass}`}>
                      Reason summary
                    </span>
                    <Textarea
                      className="min-h-24"
                      {...bonusForm.register("reasonSummary")}
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className={`text-sm ${rewardBodyClass}`}>
                      Metadata JSON
                    </span>
                    <Textarea
                      className="min-h-24 font-mono text-xs"
                      {...bonusForm.register("metadataJson")}
                    />
                  </label>
                  {bonusMetadataError ? (
                    <div className={`text-sm ${rewardWarningClass}`}>
                      {bonusMetadataError}
                    </div>
                  ) : null}
                  <Button
                    type="submit"
                    pending={bonusMutation.isPending}
                    pendingLabel="Issuing bonus"
                  >
                    Issue bonus XP
                  </Button>
                </form>
                {bonusMutation.data ? (
                  <div className={rewardSuccessPanelClass}>
                    Granted {bonusMutation.data.reward.deltaXp > 0 ? "+" : ""}
                    {bonusMutation.data.reward.deltaXp} XP for{" "}
                    <strong>{bonusMutation.data.reward.reasonTitle}</strong>.
                  </div>
                ) : null}
              </div>
            </div>

            {/* Manual bonus history */}
            <div className={rewardPanelClass}>
              <div className={`font-medium ${rewardTitleClass}`}>
                Manual bonus history
              </div>
              <div className="mt-4 grid gap-3">
                {manualBonusEvents.length === 0 ? (
                  <div
                    className={`${rewardInsetClass} text-sm ${rewardBodyClass}`}
                  >
                    No manual bonus grants yet.
                  </div>
                ) : (
                  manualBonusEvents.map((event) => (
                    <div key={event.id} className={rewardInsetClass}>
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                        <div
                          className={`min-w-0 break-words font-medium ${rewardTitleClass}`}
                        >
                          {event.reasonTitle}
                        </div>
                        <Badge
                          wrap
                          className={
                            event.deltaXp >= 0
                              ? "bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]"
                              : "bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]"
                          }
                        >
                          {event.deltaXp > 0 ? "+" : ""}
                          {event.deltaXp} XP
                        </Badge>
                      </div>
                      <div
                        className={`mt-2 text-sm leading-6 ${rewardBodyClass}`}
                      >
                        {event.reasonSummary || "No summary supplied."}
                      </div>
                      <div
                        className={`mt-2 break-words text-xs uppercase tracking-[0.16em] [overflow-wrap:anywhere] ${rewardFaintClass}`}
                      >
                        {event.entityType} · {event.entityId} ·{" "}
                        {new Date(event.createdAt).toLocaleString()}
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
