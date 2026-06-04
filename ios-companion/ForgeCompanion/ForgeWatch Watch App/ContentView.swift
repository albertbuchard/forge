import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var appModel: WatchAppModel
    @StateObject private var navigation = WatchNavigationModel()
    @State private var selectedHabit: ForgeWatchHabitSummary?
    @State private var selectedCommand: WatchCommandModalItem?
    @FocusState private var crownFocused: Bool

    private let surfaces = WatchSurface.allCases

    var body: some View {
        ZStack {
            WatchSurfaceBackground()

            VStack(alignment: .leading, spacing: 8) {
                header

                WatchSurfacePager(
                    surface: navigation.selectedSurface,
                    navigation: navigation,
                    bootstrap: appModel.bootstrap,
                    onHabitTap: { selectedHabit = $0 },
                    onCommandTap: { selectedCommand = $0 },
                    onCommand: appModel.queueCommand,
                    onCapture: appModel.queueCaptureEvent,
                    onRefresh: { appModel.requestPhoneRefresh(reason: "surface_refresh") },
                    onRetry: appModel.flushPendingActions
                )
                .id(navigation.selectedSurface)
                .transition(.opacity.combined(with: .scale(scale: 0.97)))
            }
            .padding(.horizontal, 8)
            .padding(.top, 2)
        }
        .focusable(true)
        .focused($crownFocused)
        .digitalCrownRotation(
            $navigation.crownValue,
            from: 0,
            through: Double(max(0, surfaces.count - 1)),
            by: 1,
            sensitivity: .medium,
            isContinuous: false,
            isHapticFeedbackEnabled: true
        )
        .onAppear {
            appModel.consumePendingLaunchDestination()
            navigation.selectSurface(appModel.selectedSurface)
            crownFocused = true
            appModel.requestPhoneRefresh(reason: "watch_open")
        }
        .onChange(of: navigation.crownValue) { _, value in
            withAnimation(.snappy(duration: 0.22)) {
                navigation.selectSurfaceFromCrown(value)
            }
        }
        .onChange(of: appModel.selectedSurface) { _, surface in
            navigation.selectSurface(surface)
        }
        .onChange(of: navigation.selectedSurface) { _, surface in
            appModel.selectedSurface = surface
            navigation.crownValue = Double(surfaceIndex(surface))
        }
        .sheet(item: $selectedHabit) { habit in
            WatchHabitActionView(habit: habit)
                .environmentObject(appModel)
        }
        .sheet(item: $selectedCommand) { item in
            WatchCommandModalView(item: item)
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(surfaceTitle(navigation.selectedSurface))
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .foregroundStyle(WatchTheme.textPrimary)
                    .lineLimit(1)

                Text(appModel.lastStatusMessage)
                    .font(.system(size: 9, weight: .medium, design: .rounded))
                    .foregroundStyle(WatchTheme.textMuted)
                    .lineLimit(1)
            }

            Spacer(minLength: 4)

            Button {
                withAnimation(.snappy(duration: 0.18)) {
                    navigation.selectPreviousSurface()
                }
            } label: {
                Image(systemName: "chevron.up")
                    .font(.system(size: 10, weight: .black))
            }
            .buttonStyle(.plain)
            .foregroundStyle(WatchTheme.textMuted)

            Text("\(surfaceIndex(navigation.selectedSurface) + 1)/\(surfaces.count)")
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundStyle(WatchTheme.accent)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(Capsule().fill(Color.white.opacity(0.1)))

            Button {
                withAnimation(.snappy(duration: 0.18)) {
                    navigation.selectNextSurface()
                }
            } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .black))
            }
            .buttonStyle(.plain)
            .foregroundStyle(WatchTheme.textMuted)
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
    @ObservedObject var navigation: WatchNavigationModel
    let bootstrap: ForgeWatchBootstrap
    let onHabitTap: (ForgeWatchHabitSummary) -> Void
    let onCommandTap: (WatchCommandModalItem) -> Void
    let onCommand: (ForgeWatchActionKind, [String: String]) -> Void
    let onCapture: (String, String?, ForgeWatchLinkedContext, [String: String]) -> Void
    let onRefresh: () -> Void
    let onRetry: () -> Void

    var body: some View {
        Group {
            switch surface {
            case .now:
                NowSurface(
                    bootstrap: bootstrap,
                    selection: navigation.cardIndexBinding(for: surface),
                    onCommandTap: onCommandTap,
                    onCommand: onCommand,
                    onCapture: onCapture,
                    onRefresh: onRefresh
                )
            case .work:
                WorkSurface(
                    work: bootstrap.work,
                    selection: navigation.cardIndexBinding(for: surface),
                    onCommandTap: onCommandTap,
                    onCommand: onCommand,
                    onRefresh: onRefresh
                )
            case .habits:
                HabitSurface(
                    habits: bootstrap.habits,
                    selection: navigation.cardIndexBinding(for: surface),
                    onHabitTap: onHabitTap,
                    onRefresh: onRefresh
                )
            case .goals:
                GoalSurface(
                    goals: bootstrap.goals ?? [],
                    projects: bootstrap.projects ?? [],
                    selection: navigation.cardIndexBinding(for: surface),
                    onCapture: onCapture
                )
            case .today:
                TodaySurface(
                    today: bootstrap.today,
                    selection: navigation.cardIndexBinding(for: surface),
                    onCommandTap: onCommandTap,
                    onCommand: onCommand,
                    onCapture: onCapture
                )
            case .health:
                HealthSurface(
                    health: bootstrap.health,
                    selection: navigation.cardIndexBinding(for: surface),
                    onCapture: onCapture
                )
            case .movement:
                MovementSurface(
                    movement: bootstrap.movement,
                    selection: navigation.cardIndexBinding(for: surface),
                    onCapture: onCapture
                )
            case .psyche:
                PsycheSurface(
                    psyche: bootstrap.psyche,
                    selection: navigation.cardIndexBinding(for: surface),
                    onCapture: onCapture
                )
            case .inbox:
                InboxSurface(
                    prompts: bootstrap.inbox?.prompts ?? bootstrap.pendingPrompts,
                    selection: navigation.cardIndexBinding(for: surface),
                    onCapture: onCapture
                )
            case .sync:
                SyncSurface(sync: bootstrap.sync, onRefresh: onRefresh, onRetry: onRetry)
            }
        }
        .animation(.snappy(duration: 0.24), value: surface)
        .onAppear {
            navigation.registerCardCount(cardCount, for: surface)
        }
        .onChange(of: cardCount) { _, count in
            navigation.registerCardCount(count, for: surface)
        }
    }

    private var cardCount: Int {
        switch surface {
        case .now:
            return 1 + ((bootstrap.now?.currentRun ?? bootstrap.work?.currentRun) == nil ? 0 : 1)
        case .work:
            return max(1, (bootstrap.work?.lanes.count ?? 0) + (bootstrap.work?.currentRun == nil ? 0 : 1))
        case .habits:
            return max(1, bootstrap.habits.count)
        case .goals:
            return max(1, (bootstrap.goals?.count ?? 0) + (bootstrap.projects?.count ?? 0))
        case .today:
            return max(1, 1 + (bootstrap.today?.dueTasks.count ?? 0))
        case .health:
            return max(1, 1 + (bootstrap.health?.lastWorkout == nil ? 0 : 1))
        case .movement:
            return max(
                1,
                1 + (bootstrap.movement?.latestTrip == nil ? 0 : 1) + (bootstrap.movement?.latestStay == nil ? 0 : 1)
            )
        case .psyche:
            return 4
        case .inbox:
            return max(1, (bootstrap.inbox?.prompts ?? bootstrap.pendingPrompts).count)
        case .sync:
            return 1
        }
    }
}

private func taskCommandModal(
    task: ForgeWatchTaskSummary,
    onCommand: @escaping (ForgeWatchActionKind, [String: String]) -> Void
) -> WatchCommandModalItem {
    WatchCommandModalItem(
        id: "task:\(task.id)",
        title: task.title,
        subtitle: task.status.replacingOccurrences(of: "_", with: " ").capitalized,
        actions: [
            WatchCommandModalAction(id: "start", title: "Start", systemImage: "play.fill", tint: WatchTheme.success) {
                onCommand(.taskRunStart, ["taskId": task.id])
            },
            WatchCommandModalAction(id: "focus", title: "Focus", systemImage: "scope", tint: WatchTheme.accent) {
                onCommand(.taskStatusUpdate, ["taskId": task.id, "status": "focus"])
            },
            WatchCommandModalAction(id: "progress", title: "In progress", systemImage: "arrow.right.circle.fill", tint: WatchTheme.accent) {
                onCommand(.taskStatusUpdate, ["taskId": task.id, "status": "in_progress"])
            },
            WatchCommandModalAction(id: "blocked", title: "Blocked", systemImage: "exclamationmark.triangle.fill", tint: .orange) {
                onCommand(.taskStatusUpdate, ["taskId": task.id, "status": "blocked"])
            },
            WatchCommandModalAction(id: "done", title: "Done", systemImage: "checkmark.circle.fill", tint: WatchTheme.success) {
                onCommand(.taskStatusUpdate, ["taskId": task.id, "status": "done"])
            }
        ]
    )
}

private func runCommandModal(
    run: ForgeWatchTaskRunSummary,
    onCommand: @escaping (ForgeWatchActionKind, [String: String]) -> Void
) -> WatchCommandModalItem {
    WatchCommandModalItem(
        id: "run:\(run.id)",
        title: run.taskTitle,
        subtitle: "Active run · \(formatSeconds(run.creditedSeconds)) credited",
        actions: [
            WatchCommandModalAction(id: "heartbeat", title: "Keep alive", systemImage: "arrow.clockwise", tint: WatchTheme.accent) {
                onCommand(.taskRunHeartbeat, ["runId": run.id])
            },
            WatchCommandModalAction(id: "focus", title: "Focus", systemImage: "scope", tint: WatchTheme.accent) {
                onCommand(.taskRunFocus, ["runId": run.id])
            },
            WatchCommandModalAction(id: "complete", title: "Complete", systemImage: "checkmark.circle.fill", tint: WatchTheme.success) {
                onCommand(.taskRunComplete, ["runId": run.id])
            },
            WatchCommandModalAction(id: "pause", title: "Pause", systemImage: "pause.fill", tint: .orange) {
                onCommand(.taskRunRelease, ["runId": run.id])
            }
        ]
    )
}

private struct NowSurface: View {
    let bootstrap: ForgeWatchBootstrap
    @Binding var selection: Int
    let onCommandTap: (WatchCommandModalItem) -> Void
    let onCommand: (ForgeWatchActionKind, [String: String]) -> Void
    let onCapture: (String, String?, ForgeWatchLinkedContext, [String: String]) -> Void
    let onRefresh: () -> Void

    var body: some View {
        let run = bootstrap.now?.currentRun ?? bootstrap.work?.currentRun
        SurfaceCarousel(selection: $selection, count: run == nil ? 1 : 2) {
            WatchCard {
                VStack(alignment: .leading, spacing: 9) {
                    Text("Now")
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(WatchTheme.textPrimary)
                    HStack(spacing: 8) {
                        DenseMetric(title: "Habits", value: "\(bootstrap.now?.dueHabitCount ?? bootstrap.habits.filter(\.dueToday).count)", tint: WatchTheme.success)
                        DenseMetric(title: "Prompts", value: "\(bootstrap.now?.pendingPromptCount ?? bootstrap.pendingPrompts.count)", tint: WatchTheme.accent)
                    }
                    if let task = bootstrap.now?.nextTask ?? bootstrap.work?.nextTask {
                        Divider().background(WatchTheme.border)
                        Button {
                            onCommandTap(taskCommandModal(task: task, onCommand: onCommand))
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(task.title)
                                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                                    .foregroundStyle(WatchTheme.textPrimary)
                                    .lineLimit(3)
                                Label("Tap for task actions", systemImage: "ellipsis.circle")
                                    .font(.system(size: 9, weight: .bold, design: .rounded))
                                    .foregroundStyle(WatchTheme.accent)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                            .buttonStyle(.plain)
                    }
                    HStack(spacing: 6) {
                        Button {
                            onCapture("mark_moment", nil, .empty, ["surface": "now"])
                        } label: {
                            Label("Moment", systemImage: "bookmark.fill")
                                .font(.system(size: 10, weight: .bold, design: .rounded))
                        }
                        .buttonStyle(.bordered)
                        .tint(WatchTheme.accent)

                        Button {
                            onRefresh()
                        } label: {
                            Label("Sync", systemImage: "arrow.clockwise")
                                .font(.system(size: 10, weight: .bold, design: .rounded))
                        }
                        .buttonStyle(.bordered)
                        .tint(WatchTheme.success)
                    }
                }
            }
            .tag(0)

            if let run {
                RunCard(run: run, onCommandTap: onCommandTap, onCommand: onCommand)
                    .tag(1)
            }
        }
    }
}

private struct WorkSurface: View {
    let work: ForgeWatchWorkSnapshot?
    @Binding var selection: Int
    let onCommandTap: (WatchCommandModalItem) -> Void
    let onCommand: (ForgeWatchActionKind, [String: String]) -> Void
    let onRefresh: () -> Void

    var body: some View {
        if let work {
            SurfaceCarousel(selection: $selection, count: max(1, work.lanes.count + (work.currentRun == nil ? 0 : 1))) {
                let runOffset = work.currentRun == nil ? 0 : 1
                if let current = work.currentRun {
                    RunCard(run: current, onCommandTap: onCommandTap, onCommand: onCommand)
                        .tag(0)
                }
                ForEach(Array(work.lanes.enumerated()), id: \.element.id) { index, lane in
                    LaneCard(lane: lane, onCommandTap: onCommandTap, onCommand: onCommand)
                        .tag(index + runOffset)
                }
            }
        } else {
            EmptySurfaceCard(
                title: "No work snapshot",
                message: "Ask the iPhone bridge to refresh Forge work and task runs.",
                actionTitle: "Refresh work",
                systemImage: "arrow.clockwise",
                action: onRefresh
            )
        }
    }
}

private struct RunCard: View {
    let run: ForgeWatchTaskRunSummary
    let onCommandTap: (WatchCommandModalItem) -> Void
    let onCommand: (ForgeWatchActionKind, [String: String]) -> Void

    var body: some View {
        Button {
            onCommandTap(runCommandModal(run: run, onCommand: onCommand))
        } label: {
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
                    Label("Tap for run actions", systemImage: "ellipsis.circle")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(WatchTheme.accent)
                }
            }
        }
        .buttonStyle(.plain)
    }
}

private struct LaneCard: View {
    let lane: ForgeWatchWorkLane
    let onCommandTap: (WatchCommandModalItem) -> Void
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
                    Button {
                        onCommandTap(taskCommandModal(task: task, onCommand: onCommand))
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(task.title)
                                .font(.system(size: 11, weight: .semibold, design: .rounded))
                                .foregroundStyle(WatchTheme.textPrimary)
                                .lineLimit(2)
                            Label(task.status.replacingOccurrences(of: "_", with: " ").capitalized, systemImage: "ellipsis.circle")
                                .font(.system(size: 9, weight: .bold, design: .rounded))
                                .foregroundStyle(WatchTheme.accent)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    Divider().background(WatchTheme.border)
                }
            }
        }
    }
}

private struct HabitSurface: View {
    let habits: [ForgeWatchHabitSummary]
    @Binding var selection: Int
    let onHabitTap: (ForgeWatchHabitSummary) -> Void
    let onRefresh: () -> Void

    var body: some View {
        if habits.isEmpty {
            EmptySurfaceCard(
                title: "No habits loaded",
                message: "Ask the iPhone bridge to fetch active habits from Forge.",
                actionTitle: "Refresh habits",
                systemImage: "arrow.clockwise",
                action: onRefresh
            )
        } else {
            SurfaceCarousel(selection: $selection, count: habits.count) {
                ForEach(Array(habits.enumerated()), id: \.element.id) { index, habit in
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
                    .tag(index)
                }
            }
        }
    }
}

private struct GoalSurface: View {
    let goals: [ForgeWatchGoalSummary]
    let projects: [ForgeWatchProjectSummary]
    @Binding var selection: Int
    let onCapture: (String, String?, ForgeWatchLinkedContext, [String: String]) -> Void

    var body: some View {
        let count = goals.count + projects.count
        if count == 0 {
            EmptySurfaceCard(
                title: "No goals loaded",
                message: "Mark a direction note now; richer goals arrive after the next iPhone refresh.",
                actionTitle: "Capture note",
                systemImage: "square.and.pencil",
                action: {
                    onCapture("mark_moment", nil, .empty, ["surface": "goals"])
                }
            )
        } else {
            SurfaceCarousel(selection: $selection, count: count) {
                ForEach(Array(goals.enumerated()), id: \.element.id) { index, goal in
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
                            Button("Mark goal") {
                                onCapture("mark_moment", nil, .empty, ["goalId": goal.id, "surface": "goals"])
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                    .tag(index)
                }
                ForEach(Array(projects.enumerated()), id: \.element.id) { index, project in
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
                            Button("Mark project") {
                                onCapture("mark_moment", nil, .empty, ["projectId": project.id, "surface": "projects"])
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                    .tag(goals.count + index)
                }
            }
        }
    }
}

private struct TodaySurface: View {
    let today: ForgeWatchTodaySnapshot?
    @Binding var selection: Int
    let onCommandTap: (WatchCommandModalItem) -> Void
    let onCommand: (ForgeWatchActionKind, [String: String]) -> Void
    let onCapture: (String, String?, ForgeWatchLinkedContext, [String: String]) -> Void

    var body: some View {
        if let today {
            SurfaceCarousel(selection: $selection, count: 1 + today.dueTasks.count) {
                WatchCard {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(today.dateKey)
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                            .foregroundStyle(WatchTheme.accent)
                        HStack {
                            DenseMetric(title: "Due", value: "\(today.dueCount)", tint: WatchTheme.accent)
                            DenseMetric(title: "Done", value: "\(today.recentDone.count)", tint: WatchTheme.success)
                        }
                        Button("Checkpoint") {
                            onCapture("mark_moment", nil, .empty, ["surface": "today", "dateKey": today.dateKey])
                        }
                        .buttonStyle(.bordered)
                    }
                }
                .tag(0)
                ForEach(Array(today.dueTasks.enumerated()), id: \.element.id) { index, task in
                    Button {
                        onCommandTap(taskCommandModal(task: task, onCommand: onCommand))
                    } label: {
                        WatchCard {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(task.title)
                                    .font(.system(size: 14, weight: .bold, design: .rounded))
                                    .foregroundStyle(WatchTheme.textPrimary)
                                    .lineLimit(4)
                                Label("Tap for task actions", systemImage: "ellipsis.circle")
                                    .font(.system(size: 10, weight: .bold, design: .rounded))
                                    .foregroundStyle(WatchTheme.accent)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .tag(index + 1)
                }
            }
        } else {
            EmptySurfaceCard(
                title: "Today not loaded",
                message: "Mark a checkpoint now; due work arrives after refresh.",
                actionTitle: "Checkpoint",
                systemImage: "checkmark.seal",
                action: {
                    onCapture("mark_moment", nil, .empty, ["surface": "today"])
                }
            )
        }
    }
}

private struct HealthSurface: View {
    let health: ForgeWatchHealthSnapshot?
    @Binding var selection: Int
    let onCapture: (String, String?, ForgeWatchLinkedContext, [String: String]) -> Void

    var body: some View {
        if let health {
            SurfaceCarousel(selection: $selection, count: health.lastWorkout == nil ? 1 : 2) {
                WatchCard {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Health")
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundStyle(WatchTheme.textPrimary)
                        HStack {
                            DenseMetric(title: "Vitals", value: "\(health.latestVitals?.metricCount ?? 0)", tint: WatchTheme.accent)
                            DenseMetric(title: "HR samples", value: "\(health.lastWorkout?.heartRateSampleCount ?? 0)", tint: WatchTheme.success)
                        }
                        Button("Mark recovery") {
                            onCapture("mark_moment", nil, .empty, ["surface": "health", "context": "recovery"])
                        }
                        .buttonStyle(.bordered)
                    }
                }
                .tag(0)
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
                            HStack(spacing: 6) {
                                Button("Good") {
                                    onCapture("workout_annotation", nil, ForgeWatchLinkedContext(placeId: nil, stayId: nil, tripId: nil, workoutId: workout.id), ["moodAfter": "Good"])
                                }
                                .buttonStyle(.bordered)
                                Button("Hard") {
                                    onCapture("workout_annotation", nil, ForgeWatchLinkedContext(placeId: nil, stayId: nil, tripId: nil, workoutId: workout.id), ["moodAfter": "Hard"])
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                    }
                    .tag(1)
                }
            }
        } else {
            EmptySurfaceCard(
                title: "Health not loaded",
                message: "Log recovery context now; Forge health context arrives after sync.",
                actionTitle: "Mark recovery",
                systemImage: "heart.text.square",
                action: {
                    onCapture("mark_moment", nil, .empty, ["surface": "health", "context": "recovery"])
                }
            )
        }
    }
}

private struct MovementSurface: View {
    let movement: ForgeWatchMovementSnapshot?
    @Binding var selection: Int
    let onCapture: (String, String?, ForgeWatchLinkedContext, [String: String]) -> Void

    var body: some View {
        if let movement {
            SurfaceCarousel(
                selection: $selection,
                count: 1 + (movement.latestTrip == nil ? 0 : 1) + (movement.latestStay == nil ? 0 : 1)
            ) {
                WatchCard {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Movement")
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundStyle(WatchTheme.textPrimary)
                        HStack {
                            DenseMetric(title: "Unlabeled", value: "\(movement.unlabeledPlaceCount)", tint: WatchTheme.accent)
                            DenseMetric(title: "Latest", value: movement.latestTrip == nil ? "Stay" : "Trip", tint: WatchTheme.success)
                        }
                        Button("Mark context") {
                            onCapture("mark_moment", nil, .empty, ["surface": "movement"])
                        }
                        .buttonStyle(.bordered)
                    }
                }
                .tag(0)
                if let trip = movement.latestTrip {
                    SegmentCard(title: "Latest trip", segment: trip) {
                        onCapture("mark_moment", nil, ForgeWatchLinkedContext(placeId: nil, stayId: nil, tripId: trip.id, workoutId: nil), ["surface": "movement", "kind": "trip"])
                    }
                        .tag(1)
                }
                if let stay = movement.latestStay {
                    SegmentCard(title: "Latest stay", segment: stay) {
                        onCapture("mark_moment", nil, ForgeWatchLinkedContext(placeId: nil, stayId: stay.id, tripId: nil, workoutId: nil), ["surface": "movement", "kind": "stay"])
                    }
                        .tag(movement.latestTrip == nil ? 1 : 2)
                }
            }
        } else {
            EmptySurfaceCard(
                title: "Movement not loaded",
                message: "Mark movement context now; exact stays and trips arrive after sync.",
                actionTitle: "Mark context",
                systemImage: "location.fill",
                action: {
                    onCapture("mark_moment", nil, .empty, ["surface": "movement"])
                }
            )
        }
    }
}

private struct SegmentCard: View {
    let title: String
    let segment: ForgeWatchMovementSnapshot.Segment
    var onMark: (() -> Void)? = nil

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
                if let onMark {
                    Button("Mark") {
                        onMark()
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
    }
}

private struct PsycheSurface: View {
    let psyche: ForgeWatchPsycheSnapshot?
    @Binding var selection: Int
    let onCapture: (String, String?, ForgeWatchLinkedContext, [String: String]) -> Void

    var body: some View {
        let emotions = nonEmpty(psyche?.emotionOptions, fallback: ["Calm", "Focused", "Tired", "Tense"])
        let triggers = nonEmpty(psyche?.triggerOptions, fallback: ["Urge", "Rumination", "Avoidance", "Victory"])
        let routines = nonEmpty(psyche?.routinePromptOptions, fallback: ["Medication taken?", "Meal?", "Sunlight?", "Wind-down?"])
        SurfaceCarousel(selection: $selection, count: 4) {
            ChoiceCard(title: "Emotion", options: emotions) { choice in
                onCapture("emotion_check_in", nil, .empty, ["emotion": choice])
            }
            .tag(0)
            ChoiceCard(title: "Trigger", options: triggers) { choice in
                onCapture("trigger_capture", nil, .empty, ["trigger": choice])
            }
            .tag(1)
            ChoiceCard(title: "Urge", options: ["Resisted", "Indulged"]) { choice in
                onCapture("trigger_capture", nil, .empty, ["trigger": "Urge", "outcome": choice])
            }
            .tag(2)
            ChoiceCard(title: "Routine", options: routines) { choice in
                onCapture("routine_check", nil, .empty, ["routine": choice])
            }
            .tag(3)
        }
    }

    private func nonEmpty(_ options: [String]?, fallback: [String]) -> [String] {
        guard let options, options.isEmpty == false else { return fallback }
        return options
    }
}

private struct InboxSurface: View {
    let prompts: [ForgeWatchPrompt]
    @Binding var selection: Int
    let onCapture: (String, String?, ForgeWatchLinkedContext, [String: String]) -> Void

    var body: some View {
        if prompts.isEmpty {
            EmptySurfaceCard(title: "Inbox clear", message: "No watch-sized prompts are waiting.")
        } else {
            SurfaceCarousel(selection: $selection, count: prompts.count) {
                ForEach(Array(prompts.enumerated()), id: \.element.id) { index, prompt in
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
                    .tag(index)
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
    let onRefresh: () -> Void
    let onRetry: () -> Void

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
                HStack(spacing: 6) {
                    Button {
                        onRefresh()
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(WatchTheme.accent)

                    Button {
                        onRetry()
                    } label: {
                        Label("Retry", systemImage: "paperplane.fill")
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                    }
                    .buttonStyle(.bordered)
                    .tint(WatchTheme.success)
                }
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

#Preview {
    ContentView()
        .environmentObject(WatchAppModel(preview: true))
}
