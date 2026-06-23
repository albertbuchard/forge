import SwiftUI

struct WatchPromptInboxView: View {
    @EnvironmentObject private var appModel: WatchAppModel

    var body: some View {
        ZStack {
            WatchSurfaceBackground()

            if appModel.bootstrap.pendingPrompts.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "tray")
                        .font(.system(size: 24))
                        .foregroundStyle(WatchTheme.accent)
                    Text("No prompts")
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                        .foregroundStyle(WatchTheme.textPrimary)
                }
            } else {
                List(appModel.bootstrap.pendingPrompts) { prompt in
                    NavigationLink {
                        WatchPromptDetailView(prompt: prompt)
                    } label: {
                        WatchCard {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(prompt.title)
                                    .font(.system(size: 13, weight: .bold, design: .rounded))
                                    .foregroundStyle(WatchTheme.textPrimary)
                                Text(prompt.message)
                                    .font(.system(size: 11, weight: .medium, design: .rounded))
                                    .foregroundStyle(WatchTheme.textMuted)
                                    .lineLimit(3)
                            }
                        }
                    }
                    .listRowBackground(Color.clear)
                    .buttonStyle(.plain)
                }
                .scrollContentBackground(.hidden)
                .background(Color.clear)
            }
        }
        .navigationTitle("Prompt Inbox")
    }
}

private struct WatchPromptDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var appModel: WatchAppModel

    let prompt: ForgeWatchPrompt

    private func eventType(for kind: String) -> String {
        switch kind {
        case "new_place":
            return "place_label"
        case "trip_label":
            return "trip_label"
        case "workout_annotation":
            return "workout_annotation"
        case "social_follow_up":
            return "social_context"
        case "unknown_block":
            return "retrospective_label"
        default:
            return "routine_check"
        }
    }

    var body: some View {
        ZStack {
            WatchSurfaceBackground()

            List {
                Section {
                    Text(prompt.message)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(WatchTheme.textPrimary)
                }

                Section("Choices") {
                    ForEach(prompt.choices, id: \.self) { choice in
                        Button(choice) {
                            appModel.queueCaptureEvent(
                                eventType: eventType(for: prompt.kind),
                                promptId: prompt.id,
                                linkedContext: prompt.linkedContext,
                                payload: [
                                    prompt.kind == "workout_annotation" ? "moodAfter" : "label": choice,
                                    "choice": choice
                                ]
                            )
                            dismiss()
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.clear)
        }
        .navigationTitle(prompt.title)
    }
}
