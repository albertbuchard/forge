import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var appModel: WatchAppModel
    @State private var crownValue = 0.0
    @State private var selectedHabit: ForgeWatchHabitSummary?

    private let surfaces = WatchSurface.allCases

    var body: some View {
        ZStack {
            WatchSurfaceBackground()

            VStack(alignment: .leading, spacing: 8) {
                header

                WatchSurfacePager(
                    surface: appModel.selectedSurface,
                    bootstrap: appModel.bootstrap,
                    onHabitTap: { selectedHabit = $0 },
                    onCommand: appModel.queueCommand,
                    onCapture: appModel.queueCaptureEvent
                )
                .id(appModel.selectedSurface)
                .transition(.opacity.combined(with: .scale(scale: 0.97)))
            }
            .padding(.horizontal, 8)
            .padding(.top, 2)
        }
        .digitalCrownRotation(
            $crownValue,
            from: 0,
            through: Double(max(0, surfaces.count - 1)),
            by: 1,
            sensitivity: .medium,
            isContinuous: false,
            isHapticFeedbackEnabled: true
        )
        .onAppear {
            appModel.consumePendingLaunchDestination()
            crownValue = Double(surfaceIndex(appModel.selectedSurface))
        }
        .onChange(of: crownValue) { _, value in
            let index = min(max(Int(value.rounded()), 0), surfaces.count - 1)
            withAnimation(.snappy(duration: 0.22)) {
                appModel.selectedSurface = surfaces[index]
            }
        }
        .onChange(of: appModel.selectedSurface) { _, surface in
            crownValue = Double(surfaceIndex(surface))
        }
        .sheet(item: $selectedHabit) { habit in
            WatchHabitActionView(habit: habit)
                .environmentObject(appModel)
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(surfaceTitle(appModel.selectedSurface))
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .foregroundStyle(WatchTheme.textPrimary)
                    .lineLimit(1)

                Text(appModel.lastStatusMessage)
                    .font(.system(size: 9, weight: .medium, design: .rounded))
                    .foregroundStyle(WatchTheme.textMuted)
                    .lineLimit(1)
            }

            Spacer(minLength: 4)

            Text("\(surfaceIndex(appModel.selectedSurface) + 1)/\(surfaces.count)")
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundStyle(WatchTheme.accent)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(Capsule().fill(Color.white.opacity(0.1)))
        }
    }

    private func surfaceIndex(_ surface: WatchSurface) -> Int {
        surfaces.firstIndex(of: surface) ?? 0
    }

    private func surfaceTitle(_ surface: WatchSurface) -> String {
        appModel.bootstrap.surfaces?
            .first(where: { $0.id == surface.rawValue })?
            .title ?? surface.rawValue.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

private struct WatchSurfacePager: View {
    let surface: WatchSurface
    let bootstrap: ForgeWatchBootstrap
    let onHabitTap: (ForgeWatchHabitSummary) -> Void
    let onCommand: (ForgeWatchActionKind, [String: String]) -> Void
    let onCapture: (String, String?, ForgeWatchLinkedContext, [String: String]) -> Void

    var body: some View {
        Group {
            switch surface {
            case .now:
                NowSurface(bootstrap: bootstrap, onCommand: onCommand)
            case .work:
                WorkSurface(work: bootstrap.work, onCommand: onCommand)
            case .habits:
                HabitSurface(habits: bootstrap.habits, onHabitTap: onHabitTap)
            case .goals:
                GoalSurface(goals: bootstrap.goals ?? [], projects: bootstrap.projects ?? [])
            case .today:
                TodaySurface(today: bootstrap.today, onCommand: onCommand)
            case .health:
                HealthSurface(health: bootstrap.health)
            case .movement:
                MovementSurface(movement: bootstrap.movement)
            case .psyche:
                PsycheSurface(psyche: bootstrap.psyche, onCapture: onCapture)
            case .inbox:
                InboxSurface(prompts: bootstrap.inbox?.prompts ?? bootstrap.pendingPrompts, onCapture: onCapture)
            case .sync:
                SyncSurface(sync: bootstrap.sync)
            }
        }
        .animation(.snappy(duration: 0.24), value: surface)
    }
}

private struct SurfaceCarousel<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        TabView {
            content
        }
        .tabViewStyle(.carousel)
    }
}

private struct DenseMetric: View {
    let title: String
    let value: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(tint)
                .lineLimit(1)
            Text(title)
                .font(.system(size: 9, weight: .semibold, design: .rounded))
                .foregroundStyle(WatchTheme.textMuted)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct EmptySurfaceCard: View {
    let title: String
    let message: String

    var body: some View {
        WatchCard {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: "applewatch")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(WatchTheme.accent)
                Text(title)
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(WatchTheme.textPrimary)
                Text(message)
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(WatchTheme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct NowSurface: View {
    let bootstrap: ForgeWatchBootstrap
    let onCommand: (ForgeWatchActionKind, [String: String]) -> Void

    var body: some View {
        SurfaceCarousel {
            WatchCard {
                VStack(alignment: .leading, spacing: 9) {
                    Text("Command Center")
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(WatchTheme.textPrimary)
                    HStack(spacing: 8) {
                        DenseMetric(title: "Habits", value: "\(bootstrap.now?.dueHabitCount ?? bootstrap.habits.filter(\.dueToday).count)", tint: WatchTheme.success)
                        DenseMetric(title: "Prompts", value: "\(bootstrap.now?.pendingPromptCount ?? bootstrap.pendingPrompts.count)", tint: WatchTheme.accent)
                    }
                    if let task = bootstrap.now?.nextTask ?? bootstrap.work?.nextTask {
                        Divider().background(WatchTheme.border)
                        Text(task.title)
                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                            .foregroundStyle(WatchTheme.textPrimary)
                            .lineLimit(3)
                        Button {
                            onCommand(.taskRunStart, ["taskId": task.id])
                        } label: {
                            Label("Start", systemImage: "play.fill")
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(WatchTheme.accent)
                    }
                }
            }

            if let run = bootstrap.now?.currentRun ?? bootstrap.work?.currentRun {
                RunCard(run: run, onCommand: onCommand)
            }
        }
    }
}

private struct WorkSurface: View {
    let work: ForgeWatchWorkSnapshot?
    let onCommand: (ForgeWatchActionKind, [String: String]) -> Void

    var body: some View {
        if let work {
            SurfaceCarousel {
                if let current = work.currentRun {
                    RunCard(run: current, onCommand: onCommand)
                }
                ForEach(work.lanes) { lane in
                    LaneCard(lane: lane, onCommand: onCommand)
                }
            }
        } else {
            EmptySurfaceCard(title: "No work snapshot", message: "Open Forge on iPhone once to refresh the watch command surface.")
        }
    }
}

private struct RunCard: View {
    let run: ForgeWatchTaskRunSummary
    let onCommand: (ForgeWatchActionKind, [String: String]) -> Void

    var body: some View {
        WatchCard {
            VStack(alignment: .leading, spacing: 8) {
                Text("Active Run")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(WatchTheme.accent)
                Text(run.taskTitle)
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(WatchTheme.textPrimary)
                    .lineLimit(3)
                HStack(spacing: 8) {
                    DenseMetric(title: "Credited", value: formatSeconds(run.creditedSeconds), tint: WatchTheme.success)
                    DenseMetric(title: "Mode", value: run.timerMode.capitalized, tint: WatchTheme.accent)
                }
                HStack {
                    Button {
                        onCommand(.taskRunHeartbeat, ["runId": run.id])
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    Button {
                        onCommand(.taskRunComplete, ["runId": run.id])
                    } label: {
                        Image(systemName: "checkmark")
                    }
                    Button {
                        onCommand(.taskRunRelease, ["runId": run.id])
                    } label: {
                        Image(systemName: "pause.fill")
                    }
                }
                .buttonStyle(.bordered)
            }
        }
    }
}

private struct LaneCard: View {
    let lane: ForgeWatchWorkLane
    let onCommand: (ForgeWatchActionKind, [String: String]) -> Void

    var body: some View {
        WatchCard {
            VStack(alignment: .leading, spacing: 7) {
                HStack {
                    Text(lane.title)
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(WatchTheme.textPrimary)
                    Spacer()
                    Text("\(lane.count)")
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundStyle(WatchTheme.accent)
                }

                ForEach(lane.tasks.prefix(3)) { task in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(task.title)
                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                            .foregroundStyle(WatchTheme.textPrimary)
                            .lineLimit(2)
                        HStack {
                            Button {
                                onCommand(.taskRunStart, ["taskId": task.id])
                            } label: {
                                Image(systemName: "play.fill")
                            }
                            Button {
                                onCommand(.taskStatusUpdate, ["taskId": task.id, "status": "focus"])
                            } label: {
                                Image(systemName: "scope")
                            }
                            Button {
                                onCommand(.taskStatusUpdate, ["taskId": task.id, "status": "done"])
                            } label: {
                                Image(systemName: "checkmark")
                            }
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(WatchTheme.accent)
                    }
                    Divider().background(WatchTheme.border)
                }
            }
        }
    }
}

private struct HabitSurface: View {
    let habits: [ForgeWatchHabitSummary]
    let onHabitTap: (ForgeWatchHabitSummary) -> Void

    var body: some View {
        if habits.isEmpty {
            EmptySurfaceCard(title: "No habits loaded", message: "Forge will send active habits to the watch after the next iPhone refresh.")
        } else {
            SurfaceCarousel {
                ForEach(habits) { habit in
                    Button {
                        onHabitTap(habit)
                    } label: {
                        WatchCard {
                            HStack(spacing: 9) {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(habit.title)
                                        .font(.system(size: 14, weight: .bold, design: .rounded))
                                        .foregroundStyle(WatchTheme.textPrimary)
                                        .lineLimit(3)
                                    Text(habit.cadenceLabel)
                                        .font(.system(size: 10, weight: .medium, design: .rounded))
                                        .foregroundStyle(WatchTheme.textMuted)
                                    Text(habit.dueToday ? "Tap to check in" : "Current period captured")
                                        .font(.system(size: 10, weight: .bold, design: .rounded))
                                        .foregroundStyle(habit.dueToday ? WatchTheme.accent : WatchTheme.success)
                                }
                                Spacer(minLength: 4)
                                WatchHabitRingView(habit: habit)
                                    .scaleEffect(0.86)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

private struct GoalSurface: View {
    let goals: [ForgeWatchGoalSummary]
    let projects: [ForgeWatchProjectSummary]

    var body: some View {
        SurfaceCarousel {
            ForEach(goals) { goal in
                WatchCard {
                    VStack(alignment: .leading, spacing: 7) {
                        Text(goal.horizon.capitalized)
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                            .foregroundStyle(WatchTheme.accent)
                        Text(goal.title)
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                            .foregroundStyle(WatchTheme.textPrimary)
                            .lineLimit(4)
                        Text("\(goal.targetPoints) target pts")
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(WatchTheme.textMuted)
                    }
                }
            }
            ForEach(projects) { project in
                WatchCard {
                    VStack(alignment: .leading, spacing: 7) {
                        Text(project.workflowStatus.capitalized)
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                            .foregroundStyle(WatchTheme.success)
                        Text(project.title)
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                            .foregroundStyle(WatchTheme.textPrimary)
                            .lineLimit(4)
                        HStack {
                            DenseMetric(title: "Open", value: "\(project.openTaskCount)", tint: WatchTheme.accent)
                            DenseMetric(title: "Runs", value: "\(project.activeRunCount)", tint: WatchTheme.success)
                        }
                    }
                }
            }
        }
    }
}

private struct TodaySurface: View {
    let today: ForgeWatchTodaySnapshot?
    let onCommand: (ForgeWatchActionKind, [String: String]) -> Void

    var body: some View {
        if let today {
            SurfaceCarousel {
                WatchCard {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(today.dateKey)
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                            .foregroundStyle(WatchTheme.accent)
                        HStack {
                            DenseMetric(title: "Due", value: "\(today.dueCount)", tint: WatchTheme.accent)
                            DenseMetric(title: "Done", value: "\(today.recentDone.count)", tint: WatchTheme.success)
                        }
                    }
                }
                ForEach(today.dueTasks) { task in
                    WatchCard {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(task.title)
                                .font(.system(size: 14, weight: .bold, design: .rounded))
                                .foregroundStyle(WatchTheme.textPrimary)
                                .lineLimit(4)
                            Button {
                                onCommand(.taskRunStart, ["taskId": task.id])
                            } label: {
                                Label("Start", systemImage: "play.fill")
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(WatchTheme.accent)
                        }
                    }
                }
            }
        } else {
            EmptySurfaceCard(title: "Today not loaded", message: "The next iPhone bridge refresh will send due tasks and recent completions.")
        }
    }
}

private struct HealthSurface: View {
    let health: ForgeWatchHealthSnapshot?

    var body: some View {
        if let health {
            SurfaceCarousel {
                WatchCard {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Health")
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundStyle(WatchTheme.textPrimary)
                        HStack {
                            DenseMetric(title: "Vitals", value: "\(health.latestVitals?.metricCount ?? 0)", tint: WatchTheme.accent)
                            DenseMetric(title: "HR samples", value: "\(health.lastWorkout?.heartRateSampleCount ?? 0)", tint: WatchTheme.success)
                        }
                    }
                }
                if let workout = health.lastWorkout {
                    WatchCard {
                        VStack(alignment: .leading, spacing: 7) {
                            Text(workout.workoutType)
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                                .foregroundStyle(WatchTheme.textPrimary)
                                .lineLimit(2)
                            HStack {
                                DenseMetric(title: "Avg HR", value: workout.averageHeartRate.map { "\(Int($0))" } ?? "--", tint: WatchTheme.accent)
                                DenseMetric(title: "Load", value: workout.trainingLoad.map { "\(Int($0))" } ?? "--", tint: WatchTheme.success)
                            }
                        }
                    }
                }
            }
        } else {
            EmptySurfaceCard(title: "Health not loaded", message: "Forge will send compact health context after the next sync.")
        }
    }
}

private struct MovementSurface: View {
    let movement: ForgeWatchMovementSnapshot?

    var body: some View {
        if let movement {
            SurfaceCarousel {
                WatchCard {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Movement")
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundStyle(WatchTheme.textPrimary)
                        HStack {
                            DenseMetric(title: "Unlabeled", value: "\(movement.unlabeledPlaceCount)", tint: WatchTheme.accent)
                            DenseMetric(title: "Latest", value: movement.latestTrip == nil ? "Stay" : "Trip", tint: WatchTheme.success)
                        }
                    }
                }
                if let trip = movement.latestTrip {
                    SegmentCard(title: "Latest trip", segment: trip)
                }
                if let stay = movement.latestStay {
                    SegmentCard(title: "Latest stay", segment: stay)
                }
            }
        } else {
            EmptySurfaceCard(title: "Movement not loaded", message: "Location context appears here after iPhone sync.")
        }
    }
}

private struct SegmentCard: View {
    let title: String
    let segment: ForgeWatchMovementSnapshot.Segment

    var body: some View {
        WatchCard {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(WatchTheme.accent)
                Text(segment.label.isEmpty ? "Unlabeled" : segment.label)
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(WatchTheme.textPrimary)
                    .lineLimit(3)
                Text(segment.startedAt)
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                    .foregroundStyle(WatchTheme.textMuted)
                    .lineLimit(1)
            }
        }
    }
}

private struct PsycheSurface: View {
    let psyche: ForgeWatchPsycheSnapshot?
    let onCapture: (String, String?, ForgeWatchLinkedContext, [String: String]) -> Void

    var body: some View {
        SurfaceCarousel {
            ChoiceCard(title: "Emotion", options: psyche?.emotionOptions ?? []) { choice in
                onCapture("emotion_check_in", nil, .empty, ["emotion": choice])
            }
            ChoiceCard(title: "Trigger", options: psyche?.triggerOptions ?? []) { choice in
                onCapture("trigger_capture", nil, .empty, ["trigger": choice])
            }
            ChoiceCard(title: "Routine", options: psyche?.routinePromptOptions ?? []) { choice in
                onCapture("routine_check", nil, .empty, ["routine": choice])
            }
        }
    }
}

private struct InboxSurface: View {
    let prompts: [ForgeWatchPrompt]
    let onCapture: (String, String?, ForgeWatchLinkedContext, [String: String]) -> Void

    var body: some View {
        if prompts.isEmpty {
            EmptySurfaceCard(title: "Inbox clear", message: "No watch-sized prompts are waiting.")
        } else {
            SurfaceCarousel {
                ForEach(prompts) { prompt in
                    WatchCard {
                        VStack(alignment: .leading, spacing: 7) {
                            Text(prompt.title)
                                .font(.system(size: 14, weight: .bold, design: .rounded))
                                .foregroundStyle(WatchTheme.textPrimary)
                                .lineLimit(2)
                            Text(prompt.message)
                                .font(.system(size: 11, weight: .medium, design: .rounded))
                                .foregroundStyle(WatchTheme.textMuted)
                                .lineLimit(3)
                            ForEach(prompt.choices.prefix(3), id: \.self) { choice in
                                Button(choice) {
                                    onCapture(eventType(for: prompt.kind), prompt.id, prompt.linkedContext, ["choice": choice, "label": choice])
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                    }
                }
            }
        }
    }

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
}

private struct SyncSurface: View {
    let sync: ForgeWatchSyncSnapshot?

    var body: some View {
        WatchCard {
            VStack(alignment: .leading, spacing: 9) {
                Text("Sync")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(WatchTheme.textPrimary)
                HStack {
                    DenseMetric(title: "Captures", value: "\(sync?.storedCaptureCount ?? 0)", tint: WatchTheme.accent)
                    DenseMetric(title: "Receipts", value: "\(sync?.actionReceiptCount ?? 0)", tint: WatchTheme.success)
                }
                Text(sync?.generatedAt ?? "Waiting for iPhone")
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                    .foregroundStyle(WatchTheme.textMuted)
                    .lineLimit(2)
            }
        }
    }
}

private struct ChoiceCard: View {
    let title: String
    let options: [String]
    let onSelect: (String) -> Void

    var body: some View {
        WatchCard {
            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(WatchTheme.textPrimary)
                ForEach(options.prefix(5), id: \.self) { option in
                    Button(option) {
                        onSelect(option)
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
    }
}

private func formatSeconds(_ seconds: Double) -> String {
    let total = max(0, Int(seconds.rounded()))
    let minutes = total / 60
    if minutes < 60 {
        return "\(minutes)m"
    }
    return "\(minutes / 60)h\(minutes % 60)"
}

#Preview {
    ContentView()
        .environmentObject(WatchAppModel(preview: true))
}
