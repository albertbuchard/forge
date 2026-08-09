import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var appModel: WatchAppModel
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @StateObject private var navigation = WatchNavigationModel()
    @StateObject private var peoplePrivacy = ForgeWatchPeoplePrivacyMonitor()
    @State private var selectedHabit: ForgeWatchHabitSummary?
    @State private var selectedCommand: WatchCommandModalItem?
    @FocusState private var crownFocused: Bool

    private let surfaces = WatchSurface.allCases

    var body: some View {
        ZStack {
            WatchSurfaceBackground()

            VStack(alignment: .leading, spacing: 8) {
                header

                TimelineView(.periodic(from: Date(), by: 60)) { context in
                    WatchSurfacePager(
                        surface: navigation.selectedSurface,
                        navigation: navigation,
                        bootstrap: appModel.bootstrap,
                        snapshotFreshness: appModel.snapshotFreshness(now: context.date),
                        snapshotSource: appModel.snapshotSource,
                        refreshState: appModel.refreshState,
                        directMetric: appModel.lastDirectSyncMetric,
                        pendingActionCount: appModel.pendingActionCount,
                        latestReceipt: appModel.latestReceipt,
                        peoplePresentation: ForgeWatchPeopleDisplayPolicy.presentation(
                            snapshot: appModel.bootstrap.people,
                            context: peoplePrivacyContext,
                            now: context.date
                        ),
                        onHabitTap: { selectedHabit = $0 },
                        onCommandTap: { selectedCommand = $0 },
                        onCommand: appModel.queueCommand,
                        onCapture: appModel.queueCaptureEvent,
                        onContinueOnPhone: appModel.continueOnPhone,
                        onRefresh: { appModel.requestForgeRefresh(reason: "surface_refresh", force: true) },
                        onRetry: { appModel.flushPendingActions(forceDirect: true) }
                    )
                    .id(navigation.selectedSurface)
                    .transition(.opacity.combined(with: .scale(scale: 0.97)))
                }
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
            peoplePrivacy.refresh()
            appModel.requestForgeRefresh(reason: "watch_open")
        }
        .onChange(of: scenePhase) { _, _ in
            peoplePrivacy.refresh()
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
                    .font(.system(
                        size: navigation.selectedSurface == .people ? 14 : 18,
                        weight: .bold,
                        design: .rounded
                    ))
                    .foregroundStyle(WatchTheme.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)

                Group {
                    if navigation.selectedSurface == .people,
                       peoplePrivacyContext != .unlockedActive
                    {
                        Text("Private")
                            .foregroundStyle(WatchTheme.textMuted)
                            .accessibilityLabel("Forge People private")
                    } else {
                        TimelineView(.periodic(from: Date(), by: 60)) { context in
                            Text(snapshotSummary(now: context.date))
                                .foregroundStyle(snapshotStatusTint(now: context.date))
                                .accessibilityLabel(snapshotAccessibilityLabel(now: context.date))
                        }
                    }
                }
                .font(.system(size: 9, weight: .medium, design: .rounded))
                .lineLimit(1)

                if navigation.selectedSurface != .people ||
                    peoplePrivacyContext == .unlockedActive
                {
                    Text(appModel.lastStatusMessage)
                        .font(.system(size: 8, weight: .medium, design: .rounded))
                        .foregroundStyle(WatchTheme.textMuted)
                        .lineLimit(1)
                }
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
            .accessibilityLabel("Previous surface")

            Text("\(surfaceIndex(navigation.selectedSurface) + 1)/\(surfaces.count)")
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundStyle(WatchTheme.accent)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(Capsule().fill(Color.white.opacity(0.1)))
                .accessibilityLabel("Surface \(surfaceIndex(navigation.selectedSurface) + 1) of \(surfaces.count)")

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
            .accessibilityLabel("Next surface")
        }
    }

    private func snapshotSummary(now: Date) -> String {
        "\(appModel.snapshotFreshness(now: now).shortLabel) · \(appModel.snapshotSource.label)"
    }

    private func snapshotAccessibilityLabel(now: Date) -> String {
        "Forge snapshot \(appModel.snapshotFreshness(now: now).shortLabel), source \(appModel.snapshotSource.label)"
    }

    private func snapshotStatusTint(now: Date) -> Color {
        switch appModel.snapshotFreshness(now: now).state {
        case .fresh:
            return WatchTheme.success
        case .stale, .clockSkew:
            return WatchTheme.accent
        case .unavailable:
            return WatchTheme.textMuted
        }
    }

    private func surfaceIndex(_ surface: WatchSurface) -> Int {
        surfaces.firstIndex(of: surface) ?? 0
    }

    private func surfaceTitle(_ surface: WatchSurface) -> String {
        if surface == .people { return "Forge People" }
        return appModel.bootstrap.surfaces?
            .first(where: { $0.id == surface.rawValue })?
            .title ?? surface.rawValue.replacingOccurrences(of: "_", with: " ").capitalized
    }

    private var peoplePrivacyContext: ForgeWatchPeoplePrivacyContext {
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("--forge-watch-preview") ||
            arguments.contains("--forge-watch-screenshot-fixture")
        {
            return .screenshotFixture
        }
        guard scenePhase == .active else { return .inactive }
        if isLuminanceReduced { return .alwaysOn }
        return peoplePrivacy.isUnlocked ? .unlockedActive : .locked
    }
}

private struct WatchSurfacePager: View {
    let surface: WatchSurface
    @ObservedObject var navigation: WatchNavigationModel
    let bootstrap: ForgeWatchBootstrap
    let snapshotFreshness: ForgeWatchSnapshotFreshness
    let snapshotSource: ForgeWatchSnapshotSource
    let refreshState: ForgeWatchRefreshState
    let directMetric: ForgeWatchDirectSyncMetric?
    let pendingActionCount: Int
    let latestReceipt: ForgeWatchStoredReceipt?
    let peoplePresentation: ForgeWatchPeoplePresentation
    let onHabitTap: (ForgeWatchHabitSummary) -> Void
    let onCommandTap: (WatchCommandModalItem) -> Void
    let onCommand: (ForgeWatchActionKind, [String: String]) -> Void
    let onCapture: (String, String?, ForgeWatchLinkedContext, [String: String]) -> Void
    let onContinueOnPhone: (ForgeWatchPhoneDestination) -> Void
    let onRefresh: () -> Void
    let onRetry: () -> Void

    var body: some View {
        Group {
            switch surface {
            case .now:
                NowSurface(
                    bootstrap: bootstrap,
                    snapshotFreshness: snapshotFreshness,
                    snapshotSource: snapshotSource,
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
                    goals: bootstrap.goals,
                    totalGoalCount: bootstrap.goalCount,
                    projects: bootstrap.projects,
                    totalProjectCount: bootstrap.projectCount,
                    uiBaseUrl: bootstrap.connection?.uiBaseUrl,
                    snapshotFreshness: snapshotFreshness,
                    snapshotSource: snapshotSource,
                    refreshState: refreshState,
                    selection: navigation.cardIndexBinding(for: surface),
                    onCapture: onCapture,
                    onContinueOnPhone: onContinueOnPhone,
                    onRefresh: onRefresh
                )
            case .today:
                TodaySurface(
                    today: bootstrap.today,
                    uiBaseUrl: bootstrap.connection?.uiBaseUrl,
                    snapshotFreshness: snapshotFreshness,
                    snapshotSource: snapshotSource,
                    refreshState: refreshState,
                    selection: navigation.cardIndexBinding(for: surface),
                    onCommandTap: onCommandTap,
                    onCommand: onCommand,
                    onCapture: onCapture,
                    onContinueOnPhone: onContinueOnPhone,
                    onRefresh: onRefresh
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
            case .people:
                PeopleGlanceSurface(presentation: peoplePresentation)
            case .inbox:
                InboxSurface(
                    prompts: bootstrap.inbox?.prompts ?? bootstrap.pendingPrompts,
                    attention: bootstrap.inbox?.attention,
                    pins: bootstrap.inbox?.pins,
                    selection: navigation.cardIndexBinding(for: surface),
                    onCapture: onCapture
                )
            case .sync:
                SyncSurface(
                    sync: bootstrap.sync,
                    connection: bootstrap.connection,
                    directMetric: directMetric,
                    pendingActionCount: pendingActionCount,
                    latestReceipt: latestReceipt,
                    onRefresh: onRefresh,
                    onRetry: onRetry
                )
            }
        }
        .animation(.snappy(duration: 0.24), value: surface)
        .onAppear {
            navigation.registerCardCount(cardCount, for: surface)
            if let previewCardIndex {
                navigation.selectCard(previewCardIndex, for: surface)
            }
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
            return max(
                1,
                flattenedWorkTasks(bootstrap.work).count + (bootstrap.work?.currentRun == nil ? 0 : 1)
            )
        case .habits:
            return max(1, bootstrap.habits.count)
        case .goals:
            let hasPayload = bootstrap.goals != nil || bootstrap.projects != nil
            guard hasPayload else { return 1 }
            let presentation = ForgeWatchGoalsPresentation(
                goals: bootstrap.goals ?? [],
                projects: bootstrap.projects ?? [],
                totalGoalCount: bootstrap.goalCount,
                totalProjectCount: bootstrap.projectCount
            )
            return presentation.cardCount + compactNoticeCount(hasPayload: true)
        case .today:
            guard let today = bootstrap.today else { return 1 }
            return ForgeWatchTodayPresentation(today: today).cardCount
                + compactNoticeCount(hasPayload: true)
        case .health:
            return max(1, 1 + (bootstrap.health?.lastWorkout == nil ? 0 : 1))
        case .movement:
            return max(
                1,
                1 + (bootstrap.movement?.latestTrip == nil ? 0 : 1) + (bootstrap.movement?.latestStay == nil ? 0 : 1)
            )
        case .psyche:
            return max(1, psycheCardCount(bootstrap.psyche))
        case .people:
            return 1
        case .inbox:
            let prompts = bootstrap.inbox?.prompts ?? bootstrap.pendingPrompts
            let attentionCards = bootstrap.inbox?.attention.map { 1 + $0.items.count } ?? 0
            let pinCards = bootstrap.inbox?.pins.map { 1 + $0.items.count } ?? 0
            return max(1, attentionCards + pinCards + prompts.count)
        case .sync:
            return 1
        }
    }

    private func compactNoticeCount(hasPayload: Bool) -> Int {
        ForgeWatchCompactSurfacePolicy.notice(
            hasPayload: hasPayload,
            freshness: snapshotFreshness,
            refreshState: refreshState
        ) == .none ? 0 : 1
    }

    private var previewCardIndex: Int? {
        ProcessInfo.processInfo.arguments
            .first(where: { $0.hasPrefix("--forge-watch-card=") })
            .flatMap { Int($0.replacingOccurrences(of: "--forge-watch-card=", with: "")) }
    }
}

private func flattenedWorkTasks(_ work: ForgeWatchWorkSnapshot?) -> [ForgeWatchTaskSummary] {
    guard let work else { return [] }
    var seen = Set<String>()
    var tasks: [ForgeWatchTaskSummary] = []
    if let nextTask = work.nextTask, seen.insert(nextTask.id).inserted {
        tasks.append(nextTask)
    }
    for lane in work.lanes {
        for task in lane.tasks where seen.insert(task.id).inserted {
            tasks.append(task)
        }
    }
    return tasks
}

private func psycheCardCount(_ psyche: ForgeWatchPsycheSnapshot?) -> Int {
    let questionCount: Int
    if let questions = psyche?.questions, questions.isEmpty == false {
        questionCount = questions.count
    } else if let psyche {
        questionCount = [
            psyche.emotionOptions.isEmpty == false,
            psyche.triggerOptions.isEmpty == false,
            psyche.routinePromptOptions.isEmpty == false
        ].filter { $0 }.count
    } else {
        questionCount = 0
    }
    let hasRecent = (psyche?.recentReports?.isEmpty == false) ? 1 : 0
    return questionCount + hasRecent
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
            WatchCommandModalAction(
                id: "done",
                title: "Done",
                systemImage: "checkmark.circle.fill",
                tint: WatchTheme.success,
                confirmation: WatchTaskCloseoutPresentation.taskCompletion
            ) {
                onCommand(
                    .taskStatusUpdate,
                    ["taskId": task.id, "status": "done", "closeoutMode": "deferred"]
                )
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
            WatchCommandModalAction(
                id: "complete",
                title: "Complete",
                systemImage: "checkmark.circle.fill",
                tint: WatchTheme.success,
                confirmation: WatchTaskCloseoutPresentation.runCompletion
            ) {
                onCommand(
                    .taskRunComplete,
                    ["runId": run.id, "closeoutMode": "deferred"]
                )
            },
            WatchCommandModalAction(id: "pause", title: "Pause", systemImage: "pause.fill", tint: .orange) {
                onCommand(.taskRunRelease, ["runId": run.id])
            }
        ]
    )
}

private struct NowSurface: View {
    let bootstrap: ForgeWatchBootstrap
    let snapshotFreshness: ForgeWatchSnapshotFreshness
    let snapshotSource: ForgeWatchSnapshotSource
    @Binding var selection: Int
    let onCommandTap: (WatchCommandModalItem) -> Void
    let onCommand: (ForgeWatchActionKind, [String: String]) -> Void
    let onCapture: (String, String?, ForgeWatchLinkedContext, [String: String]) -> Void
    let onRefresh: () -> Void

    var body: some View {
        let run = bootstrap.now?.currentRun ?? bootstrap.work?.currentRun
        let notice = ForgeWatchSnapshotNotice.make(
            freshness: snapshotFreshness,
            source: snapshotSource
        )
        let noticeOffset = notice == nil ? 0 : 1
        SurfaceCarousel(selection: $selection, count: (run == nil ? 1 : 2) + noticeOffset) {
            if let notice {
                SnapshotNoticeCard(
                    notice: notice,
                    state: snapshotFreshness.state,
                    onRefresh: onRefresh
                )
                .tag(0)
            }

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
            .tag(noticeOffset)

            if let run {
                RunCard(run: run, onCommandTap: onCommandTap, onCommand: onCommand)
                    .tag(noticeOffset + 1)
            }
        }
    }
}

private struct SnapshotNoticeCard: View {
    let notice: ForgeWatchSnapshotNotice
    let state: ForgeWatchSnapshotFreshness.State
    let onRefresh: () -> Void

    var body: some View {
        WatchCard {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: state == .unavailable ? "icloud.slash" : "exclamationmark.arrow.triangle.2.circlepath")
                    .font(.system(size: 21, weight: .semibold))
                    .foregroundStyle(WatchTheme.accent)
                Text(notice.title)
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(WatchTheme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(notice.message)
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                    .foregroundStyle(WatchTheme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                Button {
                    onRefresh()
                } label: {
                    Label("Refresh now", systemImage: "arrow.clockwise")
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.borderedProminent)
                .tint(WatchTheme.accent)
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
            let tasks = flattenedWorkTasks(work)
            let count = max(1, tasks.count + (work.currentRun == nil ? 0 : 1))
            IndexedSurfaceCarousel(selection: $selection, count: count) { index in
                workPage(work: work, tasks: tasks, index: index)
            }
        } else {
            EmptySurfaceCard(
                title: "No work snapshot",
                message: "Refresh Forge directly when reachable; paired iPhone backup protects offline actions.",
                actionTitle: "Refresh work",
                systemImage: "arrow.clockwise",
                action: onRefresh
            )
        }
    }

    @ViewBuilder
    private func workPage(
        work: ForgeWatchWorkSnapshot,
        tasks: [ForgeWatchTaskSummary],
        index: Int
    ) -> some View {
        let runOffset = work.currentRun == nil ? 0 : 1
        if let current = work.currentRun, index == 0 {
            RunCard(run: current, onCommandTap: onCommandTap, onCommand: onCommand)
        } else if tasks.isEmpty {
            EmptySurfaceCard(
                title: "No open tasks",
                message: "Forge has no current watch-sized work. Refresh when you expect a task to appear.",
                actionTitle: "Refresh work",
                systemImage: "arrow.clockwise",
                action: onRefresh
            )
        } else {
            let taskIndex = index - runOffset
            if tasks.indices.contains(taskIndex) {
                TaskCard(
                    task: tasks[taskIndex],
                    onCommandTap: onCommandTap,
                    onCommand: onCommand
                )
            }
        }
    }
}

private struct TaskCard: View {
    let task: ForgeWatchTaskSummary
    let onCommandTap: (WatchCommandModalItem) -> Void
    let onCommand: (ForgeWatchActionKind, [String: String]) -> Void

    var body: some View {
        Button {
            onCommandTap(taskCommandModal(task: task, onCommand: onCommand))
        } label: {
            WatchCard {
                VStack(alignment: .leading, spacing: 7) {
                    HStack(spacing: 6) {
                        Text(task.status.replacingOccurrences(of: "_", with: " ").capitalized)
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                            .foregroundStyle(statusTint(task.status))
                            .lineLimit(1)
                        Spacer(minLength: 4)
                        Text(task.priority.capitalized)
                            .font(.system(size: 9, weight: .bold, design: .rounded))
                            .foregroundStyle(WatchTheme.textMuted)
                            .lineLimit(1)
                    }
                    Text(task.title)
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(WatchTheme.textPrimary)
                        .lineLimit(4)
                    HStack(spacing: 8) {
                        DenseMetric(title: "Pts", value: "\(task.points)", tint: WatchTheme.accent)
                        DenseMetric(title: "Energy", value: task.energy.isEmpty ? "--" : task.energy.capitalized, tint: WatchTheme.success)
                    }
                    if task.closeoutState == "deferred" {
                        Label("Evidence deferred", systemImage: "doc.badge.clock")
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                            .foregroundStyle(WatchTheme.accent)
                            .accessibilityLabel("Completion evidence deferred")
                            .accessibilityHint("Add files, Git references, and a completion note later in Forge")
                    }
                    Label("Tap to start or move", systemImage: "ellipsis.circle")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(WatchTheme.accent)
                }
            }
        }
        .buttonStyle(.plain)
    }

    private func statusTint(_ status: String) -> Color {
        switch status {
        case "focus", "in_progress":
            return WatchTheme.accent
        case "blocked":
            return .orange
        case "done":
            return WatchTheme.success
        default:
            return WatchTheme.textMuted
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
                message: "Refresh Forge directly to load active habits; paired iPhone backup runs only if the watch cannot reach Forge.",
                actionTitle: "Refresh habits",
                systemImage: "arrow.clockwise",
                action: onRefresh
            )
        } else {
            IndexedSurfaceCarousel(selection: $selection, count: habits.count) { index in
                if habits.indices.contains(index) {
                    let habit = habits[index]
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
    let goals: [ForgeWatchGoalSummary]?
    let totalGoalCount: Int?
    let projects: [ForgeWatchProjectSummary]?
    let totalProjectCount: Int?
    let uiBaseUrl: String?
    let snapshotFreshness: ForgeWatchSnapshotFreshness
    let snapshotSource: ForgeWatchSnapshotSource
    let refreshState: ForgeWatchRefreshState
    @Binding var selection: Int
    let onCapture: (String, String?, ForgeWatchLinkedContext, [String: String]) -> Void
    let onContinueOnPhone: (ForgeWatchPhoneDestination) -> Void
    let onRefresh: () -> Void

    var body: some View {
        let hasPayload = goals != nil || projects != nil
        let notice = ForgeWatchCompactSurfacePolicy.notice(
            hasPayload: hasPayload,
            freshness: snapshotFreshness,
            refreshState: refreshState
        )
        if hasPayload == false {
            CompactSurfaceNoticeCard(
                surfaceTitle: "Goals",
                notice: notice,
                freshness: snapshotFreshness,
                source: snapshotSource,
                hasCachedContent: false,
                onCheckpoint: {
                    onCapture("mark_moment", nil, .empty, goalCheckpointPayload())
                },
                onRefresh: onRefresh
            )
        } else {
            let presentation = ForgeWatchGoalsPresentation(
                goals: goals ?? [],
                projects: projects ?? [],
                totalGoalCount: totalGoalCount,
                totalProjectCount: totalProjectCount
            )
            let noticeOffset = notice == .none ? 0 : 1
            IndexedSurfaceCarousel(
                selection: $selection,
                count: presentation.cardCount + noticeOffset
            ) { pageIndex in
                let contentIndex = pageIndex - noticeOffset
                if pageIndex < noticeOffset {
                    CompactSurfaceNoticeCard(
                        surfaceTitle: "Goals",
                        notice: notice,
                        freshness: snapshotFreshness,
                        source: snapshotSource,
                        hasCachedContent: true,
                        onCheckpoint: {
                            onCapture("mark_moment", nil, .empty, goalCheckpointPayload())
                        },
                        onRefresh: onRefresh
                    )
                } else if contentIndex == 0 {
                    goalSummaryCard(presentation)
                } else if contentIndex <= presentation.goals.count {
                    goalCard(presentation.goals[contentIndex - 1])
                } else {
                    let projectIndex = contentIndex - presentation.goals.count - 1
                    if presentation.projects.indices.contains(projectIndex) {
                        projectCard(presentation.projects[projectIndex])
                    }
                }
            }
        }
    }

    private func goalSummaryCard(_ presentation: ForgeWatchGoalsPresentation) -> some View {
        CompactScrollableWatchCard {
            VStack(alignment: .leading, spacing: 8) {
                Label(
                    presentation.totalGoalCount + presentation.totalProjectCount == 0
                        ? "No active direction"
                        : "Direction snapshot",
                    systemImage: "scope"
                )
                .font(.system(.headline, design: .rounded, weight: .bold))
                .foregroundStyle(WatchTheme.textPrimary)

                HStack(spacing: 8) {
                    DenseMetric(
                        title: "Goals",
                        value: "\(presentation.totalGoalCount)",
                        tint: WatchTheme.accent
                    )
                    DenseMetric(
                        title: "Projects",
                        value: "\(presentation.totalProjectCount)",
                        tint: WatchTheme.success
                    )
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(
                    "\(presentation.totalGoalCount) goals, \(presentation.totalProjectCount) projects"
                )

                Text(goalSummaryMessage(presentation))
                    .font(.system(.footnote, design: .rounded, weight: .medium))
                    .foregroundStyle(WatchTheme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)

                WatchCheckpointButton {
                    onCapture("mark_moment", nil, .empty, goalCheckpointPayload())
                }

                WatchPhoneHandoffButton(
                    destination: .goals,
                    uiBaseUrl: uiBaseUrl,
                    onContinue: onContinueOnPhone
                )
            }
        }
    }

    private func goalCard(_ goal: ForgeWatchGoalSummary) -> some View {
        CompactScrollableWatchCard {
            VStack(alignment: .leading, spacing: 7) {
                Label(
                    "Goal · \(watchDisplayLabel(goal.horizon))",
                    systemImage: "scope"
                )
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .foregroundStyle(WatchTheme.accent)
                Text(goal.title)
                    .font(.system(.headline, design: .rounded, weight: .bold))
                    .foregroundStyle(WatchTheme.textPrimary)
                    .lineLimit(3)
                    .minimumScaleFactor(0.82)
                    .accessibilityLabel("Goal: \(goal.title)")
                Text("\(goal.targetPoints) target points · \(watchDisplayLabel(goal.status))")
                    .font(.system(.footnote, design: .rounded, weight: .medium))
                    .foregroundStyle(WatchTheme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                WatchCheckpointButton {
                    onCapture(
                        "mark_moment",
                        nil,
                        .empty,
                        goalCheckpointPayload(goalId: goal.id)
                    )
                }
                WatchPhoneHandoffButton(
                    destination: .goal(goal.id),
                    uiBaseUrl: uiBaseUrl,
                    onContinue: onContinueOnPhone
                )
            }
        }
    }

    private func projectCard(_ project: ForgeWatchProjectSummary) -> some View {
        CompactScrollableWatchCard {
            VStack(alignment: .leading, spacing: 7) {
                Label(
                    "Project · \(watchDisplayLabel(project.workflowStatus))",
                    systemImage: "hammer.fill"
                )
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .foregroundStyle(WatchTheme.success)
                Text(project.title)
                    .font(.system(.headline, design: .rounded, weight: .bold))
                    .foregroundStyle(WatchTheme.textPrimary)
                    .lineLimit(3)
                    .minimumScaleFactor(0.82)
                    .accessibilityLabel("Project: \(project.title)")
                Text(project.goalTitle)
                    .font(.system(.footnote, design: .rounded, weight: .medium))
                    .foregroundStyle(WatchTheme.textMuted)
                    .lineLimit(2)
                HStack(spacing: 8) {
                    DenseMetric(title: "Open", value: "\(project.openTaskCount)", tint: WatchTheme.accent)
                    DenseMetric(title: "Runs", value: "\(project.activeRunCount)", tint: WatchTheme.success)
                }
                WatchCheckpointButton {
                    onCapture(
                        "mark_moment",
                        nil,
                        .empty,
                        goalCheckpointPayload(projectId: project.id)
                    )
                }
                WatchPhoneHandoffButton(
                    destination: .project(project.id),
                    uiBaseUrl: uiBaseUrl,
                    onContinue: onContinueOnPhone
                )
            }
        }
    }

    private func goalSummaryMessage(_ presentation: ForgeWatchGoalsPresentation) -> String {
        let total = presentation.totalGoalCount + presentation.totalProjectCount
        guard total > 0 else {
            return "No active goals or projects are in this snapshot. Plan and edit in Forge on iPhone."
        }
        let hidden = presentation.hiddenGoalCount + presentation.hiddenProjectCount
        if hidden > 0 {
            return "\(presentation.goals.count + presentation.projects.count) cards shown · \(hidden) more in Forge."
        }
        return "Swipe for compact details. Plan and edit in Forge on iPhone."
    }

    private func goalCheckpointPayload(
        goalId: String? = nil,
        projectId: String? = nil
    ) -> [String: String] {
        var payload = [
            "surface": "goals",
            "context": "planning_checkpoint",
            "source": "watch"
        ]
        payload["goalId"] = goalId
        payload["projectId"] = projectId
        return payload
    }
}

private struct TodaySurface: View {
    let today: ForgeWatchTodaySnapshot?
    let uiBaseUrl: String?
    let snapshotFreshness: ForgeWatchSnapshotFreshness
    let snapshotSource: ForgeWatchSnapshotSource
    let refreshState: ForgeWatchRefreshState
    @Binding var selection: Int
    let onCommandTap: (WatchCommandModalItem) -> Void
    let onCommand: (ForgeWatchActionKind, [String: String]) -> Void
    let onCapture: (String, String?, ForgeWatchLinkedContext, [String: String]) -> Void
    let onContinueOnPhone: (ForgeWatchPhoneDestination) -> Void
    let onRefresh: () -> Void

    var body: some View {
        let notice = ForgeWatchCompactSurfacePolicy.notice(
            hasPayload: today != nil,
            freshness: snapshotFreshness,
            refreshState: refreshState
        )
        if let today {
            let presentation = ForgeWatchTodayPresentation(today: today)
            let noticeOffset = notice == .none ? 0 : 1
            IndexedSurfaceCarousel(
                selection: $selection,
                count: presentation.cardCount + noticeOffset
            ) { pageIndex in
                let contentIndex = pageIndex - noticeOffset
                if pageIndex < noticeOffset {
                    CompactSurfaceNoticeCard(
                        surfaceTitle: "Today",
                        notice: notice,
                        freshness: snapshotFreshness,
                        source: snapshotSource,
                        hasCachedContent: true,
                        onCheckpoint: {
                            onCapture("mark_moment", nil, .empty, todayCheckpointPayload())
                        },
                        onRefresh: onRefresh
                    )
                } else if contentIndex == 0 {
                    todaySummaryCard(today: today, presentation: presentation)
                } else {
                    let taskIndex = contentIndex - 1
                    if presentation.dueTasks.indices.contains(taskIndex) {
                        todayTaskCard(presentation.dueTasks[taskIndex])
                    }
                }
            }
        } else {
            CompactSurfaceNoticeCard(
                surfaceTitle: "Today",
                notice: notice,
                freshness: snapshotFreshness,
                source: snapshotSource,
                hasCachedContent: false,
                onCheckpoint: {
                    onCapture("mark_moment", nil, .empty, todayCheckpointPayload())
                },
                onRefresh: onRefresh
            )
        }
    }

    private func todaySummaryCard(
        today: ForgeWatchTodaySnapshot,
        presentation: ForgeWatchTodayPresentation
    ) -> some View {
        CompactScrollableWatchCard {
            VStack(alignment: .leading, spacing: 8) {
                Label(today.dateKey, systemImage: "calendar")
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .foregroundStyle(WatchTheme.accent)
                HStack(spacing: 8) {
                    DenseMetric(title: "Due", value: "\(presentation.snapshotDueCount)", tint: WatchTheme.accent)
                    DenseMetric(title: "Recent", value: "\(presentation.recentDoneCount)", tint: WatchTheme.success)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(
                    "\(presentation.snapshotDueCount) tasks due in this snapshot, \(presentation.recentDoneCount) recently completed tasks"
                )
                Text(todaySummaryMessage(presentation))
                    .font(.system(.footnote, design: .rounded, weight: .medium))
                    .foregroundStyle(WatchTheme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                if today.recentDone.contains(where: { $0.closeoutState == "deferred" }) {
                    let deferredCount = today.recentDone.filter {
                        $0.closeoutState == "deferred"
                    }.count
                    Label(
                        "\(deferredCount) need\(deferredCount == 1 ? "s" : "") evidence",
                        systemImage: "doc.badge.clock"
                    )
                    .font(.system(.footnote, design: .rounded, weight: .bold))
                    .foregroundStyle(WatchTheme.accent)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel(
                        "\(deferredCount) completed task\(deferredCount == 1 ? "" : "s") need completion evidence"
                    )
                    .accessibilityHint("Continue on iPhone to add files, Git references, and completion notes")
                }
                WatchCheckpointButton {
                    onCapture("mark_moment", nil, .empty, todayCheckpointPayload())
                }
                WatchPhoneHandoffButton(
                    destination: .today,
                    uiBaseUrl: uiBaseUrl,
                    onContinue: onContinueOnPhone
                )
            }
        }
    }

    private func todayTaskCard(_ task: ForgeWatchTaskSummary) -> some View {
        CompactScrollableWatchCard {
            VStack(alignment: .leading, spacing: 8) {
                Text("\(watchDisplayLabel(task.status)) · \(watchDisplayLabel(task.priority)) priority")
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .foregroundStyle(WatchTheme.accent)
                Text(task.title)
                    .font(.system(.headline, design: .rounded, weight: .bold))
                    .foregroundStyle(WatchTheme.textPrimary)
                    .lineLimit(3)
                    .minimumScaleFactor(0.82)
                    .accessibilityLabel("Due task: \(task.title)")
                Text("\(task.points) points · \(watchDisplayLabel(task.effort)) effort")
                    .font(.system(.footnote, design: .rounded, weight: .medium))
                    .foregroundStyle(WatchTheme.textMuted)
                WatchCheckpointButton {
                    onCapture(
                        "mark_moment",
                        nil,
                        .empty,
                        todayCheckpointPayload(taskId: task.id)
                    )
                }
                Button {
                    onCommandTap(taskCommandModal(task: task, onCommand: onCommand))
                } label: {
                    Label("Task actions", systemImage: "checklist")
                        .font(.system(.footnote, design: .rounded, weight: .bold))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.borderedProminent)
                .tint(WatchTheme.success)
                .accessibilityHint("Opens bounded status and task run actions")
                WatchPhoneHandoffButton(
                    destination: .task(task.id),
                    uiBaseUrl: uiBaseUrl,
                    onContinue: onContinueOnPhone
                )
            }
        }
    }

    private func todaySummaryMessage(_ presentation: ForgeWatchTodayPresentation) -> String {
        guard presentation.snapshotDueCount > 0 else {
            return "Nothing is due in this compact snapshot. Plan and edit in Forge on iPhone."
        }
        if presentation.hiddenDueTaskCount > 0 {
            return "\(presentation.dueTasks.count) cards shown · \(presentation.hiddenDueTaskCount) more in Forge."
        }
        return "Swipe through due work. Plan and edit in Forge on iPhone."
    }

    private func todayCheckpointPayload(taskId: String? = nil) -> [String: String] {
        var payload = [
            "surface": "today",
            "context": "planning_checkpoint",
            "source": "watch"
        ]
        payload["taskId"] = taskId
        return payload
    }
}

private struct CompactScrollableWatchCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ScrollView(.vertical) {
            WatchCard {
                content
            }
            .padding(.vertical, 1)
        }
        .scrollIndicators(.hidden)
    }
}

private struct WatchCheckpointButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label("Checkpoint", systemImage: "checkmark.circle")
                .font(.system(.footnote, design: .rounded, weight: .bold))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.bordered)
        .tint(WatchTheme.success)
        .accessibilityLabel("Capture planning checkpoint")
        .accessibilityHint("Records a quick checkpoint without opening the planning editor")
    }
}

private struct WatchPhoneHandoffButton: View {
    let destination: ForgeWatchPhoneDestination
    let uiBaseUrl: String?
    let onContinue: (ForgeWatchPhoneDestination) -> Void

    private var canContinue: Bool {
        ForgeWatchPhoneHandoff.url(uiBaseUrl: uiBaseUrl, destination: destination) != nil
            || ForgeWatchPhoneHandoffRequest(destination: destination) != nil
    }

    var body: some View {
        Button {
            onContinue(destination)
        } label: {
            Label("On iPhone", systemImage: "iphone")
                .font(.system(.footnote, design: .rounded, weight: .bold))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.bordered)
        .tint(WatchTheme.accent)
        .disabled(canContinue == false)
        .accessibilityLabel("Continue in Forge on iPhone")
        .accessibilityHint(
            canContinue
                ? "Opens this exact Forge view through Handoff or the paired iPhone"
                : "Open Forge on the paired iPhone to continue"
        )
    }
}

private struct CompactSurfaceNoticeCard: View {
    let surfaceTitle: String
    let notice: ForgeWatchCompactNotice
    let freshness: ForgeWatchSnapshotFreshness
    let source: ForgeWatchSnapshotSource
    let hasCachedContent: Bool
    let onCheckpoint: (() -> Void)?
    let onRefresh: () -> Void

    var body: some View {
        CompactScrollableWatchCard {
            VStack(alignment: .leading, spacing: 8) {
                if notice == .loading {
                    ProgressView()
                        .tint(WatchTheme.accent)
                        .accessibilityLabel("Refreshing \(surfaceTitle)")
                } else {
                    Image(systemName: systemImage)
                        .font(.system(size: 21, weight: .semibold))
                        .foregroundStyle(WatchTheme.accent)
                        .accessibilityHidden(true)
                }
                Text(title)
                    .font(.system(.headline, design: .rounded, weight: .bold))
                    .foregroundStyle(WatchTheme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(message)
                    .font(.system(.footnote, design: .rounded, weight: .medium))
                    .foregroundStyle(WatchTheme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                if let onCheckpoint {
                    WatchCheckpointButton(action: onCheckpoint)
                }
                if notice != .loading {
                    Button {
                        onRefresh()
                    } label: {
                        Label("Refresh now", systemImage: "arrow.clockwise")
                            .font(.system(.footnote, design: .rounded, weight: .bold))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(WatchTheme.accent)
                }
            }
        }
    }

    private var title: String {
        switch notice {
        case .loading:
            return "Refreshing \(surfaceTitle)"
        case .stale:
            return "Cached \(surfaceTitle)"
        case .clockSkew:
            return "Snapshot time mismatch"
        case .failed:
            return "Refresh failed"
        case .unavailable, .none:
            return "\(surfaceTitle) unavailable"
        }
    }

    private var message: String {
        switch notice {
        case .loading:
            return "Fetching a compact Forge snapshot."
        case .stale:
            return "\(freshness.shortLabel) from \(source.label). Cached cards remain available after this notice."
        case .clockSkew:
            return "The snapshot timestamp is ahead of this watch. Refresh before relying on current counts."
        case .failed:
            return hasCachedContent
                ? "Forge could not refresh this summary. Cached cards remain available after this notice."
                : "Forge could not load this summary. Retry directly or through the paired iPhone."
        case .unavailable, .none:
            return "Forge has not delivered this compact summary yet."
        }
    }

    private var systemImage: String {
        switch notice {
        case .failed:
            return "exclamationmark.triangle.fill"
        case .stale, .clockSkew:
            return "clock.arrow.circlepath"
        case .loading:
            return "arrow.clockwise"
        case .unavailable, .none:
            return "icloud.slash"
        }
    }
}

private func watchDisplayLabel(_ rawValue: String) -> String {
    rawValue
        .replacingOccurrences(of: "_", with: " ")
        .replacingOccurrences(of: "-", with: " ")
        .capitalized
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
        let questions = questionCards
        let hasRecent = psyche?.recentReports?.isEmpty == false
        IndexedSurfaceCarousel(
            selection: $selection,
            count: max(1, questions.count + (hasRecent ? 1 : 0))
        ) { index in
            if questions.isEmpty {
                EmptySurfaceCard(
                    title: "Psyche not loaded",
                    message: "Mark a moment now; Forge definitions load after the next direct refresh or paired iPhone backup.",
                    actionTitle: "Mark moment",
                    systemImage: "bookmark.fill",
                    action: {
                        onCapture("mark_moment", nil, .empty, ["surface": "psyche"])
                    }
                )
            } else if questions.indices.contains(index) {
                let question = questions[index]
                PsycheQuestionCard(question: question) { option in
                    var payload = option.payload
                    payload["questionId"] = question.id
                    payload["choice"] = option.label
                    payload["surface"] = "psyche"
                    onCapture(question.eventType, question.id, .empty, payload)
                }
            } else if hasRecent, index == questions.count {
                PsycheRecentReportCard(reports: psyche?.recentReports ?? [])
            }
        }
    }

    private var questionCards: [ForgeWatchPsycheSnapshot.Question] {
        if let questions = psyche?.questions, questions.isEmpty == false {
            return questions
        }

        guard let psyche else { return [] }
        return [
            legacyQuestion(
                id: "emotion",
                title: "Emotion",
                prompt: "What emotion is present?",
                eventType: "emotion_check_in",
                labels: psyche.emotionOptions,
                payloadKey: "emotion"
            ),
            legacyQuestion(
                id: "trigger",
                title: "Trigger",
                prompt: "What happened?",
                eventType: "trigger_capture",
                labels: psyche.triggerOptions,
                payloadKey: "trigger"
            ),
            legacyQuestion(
                id: "routine",
                title: "Routine",
                prompt: "Log one daily signal.",
                eventType: "routine_check",
                labels: psyche.routinePromptOptions,
                payloadKey: "routine"
            )
        ].filter { $0.options.isEmpty == false }
    }

    private func legacyQuestion(
        id: String,
        title: String,
        prompt: String,
        eventType: String,
        labels: [String],
        payloadKey: String
    ) -> ForgeWatchPsycheSnapshot.Question {
        ForgeWatchPsycheSnapshot.Question(
            id: id,
            title: title,
            prompt: prompt,
            eventType: eventType,
            options: labels.prefix(6).map { label in
                ForgeWatchPsycheSnapshot.Option(
                    id: label,
                    label: label,
                    subtitle: "",
                    payload: [payloadKey: label]
                )
            }
        )
    }
}

private struct PsycheQuestionCard: View {
    let question: ForgeWatchPsycheSnapshot.Question
    let onSelect: (ForgeWatchPsycheSnapshot.Option) -> Void

    var body: some View {
        WatchCard {
            VStack(alignment: .leading, spacing: 5) {
                Text(question.title)
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(WatchTheme.textPrimary)
                    .lineLimit(1)
                Text(question.prompt)
                    .font(.system(size: 9, weight: .medium, design: .rounded))
                    .foregroundStyle(WatchTheme.textMuted)
                    .lineLimit(1)
                ForEach(question.options.prefix(2)) { option in
                    Button {
                        onSelect(option)
                    } label: {
                        HStack(spacing: 6) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(option.label)
                                    .font(.system(size: 11, weight: .bold, design: .rounded))
                                    .foregroundStyle(WatchTheme.textPrimary)
                                    .lineLimit(1)
                                if option.subtitle.isEmpty == false {
                                    Text(option.subtitle)
                                        .font(.system(size: 8, weight: .medium, design: .rounded))
                                        .foregroundStyle(WatchTheme.textMuted)
                                        .lineLimit(1)
                                }
                            }
                            Spacer(minLength: 4)
                            Image(systemName: "checkmark.circle")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(WatchTheme.accent)
                        }
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .fill(Color.white.opacity(0.09))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                                        .stroke(WatchTheme.border, lineWidth: 1)
                                )
                        )
                    }
                    .buttonStyle(.plain)
                }
                if question.options.count > 2 {
                    Text("+ \(question.options.count - 2) more on iPhone")
                        .font(.system(size: 8, weight: .semibold, design: .rounded))
                        .foregroundStyle(WatchTheme.textMuted)
                        .lineLimit(1)
                }
            }
            .padding(.top, 4)
        }
    }
}

private struct PsycheRecentReportCard: View {
    let reports: [ForgeWatchPsycheSnapshot.RecentReport]

    var body: some View {
        WatchCard {
            VStack(alignment: .leading, spacing: 7) {
                Text("Recent Psyche")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(WatchTheme.textPrimary)
                ForEach(reports.prefix(4)) { report in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(report.title)
                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                            .foregroundStyle(WatchTheme.textPrimary)
                            .lineLimit(2)
                        Text(report.status.capitalized)
                            .font(.system(size: 9, weight: .bold, design: .rounded))
                            .foregroundStyle(WatchTheme.textMuted)
                            .lineLimit(1)
                    }
                    Divider().background(WatchTheme.border)
                }
            }
        }
    }
}

private struct PeopleGlanceSurface: View {
    let presentation: ForgeWatchPeoplePresentation

    var body: some View {
        CompactScrollableWatchCard {
            if presentation.isDetailed, let personName = presentation.personName {
                VStack(alignment: .leading, spacing: 7) {
                    Label("Together", systemImage: "person.2.fill")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(WatchTheme.accent)
                    Text(personName)
                        .font(.system(size: 17, weight: .bold, design: .rounded))
                        .foregroundStyle(WatchTheme.textPrimary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.72)
                    Text(presentation.indicator)
                        .font(.system(size: 9, weight: .semibold, design: .rounded))
                        .foregroundStyle(
                            presentation.indicator.contains("stale")
                                ? WatchTheme.accent
                                : WatchTheme.success
                        )
                    if let connectivity = presentation.connectivity {
                        Label(connectivity, systemImage: "antenna.radiowaves.left.and.right")
                            .font(.system(size: 10, weight: .medium, design: .rounded))
                            .foregroundStyle(WatchTheme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Divider().overlay(WatchTheme.border)
                    if let eventTitle = presentation.eventTitle {
                        Text(eventTitle)
                            .font(.system(size: 12, weight: .bold, design: .rounded))
                            .foregroundStyle(WatchTheme.textPrimary)
                            .lineLimit(2)
                            .minimumScaleFactor(0.75)
                        if let eventTiming = presentation.eventTiming {
                            Text(eventTiming)
                                .font(.system(size: 10, weight: .medium, design: .rounded))
                                .foregroundStyle(WatchTheme.textMuted)
                        }
                    }
                    if let eventStatus = presentation.eventStatus {
                        Text(eventStatus)
                            .font(.system(size: 9, weight: .medium, design: .rounded))
                            .foregroundStyle(WatchTheme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .accessibilityElement(children: .combine)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Image(systemName: "person.2.fill")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(WatchTheme.accent)
                        .accessibilityHidden(true)
                    Text(presentation.title)
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(WatchTheme.textPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                    Text(presentation.indicator)
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(WatchTheme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(presentation.title), \(presentation.indicator)")
            }
        }
        .accessibilityIdentifier("ForgeWatchPeopleGlance")
    }
}

private struct InboxSurface: View {
    let prompts: [ForgeWatchPrompt]
    let attention: ForgeWatchAttentionSnapshot?
    let pins: ForgeWatchPinsSnapshot?
    @Binding var selection: Int
    let onCapture: (String, String?, ForgeWatchLinkedContext, [String: String]) -> Void

    var body: some View {
        if prompts.isEmpty, attention == nil, pins == nil {
            EmptySurfaceCard(title: "Inbox clear", message: "No watch-sized prompts are waiting.")
        } else {
            SurfaceCarousel(selection: $selection, count: cardCount) {
                if let attention {
                    WatchCard {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 7) {
                                Image(systemName: "tray.full.fill")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(attention.blockingCount > 0 ? WatchTheme.danger : WatchTheme.accent)
                                Text("Attention")
                                    .font(.system(size: 14, weight: .bold, design: .rounded))
                                    .foregroundStyle(WatchTheme.textPrimary)
                            }

                            HStack(spacing: 6) {
                                DenseMetric(title: "Active", value: "\(attention.activeCount)", tint: WatchTheme.accent)
                                DenseMetric(title: "Important", value: "\(attention.importantCount)", tint: WatchTheme.accent)
                                DenseMetric(title: "Blocking", value: "\(attention.blockingCount)", tint: WatchTheme.danger)
                            }

                            Text(attention.items.first?.title ?? "Nothing needs a next move.")
                                .font(.system(size: 10, weight: .medium, design: .rounded))
                                .foregroundStyle(WatchTheme.textMuted)
                                .lineLimit(2)
                        }
                    }
                    .tag(0)

                    ForEach(Array(attention.items.enumerated()), id: \.element.id) { index, item in
                        WatchCard {
                            VStack(alignment: .leading, spacing: 7) {
                                HStack(spacing: 6) {
                                    Circle()
                                        .fill(severityColor(item.severity))
                                        .frame(width: 7, height: 7)
                                    Text(item.source.replacingOccurrences(of: "_", with: " ").capitalized)
                                        .font(.system(size: 9, weight: .bold, design: .rounded))
                                        .foregroundStyle(WatchTheme.textMuted)
                                        .lineLimit(1)
                                }
                                Text(item.title)
                                    .font(.system(size: 14, weight: .bold, design: .rounded))
                                    .foregroundStyle(WatchTheme.textPrimary)
                                    .lineLimit(2)
                                Text(item.reason)
                                    .font(.system(size: 11, weight: .medium, design: .rounded))
                                    .foregroundStyle(WatchTheme.textMuted)
                                    .lineLimit(3)
                                Text(item.targetLabel)
                                    .font(.system(size: 9, weight: .semibold, design: .rounded))
                                    .foregroundStyle(WatchTheme.accent)
                                    .lineLimit(1)
                            }
                        }
                        .tag(index + 1)
                    }
                }

                if let pins {
                    WatchCard {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 7) {
                                Image(systemName: "pin.fill")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(WatchTheme.accent)
                                Text("Pinned")
                                    .font(.system(size: 14, weight: .bold, design: .rounded))
                                    .foregroundStyle(WatchTheme.textPrimary)
                            }

                            DenseMetric(
                                title: "Records",
                                value: "\(pins.total)",
                                tint: WatchTheme.accent
                            )

                            Text(pins.items.first?.title ?? "No pinned records.")
                                .font(.system(size: 10, weight: .medium, design: .rounded))
                                .foregroundStyle(WatchTheme.textMuted)
                                .lineLimit(2)
                        }
                    }
                    .tag(attentionCardCount)

                    ForEach(Array(pins.items.enumerated()), id: \.element.id) { index, item in
                        WatchCard {
                            VStack(alignment: .leading, spacing: 7) {
                                Text(item.category)
                                    .font(.system(size: 9, weight: .bold, design: .rounded))
                                    .foregroundStyle(WatchTheme.accent)
                                    .lineLimit(1)
                                Text(item.title)
                                    .font(.system(size: 14, weight: .bold, design: .rounded))
                                    .foregroundStyle(WatchTheme.textPrimary)
                                    .lineLimit(2)
                                Text(item.availability == "available" ? item.detail : "Unavailable in Forge")
                                    .font(.system(size: 11, weight: .medium, design: .rounded))
                                    .foregroundStyle(WatchTheme.textMuted)
                                    .lineLimit(3)
                            }
                        }
                        .tag(attentionCardCount + index + 1)
                    }
                }

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
                    .tag(attentionCardCount + pinCardCount + index)
                }
            }
        }
    }

    private var attentionCardCount: Int {
        attention.map { 1 + $0.items.count } ?? 0
    }

    private var pinCardCount: Int {
        pins.map { 1 + $0.items.count } ?? 0
    }

    private var cardCount: Int {
        max(1, attentionCardCount + pinCardCount + prompts.count)
    }

    private func severityColor(_ severity: String) -> Color {
        switch severity {
        case "blocking":
            return WatchTheme.danger
        case "important":
            return WatchTheme.accent
        default:
            return WatchTheme.accent
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
    let connection: ForgeWatchConnection?
    let directMetric: ForgeWatchDirectSyncMetric?
    let pendingActionCount: Int
    let latestReceipt: ForgeWatchStoredReceipt?
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
                    DenseMetric(title: actionCountTitle, value: "\(pendingActionCount)", tint: pendingActionCount == 0 ? WatchTheme.success : WatchTheme.accent)
                }
                Text(connectionSummary)
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(connectionSummaryTint)
                    .lineLimit(2)
                    .minimumScaleFactor(0.82)
                Text(sync?.generatedAt ?? "Waiting for Forge")
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                    .foregroundStyle(WatchTheme.textMuted)
                    .lineLimit(2)
                if let directMetric {
                    Text(directMetric.summary)
                        .font(.system(size: 9, weight: .semibold, design: .rounded))
                        .foregroundStyle(directMetric.succeeded ? WatchTheme.success : WatchTheme.accent)
                        .lineLimit(3)
                        .minimumScaleFactor(0.82)
                    if directMetric.succeeded == false, let error = directMetric.errorDescription {
                        Text(error)
                            .font(.system(size: 9, weight: .medium, design: .rounded))
                            .foregroundStyle(WatchTheme.accent)
                            .lineLimit(2)
                            .minimumScaleFactor(0.78)
                    }
                }
                if let latestReceipt {
                    Divider().background(WatchTheme.border)
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Image(systemName: receiptSystemImage(latestReceipt.status))
                            .foregroundStyle(receiptTint(latestReceipt.status))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Last receipt · \(receiptKindLabel(latestReceipt.kind))")
                                .font(.system(size: 9, weight: .bold, design: .rounded))
                                .foregroundStyle(WatchTheme.textPrimary)
                                .lineLimit(1)
                            Text(latestReceipt.status.replacingOccurrences(of: "_", with: " ").capitalized)
                                .font(.system(size: 9, weight: .medium, design: .rounded))
                                .foregroundStyle(receiptTint(latestReceipt.status))
                            if let errorMessage = latestReceipt.errorMessage {
                                Text(errorMessage)
                                    .font(.system(size: 9, weight: .medium, design: .rounded))
                                    .foregroundStyle(WatchTheme.danger)
                                    .lineLimit(3)
                                    .minimumScaleFactor(0.78)
                            }
                            Text(receiptOperationLabel(latestReceipt))
                                .font(.system(size: 8, weight: .medium, design: .monospaced))
                                .foregroundStyle(WatchTheme.textMuted)
                                .lineLimit(1)
                                .minimumScaleFactor(0.68)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
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

    private var connectionSummary: String {
        guard let connection else {
            return "No secure watch route yet; open the iPhone app to share one."
        }
        guard connection.directNetworkingEnabled else {
            return "No direct HTTPS route; paired iPhone backup can still send."
        }
        guard let directMetric else {
            if pendingActionCount > 0 {
                return "Trying direct \(connection.transportLabel) HTTPS now; paired iPhone backup only if direct fails."
            }
            return "Ready to test direct \(connection.transportLabel) HTTPS to Forge."
        }
        if directMetric.succeeded {
            return "Verified direct \(directMetric.transportLabel) HTTPS to Forge."
        }
        if directMetric.fallbackUsed {
            return "\(directMetric.transportLabel) direct failed on watch; paired iPhone backup sent it."
        }
        return "\(directMetric.transportLabel) direct failed on watch; retry direct when reachable."
    }

    private var connectionSummaryTint: Color {
        guard connection?.directNetworkingEnabled == true else {
            return WatchTheme.textMuted
        }
        guard let directMetric else {
            return WatchTheme.textMuted
        }
        return directMetric.succeeded ? WatchTheme.success : WatchTheme.accent
    }

    private var actionCountTitle: String {
        if pendingActionCount == 0 {
            return "Clear"
        }
        return connection?.directNetworkingEnabled == true ? "Sending" : "Backup"
    }

    private func receiptKindLabel(_ kind: String) -> String {
        kind.replacingOccurrences(of: "_", with: " ").capitalized
    }

    private func receiptSystemImage(_ status: String) -> String {
        status == "failed" ? "xmark.circle.fill" : "checkmark.circle.fill"
    }

    private func receiptTint(_ status: String) -> Color {
        status == "failed" ? WatchTheme.danger : WatchTheme.success
    }

    private func receiptOperationLabel(_ receipt: ForgeWatchStoredReceipt) -> String {
        let code = receipt.structuredError?["code"]?.stringValue
        return code.map { "\($0) · \(receipt.actionId)" } ?? receipt.actionId
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
