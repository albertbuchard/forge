import { useEffect, useMemo, useState } from "react";
import { CalendarDays, MapPin, Sparkles } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EntityBadge } from "@/components/ui/entity-badge";
import { readCalendarDisplayName } from "@/lib/calendar-name-deduper";
import { getEntityKindForCrudEntityType } from "@/lib/entity-visuals";
import {
  estimateCalendarEventActionPointLoad,
  formatLifeForceAp,
  formatLifeForceRate,
  getCalendarActivityCustomRate,
  getCalendarActivityPresetKey,
  getCalendarActivityPresetOptions
} from "@/lib/life-force-display";
import type {
  CalendarAvailability,
  CalendarEvent,
  CalendarResource,
  CrudEntityType
} from "@/lib/types";

type EventLinkDraft = {
  entityType: CrudEntityType;
  entityId: string;
  relationshipType: string;
  label: string;
};

type EventDraft = {
  title: string;
  description: string;
  location: string;
  placeAddress: string;
  placeTimezone: string;
  startAtLocal: string;
  endAtLocal: string;
  timezone: string;
  availability: CalendarAvailability;
  preferredCalendarId: string | null | undefined;
  categoriesText: string;
  activityPresetKey: string | null;
  customSustainRateApPerHour: number | null;
  linkQuery: string;
  links: EventLinkDraft[];
};

type LinkOption = {
  entityType: CrudEntityType;
  entityId: string;
  label: string;
  subtitle: string;
};

function toSafeIsoOrFallback(value: string, fallback: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function toLocalInputValue(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function createDraft(
  event?: CalendarEvent | null,
  seed?: Partial<{
    title: string;
    description: string;
    location: string;
    place?: {
      label?: string;
      address?: string;
      timezone?: string;
      latitude?: number | null;
      longitude?: number | null;
      source?: string;
      externalPlaceId?: string;
    };
    startAt: string;
    endAt: string;
    timezone: string;
    availability: CalendarAvailability;
    preferredCalendarId?: string | null;
    categories: string[];
    links: EventLinkDraft[];
  }>
): EventDraft {
  const now = new Date();
  const defaultStart = new Date(now.getTime() + 30 * 60_000);
  const defaultEnd = new Date(defaultStart.getTime() + 60 * 60_000);
  return {
    title: seed?.title ?? event?.title ?? "",
    description: seed?.description ?? event?.description ?? "",
    location: seed?.location ?? event?.location ?? "",
    placeAddress: seed?.place?.address ?? event?.place?.address ?? "",
    placeTimezone: seed?.place?.timezone ?? event?.place?.timezone ?? "",
    startAtLocal: event
      ? toLocalInputValue(event.startAt)
      : seed?.startAt
        ? toLocalInputValue(seed.startAt)
        : toLocalInputValue(defaultStart.toISOString()),
    endAtLocal: event
      ? toLocalInputValue(event.endAt)
      : seed?.endAt
        ? toLocalInputValue(seed.endAt)
        : toLocalInputValue(defaultEnd.toISOString()),
    timezone:
      seed?.timezone ??
      event?.timezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      "UTC",
    availability: seed?.availability ?? event?.availability ?? "busy",
    activityPresetKey: getCalendarActivityPresetKey(event?.actionProfile),
    customSustainRateApPerHour: getCalendarActivityCustomRate(
      event?.actionProfile
    ),
    preferredCalendarId:
      seed && "preferredCalendarId" in seed
        ? seed.preferredCalendarId
        : (event?.calendarId ?? undefined),
    categoriesText:
      seed?.categories?.join(", ") ?? event?.categories.join(", ") ?? "",
    linkQuery: "",
    links:
      seed?.links ??
      event?.links.map((link) => ({
        entityType: link.entityType,
        entityId: link.entityId,
        relationshipType: link.relationshipType,
        label: `${link.entityType.replaceAll("_", " ")} · ${link.entityId}`
      })) ??
      []
  };
}

export function CalendarEventFlowDialog({
  open,
  onOpenChange,
  writableCalendars,
  linkOptions,
  event,
  seed,
  onSubmit,
  pending = false
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  writableCalendars: CalendarResource[];
  linkOptions: LinkOption[];
  event?: CalendarEvent | null;
  seed?: Partial<{
    title: string;
    description: string;
    location: string;
    place?: {
      label?: string;
      address?: string;
      timezone?: string;
      latitude?: number | null;
      longitude?: number | null;
      source?: string;
      externalPlaceId?: string;
    };
    startAt: string;
    endAt: string;
    timezone: string;
    availability: CalendarAvailability;
    preferredCalendarId?: string | null;
    categories: string[];
    links: EventLinkDraft[];
  }>;
  onSubmit: (input: {
    title: string;
    description?: string;
    location?: string;
    place?: {
      label?: string;
      address?: string;
      timezone?: string;
      latitude?: number | null;
      longitude?: number | null;
      source?: string;
      externalPlaceId?: string;
    };
    startAt: string;
    endAt: string;
    timezone?: string;
    availability?: CalendarAvailability;
    activityPresetKey?: string | null;
    customSustainRateApPerHour?: number | null;
    preferredCalendarId?: string | null;
    categories?: string[];
    links?: Array<{
      entityType: CrudEntityType;
      entityId: string;
      relationshipType?: string;
    }>;
  }) => Promise<void>;
  pending?: boolean;
}) {
  const [draft, setDraft] = useState<EventDraft>(() =>
    createDraft(event, seed)
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setDraft(createDraft(event, seed));
    setError(null);
  }, [event, open, seed]);

  const linkSelectOptions = useMemo<EntityLinkOption[]>(
    () =>
      linkOptions.map((option) => {
        const entityKind = getEntityKindForCrudEntityType(option.entityType);
        return {
          value: `${option.entityType}:${option.entityId}`,
          label: option.label,
          description: option.subtitle,
          searchText: `${option.label} ${option.subtitle} ${option.entityType}`,
          kind: entityKind ?? undefined,
          menuBadge: entityKind ? (
            <EntityBadge
              kind={entityKind}
              label={option.label}
              compact
              gradient={false}
            />
          ) : undefined,
          badge: entityKind ? (
            <EntityBadge kind={entityKind} label={option.label} compact />
          ) : undefined
        };
      }),
    [linkOptions]
  );

  const steps = useMemo<Array<QuestionFlowStep<EventDraft>>>(
    () => [
      {
        id: "identity",
        eyebrow: "Event",
        title: event
          ? "Refine the Forge event"
          : "Create a Forge calendar event",
        description:
          "This event belongs to Forge first. If you choose a writable calendar, Forge will also project it to the connected provider.",
        render: (value, setValue) => (
          <div className="grid gap-4">
            <FlowField label="Title">
              <Input
                value={value.title}
                onChange={(next) => setValue({ title: next.target.value })}
                placeholder="Weekly research supervision"
              />
            </FlowField>
            <FlowField label="Description">
              <Textarea
                value={value.description}
                onChange={(next) =>
                  setValue({ description: next.target.value })
                }
                placeholder="Agenda, context, or outcomes you want this event to carry."
              />
            </FlowField>
            <FlowField label="Location">
              <Input
                value={value.location}
                onChange={(next) => setValue({ location: next.target.value })}
                placeholder="Clinic room 2 or Zoom"
              />
            </FlowField>
            <FlowField label="Place address">
              <Input
                value={value.placeAddress}
                onChange={(next) =>
                  setValue({ placeAddress: next.target.value })
                }
                placeholder="Bahnhofstrasse 10, Zurich"
              />
            </FlowField>
            <FlowField label="Place timezone">
              <Input
                value={value.placeTimezone}
                onChange={(next) =>
                  setValue({ placeTimezone: next.target.value })
                }
                placeholder="Europe/Zurich"
              />
            </FlowField>
          </div>
        )
      },
      {
        id: "timing",
        eyebrow: "Timing",
        title: "Set the time and visibility",
        description:
          "Forge stores the real event window, timezone, and whether it should behave like a busy or free slot for scheduling rules.",
        render: (value, setValue) => (
          <div className="grid gap-4">
            {(() => {
              const fallbackStart = new Date().toISOString();
              const fallbackEnd = new Date(
                Date.now() + 60 * 60 * 1000
              ).toISOString();
              const preview = estimateCalendarEventActionPointLoad({
                title: value.title,
                availability: value.availability,
                activityPresetKey: value.activityPresetKey as never,
                customSustainRateApPerHour: value.customSustainRateApPerHour,
                startAt: toSafeIsoOrFallback(value.startAtLocal, fallbackStart),
                endAt: toSafeIsoOrFallback(value.endAtLocal, fallbackEnd)
              });
              return (
                <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-white/[0.08] text-white/74">
                      {formatLifeForceRate(preview.rateApPerHour)}
                    </Badge>
                    <Badge className="bg-white/[0.08] text-white/74">
                      {formatLifeForceAp(preview.totalAp)}
                    </Badge>
                  </div>
                  <div className="mt-3 text-sm leading-6 text-white/58">
                    Availability controls whether the event blocks planning. The
                    activity profile controls AP drain, and you can override it
                    with a custom AP per hour.
                  </div>
                </div>
              );
            })()}
            <FlowField label="Activity profile">
              <FlowChoiceGrid
                value={
                  value.activityPresetKey ??
                  (value.availability === "busy" ? "meeting" : "light_context")
                }
                columns={3}
                onChange={(next) => setValue({ activityPresetKey: next })}
                options={getCalendarActivityPresetOptions()
                  .filter((preset) => preset.key !== "task_inherited")
                  .map((preset) => ({
                    value: preset.key,
                    label: preset.label,
                    description: `${formatLifeForceRate(preset.defaultRateApPerHour)} · ${preset.description}`
                  }))}
              />
            </FlowField>
            <FlowField label="Custom AP per hour">
              <Input
                type="number"
                min={0}
                step={0.5}
                value={value.customSustainRateApPerHour ?? ""}
                onChange={(next) =>
                  setValue({
                    customSustainRateApPerHour:
                      next.target.value.trim() === ""
                        ? null
                        : Number(next.target.value)
                  })
                }
                placeholder="Leave empty to use the activity default"
              />
            </FlowField>
            <div className="grid gap-4 md:grid-cols-2">
              <FlowField label="Starts">
                <Input
                  type="datetime-local"
                  value={value.startAtLocal}
                  onChange={(next) =>
                    setValue({ startAtLocal: next.target.value })
                  }
                />
              </FlowField>
              <FlowField label="Ends">
                <Input
                  type="datetime-local"
                  value={value.endAtLocal}
                  onChange={(next) =>
                    setValue({ endAtLocal: next.target.value })
                  }
                />
              </FlowField>
            </div>
            <FlowField label="Timezone">
              <Input
                value={value.timezone}
                onChange={(next) => setValue({ timezone: next.target.value })}
                placeholder="Europe/Zurich"
              />
            </FlowField>
            <FlowField label="Availability">
              <FlowChoiceGrid
                value={value.availability}
                onChange={(next) =>
                  setValue({ availability: next as CalendarAvailability })
                }
                options={[
                  {
                    value: "busy",
                    label: "Busy",
                    description:
                      "This event should block timebox recommendations and rule checks."
                  },
                  {
                    value: "free",
                    label: "Free",
                    description:
                      "This event stays visible in the calendar without blocking work."
                  }
                ]}
              />
            </FlowField>
          </div>
        )
      },
      {
        id: "links",
        eyebrow: "Meaning",
        title: "Connect the event to Forge entities",
        description:
          "Attach this event to strategies, goals, projects, tasks, or habits so the calendar carries multi-user operating context instead of staying isolated.",
        render: (value, setValue) => (
          <div className="grid gap-4">
            <FlowField
              label="Search Forge entities"
              description="Search across human and bot-owned entities; the linked records use the same icon, color, and owner system as the rest of Forge."
            >
              <EntityLinkMultiSelect
                options={linkSelectOptions}
                selectedValues={value.links.map(
                  (link) => `${link.entityType}:${link.entityId}`
                )}
                onChange={(selectedValues) => {
                  setValue({
                    links: selectedValues
                      .map((selectedValue) => {
                        const [entityType, ...rest] = selectedValue.split(":");
                        const entityId = rest.join(":");
                        const option = linkOptions.find(
                          (entry) =>
                            entry.entityType === entityType &&
                            entry.entityId === entityId
                        );
                        if (!option) {
                          return null;
                        }
                        return {
                          entityType: option.entityType,
                          entityId: option.entityId,
                          relationshipType: "context",
                          label: option.label
                        } satisfies EventLinkDraft;
                      })
                      .filter(
                        (entry): entry is EventLinkDraft => entry !== null
                      )
                  });
                }}
                placeholder="Search strategies, goals, projects, tasks, habits, human, or bot owners"
                emptyMessage="No matching Forge entities found."
              />
            </FlowField>
          </div>
        )
      },
      {
        id: "projection",
        eyebrow: "Projection",
        title: "Choose where this event should live remotely",
        description:
          "You can keep the event local to Forge, or choose a writable connected calendar so Forge also keeps a synced remote copy.",
        render: (value, setValue) => (
          <div className="grid gap-4">
            <div className="grid gap-3">
              {writableCalendars.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setValue({ preferredCalendarId: undefined })}
                  className={`rounded-[22px] border px-4 py-4 text-left transition ${
                    value.preferredCalendarId === undefined
                      ? "border-[rgba(125,211,252,0.28)] bg-[rgba(125,211,252,0.14)] text-white"
                      : "border-white/8 bg-white/[0.04] text-white/72 hover:bg-white/[0.07]"
                  }`}
                >
                  <div className="flex items-center gap-2 font-medium">
                    <CalendarDays className="size-4" />
                    Default synced calendar
                  </div>
                  <div className="mt-2 text-sm leading-6 text-white/55">
                    Let Forge use the default writable connected calendar
                    automatically.
                  </div>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setValue({ preferredCalendarId: null })}
                className={`rounded-[22px] border px-4 py-4 text-left transition ${
                  value.preferredCalendarId === null
                    ? "border-[rgba(192,193,255,0.28)] bg-[rgba(192,193,255,0.14)] text-white"
                    : "border-white/8 bg-white/[0.04] text-white/72 hover:bg-white/[0.07]"
                }`}
              >
                <div className="flex items-center gap-2 font-medium">
                  <Sparkles className="size-4" />
                  Forge only
                </div>
                <div className="mt-2 text-sm leading-6 text-white/55">
                  Keep the event in Forge without creating a remote provider
                  copy yet.
                </div>
              </button>
              {writableCalendars.map((calendar) => (
                <button
                  key={calendar.id}
                  type="button"
                  onClick={() => setValue({ preferredCalendarId: calendar.id })}
                  className={`rounded-[22px] border px-4 py-4 text-left transition ${
                    value.preferredCalendarId === calendar.id
                      ? "border-[rgba(125,211,252,0.28)] bg-[rgba(125,211,252,0.14)] text-white"
                      : "border-white/8 bg-white/[0.04] text-white/72 hover:bg-white/[0.07]"
                  }`}
                >
                  <div className="flex items-center gap-2 font-medium">
                    <CalendarDays className="size-4" />
                    {readCalendarDisplayName(calendar)}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-white/55">
                    {calendar.description || `${calendar.timezone} · writable`}
                  </div>
                </button>
              ))}
            </div>

            <div className="grid gap-2 rounded-[22px] border border-white/8 bg-white/[0.04] p-4 text-sm text-white/66">
              <div className="flex items-center gap-2 font-medium text-white">
                <MapPin className="size-4 text-[var(--primary)]" />
                Categories and filtering
              </div>
              <Input
                value={value.categoriesText}
                onChange={(next) =>
                  setValue({ categoriesText: next.target.value })
                }
                placeholder="meeting, clinic, research"
              />
            </div>
          </div>
        )
      }
    ],
    [event, linkOptions, linkSelectOptions, writableCalendars]
  );

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow={event ? "Edit event" : "New event"}
      title={event ? "Edit calendar event" : "Create calendar event"}
      description="Forge-owned events can stay local or publish to a connected provider calendar."
      value={draft}
      onChange={setDraft}
      draftPersistenceKey={
        event ? `calendar.event.${event.id}` : "calendar.event.new"
      }
      steps={steps}
      onSubmit={async () => {
        if (!draft.title.trim()) {
          setError("Add an event title before saving.");
          return;
        }
        if (!draft.startAtLocal || !draft.endAtLocal) {
          setError("Set both the start and end time before saving.");
          return;
        }
        if (
          new Date(draft.endAtLocal).getTime() <=
          new Date(draft.startAtLocal).getTime()
        ) {
          setError("The event end time must be after the start time.");
          return;
        }
        setError(null);
        await onSubmit({
          title: draft.title.trim(),
          description: draft.description.trim(),
          location: draft.location.trim(),
          place: {
            label: draft.location.trim(),
            address: draft.placeAddress.trim(),
            timezone: draft.placeTimezone.trim(),
            latitude: null,
            longitude: null,
            source: draft.placeAddress.trim() ? "manual" : "",
            externalPlaceId: ""
          },
          startAt: new Date(draft.startAtLocal).toISOString(),
          endAt: new Date(draft.endAtLocal).toISOString(),
          timezone: draft.timezone.trim() || "UTC",
          availability: draft.availability,
          activityPresetKey: draft.activityPresetKey,
          customSustainRateApPerHour: draft.customSustainRateApPerHour,
          categories: draft.categoriesText
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          links: draft.links.map((link) => ({
            entityType: link.entityType,
            entityId: link.entityId,
            relationshipType: link.relationshipType
          })),
          ...(draft.preferredCalendarId !== undefined
            ? { preferredCalendarId: draft.preferredCalendarId }
            : {})
        });
      }}
      submitLabel={event ? "Save event" : "Create event"}
      pending={pending}
      pendingLabel={event ? "Saving" : "Creating"}
      error={error}
    />
  );
}
