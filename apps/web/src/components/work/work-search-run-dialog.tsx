import { useEffect, useMemo, useState } from "react";
import {
  FlowField,
  QuestionFlowDialog
} from "@/components/flows/question-flow-dialog";
import type { QuestionFlowStep } from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { recordWorkSearchRun } from "@/lib/work-api";
import type { OpportunityCampaign } from "@/lib/work-api";
import {
  lines,
  localDateTime,
  isoOrNull,
  message,
  idempotencyKey,
  Select
} from "./work-operational-dialog-shared";

type SearchRunDraft = {
  status: string;
  startedAt: string;
  endedAt: string;
  sources: string;
  queries: string;
  found: string;
  fresh: string;
  changed: string;
  duplicate: string;
  stale: string;
  closed: string;
  failed: string;
  failures: string;
  costAmount: string;
  costCurrency: string;
  costBillingUnit: string;
  costNotes: string;
  evidence: string;
  items: string;
};

function parseSearchRunItems(value: string) {
  return lines(value).map((entry, index) => {
    const [opportunityId, resultKind, ...evidence] = entry
      .split("|")
      .map((part) => part.trim());
    if (!resultKind) {
      throw new Error(
        `Search result ${index + 1} needs an Opportunity ID (or an empty first field) and a result kind.`
      );
    }
    return {
      opportunityId: opportunityId || null,
      resultKind,
      evidence: evidence.length > 0 ? { description: evidence.join(" | ") } : {}
    };
  });
}

export function SearchRunDialog({
  open,
  onOpenChange,
  userIds,
  campaign,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  campaign: OpportunityCampaign;
  onSaved: () => Promise<void> | void;
}) {
  const makeDraft = (): SearchRunDraft => ({
    status: "completed",
    startedAt: localDateTime(new Date().toISOString()),
    endedAt: localDateTime(new Date().toISOString()),
    sources: "",
    queries: "",
    found: "0",
    fresh: "0",
    changed: "0",
    duplicate: "0",
    stale: "0",
    closed: "0",
    failed: "0",
    failures: "",
    costAmount: "",
    costCurrency: "",
    costBillingUnit: "run",
    costNotes: "",
    evidence: "",
    items: ""
  });
  const [draft, setDraft] = useState(makeDraft);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setDraft(makeDraft());
  }, [open]);
  const criteriaVersionId = String(
    campaign.currentCriteria?.id ?? campaign.currentCriteriaVersionId ?? ""
  );
  const steps = useMemo<Array<QuestionFlowStep<SearchRunDraft>>>(
    () => [
      {
        id: "evidence",
        eyebrow: "Durable search evidence",
        title: "Record a search run",
        description:
          "Preserve the exact criteria version, sources, queries, per-opportunity outcomes, cost, failures, and timing. This does not invent opportunities that were not sourced.",
        render: (value, setValue) => (
          <div className="grid gap-4 md:grid-cols-2">
            <Select
              label="Status"
              value={value.status}
              onChange={(status) =>
                setValue({
                  status,
                  ...(status === "running" ? { endedAt: "" } : {})
                })
              }
            >
              {["running", "completed", "partial", "failed", "cancelled"].map(
                (option) => (
                  <option key={option}>{option}</option>
                )
              )}
            </Select>
            <FlowField label="Criteria version">
              <Input value={criteriaVersionId} disabled />
            </FlowField>
            <FlowField label="Started">
              <Input
                type="datetime-local"
                value={value.startedAt}
                onChange={(event) =>
                  setValue({ startedAt: event.target.value })
                }
              />
            </FlowField>
            <FlowField
              label="Ended"
              hint={
                value.status === "running"
                  ? "A running Search Run has no end time."
                  : undefined
              }
            >
              <Input
                type="datetime-local"
                disabled={value.status === "running"}
                value={value.endedAt}
                onChange={(event) => setValue({ endedAt: event.target.value })}
              />
            </FlowField>
            <FlowField
              label="Sources checked"
              hint="One source ID or label per line"
            >
              <Textarea
                rows={4}
                value={value.sources}
                onChange={(event) => setValue({ sources: event.target.value })}
              />
            </FlowField>
            <FlowField label="Queries executed" hint="One exact query per line">
              <Textarea
                rows={4}
                value={value.queries}
                onChange={(event) => setValue({ queries: event.target.value })}
              />
            </FlowField>
            <div className="grid grid-cols-2 gap-3 md:col-span-2 sm:grid-cols-4">
              {(
                [
                  ["found", "Found"],
                  ["fresh", "New"],
                  ["changed", "Changed"],
                  ["duplicate", "Duplicate"],
                  ["stale", "Stale"],
                  ["closed", "Closed"],
                  ["failed", "Failed"]
                ] as const
              ).map(([key, label]) => (
                <FlowField key={key} label={label}>
                  <Input
                    type="number"
                    min="0"
                    value={value[key]}
                    onChange={(event) =>
                      setValue({ [key]: event.target.value })
                    }
                  />
                </FlowField>
              ))}
            </div>
            <FlowField
              label="Per-opportunity results"
              hint="Opportunity ID | new, changed, duplicate, stale, closed, or failed | factual evidence"
              className="md:col-span-2"
            >
              <Textarea
                rows={6}
                value={value.items}
                onChange={(event) => setValue({ items: event.target.value })}
                placeholder="jopp_… | new | First seen on the employer careers page"
              />
            </FlowField>
            <FlowField
              label="Failures"
              hint="One factual failure per line"
              className="md:col-span-2"
            >
              <Textarea
                rows={4}
                value={value.failures}
                onChange={(event) => setValue({ failures: event.target.value })}
              />
            </FlowField>
            <FlowField
              label="Evidence"
              hint="One source, receipt, or durable evidence statement per line"
              className="md:col-span-2"
            >
              <Textarea
                rows={4}
                value={value.evidence}
                onChange={(event) => setValue({ evidence: event.target.value })}
              />
            </FlowField>
            <FlowField label="Cost amount">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={value.costAmount}
                onChange={(event) =>
                  setValue({ costAmount: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Cost currency">
              <Input
                maxLength={3}
                value={value.costCurrency}
                onChange={(event) =>
                  setValue({ costCurrency: event.target.value.toUpperCase() })
                }
                placeholder="CHF"
              />
            </FlowField>
            <FlowField label="Billing unit">
              <Input
                value={value.costBillingUnit}
                onChange={(event) =>
                  setValue({ costBillingUnit: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Cost notes">
              <Input
                value={value.costNotes}
                onChange={(event) =>
                  setValue({ costNotes: event.target.value })
                }
              />
            </FlowField>
          </div>
        )
      }
    ],
    [criteriaVersionId]
  );
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Search run"
      title="Record search run"
      description="Keep durable source and query evidence."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel="Record search run"
      pending={pending}
      error={error}
      onSubmit={async () => {
        if (!criteriaVersionId) {
          setError(
            "Create the first criteria version before recording a search run."
          );
          return;
        }
        setPending(true);
        setError(null);
        const counts = {
          found: Number(draft.found),
          new: Number(draft.fresh),
          changed: Number(draft.changed),
          duplicate: Number(draft.duplicate),
          stale: Number(draft.stale),
          closed: Number(draft.closed),
          failed: Number(draft.failed)
        };
        try {
          await recordWorkSearchRun(userIds, {
            campaignId: campaign.id,
            criteriaVersionId,
            data: {
              startedAt: isoOrNull(draft.startedAt) ?? undefined,
              endedAt:
                draft.status === "running" ? null : isoOrNull(draft.endedAt),
              status: draft.status,
              sources: lines(draft.sources),
              queries: lines(draft.queries),
              counts,
              failures: lines(draft.failures).map((description) => ({
                description
              })),
              cost: {
                amount: draft.costAmount ? Number(draft.costAmount) : null,
                currency: draft.costCurrency || null,
                billingUnit: draft.costBillingUnit || "run",
                notes: draft.costNotes
              },
              evidence: lines(draft.evidence).map((description) => ({
                description
              }))
            },
            items: parseSearchRunItems(draft.items),
            idempotencyKey: idempotencyKey("work-search-run")
          });
          onOpenChange(false);
          await onSaved();
        } catch (caught) {
          setError(message(caught));
        } finally {
          setPending(false);
        }
      }}
    />
  );
}
