import { useMemo, useState } from "react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createWorkEngagement,
  createWorkOrganization,
  type WorkRecord
} from "@/lib/work-api";
import {
  errorMessage,
  workInterfaceProvenance as provenance
} from "@/components/work/work-dialog-helpers";
import {
  emptyEngagement,
  engagementCreatePayload,
  engagementFlowSteps
} from "@/components/work/work-engagement-flow";

type OrganizationDraft = {
  name: string;
  domain: string;
  websiteUrl: string;
  location: string;
  description: string;
  status: "active" | "target" | "past";
};

const emptyOrganization: OrganizationDraft = {
  name: "",
  domain: "",
  websiteUrl: "",
  location: "",
  description: "",
  status: "active"
};

export function WorkOrganizationDialog({
  open,
  onOpenChange,
  userIds,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(emptyOrganization);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const steps = useMemo<Array<QuestionFlowStep<OrganizationDraft>>>(
    () => [
      {
        id: "identity",
        eyebrow: "Organization",
        title: "Who is the employer or client?",
        description:
          "Create one reusable Organization record instead of copying company facts into every role and application.",
        render: (value, setValue) => (
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="Name" className="md:col-span-2">
              <Input
                value={value.name}
                onChange={(event) => setValue({ name: event.target.value })}
                autoFocus
              />
            </FlowField>
            <FlowField label="Domain or sector">
              <Input
                value={value.domain}
                onChange={(event) => setValue({ domain: event.target.value })}
                placeholder="Medical AI, hospitality…"
              />
            </FlowField>
            <FlowField label="Website">
              <Input
                value={value.websiteUrl}
                onChange={(event) =>
                  setValue({ websiteUrl: event.target.value })
                }
                placeholder="https://…"
                inputMode="url"
              />
            </FlowField>
            <FlowField label="Location" className="md:col-span-2">
              <Input
                value={value.location}
                onChange={(event) => setValue({ location: event.target.value })}
                placeholder="City, region, or distributed"
              />
            </FlowField>
          </div>
        )
      },
      {
        id: "context",
        eyebrow: "Context",
        title: "What should Forge remember?",
        description:
          "Keep factual context here. Personal contacts, compensation, and documents belong on their permissioned records.",
        render: (value, setValue) => (
          <div className="grid gap-4">
            <FlowChoiceGrid
              value={value.status}
              onChange={(status) =>
                setValue({ status: status as OrganizationDraft["status"] })
              }
              options={[
                {
                  value: "active",
                  label: "Active",
                  description: "A current employer, client, or organization."
                },
                {
                  value: "target",
                  label: "Target",
                  description: "An organization you may want to work with."
                },
                {
                  value: "past",
                  label: "Past",
                  description: "Historical work context."
                }
              ]}
              columns={3}
            />
            <FlowField label="Description">
              <Textarea
                value={value.description}
                onChange={(event) =>
                  setValue({ description: event.target.value })
                }
                rows={7}
              />
            </FlowField>
          </div>
        )
      }
    ],
    []
  );
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Organization"
      title="Add organization"
      description="Create a reusable employer or client record."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel="Add organization"
      pending={pending}
      pendingLabel="Adding organization…"
      error={error}
      resolveContinueBlocker={(step) =>
        step === "identity" && !draft.name.trim()
          ? "Enter the organization name."
          : null
      }
      draftPersistenceKey="work-organization-new"
      onSubmit={async () => {
        setPending(true);
        setError(null);
        try {
          await createWorkOrganization(userIds, {
            name: draft.name,
            aliases: [],
            domain: draft.domain,
            websiteUrl: draft.websiteUrl,
            location: draft.location ? { label: draft.location } : {},
            organizationFacts: {},
            status: draft.status,
            description: draft.description,
            visibility: "private",
            scope: { projectIds: [], tagIds: [] },
            provenance
          });
          setDraft(emptyOrganization);
          onOpenChange(false);
          await onSaved();
        } catch (caught) {
          setError(errorMessage(caught));
        } finally {
          setPending(false);
        }
      }}
    />
  );
}

export function WorkEngagementDialog({
  open,
  onOpenChange,
  userIds,
  organizations,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  organizations: WorkRecord[];
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(emptyEngagement);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const steps = useMemo(
    () => engagementFlowSteps(organizations),
    [organizations]
  );
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Current work"
      title="Add work engagement"
      description="Represent a current or planned work arrangement."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel="Add work engagement"
      pending={pending}
      pendingLabel="Adding work…"
      error={error}
      resolveContinueBlocker={(step) =>
        step === "role" && !draft.title.trim()
          ? "Enter the job or engagement title."
          : null
      }
      draftPersistenceKey="work-engagement-new"
      onSubmit={async () => {
        setPending(true);
        setError(null);
        try {
          await createWorkEngagement(userIds, engagementCreatePayload(draft));
          setDraft(emptyEngagement);
          onOpenChange(false);
          await onSaved();
        } catch (caught) {
          setError(errorMessage(caught));
        } finally {
          setPending(false);
        }
      }}
    />
  );
}
