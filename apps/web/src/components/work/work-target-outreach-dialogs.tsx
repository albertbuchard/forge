import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlowField,
  QuestionFlowDialog
} from "@/components/flows/question-flow-dialog";
import type { QuestionFlowStep } from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { readable } from "@/components/work/work-components";
import {
  EntityLinkMultiSelect,
  type EntityLinkOption
} from "@/components/psyche/entity-link-multiselect";
import { searchLocalRecords } from "@/lib/api";
import {
  createWorkSupportingRecord,
  updateWorkSupportingRecord
} from "@/lib/work-api";
import type { OpportunityCampaign, WorkRecord } from "@/lib/work-api";
import {
  provenance,
  lines,
  localDateTime,
  isoOrNull,
  message,
  recordValue,
  Select
} from "./work-operational-dialog-shared";
type OutreachDraft = {
  campaignId: string;
  organizationId: string;
  personId: string;
  proposal: string;
  channel: string;
  status: string;
  messageArtifactId: string;
  sentAt: string;
  followUpAt: string;
  response: string;
  nextAction: string;
};

function outreachDraft(
  value?: WorkRecord,
  campaignId = "",
  organizationId = ""
): OutreachDraft {
  return {
    campaignId: String(value?.campaignId ?? campaignId),
    organizationId: String(value?.organizationId ?? organizationId),
    personId: String(value?.personId ?? ""),
    proposal: String(value?.proposal ?? ""),
    channel: String(value?.channel ?? "email"),
    status: String(value?.status ?? "planned"),
    messageArtifactId: String(value?.messageArtifactId ?? ""),
    sentAt: localDateTime(value?.sentAt),
    followUpAt: localDateTime(value?.followUpAt),
    response: String(value?.response ?? ""),
    nextAction: String(value?.nextAction ?? "")
  };
}

export function OutreachDialog({
  open,
  onOpenChange,
  userIds,
  campaigns,
  organizations,
  outreach,
  initialCampaignId,
  initialOrganizationId,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  campaigns: OpportunityCampaign[];
  organizations: WorkRecord[];
  outreach?: WorkRecord;
  initialCampaignId?: string;
  initialOrganizationId?: string;
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(() =>
    outreachDraft(outreach, initialCampaignId, initialOrganizationId)
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open)
      setDraft(
        outreachDraft(outreach, initialCampaignId, initialOrganizationId)
      );
  }, [initialCampaignId, initialOrganizationId, open, outreach]);
  const postSend = ["sent", "replied", "follow_up", "closed"].includes(
    draft.status
  );
  const searchPeople = useCallback(
    async (query: string): Promise<EntityLinkOption[]> => {
      const response = await searchLocalRecords({
        query,
        entityTypes: ["person"],
        userIds,
        limit: 20
      });
      return response.results.map((person) => ({
        value: `person:${person.entityId}`,
        label: person.title,
        description: person.detail || "Person"
      }));
    },
    [userIds]
  );
  const steps = useMemo<Array<QuestionFlowStep<OutreachDraft>>>(
    () => [
      {
        id: "details",
        eyebrow: "Networking and outreach",
        title: outreach ? "Update outreach" : "Plan an outreach",
        description:
          "Connect a concrete proposal to a job search, organization, person, message file, and factual follow-up history.",
        render: (value, setValue) => (
          <div className="grid gap-4 md:grid-cols-2">
            <Select
              label="Job search"
              value={value.campaignId}
              onChange={(campaignId) => setValue({ campaignId })}
            >
              <option value="">No job search</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.title}
                </option>
              ))}
            </Select>
            <Select
              label="Organization"
              value={value.organizationId}
              onChange={(organizationId) => setValue({ organizationId })}
            >
              <option value="">No organization</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {String(organization.name ?? organization.id)}
                </option>
              ))}
            </Select>
            <div className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
              Person
              <EntityLinkMultiSelect
                options={
                  value.personId
                    ? [
                        {
                          value: `person:${value.personId}`,
                          label: "Selected person"
                        }
                      ]
                    : []
                }
                selectedValues={
                  value.personId ? [`person:${value.personId}`] : []
                }
                onSearch={searchPeople}
                onChange={(selected) =>
                  setValue({
                    personId: selected.at(-1)?.replace(/^person:/u, "") ?? ""
                  })
                }
                placeholder="Search people…"
                emptyMessage="No matching person found."
              />
            </div>
            <FlowField label="Channel">
              <Input
                value={value.channel}
                onChange={(event) => setValue({ channel: event.target.value })}
              />
            </FlowField>
            <Select
              label="Status"
              value={value.status}
              onChange={(status) => setValue({ status })}
            >
              {[
                "planned",
                "drafted",
                "ready",
                "sent",
                "replied",
                "follow_up",
                "closed"
              ].map((option) => (
                <option key={option} value={option}>
                  {readable(option)}
                </option>
              ))}
            </Select>
            <details className="rounded-[16px] border border-[var(--ui-border-subtle)] p-3">
              <summary className="cursor-pointer text-sm font-medium text-[var(--ui-ink-medium)]">
                Technical details
              </summary>
              <FlowField label="Message file ID">
                <Input
                  value={value.messageArtifactId}
                  onChange={(event) =>
                    setValue({ messageArtifactId: event.target.value })
                  }
                />
              </FlowField>
            </details>
            <FlowField label="Sent at">
              <Input
                type="datetime-local"
                value={value.sentAt}
                onChange={(event) => setValue({ sentAt: event.target.value })}
              />
            </FlowField>
            <FlowField label="Follow up at">
              <Input
                type="datetime-local"
                value={value.followUpAt}
                onChange={(event) =>
                  setValue({ followUpAt: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Concrete proposal" className="md:col-span-2">
              <Textarea
                rows={5}
                value={value.proposal}
                onChange={(event) => setValue({ proposal: event.target.value })}
                autoFocus
              />
            </FlowField>
            <FlowField label="Factual response" className="md:col-span-2">
              <Textarea
                rows={4}
                value={value.response}
                onChange={(event) => setValue({ response: event.target.value })}
              />
            </FlowField>
            <FlowField label="Next action" className="md:col-span-2">
              <Textarea
                rows={3}
                value={value.nextAction}
                onChange={(event) =>
                  setValue({ nextAction: event.target.value })
                }
              />
            </FlowField>
          </div>
        )
      }
    ],
    [campaigns, organizations, outreach, searchPeople]
  );
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Outreach"
      title={outreach ? "Edit outreach" : "Add outreach"}
      description="Track networking without inventing that a message was sent."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={outreach ? "Save outreach" : "Add outreach"}
      pending={pending}
      error={error}
      draftPersistenceKey={`work-outreach-${outreach?.id ?? "new"}`}
      resolveContinueBlocker={() => null}
      onSubmit={async () => {
        if (postSend && !draft.sentAt) {
          setError(
            "A sent or post-send status requires the factual sent time."
          );
          return;
        }
        setPending(true);
        setError(null);
        const data = {
          campaignId: draft.campaignId || null,
          organizationId: draft.organizationId || null,
          personId: draft.personId || null,
          proposal: draft.proposal,
          channel: draft.channel,
          status: draft.status,
          messageArtifactId: draft.messageArtifactId || null,
          sentAt: isoOrNull(draft.sentAt),
          followUpAt: isoOrNull(draft.followUpAt),
          response: draft.response,
          nextAction: draft.nextAction,
          scopeProjectIds: [],
          scopeTagIds: [],
          provenance
        };
        try {
          if (outreach)
            await updateWorkSupportingRecord(userIds, "outreach", outreach.id, {
              expectedRevision: Number(outreach.revision),
              data
            });
          else await createWorkSupportingRecord(userIds, "outreach", { data });
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

type RoleTargetDraft = {
  titleFamily: string;
  aliases: string;
  seniority: string;
  functionName: string;
  domain: string;
  responsibilities: string;
  technologies: string;
  requiredQualifications: string;
  desiredQualifications: string;
  transferableEvidence: string;
  knownGaps: string;
  evidenceActions: string;
  searchTerms: string;
  queryFragments: string;
  priority: string;
};

function roleTargetDraft(value?: WorkRecord): RoleTargetDraft {
  const list = (key: string) =>
    Array.isArray(value?.[key])
      ? (value?.[key] as unknown[]).map(String).join("\n")
      : "";
  return {
    titleFamily: String(value?.titleFamily ?? ""),
    aliases: list("aliases"),
    seniority: String(value?.seniority ?? ""),
    functionName: String(value?.functionName ?? ""),
    domain: String(value?.domain ?? ""),
    responsibilities: list("responsibilities"),
    technologies: list("technologies"),
    requiredQualifications: list("requiredQualifications"),
    desiredQualifications: list("desiredQualifications"),
    transferableEvidence: list("transferableEvidence"),
    knownGaps: list("knownGaps"),
    evidenceActions: list("evidenceActions"),
    searchTerms: list("searchTerms"),
    queryFragments: list("queryFragments"),
    priority: String(value?.priority ?? "50")
  };
}

export function RoleTargetDialog({
  open,
  onOpenChange,
  userIds,
  campaignId,
  target,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  campaignId: string;
  target?: WorkRecord;
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(() => roleTargetDraft(target));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setDraft(roleTargetDraft(target));
  }, [open, target]);
  const steps = useMemo<Array<QuestionFlowStep<RoleTargetDraft>>>(
    () => [
      {
        id: "target",
        eyebrow: "Job-search role target",
        title: target ? "Update the role target" : "Add a role target",
        description:
          "Separate required qualifications, transferable evidence, known gaps, and evidence-building actions so agents do not collapse them into one fit claim.",
        render: (value, setValue) => (
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="Title family">
              <Input
                value={value.titleFamily}
                onChange={(event) =>
                  setValue({ titleFamily: event.target.value })
                }
                autoFocus
              />
            </FlowField>
            <FlowField label="Aliases" hint="One per line">
              <Textarea
                rows={3}
                value={value.aliases}
                onChange={(event) => setValue({ aliases: event.target.value })}
              />
            </FlowField>
            <FlowField label="Seniority">
              <Input
                value={value.seniority}
                onChange={(event) =>
                  setValue({ seniority: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Function">
              <Input
                value={value.functionName}
                onChange={(event) =>
                  setValue({ functionName: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Domain">
              <Input
                value={value.domain}
                onChange={(event) => setValue({ domain: event.target.value })}
              />
            </FlowField>
            <FlowField label="Priority (0 to 100)">
              <Input
                type="number"
                min="0"
                max="100"
                value={value.priority}
                onChange={(event) => setValue({ priority: event.target.value })}
              />
            </FlowField>
            {(
              [
                ["responsibilities", "Responsibilities"],
                ["technologies", "Technologies"],
                ["requiredQualifications", "Required qualifications"],
                ["desiredQualifications", "Desired qualifications"],
                ["transferableEvidence", "Transferable evidence"],
                ["knownGaps", "Known gaps"],
                ["evidenceActions", "Evidence-building actions"],
                ["searchTerms", "Search terms"],
                ["queryFragments", "Search query phrases"]
              ] as const
            ).map(([key, label]) => (
              <FlowField key={key} label={label} hint="One per line">
                <Textarea
                  rows={4}
                  value={value[key]}
                  onChange={(event) => setValue({ [key]: event.target.value })}
                />
              </FlowField>
            ))}
          </div>
        )
      }
    ],
    [target]
  );
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Job search"
      title={target ? "Edit role target" : "Add role target"}
      description="Build a sourceable role-search target."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={target ? "Save role target" : "Add role target"}
      pending={pending}
      error={error}
      draftPersistenceKey={`work-role-target-${target?.id ?? campaignId}`}
      onSubmit={async () => {
        setPending(true);
        setError(null);
        const data = {
          titleFamily: draft.titleFamily,
          aliases: lines(draft.aliases),
          seniority: draft.seniority,
          functionName: draft.functionName,
          domain: draft.domain,
          responsibilities: lines(draft.responsibilities),
          technologies: lines(draft.technologies),
          requiredQualifications: lines(draft.requiredQualifications),
          desiredQualifications: lines(draft.desiredQualifications),
          transferableEvidence: lines(draft.transferableEvidence),
          knownGaps: lines(draft.knownGaps),
          evidenceActions: lines(draft.evidenceActions),
          searchTerms: lines(draft.searchTerms),
          queryFragments: lines(draft.queryFragments),
          priority: Number(draft.priority)
        };
        try {
          if (target)
            await updateWorkSupportingRecord(userIds, "roleTarget", target.id, {
              expectedRevision: Number(target.revision),
              data
            });
          else
            await createWorkSupportingRecord(
              userIds,
              "roleTarget",
              { data },
              campaignId
            );
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

type OrganizationTargetDraft = {
  organizationId: string;
  targetTier: string;
  rationale: string;
  status: string;
  warmPaths: string;
  exclusions: string;
  priorApplications: string;
  nextAction: string;
};

export function OrganizationTargetDialog({
  open,
  onOpenChange,
  userIds,
  campaignId,
  organizations,
  target,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  campaignId: string;
  organizations: WorkRecord[];
  target?: WorkRecord;
  onSaved: () => Promise<void> | void;
}) {
  const make = (value?: WorkRecord): OrganizationTargetDraft => ({
    organizationId: String(value?.organizationId ?? ""),
    targetTier: String(value?.targetTier ?? "explore"),
    rationale: String(value?.rationale ?? ""),
    status: String(value?.status ?? "active"),
    warmPaths: Array.isArray(value?.warmPaths)
      ? value.warmPaths
          .map((entry) =>
            String(
              recordValue(entry).description ?? recordValue(entry).label ?? ""
            )
          )
          .join("\n")
      : "",
    exclusions: Array.isArray(value?.exclusions)
      ? value.exclusions.map(String).join("\n")
      : "",
    priorApplications: Array.isArray(value?.priorApplications)
      ? value.priorApplications
          .map((entry) =>
            String(
              recordValue(entry).description ??
                recordValue(entry).applicationId ??
                ""
            )
          )
          .join("\n")
      : "",
    nextAction: String(value?.nextAction ?? "")
  });
  const [draft, setDraft] = useState(() => make(target));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setDraft(make(target));
  }, [open, target]);
  const steps = useMemo<Array<QuestionFlowStep<OrganizationTargetDraft>>>(
    () => [
      {
        id: "target",
        eyebrow: "Job-search organization target",
        title: target
          ? "Update the organization target"
          : "Add an organization target",
        description:
          "Reuse one organization and add its priority, warm introduction paths, exclusions, application history, and next action for this job search.",
        render: (value, setValue) => (
          <div className="grid gap-4 md:grid-cols-2">
            <Select
              label="Organization"
              value={value.organizationId}
              onChange={(organizationId) => setValue({ organizationId })}
            >
              <option value="">Choose an organization</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {String(organization.name ?? organization.id)}
                </option>
              ))}
            </Select>
            <FlowField label="Target tier">
              <Input
                value={value.targetTier}
                onChange={(event) =>
                  setValue({ targetTier: event.target.value })
                }
              />
            </FlowField>
            <Select
              label="Status"
              value={value.status}
              onChange={(status) => setValue({ status })}
            >
              {[
                "active",
                "watching",
                "contacting",
                "paused",
                "excluded",
                "completed"
              ].map((option) => (
                <option key={option} value={option}>
                  {readable(option)}
                </option>
              ))}
            </Select>
            <FlowField label="Next action">
              <Input
                value={value.nextAction}
                onChange={(event) =>
                  setValue({ nextAction: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Rationale" className="md:col-span-2">
              <Textarea
                rows={5}
                value={value.rationale}
                onChange={(event) =>
                  setValue({ rationale: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Warm introduction paths" hint="One per line">
              <Textarea
                rows={4}
                value={value.warmPaths}
                onChange={(event) =>
                  setValue({ warmPaths: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Exclusions" hint="One per line">
              <Textarea
                rows={4}
                value={value.exclusions}
                onChange={(event) =>
                  setValue({ exclusions: event.target.value })
                }
              />
            </FlowField>
            <FlowField
              label="Prior applications"
              hint="One factual reference per line"
              className="md:col-span-2"
            >
              <Textarea
                rows={4}
                value={value.priorApplications}
                onChange={(event) =>
                  setValue({ priorApplications: event.target.value })
                }
              />
            </FlowField>
          </div>
        )
      }
    ],
    [organizations, target]
  );
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Job search"
      title={target ? "Edit organization target" : "Add organization target"}
      description="Add a reusable organization to this job search."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={
        target ? "Save organization target" : "Add organization target"
      }
      pending={pending}
      error={error}
      draftPersistenceKey={`work-organization-target-${target?.id ?? campaignId}`}
      onSubmit={async () => {
        setPending(true);
        setError(null);
        const data = {
          organizationId: draft.organizationId,
          targetTier: draft.targetTier,
          rationale: draft.rationale,
          status: draft.status,
          evidence: [],
          warmPaths: lines(draft.warmPaths).map((description) => ({
            description
          })),
          exclusions: lines(draft.exclusions),
          priorApplications: lines(draft.priorApplications).map(
            (description) => ({ description })
          ),
          nextAction: draft.nextAction
        };
        try {
          if (target)
            await updateWorkSupportingRecord(
              userIds,
              "organizationTarget",
              target.id,
              { expectedRevision: Number(target.revision), data }
            );
          else
            await createWorkSupportingRecord(
              userIds,
              "organizationTarget",
              { data },
              campaignId
            );
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
