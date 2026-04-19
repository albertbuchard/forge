import Combine
import Foundation

private let companionDebugLogDisplayFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "HH:mm:ss"
    return formatter
}()

private let companionDebugLogExportFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

private func inferCompanionDebugLogLevel(for message: String) -> CompanionDebugLogLevel {
    let normalized = message.lowercased()
    if normalized.contains("error=")
        || normalized.contains(" failed")
        || normalized.hasPrefix("failed")
        || normalized.contains(" failure")
    {
        return .error
    }
    if normalized.contains("warning") || normalized.contains("warn") {
        return .warn
    }
    if normalized.contains("debug") {
        return .debug
    }
    return .info
}

enum CompanionDebugLogLevel: String, Codable, CaseIterable, Hashable, Identifiable {
    case debug
    case info
    case warn
    case error

    var id: String { rawValue }

    var label: String {
        rawValue.uppercased()
    }

    var storageRetentionBucket: String {
        switch self {
        case .error:
            return "error"
        case .debug, .info, .warn:
            return "regular"
        }
    }
}

struct CompanionDebugLogRetentionSettings: Codable, Hashable {
    var regularDays: Int
    var errorDays: Int

    static let `default` = CompanionDebugLogRetentionSettings(regularDays: 1, errorDays: 10)
}

struct CompanionDebugLogEntry: Codable, Identifiable, Hashable {
    let id: String
    let timestamp: Date
    let scope: String
    let message: String
    let level: CompanionDebugLogLevel

    private enum CodingKeys: String, CodingKey {
        case id
        case timestamp
        case scope
        case message
        case level
    }

    init(
        id: String,
        timestamp: Date,
        scope: String,
        message: String,
        level: CompanionDebugLogLevel = .info
    ) {
        self.id = id
        self.timestamp = timestamp
        self.scope = scope
        self.message = message
        self.level = level
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        timestamp = try container.decode(Date.self, forKey: .timestamp)
        scope = try container.decode(String.self, forKey: .scope)
        message = try container.decode(String.self, forKey: .message)
        level = try container.decodeIfPresent(CompanionDebugLogLevel.self, forKey: .level) ?? .info
    }

    var formattedTimestamp: String {
        companionDebugLogDisplayFormatter.string(from: timestamp)
    }

    var exportTimestamp: String {
        companionDebugLogExportFormatter.string(from: timestamp)
    }

    var exportLine: String {
        "[\(exportTimestamp)][\(level.label)][\(scope)] \(message)"
    }
}

@MainActor
final class CompanionDebugLogStore: ObservableObject {
    static let shared = CompanionDebugLogStore()

    private enum StorageKeys {
        static let entries = "forge_companion_debug_log_entries"
        static let retentionSettings = "forge_companion_debug_log_retention_settings"
    }

    private let maxEntries = 1500

    @Published private(set) var entries: [CompanionDebugLogEntry] = []
    @Published private(set) var retentionSettings = CompanionDebugLogRetentionSettings.default

    private init() {
        if
            let settingsData = UserDefaults.standard.data(forKey: StorageKeys.retentionSettings),
            let decodedSettings = try? JSONDecoder().decode(
                CompanionDebugLogRetentionSettings.self,
                from: settingsData
            )
        {
            retentionSettings = decodedSettings
        }
        if
            let data = UserDefaults.standard.data(forKey: StorageKeys.entries),
            let decoded = try? JSONDecoder().decode([CompanionDebugLogEntry].self, from: data)
        {
            entries = Self.prunedEntries(
                entries: decoded,
                settings: retentionSettings,
                referenceDate: Date()
            )
            persistEntries()
        }
    }

    func record(
        scope: String,
        message: String,
        timestamp: Date,
        level: CompanionDebugLogLevel
    ) {
        entries = Self.prunedEntries(
            entries: entries,
            settings: retentionSettings,
            referenceDate: timestamp
        )
        let entry = CompanionDebugLogEntry(
            id: UUID().uuidString.lowercased(),
            timestamp: timestamp,
            scope: scope,
            message: message,
            level: level
        )
        entries.insert(entry, at: 0)
        if entries.count > maxEntries {
            entries = Array(entries.prefix(maxEntries))
        }
        persistEntries()
    }

    func clear() {
        entries = []
        UserDefaults.standard.removeObject(forKey: StorageKeys.entries)
    }

    func updateRetentionSettings(regularDays: Int, errorDays: Int) {
        retentionSettings = CompanionDebugLogRetentionSettings(
            regularDays: max(1, regularDays),
            errorDays: max(1, errorDays)
        )
        persistRetentionSettings()
        entries = Self.prunedEntries(
            entries: entries,
            settings: retentionSettings,
            referenceDate: Date()
        )
        persistEntries()
    }

    func renderPlainText(entries filteredEntries: [CompanionDebugLogEntry]? = nil) -> String {
        Self.renderPlainText(entries: filteredEntries ?? entries)
    }

    static func renderPlainText(entries: [CompanionDebugLogEntry]) -> String {
        guard entries.isEmpty == false else {
            return "No Forge Companion diagnostic logs captured."
        }
        return entries
            .reversed()
            .map(\.exportLine)
            .joined(separator: "\n")
    }

    static func prunedEntries(
        entries: [CompanionDebugLogEntry],
        settings: CompanionDebugLogRetentionSettings,
        referenceDate: Date
    ) -> [CompanionDebugLogEntry] {
        entries.filter { entry in
            let retentionDays =
                entry.level.storageRetentionBucket == "error"
                ? settings.errorDays
                : settings.regularDays
            guard retentionDays > 0 else {
                return true
            }
            guard let expirationDate = Calendar.current.date(
                byAdding: .day,
                value: retentionDays,
                to: entry.timestamp
            ) else {
                return true
            }
            return expirationDate >= referenceDate
        }
    }

    private func persistEntries() {
        guard let data = try? JSONEncoder().encode(entries) else {
            return
        }
        UserDefaults.standard.set(data, forKey: StorageKeys.entries)
    }

    private func persistRetentionSettings() {
        guard let data = try? JSONEncoder().encode(retentionSettings) else {
            return
        }
        UserDefaults.standard.set(data, forKey: StorageKeys.retentionSettings)
    }
}

nonisolated
func companionDebugLog(
    _ scope: String,
    level: CompanionDebugLogLevel,
    _ message: @autoclosure () -> String
) {
    let renderedMessage = message()
    let timestamp = Date()
    let renderedTimestamp = companionDebugLogExportFormatter.string(from: timestamp)
    print("[ForgeCompanion][\(renderedTimestamp)][\(level.label)][\(scope)] \(renderedMessage)")
    Task { @MainActor in
        CompanionDebugLogStore.shared.record(
            scope: scope,
            message: renderedMessage,
            timestamp: timestamp,
            level: level
        )
    }
}

nonisolated
func companionDebugLog(_ scope: String, _ message: @autoclosure () -> String) {
    let renderedMessage = message()
    companionDebugLog(
        scope,
        level: inferCompanionDebugLogLevel(for: renderedMessage),
        renderedMessage
    )
}
