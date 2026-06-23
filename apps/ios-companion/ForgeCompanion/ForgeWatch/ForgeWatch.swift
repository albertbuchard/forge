import AppIntents
import WidgetKit
import SwiftUI

private struct WidgetBootstrap: Decodable {
    struct Habit: Decodable {
        let title: String
        let dueToday: Bool
    }

    let habits: [Habit]
}

private struct WidgetEntry: TimelineEntry {
    let date: Date
    let dueCount: Int
    let nextHabitTitle: String?
}

private struct WidgetProvider: TimelineProvider {
    private func currentEntry() -> WidgetEntry {
        let defaults = widgetSharedDefaults()
        let bootstrap = defaults.data(forKey: "forge_watch_bootstrap").flatMap {
            try? JSONDecoder().decode(WidgetBootstrap.self, from: $0)
        }
        let dueHabits = bootstrap?.habits.filter(\.dueToday) ?? []
        return WidgetEntry(
            date: Date(),
            dueCount: dueHabits.count,
            nextHabitTitle: dueHabits.first?.title
        )
    }

    func placeholder(in context: Context) -> WidgetEntry {
        WidgetEntry(date: Date(), dueCount: 2, nextHabitTitle: "Morning planning")
    }

    func getSnapshot(in context: Context, completion: @escaping (WidgetEntry) -> Void) {
        completion(currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WidgetEntry>) -> Void) {
        let entry = currentEntry()
        let nextRefresh = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

private func widgetSharedDefaults() -> UserDefaults {
    guard
        FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.albertbuchard.ForgeCompanion"
        ) != nil
    else {
        return .standard
    }
    return UserDefaults(suiteName: "group.albertbuchard.ForgeCompanion") ?? .standard
}

private struct ForgeWatchQuickActionsView: View {
    let entry: WidgetEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Forge Watch")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                Spacer()
                Text("\(entry.dueCount) due")
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            if let nextHabitTitle = entry.nextHabitTitle {
                Text(nextHabitTitle)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .lineLimit(1)
            }

            HStack {
                Button(intent: OpenHabitsIntent()) {
                    Label("Habits", systemImage: "circle.grid.2x2")
                }
                Button(intent: OpenCheckInIntent()) {
                    Label("Check In", systemImage: "waveform.path.ecg")
                }
            }

            HStack {
                Button(intent: OpenMarkMomentIntent()) {
                    Label("Moment", systemImage: "bookmark")
                }
                Button(intent: OpenEmotionIntent()) {
                    Label("Emotion", systemImage: "face.smiling")
                }
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

struct ForgeWatch: Widget {
    let kind: String = "ForgeWatchQuickActions"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: WidgetProvider()) { entry in
            ForgeWatchQuickActionsView(entry: entry)
        }
        .configurationDisplayName("Forge Watch")
        .description("Open habits, check in fast, mark a moment, or log an emotion.")
        .supportedFamilies([.accessoryRectangular, .accessoryInline])
    }
}

#Preview(as: .accessoryRectangular) {
    ForgeWatch()
} timeline: {
    WidgetEntry(date: .now, dueCount: 2, nextHabitTitle: "Morning planning")
}
