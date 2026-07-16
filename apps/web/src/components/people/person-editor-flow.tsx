import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import {
  EntityLinkMultiSelect,
  type EntityLinkOption
} from "@/components/psyche/entity-link-multiselect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { usePeopleGateway } from "@/components/people/people-gateway";
import type {
  PersonContext,
  PersonEntityLinkInput,
  SavePersonInput
} from "@/components/people/people-types";

function emptyPersonDraft(): SavePersonInput {
  return {
    displayName: "",
    givenName: null,
    middleName: null,
    familyName: null,
    preferredName: null,
    pronouns: null,
    aliases: [],
    relationshipCategory: "friend",
    relationshipLabel: null,
    closeness: null,
    importance: "normal",
    importanceScore: 3,
    shortDescription: null,
    description: null,
    privateNotes: null,
    howWeMet: null,
    metAt: null,
    birthday: {
      year: null,
      month: null,
      day: null,
      precision: "unknown"
    },
    timezone: null,
    homePlaceLabel: null,
    contactMethods: [],
    facts: [],
    linkUpdate: { mode: "replace_complete", links: [] }
  };
}

function draftFromContext(context: PersonContext | null): SavePersonInput {
  if (!context) {
    return emptyPersonDraft();
  }
  const { person } = context;
  return {
    id: person.id,
    displayName: person.displayName,
    givenName: person.givenName,
    middleName: person.middleName,
    familyName: person.familyName,
    preferredName: person.preferredName,
    pronouns: person.pronouns,
    aliases: person.aliases,
    relationshipCategory: person.relationshipCategory,
    relationshipLabel: person.relationshipLabel,
    closeness: person.closeness,
    importance: person.importance,
    importanceScore: person.importanceScore,
    shortDescription: person.shortDescription,
    description: person.description,
    privateNotes: person.privateNotes,
    howWeMet: person.howWeMet,
    metAt: person.metAt,
    birthday: person.birthday,
    timezone: person.timezone,
    homePlaceLabel: person.homePlaceLabel,
    contactMethods: person.contactMethods.map(
      ({ id: _id, ...method }) => method
    ),
    facts: person.facts.map(
      ({ id: _id, reviewedAt: _reviewedAt, ...fact }) => fact
    ),
    linkUpdate: { mode: "unchanged" },
    expectedUpdatedAt: person.updatedAt
  };
}

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseAliases(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function entityLinkValue(entityType: string, entityId: string) {
  return JSON.stringify([entityType, entityId]);
}

function parseEntityLinkValue(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      parsed.every((part) => typeof part === "string" && part.trim())
    ) {
      return { entityType: parsed[0]!, entityId: parsed[1]! };
    }
  } catch {
    // Ignore malformed picker values rather than sending an invalid graph edge.
  }
  return null;
}

function replaceSelectedEntityLinks(
  links: PersonEntityLinkInput[],
  selectedValues: string[]
) {
  const selected = selectedValues
    .map(parseEntityLinkValue)
    .filter((value): value is NonNullable<typeof value> => value !== null);
  const selectedKeys = new Set(
    selected.map(({ entityType, entityId }) =>
      entityLinkValue(entityType, entityId)
    )
  );
  const next = links.filter((link) =>
    selectedKeys.has(entityLinkValue(link.entityType, link.entityId))
  );
  const existingKeys = new Set(
    next.map((link) => entityLinkValue(link.entityType, link.entityId))
  );
  for (const link of selected) {
    const key = entityLinkValue(link.entityType, link.entityId);
    if (!existingKeys.has(key)) {
      next.push({ ...link, anchorKey: null, relationship: "related_to" });
      existingKeys.add(key);
    }
  }
  return next;
}

type BirthdayDraft = SavePersonInput["birthday"];

function normalizeBirthdayPrecision(
  birthday: BirthdayDraft,
  precision: BirthdayDraft["precision"]
): BirthdayDraft {
  switch (precision) {
    case "unknown":
      return { precision, year: null, month: null, day: null };
    case "year":
      return { precision, year: birthday.year, month: null, day: null };
    case "month_day":
      return {
        precision,
        year: null,
        month: birthday.month,
        day: birthday.day
      };
    case "year_month":
      return {
        precision,
        year: birthday.year,
        month: birthday.month,
        day: null
      };
    case "full":
      return { ...birthday, precision };
  }
}

function birthdayValidationMessage(birthday: BirthdayDraft) {
  const { day, month, precision, year } = birthday;
  if (precision === "unknown") {
    return year === null && month === null && day === null
      ? null
      : "Unknown precision cannot include birthday parts.";
  }
  if (
    precision === "year" ||
    precision === "year_month" ||
    precision === "full"
  ) {
    if (!Number.isInteger(year) || year === null || year < 1 || year > 9999) {
      return "Enter a valid birthday year.";
    }
  } else if (year !== null) {
    return "Month-and-day precision cannot include a year.";
  }
  if (
    precision === "month_day" ||
    precision === "year_month" ||
    precision === "full"
  ) {
    if (!Number.isInteger(month) || month === null || month < 1 || month > 12) {
      return "Enter a birthday month from 1 to 12.";
    }
    if (precision !== "year_month") {
      if (!Number.isInteger(day) || day === null || day < 1 || day > 31) {
        return "Enter a valid birthday day.";
      }
      const validationYear = year ?? 2000;
      const candidate = new Date(0);
      candidate.setUTCHours(0, 0, 0, 0);
      candidate.setUTCFullYear(validationYear, month - 1, day);
      if (
        candidate.getUTCFullYear() !== validationYear ||
        candidate.getUTCMonth() !== month - 1 ||
        candidate.getUTCDate() !== day
      ) {
        return "Enter a real calendar date.";
      }
    } else if (day !== null) {
      return "Year-and-month precision cannot include a day.";
    }
  } else if (month !== null || day !== null) {
    return "Year-only precision cannot include a month or day.";
  }
  return null;
}

function detailsValidationMessage(value: SavePersonInput) {
  if (value.aliases.length > 256) {
    return "Keep aliases to 256 or fewer entries.";
  }
  if (value.contactMethods.length > 256) {
    return "Keep contact methods to 256 or fewer entries.";
  }
  if (value.facts.length > 1_000) {
    return "Keep local facts to 1,000 or fewer entries.";
  }
  const links =
    value.linkUpdate.mode === "replace_complete" ? value.linkUpdate.links : [];
  const invalidLinkIndex = links.findIndex(
    (link) =>
      !link.entityType.trim() ||
      !link.entityId.trim() ||
      !link.relationship.trim()
  );
  if (invalidLinkIndex >= 0) {
    return `Remove invalid linked record ${invalidLinkIndex + 1}.`;
  }
  const incompleteContactIndex = value.contactMethods.findIndex(
    (method) => !method.label.trim() || !method.value.trim()
  );
  if (incompleteContactIndex >= 0) {
    return `Complete or remove contact method ${incompleteContactIndex + 1}.`;
  }
  const incompleteFactIndex = value.facts.findIndex(
    (fact) => !fact.label.trim() || !fact.value.trim()
  );
  if (incompleteFactIndex >= 0) {
    return `Complete or remove fact ${incompleteFactIndex + 1}.`;
  }
  return null;
}

function timezoneValidationMessage(value: string | null) {
  if (!value) {
    return null;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return null;
  } catch {
    return "Enter a valid IANA time zone, such as Europe/Zurich.";
  }
}

export function PersonEditorFlow({
  open,
  context,
  onOpenChange,
  onSaved
}: {
  open: boolean;
  context: PersonContext | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (context: PersonContext) => void;
}) {
  const gateway = usePeopleGateway();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<SavePersonInput>(() =>
    draftFromContext(context)
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(draftFromContext(context));
    setError(null);
  }, [context, open]);

  const saveMutation = useMutation({
    mutationFn: (input: SavePersonInput) => gateway.savePerson(input),
    onSuccess: async (nextContext) => {
      queryClient.setQueryData(
        ["people", "context", nextContext.person.id],
        nextContext
      );
      await queryClient.invalidateQueries({
        queryKey: ["people", "collection"]
      });
      onSaved(nextContext);
      onOpenChange(false);
    }
  });

  const currentLinkOptions = useMemo<EntityLinkOption[]>(
    () =>
      (context?.linkedRecords ?? [])
        .filter(
          (record) =>
            record.direction === "outgoing" && record.state === "active"
        )
        .map((record) => ({
          value: entityLinkValue(record.entityType, record.entityId),
          label:
            record.title ??
            `${record.entityType.replaceAll("_", " ")} ${record.entityId}`,
          description: `${record.entityType.replaceAll("_", " ")} - ${record.relationship}`
        })),
    [context?.linkedRecords]
  );
  const searchLinkOptions = useCallback(
    async (query: string): Promise<EntityLinkOption[]> =>
      (
        await gateway.searchLinkableEntities({
          query,
          excludePersonId: context?.person.id,
          limit: 40
        })
      ).map((candidate) => ({
        value: entityLinkValue(candidate.entityType, candidate.entityId),
        label: candidate.label,
        description:
          candidate.description ?? candidate.entityType.replaceAll("_", " ")
      })),
    [context?.person.id, gateway]
  );
  const initialOutgoingLinks = useMemo(
    () =>
      (context?.linkedRecords ?? [])
        .filter(
          (record) =>
            record.direction === "outgoing" && record.state === "active"
        )
        .map((record) => ({
          entityType: record.entityType,
          entityId: record.entityId,
          anchorKey: record.anchorKey,
          relationship: record.relationship
        })),
    [context?.linkedRecords]
  );
  const linksEditable =
    !context || context.coverage.linkedRecords === "complete";

  const steps = useMemo<Array<QuestionFlowStep<SavePersonInput>>>(
    () => [
      {
        id: "identity",
        title: context
          ? `Update ${context.person.displayName}`
          : "Who would you like to remember?",
        description:
          "Start with the name you use for them. Add anything else that helps you recognize the right person.",
        render: (value, setValue) => (
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="Display name">
              <Input
                autoFocus
                value={value.displayName}
                onChange={(event) =>
                  setValue({ displayName: event.target.value })
                }
                autoComplete="off"
              />
            </FlowField>
            <FlowField label="Preferred name" hint="Optional">
              <Input
                value={value.preferredName ?? ""}
                onChange={(event) =>
                  setValue({ preferredName: nullable(event.target.value) })
                }
                autoComplete="off"
              />
            </FlowField>
            <FlowField label="Given name" hint="Optional">
              <Input
                value={value.givenName ?? ""}
                onChange={(event) =>
                  setValue({ givenName: nullable(event.target.value) })
                }
                autoComplete="off"
              />
            </FlowField>
            <FlowField label="Middle name" hint="Optional">
              <Input
                value={value.middleName ?? ""}
                onChange={(event) =>
                  setValue({ middleName: nullable(event.target.value) })
                }
                autoComplete="off"
              />
            </FlowField>
            <FlowField label="Family name" hint="Optional">
              <Input
                value={value.familyName ?? ""}
                onChange={(event) =>
                  setValue({ familyName: nullable(event.target.value) })
                }
                autoComplete="off"
              />
            </FlowField>
            <FlowField label="Pronouns" hint="Optional">
              <Input
                value={value.pronouns ?? ""}
                onChange={(event) =>
                  setValue({ pronouns: nullable(event.target.value) })
                }
                autoComplete="off"
              />
            </FlowField>
            <div className="md:col-span-2">
              <FlowField
                label="Aliases"
                description={
                  context
                    ? "Shown for reference. The current update API cannot replace aliases on an existing Person."
                    : "Comma-separated nicknames, former names, or handles."
                }
                hint="Optional"
              >
                <Input
                  value={value.aliases.join(", ")}
                  disabled={Boolean(context)}
                  onChange={(event) =>
                    setValue({ aliases: parseAliases(event.target.value) })
                  }
                  autoComplete="off"
                />
              </FlowField>
            </div>
          </div>
        )
      },
      {
        id: "relationship",
        title: "How do you know them?",
        description:
          "Choose the closest match, then add your own label if it would be useful.",
        render: (value, setValue) => (
          <div className="grid gap-5">
            <FlowChoiceGrid
              columns={3}
              value={value.relationshipCategory}
              onChange={(relationshipCategory) =>
                setValue({
                  relationshipCategory:
                    relationshipCategory as SavePersonInput["relationshipCategory"]
                })
              }
              options={[
                { value: "family", label: "Family" },
                { value: "friend", label: "Friend" },
                { value: "partner", label: "Partner" },
                { value: "colleague", label: "Colleague" },
                { value: "community", label: "Community" },
                { value: "professional", label: "Professional" },
                { value: "other", label: "Other" }
              ]}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <FlowField label="Relationship label" hint="Optional">
                <Input
                  value={value.relationshipLabel ?? ""}
                  onChange={(event) =>
                    setValue({
                      relationshipLabel: nullable(event.target.value)
                    })
                  }
                  placeholder="For example, cousin or research collaborator"
                />
              </FlowField>
              <FlowField
                label="Closeness"
                description="1 is distant; 5 is very close."
                hint="Optional"
              >
                <select
                  value={value.closeness ?? ""}
                  onChange={(event) =>
                    setValue({
                      closeness: event.target.value
                        ? Number.parseInt(event.target.value, 10)
                        : null
                    })
                  }
                  className="interactive-tap min-h-11 w-full rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-[var(--ui-ink-strong)]"
                >
                  <option value="">Not set</option>
                  <option value={0}>0 - No closeness</option>
                  {[1, 2, 3, 4, 5].map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </FlowField>
            </div>
            <FlowChoiceGrid
              value={value.importance}
              onChange={(importance) => {
                const nextImportance =
                  importance as SavePersonInput["importance"];
                setValue({
                  importance: nextImportance,
                  importanceScore:
                    nextImportance === "essential"
                      ? 5
                      : nextImportance === "high"
                        ? 4
                        : nextImportance === "normal"
                          ? 3
                          : 1
                });
              }}
              options={[
                { value: "low", label: "Low" },
                { value: "normal", label: "Normal" },
                { value: "high", label: "High" },
                { value: "essential", label: "Essential" }
              ]}
            />
          </div>
        )
      },
      {
        id: "context",
        title: "What would help you remember this relationship?",
        description:
          "Add only what feels useful. You decide separately whether any eligible detail is ever shared.",
        render: (value, setValue) => (
          <div className="grid gap-4">
            <FlowField label="Short description" hint="Optional">
              <Input
                value={value.shortDescription ?? ""}
                onChange={(event) =>
                  setValue({ shortDescription: nullable(event.target.value) })
                }
                autoComplete="off"
              />
            </FlowField>
            <FlowField label="Relationship context" hint="Optional">
              <Textarea
                value={value.description ?? ""}
                onChange={(event) =>
                  setValue({ description: nullable(event.target.value) })
                }
                autoComplete="off"
              />
            </FlowField>
            <FlowField
              label="Private notes"
              description="Private notes are never included by a preset."
              hint="Optional"
            >
              <Textarea
                value={value.privateNotes ?? ""}
                onChange={(event) =>
                  setValue({ privateNotes: nullable(event.target.value) })
                }
                autoComplete="off"
              />
            </FlowField>
            <FlowField label="How you met" hint="Optional">
              <Textarea
                value={value.howWeMet ?? ""}
                onChange={(event) =>
                  setValue({ howWeMet: nullable(event.target.value) })
                }
                autoComplete="off"
              />
            </FlowField>
          </div>
        )
      },
      {
        id: "dates-place",
        title: "Are there dates or places worth remembering?",
        description:
          "Leave anything uncertain blank. A partial birthday stays partial.",
        render: (value, setValue) => (
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="When you met" hint="Optional">
              <Input
                type="date"
                value={value.metAt ?? ""}
                onChange={(event) =>
                  setValue({ metAt: nullable(event.target.value) })
                }
              />
            </FlowField>
            <FlowField
              label="Birthday precision"
              error={birthdayValidationMessage(value.birthday)}
            >
              <select
                value={value.birthday.precision}
                onChange={(event) =>
                  setValue({
                    birthday: normalizeBirthdayPrecision(
                      value.birthday,
                      event.target
                        .value as SavePersonInput["birthday"]["precision"]
                    )
                  })
                }
                className="interactive-tap min-h-11 w-full rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-[var(--ui-ink-strong)]"
              >
                <option value="unknown">Unknown</option>
                <option value="year">Year only</option>
                <option value="year_month">Year and month</option>
                <option value="month_day">Month and day</option>
                <option value="full">Full date</option>
              </select>
            </FlowField>
            {value.birthday.precision === "year" ||
            value.birthday.precision === "year_month" ||
            value.birthday.precision === "full" ? (
              <FlowField label="Birthday year">
                <Input
                  type="number"
                  min={1}
                  max={9999}
                  value={value.birthday.year ?? ""}
                  onChange={(event) =>
                    setValue({
                      birthday: {
                        ...value.birthday,
                        year: event.target.value
                          ? Number(event.target.value)
                          : null
                      }
                    })
                  }
                />
              </FlowField>
            ) : null}
            {value.birthday.precision === "month_day" ||
            value.birthday.precision === "year_month" ||
            value.birthday.precision === "full" ? (
              <div className="grid grid-cols-2 gap-3">
                <FlowField label="Birthday month">
                  <Input
                    type="number"
                    min={1}
                    max={12}
                    value={value.birthday.month ?? ""}
                    onChange={(event) =>
                      setValue({
                        birthday: {
                          ...value.birthday,
                          month: event.target.value
                            ? Number(event.target.value)
                            : null
                        }
                      })
                    }
                  />
                </FlowField>
                {value.birthday.precision !== "year_month" ? (
                  <FlowField label="Birthday day">
                    <Input
                      type="number"
                      min={1}
                      max={31}
                      value={value.birthday.day ?? ""}
                      onChange={(event) =>
                        setValue({
                          birthday: {
                            ...value.birthday,
                            day: event.target.value
                              ? Number(event.target.value)
                              : null
                          }
                        })
                      }
                    />
                  </FlowField>
                ) : null}
              </div>
            ) : null}
            {value.birthday.precision === "unknown" ? (
              <p
                role="status"
                className="self-center text-sm leading-6 text-[var(--ui-ink-muted)]"
              >
                No birthday parts will be saved.
              </p>
            ) : null}
            <FlowField
              label="Timezone"
              hint="Optional"
              error={timezoneValidationMessage(value.timezone)}
            >
              <Input
                value={value.timezone ?? ""}
                onChange={(event) =>
                  setValue({ timezone: nullable(event.target.value) })
                }
                placeholder="Europe/Zurich"
                autoComplete="off"
              />
            </FlowField>
            <FlowField label="Home place label" hint="Optional">
              <Input
                value={value.homePlaceLabel ?? ""}
                onChange={(event) =>
                  setValue({ homePlaceLabel: nullable(event.target.value) })
                }
                autoComplete="off"
              />
            </FlowField>
          </div>
        )
      },
      {
        id: "contacts-facts",
        title: "What else should stay connected to this person?",
        description:
          "Link related Forge records, then add contact details or facts you want close at hand.",
        render: (value, setValue) => (
          <div className="grid gap-7">
            <fieldset
              disabled={!linksEditable}
              aria-labelledby="person-linked-records-heading"
            >
              <legend
                id="person-linked-records-heading"
                className="text-sm font-semibold text-[var(--ui-ink-strong)]"
              >
                Linked records
              </legend>
              <div className="mt-3">
                <EntityLinkMultiSelect
                  options={currentLinkOptions}
                  selectedValues={Array.from(
                    new Set(
                      (value.linkUpdate.mode === "replace_complete"
                        ? value.linkUpdate.links
                        : initialOutgoingLinks
                      ).map((link) =>
                        entityLinkValue(link.entityType, link.entityId)
                      )
                    )
                  )}
                  onChange={(selectedValues) =>
                    setValue({
                      linkUpdate: {
                        mode: "replace_complete",
                        links: replaceSelectedEntityLinks(
                          value.linkUpdate.mode === "replace_complete"
                            ? value.linkUpdate.links
                            : initialOutgoingLinks,
                          selectedValues
                        )
                      }
                    })
                  }
                  onSearch={searchLinkOptions}
                  placeholder="Search Forge records"
                  emptyMessage="No matching owner-scoped records found."
                />
              </div>
              {!linksEditable ? (
                <p
                  role="status"
                  className="mt-3 text-sm leading-6 text-[var(--ui-ink-muted)]"
                >
                  Linked records are read-only because this Person reached the
                  context limit. Scalar edits will preserve every unseen link.
                </p>
              ) : null}
            </fieldset>

            {context ? (
              <p
                role="status"
                className="rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-info-soft)] p-3 text-sm leading-6 text-[var(--ui-ink-medium)]"
              >
                Aliases, contacts, and facts are read-only for existing People;
                the current update contract supports scalar profile fields and
                entity links only.
              </p>
            ) : null}

            <fieldset disabled={Boolean(context)} className="contents">
              <legend className="sr-only">Local contacts and facts</legend>
              <section aria-labelledby="person-contact-methods-heading">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3
                    id="person-contact-methods-heading"
                    className="text-sm font-semibold text-[var(--ui-ink-strong)]"
                  >
                    Contact methods
                  </h3>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="min-h-11"
                    onClick={() =>
                      setValue({
                        contactMethods: [
                          ...value.contactMethods,
                          {
                            kind: "email",
                            label: "",
                            value: "",
                            isPrimary: value.contactMethods.length === 0
                          }
                        ]
                      })
                    }
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    Add contact
                  </Button>
                </div>
                {value.contactMethods.length > 0 ? (
                  <div className="mt-3 grid gap-4">
                    {value.contactMethods.map((method, index) => (
                      <fieldset
                        key={`contact-${index}`}
                        className="grid gap-4 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 md:grid-cols-2"
                      >
                        <legend className="sr-only">
                          Contact method {index + 1}
                        </legend>
                        <div className="flex items-start justify-between gap-3 md:col-span-2">
                          <span className="text-xs font-medium text-[var(--ui-ink-muted)]">
                            Contact method {index + 1}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="size-11 shrink-0 px-0 text-[var(--danger)]"
                            aria-label={`Remove contact method ${index + 1}`}
                            title={`Remove contact method ${index + 1}`}
                            onClick={() =>
                              setValue({
                                contactMethods: value.contactMethods.filter(
                                  (_item, itemIndex) => itemIndex !== index
                                )
                              })
                            }
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        </div>
                        <FlowField label="Contact type">
                          <select
                            value={method.kind}
                            onChange={(event) =>
                              setValue({
                                contactMethods: value.contactMethods.map(
                                  (item, itemIndex) =>
                                    itemIndex === index
                                      ? {
                                          ...item,
                                          kind: event.target
                                            .value as SavePersonInput["contactMethods"][number]["kind"]
                                        }
                                      : item
                                )
                              })
                            }
                            className="interactive-tap min-h-11 w-full rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-[var(--ui-ink-strong)]"
                          >
                            {[
                              "email",
                              "phone",
                              "messaging",
                              "social",
                              "address",
                              "website",
                              "custom"
                            ].map((kind) => (
                              <option key={kind} value={kind}>
                                {kind}
                              </option>
                            ))}
                          </select>
                        </FlowField>
                        <FlowField
                          label="Contact label"
                          error={
                            method.label.trim()
                              ? null
                              : "Enter a label or remove this contact."
                          }
                        >
                          <Input
                            value={method.label}
                            onChange={(event) =>
                              setValue({
                                contactMethods: value.contactMethods.map(
                                  (item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, label: event.target.value }
                                      : item
                                )
                              })
                            }
                            autoComplete="off"
                          />
                        </FlowField>
                        <div className="md:col-span-2">
                          <FlowField
                            label="Contact value"
                            error={
                              method.value.trim()
                                ? null
                                : "Enter a value or remove this contact."
                            }
                          >
                            <Input
                              value={method.value}
                              onChange={(event) =>
                                setValue({
                                  contactMethods: value.contactMethods.map(
                                    (item, itemIndex) =>
                                      itemIndex === index
                                        ? { ...item, value: event.target.value }
                                        : item
                                  )
                                })
                              }
                              autoComplete="off"
                            />
                          </FlowField>
                        </div>
                        <label className="flex min-h-11 items-center gap-3 text-sm text-[var(--ui-ink-medium)] md:col-span-2">
                          <input
                            type="checkbox"
                            className="size-4"
                            checked={method.isPrimary}
                            onChange={(event) =>
                              setValue({
                                contactMethods: value.contactMethods.map(
                                  (item, itemIndex) => ({
                                    ...item,
                                    isPrimary:
                                      itemIndex === index
                                        ? event.target.checked
                                        : event.target.checked &&
                                            item.kind === method.kind
                                          ? false
                                          : item.isPrimary
                                  })
                                )
                              })
                            }
                          />
                          Primary {method.kind} contact
                        </label>
                      </fieldset>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-[var(--ui-ink-muted)]">
                    No contact methods recorded.
                  </p>
                )}
              </section>

              <section aria-labelledby="person-facts-heading">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3
                    id="person-facts-heading"
                    className="text-sm font-semibold text-[var(--ui-ink-strong)]"
                  >
                    Local facts
                  </h3>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="min-h-11"
                    onClick={() =>
                      setValue({
                        facts: [
                          ...value.facts,
                          {
                            label: "",
                            value: "",
                            sensitivity: "personal",
                            sourceLabel: "This Forge"
                          }
                        ]
                      })
                    }
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    Add fact
                  </Button>
                </div>
                {value.facts.length > 0 ? (
                  <div className="mt-3 grid gap-4">
                    {value.facts.map((fact, index) => (
                      <fieldset
                        key={`fact-${index}`}
                        className="grid gap-4 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 md:grid-cols-2"
                      >
                        <legend className="sr-only">Fact {index + 1}</legend>
                        <div className="flex items-start justify-between gap-3 md:col-span-2">
                          <span className="text-xs font-medium text-[var(--ui-ink-muted)]">
                            Fact {index + 1}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="size-11 shrink-0 px-0 text-[var(--danger)]"
                            aria-label={`Remove fact ${index + 1}`}
                            title={`Remove fact ${index + 1}`}
                            onClick={() =>
                              setValue({
                                facts: value.facts.filter(
                                  (_item, itemIndex) => itemIndex !== index
                                )
                              })
                            }
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        </div>
                        <FlowField
                          label="Fact label"
                          error={
                            fact.label.trim()
                              ? null
                              : "Enter a label or remove this fact."
                          }
                        >
                          <Input
                            value={fact.label}
                            onChange={(event) =>
                              setValue({
                                facts: value.facts.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, label: event.target.value }
                                    : item
                                )
                              })
                            }
                            autoComplete="off"
                          />
                        </FlowField>
                        <FlowField label="Fact sensitivity">
                          <select
                            value={fact.sensitivity}
                            onChange={(event) =>
                              setValue({
                                facts: value.facts.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        sensitivity: event.target
                                          .value as SavePersonInput["facts"][number]["sensitivity"]
                                      }
                                    : item
                                )
                              })
                            }
                            className="interactive-tap min-h-11 w-full rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-[var(--ui-ink-strong)]"
                          >
                            <option value="ordinary">Ordinary</option>
                            <option value="personal">Personal</option>
                            <option value="sensitive">Sensitive</option>
                          </select>
                        </FlowField>
                        <div className="md:col-span-2">
                          <FlowField
                            label="Fact value"
                            error={
                              fact.value.trim()
                                ? null
                                : "Enter a value or remove this fact."
                            }
                          >
                            <Textarea
                              value={fact.value}
                              onChange={(event) =>
                                setValue({
                                  facts: value.facts.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, value: event.target.value }
                                      : item
                                  )
                                })
                              }
                              autoComplete="off"
                            />
                          </FlowField>
                        </div>
                      </fieldset>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-[var(--ui-ink-muted)]">
                    No local facts recorded.
                  </p>
                )}
              </section>
            </fieldset>
          </div>
        )
      }
    ],
    [
      context,
      currentLinkOptions,
      initialOutgoingLinks,
      linksEditable,
      searchLinkOptions
    ]
  );

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="People"
      title={context ? `Edit ${context.person.displayName}` : "Add person"}
      description="Add the details you want Forge to remember."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={context ? "Save person" : "Add person"}
      pending={saveMutation.isPending}
      pendingLabel="Saving"
      error={
        error ??
        (saveMutation.error instanceof Error
          ? saveMutation.error.message
          : null)
      }
      resolveContinueBlocker={(stepId, value) => {
        if (stepId === "identity" && !value.displayName.trim()) {
          return "Enter a display name to continue.";
        }
        if (stepId === "dates-place") {
          return (
            birthdayValidationMessage(value.birthday) ??
            timezoneValidationMessage(value.timezone)
          );
        }
        if (stepId === "contacts-facts") {
          return detailsValidationMessage(value);
        }
        return null;
      }}
      resolveContinueBlockerTone={(stepId) =>
        stepId === "identity" ? "guidance" : "error"
      }
      onSubmit={async () => {
        if (!draft.displayName.trim()) {
          setError("Display name is required.");
          return;
        }
        const birthdayError = birthdayValidationMessage(draft.birthday);
        if (birthdayError) {
          setError(birthdayError);
          return;
        }
        const timezoneError = timezoneValidationMessage(draft.timezone);
        if (timezoneError) {
          setError(timezoneError);
          return;
        }
        const detailsError = detailsValidationMessage(draft);
        if (detailsError) {
          setError(detailsError);
          return;
        }
        setError(null);
        try {
          await saveMutation.mutateAsync({
            ...draft,
            displayName: draft.displayName.trim(),
            contactMethods: draft.contactMethods.map((method) => ({
              ...method,
              label: method.label.trim(),
              value: method.value.trim()
            })),
            facts: draft.facts.map((fact) => ({
              ...fact,
              label: fact.label.trim(),
              value: fact.value.trim()
            })),
            linkUpdate:
              draft.linkUpdate.mode === "unchanged"
                ? draft.linkUpdate
                : {
                    mode: "replace_complete",
                    links: draft.linkUpdate.links.map((link) => ({
                      entityType: link.entityType.trim(),
                      entityId: link.entityId.trim(),
                      anchorKey: link.anchorKey?.trim() || null,
                      relationship: link.relationship.trim()
                    }))
                  }
          });
        } catch {
          // The mutation error is rendered by the guided flow.
        }
      }}
    />
  );
}
