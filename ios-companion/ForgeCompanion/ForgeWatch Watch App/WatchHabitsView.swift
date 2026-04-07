import SwiftUI

struct WatchHabitsView: View {
    @EnvironmentObject private var appModel: WatchAppModel

    var body: some View {
        ZStack {
            WatchSurfaceBackground()

            if appModel.bootstrap.habits.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "applewatch.slash")
                        .font(.system(size: 24, weight: .medium))
                        .foregroundStyle(WatchTheme.accent)
                    Text("Pair on iPhone")
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                        .foregroundStyle(WatchTheme.textPrimary)
                    Text(appModel.lastStatusMessage)
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(WatchTheme.textMuted)
                        .multilineTextAlignment(.center)
                }
                .padding()
            } else {
                List {
                    Section {
                        ForEach(appModel.bootstrap.habits) { habit in
                            NavigationLink {
                                WatchHabitActionView(habit: habit)
                            } label: {
                                WatchHabitCard(habit: habit)
                            }
                            .buttonStyle(.plain)
                            .listRowBackground(Color.clear)
                        }
                    } header: {
                        Text("Habits")
                    } footer: {
                        Text(appModel.lastStatusMessage)
                    }
                }
                .scrollContentBackground(.hidden)
                .background(Color.clear)
            }
        }
        .navigationTitle("Habits")
    }
}

private struct WatchHabitCard: View {
    let habit: ForgeWatchHabitSummary

    var body: some View {
        WatchCard {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(habit.title)
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundStyle(WatchTheme.textPrimary)
                        .lineLimit(2)

                    Text(habit.cadenceLabel)
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundStyle(WatchTheme.textMuted)
                        .lineLimit(2)

                    if habit.dueToday {
                        Text("Needs check-in")
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                            .foregroundStyle(WatchTheme.accent)
                    }
                }

                Spacer(minLength: 8)

                WatchHabitRingView(habit: habit)
            }
        }
    }
}

struct WatchHabitActionView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var appModel: WatchAppModel

    let habit: ForgeWatchHabitSummary

    var body: some View {
        ZStack {
            WatchSurfaceBackground()

            VStack(spacing: 12) {
                WatchHabitRingView(habit: habit)

                Text(habit.title)
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(WatchTheme.textPrimary)
                    .multilineTextAlignment(.center)

                Text(habit.cadenceLabel)
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(WatchTheme.textMuted)

                Button(habit.alignedActionLabel) {
                    let status = habit.polarity == "positive" ? "done" : "missed"
                    appModel.queueHabitCheckIn(for: habit, status: status)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .tint(WatchTheme.success)

                Button(habit.unalignedActionLabel) {
                    let status = habit.polarity == "positive" ? "missed" : "done"
                    appModel.queueHabitCheckIn(for: habit, status: status)
                    dismiss()
                }
                .buttonStyle(.bordered)
                .tint(WatchTheme.danger)

                Text("Back to skip")
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                    .foregroundStyle(WatchTheme.textMuted)
            }
            .padding()
        }
    }
}
