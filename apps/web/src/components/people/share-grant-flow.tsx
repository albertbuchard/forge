import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, Link2, ShieldAlert } from "lucide-react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { usePeopleGateway } from "@/components/people/people-gateway";
import {
  InlineEmpty,
  PeopleStateBanner
} from "@/components/people/people-status";
import type {
  PersonContext,
  ShareGrantDraft,
  SharePreset,
  SharePreview
} from "@/components/people/people-types";

type ShareFlowDraft = ShareGrantDraft & {
  preview: SharePreview | null;
  exclusionsReviewed: boolean;
};

const PRESET_OPTIONS: Array<{
  value: SharePreset;
  label: string;
  description: string;
}> = [
  {
    value: "availability",
    label: "Availability",
    description:
      "Shows whether you are free or busy for the chosen time range. Event titles and details stay hidden."
  },
  {
    value: "plans",
    label: "Plans",
    description:
      "Goal summaries for the chosen time range. Private notes stay hidden."
  },
  {
    value: "activity",
    label: "Activity",
    description:
      "Movement and workout totals for the chosen time range. Raw health samples stay hidden."
  },
  {
    value: "selected_records",
    label: "Selected records",
    description: "Only the records and fields you choose."
  },
  {
    value: "broad",
    label: "Broad share",
    description:
      "Every currently shareable, non-sensitive category shown in the final preview."
  }
];

function presetDefaults(preset: SharePreset) {
  switch (preset) {
    case "availability":
      return {
        projections: ["calendar.availability.v1"],
        fields: ["startsAt", "endsAt", "state"],
        exclusions: [
          "description",
          "participants",
          "linkedEntities",
          "providerRaw"
        ],
        precision: "free_busy",
        horizonDays: 30
      };
    case "plans":
      return {
        projections: ["goals.horizon_summary.v1"],
        fields: ["title", "shortDescription", "status", "horizon"],
        exclusions: ["privateNotes", "psycheLinks", "agentHistory"],
        precision: "summary",
        horizonDays: 90
      };
    case "activity":
      return {
        projections: ["health.cycling.aggregate.v1", "movement.aggregate.v1"],
        fields: [
          "duration",
          "distance",
          "activityCount",
          "units",
          "tripCount",
          "activeDays"
        ],
        exclusions: [
          "rawSamples",
          "route",
          "places",
          "startLocation",
          "endLocation",
          "timeline",
          "rawPoints"
        ],
        precision: "aggregate",
        horizonDays: 30
      };
    case "selected_records":
      return {
        projections: ["custom.selected_entities.v1"],
        fields: ["title", "summary"],
        exclusions: [
          "secret",
          "token",
          "password",
          "artifactBytes",
          "rawHealthSamples",
          "privatePsyche"
        ],
        precision: "selected",
        horizonDays: 30
      };
    case "broad":
      return {
        projections: [
          "calendar.availability.v1",
          "goals.horizon_summary.v1",
          "person.profile.v1"
        ],
        fields: [
          "startsAt",
          "endsAt",
          "state",
          "title",
          "shortDescription",
          "status",
          "horizon",
          "displayName",
          "pronouns",
          "timezone"
        ],
        exclusions: [
          "description",
          "participants",
          "linkedEntities",
          "providerRaw",
          "privateNotes",
          "psycheLinks",
          "agentHistory",
          "actorBinding",
          "peerAudit"
        ],
        precision: "projection_defaults",
        horizonDays: 30
      };
  }
}

function createDraft(context: PersonContext): ShareFlowDraft {
  const preset = "availability" as const;
  const defaults = presetDefaults(preset);
  return {
    personId: context.person.id,
    relationshipId: context.peer?.id ?? "",
    direction: "outgoing",
    preset,
    purpose: "",
    ...defaults,
    selectedRecordIds: [],
    expiresAt: null,
    retentionDays: 7,
    recipientDeviceIds:
      context.peer?.devices
        .filter((device) => device.trustState === "approved")
        .map((device) => device.id) ?? [],
    preview: null,
    exclusionsReviewed: false
  };
}

function parseList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function sharedInformationLabel(projectionId: string) {
  const knownLabels: Record<string, string> = {
    "calendar.availability.v1": "Calendar availability",
    "goals.horizon_summary.v1": "Goal summaries",
    "health.cycling.aggregate.v1": "Cycling totals",
    "movement.aggregate.v1": "Movement totals",
    "person.profile.v1": "Profile details",
    "custom.selected_entities.v1": "Selected records"
  };
  if (knownLabels[projectionId]) {
    return knownLabels[projectionId];
  }
  const words = projectionId
    .replace(/\.v\d+$/, "")
    .split(".")
    .flatMap((part) => part.split("_"))
    .filter(Boolean);
  const label = words.join(" ");
  return label
    ? `${label[0]!.toUpperCase()}${label.slice(1)}`
    : "Shared information";
}

function fieldLabel(field: string) {
  const words = field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .trim();
  return words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : "Field";
}

export function ShareGrantFlow({
  open,
  context,
  onOpenChange,
  onUpdated
}: {
  open: boolean;
  context: PersonContext;
  onOpenChange: (open: boolean) => void;
  onUpdated: (context: PersonContext) => void;
}) {
  const gateway = usePeopleGateway();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ShareFlowDraft>(() =>
    createDraft(context)
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(createDraft(context));
    setSubmitError(null);
  }, [context, open]);

  const previewMutation = useMutation({
    mutationFn: (input: ShareGrantDraft) => gateway.previewShareGrant(input),
    onSuccess: (preview) => {
      setDraft((current) => ({ ...current, preview }));
    }
  });

  const proposeMutation = useMutation({
    mutationFn: ({
      shareDraft,
      preview
    }: {
      shareDraft: ShareGrantDraft;
      preview: SharePreview;
    }) =>
      gateway.proposeShareGrant({
        draft: shareDraft,
        previewHash: preview.draftHash
      }),
    onSuccess: async (nextContext) => {
      queryClient.setQueryData(
        ["people", "context", context.person.id],
        nextContext
      );
      await queryClient.invalidateQueries({
        queryKey: ["people", "collection"]
      });
      onUpdated(nextContext);
      onOpenChange(false);
    }
  });

  const steps = useMemo<Array<QuestionFlowStep<ShareFlowDraft>>>(
    () => [
      {
        id: "direction",
        title: `You share with ${context.person.displayName}`,
        description: `This share goes from you to ${context.person.displayName} and only to devices you approve. What they share with you is controlled separately by them.`,
        render: () => (
          <div className="grid gap-3 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-info-soft)] p-4 text-sm leading-6 text-[var(--ui-ink-medium)]">
            <div className="flex items-center gap-2 font-medium text-[var(--ui-ink-strong)]">
              <Eye className="size-4 text-[var(--info)]" aria-hidden="true" />
              Direction: you to {context.person.displayName}
            </div>
            <p>
              The final preview shows exactly what approved devices can receive,
              how detailed it is, and how long Forge may keep a protected
              offline copy.
            </p>
          </div>
        )
      },
      {
        id: "preset",
        title: "Choose what to share",
        description:
          "Start with a category, then review every included field and exclusion before continuing.",
        render: (value, setValue) => (
          <FlowChoiceGrid
            columns={3}
            value={value.preset}
            onChange={(nextPreset) => {
              const preset = nextPreset as SharePreset;
              setValue({
                preset,
                ...presetDefaults(preset),
                selectedRecordIds: [],
                preview: null,
                exclusionsReviewed: false
              });
            }}
            options={PRESET_OPTIONS}
          />
        )
      },
      {
        id: "scope",
        title: "Choose the information and level of detail",
        description:
          "Forge can share only the data types, fields, records, and time range listed below.",
        render: (value, setValue) => {
          const selectableRecords = context.linkedRecords.filter(
            (record) => record.state === "active"
          );
          return (
            <div className="grid gap-4">
              <FlowField
                label="Purpose"
                description={`Shown to ${context.person.displayName} and saved in the security history.`}
                hint="Optional"
              >
                <Input
                  value={value.purpose}
                  onChange={(event) =>
                    setValue({ purpose: event.target.value, preview: null })
                  }
                  autoComplete="off"
                />
              </FlowField>
              <div className="grid gap-4 md:grid-cols-2">
                <FlowField label="Level of detail">
                  <select
                    value={value.precision}
                    onChange={(event) =>
                      setValue({ precision: event.target.value, preview: null })
                    }
                    className="interactive-tap min-h-11 w-full rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-[var(--ui-ink-strong)]"
                  >
                    {value.preset === "availability" ? (
                      <>
                        <option value="free_busy">Free/busy</option>
                        <option value="named">Named availability</option>
                      </>
                    ) : value.preset === "plans" ? (
                      <option value="summary">Summary</option>
                    ) : value.preset === "activity" ? (
                      <option value="aggregate">Weekly aggregate</option>
                    ) : value.preset === "selected_records" ? (
                      <option value="selected">Selected fields</option>
                    ) : (
                      <option value="projection_defaults">
                        Safe default for each data type
                      </option>
                    )}
                  </select>
                </FlowField>
                <FlowField label="Time range in days">
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={value.horizonDays}
                    onChange={(event) =>
                      setValue({
                        horizonDays: Math.max(
                          1,
                          Math.min(365, Number(event.target.value) || 1)
                        ),
                        preview: null
                      })
                    }
                  />
                </FlowField>
              </div>
              <FlowField
                label="Shared data types and exact IDs"
                description={value.projections
                  .map(
                    (projectionId) =>
                      `${sharedInformationLabel(projectionId)} (${projectionId})`
                  )
                  .join("; ")}
              >
                <Textarea
                  value={value.projections.join("\n")}
                  onChange={(event) =>
                    setValue({
                      projections: parseList(event.target.value),
                      preview: null
                    })
                  }
                  spellCheck={false}
                  autoComplete="off"
                />
              </FlowField>
              <FlowField
                label="Shared fields"
                description={value.fields
                  .map((field) => `${fieldLabel(field)} (${field})`)
                  .join("; ")}
              >
                <Textarea
                  value={value.fields.join("\n")}
                  onChange={(event) =>
                    setValue({
                      fields: parseList(event.target.value),
                      preview: null
                    })
                  }
                  autoComplete="off"
                />
              </FlowField>
              {value.preset === "selected_records" ? (
                <fieldset
                  className="grid gap-3"
                  aria-describedby="selected-records-description"
                >
                  <legend className="text-sm font-medium text-[var(--ui-ink-strong)]">
                    Selected records
                  </legend>
                  <p
                    id="selected-records-description"
                    className="text-sm leading-6 text-[var(--ui-ink-soft)]"
                  >
                    Choose from the active records linked to this person. Every
                    record must be selected individually.
                  </p>
                  {selectableRecords.length > 0 ? (
                    <div className="grid gap-2">
                      {selectableRecords.map((record) => {
                        const checked = value.selectedRecordIds.includes(
                          record.entityId
                        );
                        return (
                          <label
                            key={record.id}
                            className="grid min-h-14 grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-3 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 text-sm text-[var(--ui-ink-medium)]"
                          >
                            <input
                              type="checkbox"
                              className="mt-1 size-4"
                              checked={checked}
                              onChange={(event) =>
                                setValue({
                                  selectedRecordIds: event.target.checked
                                    ? [
                                        ...value.selectedRecordIds,
                                        record.entityId
                                      ]
                                    : value.selectedRecordIds.filter(
                                        (id) => id !== record.entityId
                                      ),
                                  preview: null
                                })
                              }
                            />
                            <Link2
                              className="mt-0.5 size-4 text-[var(--primary)]"
                              aria-hidden="true"
                            />
                            <span className="min-w-0">
                              <span className="block break-words font-medium text-[var(--ui-ink-strong)]">
                                {record.title ??
                                  `${record.entityType}: ${record.entityId}`}
                              </span>
                              <span className="mt-1 block break-words text-xs text-[var(--ui-ink-muted)]">
                                {record.entityType} · {record.relationship}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <InlineEmpty>
                      No active linked records are available to share.
                    </InlineEmpty>
                  )}
                  {value.selectedRecordIds.length === 0 ? (
                    <span role="alert" className="text-sm text-[var(--danger)]">
                      Select at least one record.
                    </span>
                  ) : null}
                </fieldset>
              ) : null}
              <FlowField
                label="Information that stays hidden"
                description={value.exclusions
                  .map((field) => `${fieldLabel(field)} (${field})`)
                  .join("; ")}
              >
                <Textarea
                  value={value.exclusions.join("\n")}
                  onChange={(event) =>
                    setValue({
                      exclusions: parseList(event.target.value),
                      preview: null,
                      exclusionsReviewed: false
                    })
                  }
                  autoComplete="off"
                />
              </FlowField>
              <label className="flex min-h-11 items-start gap-3 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 text-sm leading-6 text-[var(--ui-ink-medium)]">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={value.exclusionsReviewed}
                  onChange={(event) =>
                    setValue({
                      exclusionsReviewed: event.target.checked,
                      preview: null
                    })
                  }
                />
                <span>
                  I reviewed what stays hidden. Secrets, credentials, file
                  contents, private Psyche fields, raw health samples, and
                  private notes remain hidden even from Broad share.
                </span>
              </label>
            </div>
          );
        }
      },
      {
        id: "retention-devices",
        title: "Set when access ends and which devices can receive it",
        description:
          "A new device receives nothing until you approve it for this share.",
        render: (value, setValue) => (
          <div className="grid gap-5">
            <div className="grid gap-4 md:grid-cols-2">
              <FlowField label="Sharing ends" hint="Optional">
                <Input
                  type="date"
                  value={value.expiresAt?.slice(0, 10) ?? ""}
                  onChange={(event) =>
                    setValue({
                      expiresAt: event.target.value || null,
                      preview: null
                    })
                  }
                />
              </FlowField>
              <FlowField label="Keep protected offline copies for">
                <select
                  value={value.retentionDays}
                  onChange={(event) =>
                    setValue({
                      retentionDays: Number(event.target.value),
                      preview: null
                    })
                  }
                  className="interactive-tap min-h-11 w-full rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-[var(--ui-ink-strong)]"
                >
                  <option value={1}>1 day</option>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                </select>
              </FlowField>
            </div>
            <fieldset className="grid gap-3">
              <legend className="text-sm font-medium text-[var(--ui-ink-strong)]">
                Devices allowed to receive this
              </legend>
              {context.peer?.devices.map((device) => {
                const approved = device.trustState === "approved";
                const checked = value.recipientDeviceIds.includes(device.id);
                return (
                  <label
                    key={device.id}
                    className="flex min-h-11 items-start gap-3 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 text-sm text-[var(--ui-ink-medium)] has-[:disabled]:opacity-60"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 size-4"
                      disabled={!approved}
                      checked={checked}
                      onChange={(event) =>
                        setValue({
                          recipientDeviceIds: event.target.checked
                            ? [...value.recipientDeviceIds, device.id]
                            : value.recipientDeviceIds.filter(
                                (id) => id !== device.id
                              ),
                          preview: null
                        })
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-[var(--ui-ink-strong)]">
                        {device.label}
                      </span>
                      <span className="mt-1 block text-xs text-[var(--ui-ink-muted)]">
                        {approved
                          ? `${device.deviceType.replaceAll("_", " ")} · approved`
                          : `${device.deviceType.replaceAll("_", " ")} · pending your approval, no access`}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          </div>
        )
      },
      {
        id: "preview",
        title: draft.preview
          ? "Review exactly what will be shared"
          : "Prepare an exact preview",
        description:
          "Forge shows typical information and the most this could reveal before you send the sharing request.",
        render: (value) =>
          value.preview ? (
            <div className="grid gap-4" data-sensitive="share-preview">
              <PeopleStateBanner
                state="info"
                title={value.preview.directionLabel}
              >
                This preview matches the choices above. Forge will prepare a new
                preview after any change.
              </PeopleStateBanner>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                  <div className="text-sm font-semibold text-[var(--ui-ink-strong)]">
                    Typical information shared
                  </div>
                  <ul className="mt-3 grid list-disc gap-2 pl-5 text-sm leading-6 text-[var(--ui-ink-medium)]">
                    {value.preview.representativeOutput.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg border border-[color-mix(in_srgb,var(--warning)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-warning-soft)] p-4">
                  <div className="text-sm font-semibold text-[var(--ui-ink-strong)]">
                    Most information this could reveal
                  </div>
                  <ul className="mt-3 grid list-disc gap-2 pl-5 text-sm leading-6 text-[var(--ui-ink-medium)]">
                    {value.preview.worstCaseOutput.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 text-sm">
                <div className="font-semibold text-[var(--ui-ink-strong)]">
                  Always hidden
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {value.preview.excludedOutput.map((item) => (
                    <Badge key={item} size="sm" tone="meta" wrap>
                      {item}
                    </Badge>
                  ))}
                </div>
                <dl className="mt-4 grid gap-3 border-t border-[var(--ui-border-subtle)] pt-4 text-[var(--ui-ink-medium)] md:grid-cols-2">
                  <div>
                    <dt className="text-[var(--ui-ink-muted)]">Access ends</dt>
                    <dd className="mt-1">{value.preview.expiryLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--ui-ink-muted)]">How current</dt>
                    <dd className="mt-1">{value.preview.freshnessLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--ui-ink-muted)]">
                      Offline copies kept for
                    </dt>
                    <dd className="mt-1">{value.preview.retentionLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--ui-ink-muted)]">
                      Approved device IDs
                    </dt>
                    <dd className="mt-1">
                      {value.preview.recipientDeviceIds.join(", ") ||
                        "No devices"}
                    </dd>
                  </div>
                </dl>
              </div>
              {value.preview.warnings.map((warning) => (
                <PeopleStateBanner
                  key={warning}
                  state="warning"
                  title="Review required"
                >
                  {warning}
                </PeopleStateBanner>
              ))}
            </div>
          ) : (
            <div className="grid justify-items-center gap-3 rounded-lg border border-dashed border-[var(--ui-border-strong)] px-5 py-8 text-center">
              <ShieldAlert
                className="size-8 text-[var(--warning)]"
                aria-hidden="true"
              />
              <p className="max-w-lg text-sm leading-6 text-[var(--ui-ink-medium)]">
                Forge will show who can receive this share, what they may see,
                how current it may be, when access ends, and how long protected
                offline copies may remain. Preparing the preview changes
                nothing.
              </p>
            </div>
          )
      }
    ],
    [context, draft.preview]
  );

  const shareDraft: ShareGrantDraft = {
    personId: draft.personId,
    relationshipId: draft.relationshipId,
    direction: draft.direction,
    preset: draft.preset,
    purpose: draft.purpose,
    projections: draft.projections,
    fields: draft.fields,
    selectedRecordIds: draft.selectedRecordIds,
    exclusions: draft.exclusions,
    precision: draft.precision,
    horizonDays: draft.horizonDays,
    expiresAt: draft.expiresAt,
    retentionDays: draft.retentionDays,
    recipientDeviceIds: draft.recipientDeviceIds
  };
  const pending = previewMutation.isPending || proposeMutation.isPending;
  const mutationError = previewMutation.error ?? proposeMutation.error;

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Selective sharing"
      title={`Share with ${context.person.displayName}`}
      description={`Choose exactly what ${context.person.displayName} can receive, then review it before sending.`}
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={
        draft.preview ? "Send sharing request" : "Preview exact share"
      }
      pending={pending}
      pendingLabel={
        previewMutation.isPending ? "Preparing preview" : "Sending request"
      }
      error={
        submitError ??
        (mutationError instanceof Error ? mutationError.message : null)
      }
      resolveContinueBlocker={(stepId, value) => {
        if (stepId === "scope" && value.projections.length === 0) {
          return "Select at least one shared data type.";
        }
        if (stepId === "scope" && value.fields.length === 0) {
          return "Select at least one field.";
        }
        if (
          stepId === "scope" &&
          value.preset === "selected_records" &&
          value.selectedRecordIds.length === 0
        ) {
          return "Select at least one exact record.";
        }
        if (stepId === "scope" && !value.exclusionsReviewed) {
          return "Review the exclusions before continuing.";
        }
        if (
          stepId === "retention-devices" &&
          value.recipientDeviceIds.length === 0
        ) {
          return "Select at least one approved recipient device.";
        }
        return null;
      }}
      onSubmit={async () => {
        if (!context.peer) {
          setSubmitError(
            `Connect ${context.person.displayName}'s Forge before sharing.`
          );
          return;
        }
        if (!draft.exclusionsReviewed) {
          setSubmitError("Review the exclusions before previewing the share.");
          return;
        }
        if (
          draft.projections.length === 0 ||
          draft.fields.length === 0 ||
          draft.recipientDeviceIds.length === 0
        ) {
          setSubmitError(
            "The share needs a data type, field, and approved recipient device."
          );
          return;
        }
        if (
          draft.preset === "selected_records" &&
          draft.selectedRecordIds.length === 0
        ) {
          setSubmitError("Select at least one exact record.");
          return;
        }
        setSubmitError(null);
        try {
          if (!draft.preview) {
            await previewMutation.mutateAsync(shareDraft);
            return;
          }
          await proposeMutation.mutateAsync({
            shareDraft,
            preview: draft.preview
          });
        } catch {
          // The active mutation error is rendered by the guided flow.
        }
      }}
    />
  );
}
