import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveDataDir } from "../db.js";
const execFile = promisify(execFileCallback);
const HELPER_SOURCE = String.raw `
import AppKit
import EventKit
import Foundation

enum HelperError: Error {
  case invalidRequest(String)
  case unavailable(String)
}

func emit(_ payload: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: payload, options: [])
  FileHandle.standardOutput.write(data)
}

func readRequest() throws -> [String: Any] {
  let args = CommandLine.arguments
  guard let requestIndex = args.firstIndex(of: "--request-base64"), requestIndex + 1 < args.count else {
    throw HelperError.invalidRequest("Missing --request-base64 argument.")
  }
  let encoded = args[requestIndex + 1]
  guard let data = Data(base64Encoded: encoded) else {
    throw HelperError.invalidRequest("Invalid base64 request payload.")
  }
  let json = try JSONSerialization.jsonObject(with: data, options: [])
  guard let payload = json as? [String: Any] else {
    throw HelperError.invalidRequest("Request payload must be a JSON object.")
  }
  return payload
}

func authStatusText() -> String {
  let status = EKEventStore.authorizationStatus(for: .event)
  if #available(macOS 14.0, *) {
    switch status {
    case .notDetermined:
      return "not_determined"
    case .restricted:
      return "restricted"
    case .denied:
      return "denied"
    case .fullAccess:
      return "full_access"
    case .writeOnly:
      return "denied"
    @unknown default:
      return "unavailable"
    }
  }

  switch status {
  case .notDetermined:
    return "not_determined"
  case .restricted:
    return "restricted"
  case .denied:
    return "denied"
  case .authorized, .fullAccess:
    return "full_access"
  case .writeOnly:
    return "denied"
  @unknown default:
    return "unavailable"
  }
}

func requestAccess(store: EKEventStore) throws -> [String: Any] {
  if authStatusText() == "full_access" {
    return [
      "granted": true,
      "status": "full_access"
    ]
  }

  let semaphore = DispatchSemaphore(value: 0)
  var granted = false
  var capturedError: Error?

  if #available(macOS 14.0, *) {
    store.requestFullAccessToEvents { allowed, error in
      granted = allowed
      capturedError = error
      semaphore.signal()
    }
  } else {
    store.requestAccess(to: .event) { allowed, error in
      granted = allowed
      capturedError = error
      semaphore.signal()
    }
  }

  semaphore.wait()
  if let capturedError {
    throw capturedError
  }

  return [
    "granted": granted,
    "status": authStatusText()
  ]
}

func sourceTypeText(_ sourceType: EKSourceType) -> String {
  switch sourceType {
  case .local:
    return "local"
  case .exchange:
    return "exchange"
  case .calDAV:
    return "caldav"
  case .mobileMe:
    return "mobileme"
  case .subscribed:
    return "subscribed"
  case .birthdays:
    return "birthdays"
  @unknown default:
    return "unknown"
  }
}

func sourceIdentifier(_ source: EKSource?) -> String {
  source?.sourceIdentifier ?? "unknown-source"
}

func sourceTitle(_ source: EKSource?) -> String {
  source?.title ?? "Unknown source"
}

func sourceTypeValue(_ source: EKSource?) -> String {
  guard let source else {
    return "unknown"
  }
  return sourceTypeText(source.sourceType)
}

func calendarDescription(_ calendar: EKCalendar) -> String {
  ""
}

func calendarTimezoneIdentifier() -> String {
  TimeZone.current.identifier
}

func calendarTypeText(_ calendarType: EKCalendarType) -> String {
  switch calendarType {
  case .local:
    return "local"
  case .calDAV:
    return "caldav"
  case .exchange:
    return "exchange"
  case .subscription:
    return "subscription"
  case .birthday:
    return "birthday"
  @unknown default:
    return "unknown"
  }
}

func colorHex(_ color: CGColor?) -> String {
  guard let color else {
    return "#7dd3fc"
  }
  let nsColor = NSColor(cgColor: color)?.usingColorSpace(.sRGB) ?? NSColor.systemBlue
  let red = Int(round(nsColor.redComponent * 255.0))
  let green = Int(round(nsColor.greenComponent * 255.0))
  let blue = Int(round(nsColor.blueComponent * 255.0))
  return String(format: "#%02x%02x%02x", red, green, blue)
}

func availabilityText(_ availability: EKEventAvailability) -> String {
  switch availability {
  case .free:
    return "free"
  default:
    return "busy"
  }
}

func isoString(_ date: Date?) -> String? {
  guard let date else {
    return nil
  }
  return ISO8601DateFormatter().string(from: date)
}

func discover(store: EKEventStore) throws -> [String: Any] {
  guard authStatusText() == "full_access" else {
    throw HelperError.unavailable("Forge needs Calendar full access before it can read calendars already configured on this Mac.")
  }

  let calendars = store.calendars(for: .event)
  let grouped = Dictionary(grouping: calendars, by: { sourceIdentifier($0.source) })
  let sources = grouped.keys.sorted().compactMap { sourceId -> [String: Any]? in
    guard let calendarsForSource = grouped[sourceId], let first = calendarsForSource.first else {
      return nil
    }
    let source = first.source
    let mappedCalendars = calendarsForSource
      .sorted { lhs, rhs in
        if lhs.title == rhs.title {
          return lhs.calendarIdentifier < rhs.calendarIdentifier
        }
        return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
      }
      .map { calendar in
        [
          "sourceId": sourceIdentifier(source),
          "sourceTitle": sourceTitle(source),
          "sourceType": sourceTypeValue(source),
          "calendarId": calendar.calendarIdentifier,
          "title": calendar.title,
          "description": calendarDescription(calendar),
          "color": colorHex(calendar.cgColor),
          "timezone": calendarTimezoneIdentifier(),
          "calendarType": calendarTypeText(calendar.type),
          "isPrimary": calendar.allowsContentModifications && calendar.title.localizedCaseInsensitiveCompare("calendar") == .orderedSame,
          "canWrite": calendar.allowsContentModifications
        ] as [String : Any]
      }
    return [
      "sourceId": sourceIdentifier(source),
      "sourceTitle": sourceTitle(source),
      "sourceType": sourceTypeValue(source),
      "accountLabel": sourceTitle(source),
      "calendars": mappedCalendars
    ]
  }

  return [
    "status": authStatusText(),
    "sources": sources
  ]
}

func eventPayload(_ event: EKEvent) -> [String: Any] {
  [
    "eventId": event.eventIdentifier ?? "",
    "externalId": event.calendarItemExternalIdentifier ?? NSNull(),
    "calendarId": event.calendar.calendarIdentifier,
    "title": event.title ?? "(untitled event)",
    "startAt": isoString(event.startDate) ?? "",
    "endAt": isoString(event.endDate) ?? "",
    "allDay": event.isAllDay,
    "availability": availabilityText(event.availability),
    "location": event.location ?? "",
    "notes": event.notes ?? "",
    "occurrenceDate": isoString(event.occurrenceDate) ?? NSNull(),
    "lastModifiedAt": isoString(event.lastModifiedDate) ?? NSNull()
  ]
}

func calendarForIdentifier(_ store: EKEventStore, _ identifier: String) -> EKCalendar? {
  store.calendar(withIdentifier: identifier)
}

func listEvents(store: EKEventStore, payload: [String: Any]) throws -> [String: Any] {
  guard authStatusText() == "full_access" else {
    throw HelperError.unavailable("Forge needs Calendar full access before it can read local events.")
  }
  guard let calendarIds = payload["calendarIds"] as? [String], !calendarIds.isEmpty else {
    throw HelperError.invalidRequest("calendarIds are required.")
  }
  guard let startRaw = payload["start"] as? String, let start = ISO8601DateFormatter().date(from: startRaw) else {
    throw HelperError.invalidRequest("A valid start ISO timestamp is required.")
  }
  guard let endRaw = payload["end"] as? String, let end = ISO8601DateFormatter().date(from: endRaw) else {
    throw HelperError.invalidRequest("A valid end ISO timestamp is required.")
  }

  let calendars = calendarIds.compactMap { calendarForIdentifier(store, $0) }
  let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
  let events = store.events(matching: predicate)
    .sorted { lhs, rhs in
      if lhs.startDate == rhs.startDate {
        return (lhs.title ?? "") < (rhs.title ?? "")
      }
      return lhs.startDate < rhs.startDate
    }
    .map(eventPayload)

  return ["events": events]
}

func ensureForgeCalendar(store: EKEventStore, payload: [String: Any]) throws -> [String: Any] {
  guard authStatusText() == "full_access" else {
    throw HelperError.unavailable("Forge needs Calendar full access before it can create or choose a local Forge calendar.")
  }
  guard let sourceId = payload["sourceId"] as? String, !sourceId.isEmpty else {
    throw HelperError.invalidRequest("sourceId is required.")
  }
  let calendars = store.calendars(for: .event).filter {
    sourceIdentifier($0.source) == sourceId
  }
  guard let source = calendars.first?.source else {
    throw HelperError.invalidRequest("Unknown macOS calendar source.")
  }
  if let existing = calendars.first(where: { $0.title.localizedCaseInsensitiveCompare("Forge") == .orderedSame && $0.allowsContentModifications }) {
    return ["calendar": [
      "sourceId": source.sourceIdentifier,
      "sourceTitle": source.title,
      "sourceType": sourceTypeText(source.sourceType),
      "calendarId": existing.calendarIdentifier,
      "title": existing.title,
      "description": calendarDescription(existing),
      "color": colorHex(existing.cgColor),
      "timezone": calendarTimezoneIdentifier(),
      "calendarType": calendarTypeText(existing.type),
      "isPrimary": false,
      "canWrite": existing.allowsContentModifications
    ]]
  }

  let newCalendar = EKCalendar(for: .event, eventStore: store)
  newCalendar.source = source
  newCalendar.title = "Forge"
  newCalendar.cgColor = NSColor(calibratedRed: 0.49, green: 0.83, blue: 0.99, alpha: 1.0).cgColor
  try store.saveCalendar(newCalendar, commit: true)

  return ["calendar": [
    "sourceId": source.sourceIdentifier,
    "sourceTitle": source.title,
    "sourceType": sourceTypeText(source.sourceType),
    "calendarId": newCalendar.calendarIdentifier,
    "title": newCalendar.title,
    "description": calendarDescription(newCalendar),
    "color": colorHex(newCalendar.cgColor),
    "timezone": calendarTimezoneIdentifier(),
    "calendarType": calendarTypeText(newCalendar.type),
    "isPrimary": false,
    "canWrite": newCalendar.allowsContentModifications
  ]]
}

func upsertEvent(store: EKEventStore, payload: [String: Any]) throws -> [String: Any] {
  guard authStatusText() == "full_access" else {
    throw HelperError.unavailable("Forge needs Calendar full access before it can write local events.")
  }
  guard let calendarId = payload["calendarId"] as? String, let calendar = store.calendar(withIdentifier: calendarId) else {
    throw HelperError.invalidRequest("calendarId is required.")
  }
  if !calendar.allowsContentModifications {
    throw HelperError.unavailable("That local calendar is read-only.")
  }
  guard let title = payload["title"] as? String, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
    throw HelperError.invalidRequest("title is required.")
  }
  guard let startRaw = payload["startAt"] as? String, let start = ISO8601DateFormatter().date(from: startRaw) else {
    throw HelperError.invalidRequest("A valid startAt ISO timestamp is required.")
  }
  guard let endRaw = payload["endAt"] as? String, let end = ISO8601DateFormatter().date(from: endRaw) else {
    throw HelperError.invalidRequest("A valid endAt ISO timestamp is required.")
  }

  let eventId = payload["eventId"] as? String
  let event = eventId.flatMap { store.event(withIdentifier: $0) } ?? EKEvent(eventStore: store)
  event.calendar = calendar
  event.title = title
  event.startDate = start
  event.endDate = end
  event.notes = payload["notes"] as? String
  event.location = payload["location"] as? String
  event.isAllDay = (payload["allDay"] as? Bool) ?? false
  try store.save(event, span: .thisEvent, commit: true)
  return ["event": eventPayload(event)]
}

func deleteEvent(store: EKEventStore, payload: [String: Any]) throws -> [String: Any] {
  guard authStatusText() == "full_access" else {
    throw HelperError.unavailable("Forge needs Calendar full access before it can delete local events.")
  }
  guard let eventId = payload["eventId"] as? String, !eventId.isEmpty else {
    throw HelperError.invalidRequest("eventId is required.")
  }
  guard let event = store.event(withIdentifier: eventId) else {
    return ["deleted": true]
  }
  try store.remove(event, span: .thisEvent, commit: true)
  return ["deleted": true]
}

do {
  let payload = try readRequest()
  let store = EKEventStore()
  let command = payload["command"] as? String ?? ""
  let result: [String: Any]
  switch command {
  case "auth_status":
    result = ["status": authStatusText()]
  case "request_access":
    result = try requestAccess(store: store)
  case "discover":
    result = try discover(store: store)
  case "list_events":
    result = try listEvents(store: store, payload: payload)
  case "ensure_forge_calendar":
    result = try ensureForgeCalendar(store: store, payload: payload)
  case "upsert_event":
    result = try upsertEvent(store: store, payload: payload)
  case "delete_event":
    result = try deleteEvent(store: store, payload: payload)
  default:
    throw HelperError.invalidRequest("Unknown command: \(command)")
  }
  var response = result
  response["ok"] = true
  emit(response)
} catch {
  emit([
    "ok": false,
    "error": String(describing: error)
  ])
}
`;
function helperCacheDir() {
    return path.join(resolveDataDir(), ".forge-native", "macos-calendar-helper");
}
function helperSourcePath() {
    return path.join(helperCacheDir(), "ForgeMacOSCalendarHelper.swift");
}
function helperBinaryPath() {
    return path.join(helperCacheDir(), "forge-macos-calendar-helper");
}
async function ensureHelperCompiled() {
    if (process.platform !== "darwin") {
        throw new Error("Forge macOS local calendars are only available on macOS.");
    }
    const cacheDir = helperCacheDir();
    const sourcePath = helperSourcePath();
    const binaryPath = helperBinaryPath();
    const sourceHash = createHash("sha256").update(HELPER_SOURCE).digest("hex");
    await mkdir(cacheDir, { recursive: true });
    let existingSource = "";
    try {
        existingSource = await readFile(sourcePath, "utf8");
    }
    catch {
        existingSource = "";
    }
    if (existingSource !== HELPER_SOURCE) {
        await writeFile(sourcePath, HELPER_SOURCE, "utf8");
    }
    let needsCompile = existingSource !== HELPER_SOURCE;
    if (!needsCompile) {
        try {
            const [sourceStats, binaryStats] = await Promise.all([
                stat(sourcePath),
                stat(binaryPath)
            ]);
            needsCompile = binaryStats.mtimeMs < sourceStats.mtimeMs;
        }
        catch {
            needsCompile = true;
        }
    }
    if (!needsCompile) {
        return { binaryPath, sourceHash };
    }
    await execFile("xcrun", [
        "swiftc",
        "-O",
        "-framework",
        "EventKit",
        "-framework",
        "AppKit",
        sourcePath,
        "-o",
        binaryPath
    ]);
    return { binaryPath, sourceHash };
}
async function runHelper(payload) {
    const mockRaw = process.env.FORGE_MACOS_LOCAL_MOCK_JSON?.trim();
    if (mockRaw) {
        const mock = JSON.parse(mockRaw);
        const status = mock.status ?? "full_access";
        switch (payload.command) {
            case "auth_status":
                return { status };
            case "request_access":
                return {
                    granted: mock.granted ?? status === "full_access",
                    status
                };
            case "discover":
                return {
                    status,
                    sources: mock.sources ?? []
                };
            case "list_events": {
                const calendarIds = Array.isArray(payload.calendarIds)
                    ? payload.calendarIds.filter((value) => typeof value === "string")
                    : [];
                return {
                    events: (mock.events ?? []).filter((event) => calendarIds.includes(event.calendarId))
                };
            }
            case "ensure_forge_calendar": {
                const sourceId = typeof payload.sourceId === "string" ? payload.sourceId : "";
                const forgeCalendar = mock.sources
                    ?.find((source) => source.sourceId === sourceId)
                    ?.calendars.find((calendar) => calendar.title === "Forge") ?? null;
                if (!forgeCalendar) {
                    throw new Error("Mock macOS local source is missing a Forge calendar.");
                }
                return { calendar: forgeCalendar };
            }
            case "upsert_event": {
                const eventId = typeof payload.eventId === "string" && payload.eventId.trim().length > 0
                    ? payload.eventId
                    : "mock_macos_event";
                return {
                    event: {
                        eventId,
                        externalId: eventId,
                        calendarId: String(payload.calendarId ?? ""),
                        title: String(payload.title ?? ""),
                        startAt: String(payload.startAt ?? ""),
                        endAt: String(payload.endAt ?? ""),
                        allDay: Boolean(payload.allDay),
                        availability: "busy",
                        location: typeof payload.location === "string" ? payload.location : "",
                        notes: typeof payload.notes === "string" ? payload.notes : "",
                        occurrenceDate: null,
                        lastModifiedAt: new Date().toISOString()
                    }
                };
            }
            case "delete_event":
                return { deleted: true };
            default:
                throw new Error(`Unknown mock macOS helper command ${String(payload.command)}`);
        }
    }
    const { binaryPath } = await ensureHelperCompiled();
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
    const { stdout } = await execFile(binaryPath, ["--request-base64", encoded], {
        maxBuffer: 8 * 1024 * 1024,
        env: {
            ...process.env,
            TMPDIR: process.env.TMPDIR ?? os.tmpdir()
        }
    });
    const parsed = JSON.parse(stdout);
    if (!parsed.ok) {
        throw new Error(parsed.error);
    }
    return parsed;
}
export function buildMacOSLocalCalendarUrl(sourceId, calendarId) {
    return `forge-macos-local://calendar/${encodeURIComponent(sourceId)}/${encodeURIComponent(calendarId)}/`;
}
export function parseMacOSLocalCalendarUrl(urlValue) {
    const url = new URL(urlValue);
    if (url.protocol !== "forge-macos-local:" || url.hostname !== "calendar") {
        throw new Error(`Forge could not parse macOS local calendar URL ${urlValue}.`);
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
        throw new Error(`Forge could not parse macOS local calendar URL ${urlValue}.`);
    }
    return {
        sourceId: decodeURIComponent(parts[0] ?? ""),
        calendarId: decodeURIComponent(parts[1] ?? "")
    };
}
export async function getMacOSCalendarAuthStatus() {
    if (process.platform !== "darwin") {
        return { status: "unavailable" };
    }
    return runHelper({
        command: "auth_status"
    });
}
export async function requestMacOSCalendarAccess() {
    if (process.platform !== "darwin") {
        return {
            granted: false,
            status: "unavailable"
        };
    }
    return runHelper({
        command: "request_access"
    });
}
export async function discoverMacOSLocalCalendars() {
    const payload = await runHelper({
        command: "discover"
    });
    return {
        status: payload.status,
        requestedAt: new Date().toISOString(),
        sources: payload.sources
    };
}
export async function listMacOSLocalEvents(input) {
    return runHelper({
        command: "list_events",
        ...input
    });
}
export async function ensureMacOSLocalForgeCalendar(sourceId) {
    return runHelper({
        command: "ensure_forge_calendar",
        sourceId
    });
}
export async function upsertMacOSLocalEvent(input) {
    return runHelper({
        command: "upsert_event",
        ...input
    });
}
export async function deleteMacOSLocalEvent(eventId) {
    return runHelper({
        command: "delete_event",
        eventId
    });
}
