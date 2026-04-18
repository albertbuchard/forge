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

struct CompanionDebugLogEntry: Codable, Identifiable, Hashable {
    let id: String
    let timestamp: Date
    let scope: String
    let message: String

    var formattedTimestamp: String {
        companionDebugLogDisplayFormatter.string(from: timestamp)
    }

    var exportTimestamp: String {
        companionDebugLogExportFormatter.string(from: timestamp)
    }

    var exportLine: String {
        "[\(exportTimestamp)][\(scope)] \(message)"
    }
}

@MainActor
final class CompanionDebugLogStore: ObservableObject {
    static let shared = CompanionDebugLogStore()

    private enum StorageKeys {
        static let entries = "forge_companion_debug_log_entries"
    }

    private let maxEntries = 1500

    @Published private(set) var entries: [CompanionDebugLogEntry] = []

    private init() {
        if
            let data = UserDefaults.standard.data(forKey: StorageKeys.entries),
            let decoded = try? JSONDecoder().decode([CompanionDebugLogEntry].self, from: data)
        {
            entries = decoded
        }
    }

    func record(scope: String, message: String, timestamp: Date) {
        let entry = CompanionDebugLogEntry(
            id: UUID().uuidString.lowercased(),
            timestamp: timestamp,
            scope: scope,
            message: message
        )
        entries.insert(entry, at: 0)
        if entries.count > maxEntries {
            entries = Array(entries.prefix(maxEntries))
        }
        persist()
    }

    func clear() {
        entries = []
        UserDefaults.standard.removeObject(forKey: StorageKeys.entries)
    }

    func renderPlainText() -> String {
        Self.renderPlainText(entries: entries)
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

    private func persist() {
        guard let data = try? JSONEncoder().encode(entries) else {
            return
        }
        UserDefaults.standard.set(data, forKey: StorageKeys.entries)
    }
}

nonisolated
func companionDebugLog(_ scope: String, _ message: @autoclosure () -> String) {
    let renderedMessage = message()
    let timestamp = Date()
    let renderedTimestamp = companionDebugLogExportFormatter.string(from: timestamp)
    print("[ForgeCompanion][\(renderedTimestamp)][\(scope)] \(renderedMessage)")
    Task { @MainActor in
        CompanionDebugLogStore.shared.record(
            scope: scope,
            message: renderedMessage,
            timestamp: timestamp
        )
    }
}
