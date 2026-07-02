# Life Events

Life Events are Forge's chronological memory surface for important events in a
person's life. They are not a replacement for the calendar. A calendar event says
something is scheduled. A Life Event records why that moment matters, what happened or
will happen, how it connects to other Forge records, and what evidence belongs with it.
It can be a short event or a span that lasts days, weeks, or months, such as a stay,
festival, retreat, long visit, work phase, health episode, or course.

The web app exposes the surface at `/forge/life-events`. The view is a virtualized
timeline with past, current, and future events, plus guided modal flows for creating,
editing, and importing ticket files. The page must not use side-panel upload forms;
event creation, event editing, and ticket import use the same guided modal pattern as
the other Forge surfaces.

## Entity Contract

The stored entity type is `life_event`. Normal stored-record operations use the shared
batch entity routes and tools:

- create, update, search, soft delete, restore, and hard delete use the batch entity
  model with `entityType: "life_event"`
- relationships use the general `entity_links` model
- do not create a special Life Event link table
- do not create a special artifact-link model

The durable Life Event record includes:

- title, short description, and long description
- type: travel flight, train, car, boat, trip, travel day, stay, lodging, holiday,
  vacation, visit, move, festival, conference, retreat, concert, cinema, meal,
  party, ceremony, date, friends, family, work milestone, work phase, thesis
  milestone, creative work, class or course, exam, deadline, medical, health
  episode, therapy, administrative, legal or financial, errand, celebration,
  memory, or custom
- status: planned, happening, completed, cancelled, or tentative
- importance: ordinary, meaningful, major, or life-changing
- start, end, timezone, all-day flag; the start/end interval is canonical and may
  represent a short event, an overnight stay, a multi-day event, or a multi-month
  period
- place label, address, timezone, and optional coordinates
- origin and destination labels, cities, countries, and optional coordinates
- transport mode when relevant
- primary calendar event id, calendar sync state, and match confidence
- source kind, source artifact id, extraction status, extraction summary
- travel details, display style, metadata
- ordered segments for flights, trains, car trips, boats, lodging, activities,
  checkpoints, or custom event parts
- ownership, timestamps, deleted state, and generic entity links

Segments carry the travel detail needed for rich cards: origin and destination labels,
IATA/ICAO codes, coordinates, carrier, service number, booking reference, terminal,
gate, seat, status, status source, checked time, route geometry, and metadata.

## Dedicated Routes

Life Events have a dedicated route family for chronology and domain actions:

- `GET /api/v1/life-events/timeline`
  returns a paginated chronology for the virtualized Life Events view.
- `GET /api/v1/life-events/:id`
  reads one Life Event with segments and links.
- `POST /api/v1/life-events/:id/calendar-sync`
  links an existing calendar event or creates a calendar projection.
- `POST /api/v1/life-events/from-calendar-event`
  creates or links a Life Event from an existing `calendar_event`.
- `POST /api/v1/life-events/import-ticket`
  drafts or creates a travel Life Event from a trusted Artifact Store ticket.
- `GET /api/v1/life-events/:id/travel-status`
  returns scheduled or provider-backed travel status when available.

Use dedicated routes only for those actions. Use shared batch CRUD for ordinary
`life_event` record mutation and deletion.

## Calendar Reconciliation

Every Life Event can be connected to the calendar.

When a user creates a Life Event first, Forge should try to find a matching calendar
event around the same interval and title. If it finds one, Forge links it. If it does
not find one and projection is allowed, Forge creates a calendar event with the full
Life Event span and records the link.

When a user starts from the calendar and marks an event as a Life Event, Forge creates
or returns the linked Life Event through `/api/v1/life-events/from-calendar-event`.

The stored relationship is still a general `entity_links` relationship. The
`primaryCalendarEventId` field is the product shortcut for the main calendar projection.

## Ticket Import

Tickets and booking files enter Life Events through the Artifact Store.

The flow is:

1. Upload the file as an Artifact Store artifact.
2. Keep the file under Artifact Store safety rules.
3. Call `POST /api/v1/life-events/import-ticket` with the `artifactId`.
4. Review the draft, fill missing fields, and save or calendar-sync the event.

Agents must not download, open, execute, decrypt, preview, or transform stored artifact
bytes. Ticket import reads safe artifact metadata and scanner text samples. If `useLlm`
is requested and the runtime does not have an approved extraction path, the response
records that LLM extraction was requested but unavailable; it does not silently call an
unapproved provider.

## Web App Behavior

The Life Events view should stay fast and readable even with many events:

- render the chronology with virtualization
- keep filters and search cheap
- show past, current, and future states without forcing the whole list into the DOM
- use guided modal forms for creation, editing, and ticket import
- present event types in grouped choices rather than a raw enum list
- ask for the event span deliberately, including same-day, overnight, multi-day,
  month-scale, and custom spans
- display long durations compactly on cards and expanded details
- allow several ticket files to be uploaded in one guided import flow
- let the user open per-file detail when a ticket needs more description or review
- keep travel and map rendering lazy so the timeline stays responsive

Travel and stay cards can show origin, destination, departure, arrival, transport
mode, segments, linked ticket artifacts, calendar sync state, and travel status when
relevant. Maps use a fast fallback route drawing by default and only load MapLibre
when a tile style is configured.

## Agent And Plugin Contract

OpenAPI, OpenClaw, Hermes, Codex, and Claude Code must expose the same route posture:

- `life_event` belongs in the batch entity catalog for normal stored-record CRUD
- `forge_call_life_event_route` is the route-key tool for dedicated Life Event actions
- OpenClaw mirrors the route family under `/forge/v1/life-events/*`
- Hermes publishes the same route keys in its catalog
- skills and onboarding must tell agents to use generic entity links for related
  artifacts, calendar events, wiki pages, goals, Psyche records, notes, movement
  context, and other Forge entities

Good agent questions ask for the missing real-world detail, not route names. The useful
questions are about what happened, why it matters, when it starts and ends, where it
happens or where the user stays, whether it belongs in the calendar, whether there is a
ticket artifact, what the travel route is, and which Forge records should be linked.
