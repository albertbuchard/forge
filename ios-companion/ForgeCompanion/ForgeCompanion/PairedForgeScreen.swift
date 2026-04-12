import SwiftUI

struct PairedForgeScreen: View {
    @EnvironmentObject private var appModel: CompanionAppModel

    let reopenSetup: () -> Void

    @State private var menuVisible = false
    @State private var reloadToken = UUID()
    @State private var isLoading = true
    @State private var webError: String?
    @State private var movementSettingsVisible = false
    @State private var screenTimeSettingsVisible = false
    @State private var settingsVisible = false
    @State private var diagnosticsVisible = false
    @State private var lifeTimelineVisible = false
    @State private var screenshotScenarioApplied = false

    var body: some View {
        GeometryReader { proxy in
            let topControlsPadding = max(6, proxy.safeAreaInsets.top + 4)
            let menuSheetTopPadding = topControlsPadding + 56

            ZStack(alignment: .topTrailing) {
                CompanionStyle.background

                if appModel.screenshotScenario?.usesForgeCanvasPlaceholder == true {
                    CompanionScreenshotForgeCanvas()
                        .frame(width: proxy.size.width, height: proxy.size.height)
                } else if let url = appModel.forgeWebURL {
                    ForgeWebView(
                        url: url,
                        reloadToken: reloadToken,
                        isLoading: $isLoading,
                        errorMessage: $webError
                    )
                    .frame(width: proxy.size.width, height: proxy.size.height)
                }

                if isLoading {
                    VStack {
                        ProgressView()
                            .tint(CompanionStyle.accentStrong)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.black.opacity(0.08))
                    .allowsHitTesting(false)
                }

                if let webError {
                    VStack {
                        Spacer()

                        Text(webError)
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(Color.white)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(Color.black.opacity(0.36), in: Capsule())
                            .padding(.bottom, proxy.safeAreaInsets.bottom + 18)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .allowsHitTesting(false)
                }

                Button {
                    companionDebugLog(
                        "PairedForgeScreen",
                        "menu button tap old=\(menuVisible)"
                    )
                    menuVisible.toggle()
                } label: {
                    Image(systemName: menuVisible ? "xmark" : "line.3.horizontal")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 34, height: 34)
                        .background(Color.black.opacity(0.22), in: Circle())
                        .overlay(Circle().stroke(Color.white.opacity(0.14), lineWidth: 1))
                        .overlay(alignment: .topTrailing) {
                            if appModel.needsNativeAttention {
                                Circle()
                                    .fill(Color(red: 1, green: 0.67, blue: 0.29))
                                    .frame(width: 8, height: 8)
                                    .offset(x: 1, y: -1)
                            }
                        }
                }
                .buttonStyle(.plain)
                .padding(.trailing, 16)
                .padding(.top, topControlsPadding)
                .zIndex(3)

                if menuVisible {
                    Color.black.opacity(0.001)
                        .ignoresSafeArea()
                        .onTapGesture {
                            companionDebugLog("PairedForgeScreen", "overlay tap close menu")
                            menuVisible = false
                        }
                        .zIndex(1)

                    CompanionMenuSheet(
                        openSettings: { settingsVisible = true },
                        openScreenTimeSettings: { screenTimeSettingsVisible = true },
                        openLifeTimeline: { lifeTimelineVisible = true },
                        closeMenu: { menuVisible = false }
                    )
                    .environmentObject(appModel)
                    .padding(.top, menuSheetTopPadding)
                    .padding(.trailing, 16)
                    .zIndex(2)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .clipped()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea(edges: .bottom)
        .sheet(isPresented: $movementSettingsVisible) {
            MovementSettingsSheet(
                movementStore: appModel.movementStore,
                close: { movementSettingsVisible = false }
            )
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $settingsVisible) {
            CompanionSettingsSheet(
                reopenSetup: reopenSetup,
                reloadForge: { reloadToken = UUID() },
                openDiagnostics: { diagnosticsVisible = true },
                openMovementSettings: { movementSettingsVisible = true },
                openScreenTimeSettings: { screenTimeSettingsVisible = true },
                close: { settingsVisible = false }
            )
            .environmentObject(appModel)
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $screenTimeSettingsVisible) {
            ScreenTimeSettingsSheet(
                screenTimeStore: appModel.screenTimeStore,
                close: { screenTimeSettingsVisible = false }
            )
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $diagnosticsVisible) {
            CompanionDiagnosticsSheet(
                close: { diagnosticsVisible = false }
            )
            .environmentObject(appModel)
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .fullScreenCover(isPresented: $lifeTimelineVisible) {
            MovementLifeTimelineView(
                close: { lifeTimelineVisible = false }
            )
            .environmentObject(appModel)
        }
        .onAppear {
            if appModel.screenshotScenario != nil {
                isLoading = false
                webError = nil
            }
            if screenshotScenarioApplied == false, let screenshotScenario = appModel.screenshotScenario {
                screenshotScenarioApplied = true
                DispatchQueue.main.async {
                    if screenshotScenario.autoOpensDiagnostics {
                        diagnosticsVisible = true
                    }
                    if screenshotScenario.autoOpensLifeTimeline {
                        lifeTimelineVisible = true
                    }
                }
            }
            companionDebugLog(
                "PairedForgeScreen",
                "onAppear forgeWebURL=\(appModel.forgeWebURL?.absoluteString ?? "nil")"
            )
        }
        .onChange(of: menuVisible) { _, nextValue in
            companionDebugLog("PairedForgeScreen", "menuVisible -> \(nextValue)")
        }
        .onChange(of: reloadToken) { _, nextValue in
            companionDebugLog("PairedForgeScreen", "reloadToken -> \(nextValue.uuidString)")
        }
        .onChange(of: isLoading) { _, nextValue in
            companionDebugLog("PairedForgeScreen", "isLoading -> \(nextValue)")
        }
        .onChange(of: webError) { _, nextValue in
            companionDebugLog("PairedForgeScreen", "webError -> \(nextValue ?? "nil")")
        }
        .onChange(of: appModel.forgeWebURL) { _, nextValue in
            companionDebugLog(
                "PairedForgeScreen",
                "forgeWebURL -> \(nextValue?.absoluteString ?? "nil")"
            )
        }
        .animation(.spring(response: 0.28, dampingFraction: 0.88), value: menuVisible)
    }
}

private struct MovementLifeTimelineView: View {
    @EnvironmentObject private var appModel: CompanionAppModel

    let close: () -> Void

    @State private var segments: [ForgeMovementTimelineSegment] = []
    @State private var nextCursor: String?
    @State private var hasMore = true
    @State private var initialLoadComplete = false
    @State private var loading = false
    @State private var loadingMore = false
    @State private var loadError: String?
    @State private var selectedId: String?
    @State private var editorDraft: MovementTimelineEditorDraft?
    @State private var scrolledToCurrent = false
    @State private var focusedVisibleId: String?

    var body: some View {
        NavigationStack {
            GeometryReader { proxy in
                ZStack {
                    CompanionStyle.background
                    Color.black.opacity(0.16)
                        .ignoresSafeArea()
                    MovementTimelineBackdropGrid(anchorDate: displayItems.last?.endedAtDate ?? Date())

                    ScrollViewReader { reader in
                        ScrollView(.vertical, showsIndicators: false) {
                            VStack(spacing: 0) {
                                if let oldestTimelineItem {
                                    MovementTimelineHistoryCap(item: oldestTimelineItem)
                                        .padding(.top, proxy.safeAreaInsets.top + 12)
                                        .padding(.bottom, 18)
                                }

                                Color.clear
                                    .frame(height: max(proxy.size.height * 0.42, 260))

                                LazyVStack(spacing: 18) {
                                    if loadingMore {
                                        ProgressView()
                                            .tint(CompanionStyle.accentStrong)
                                            .padding(.vertical, 10)
                                    } else if hasMore {
                                        Color.clear
                                            .frame(height: 1)
                                            .onAppear {
                                                Task {
                                                    await loadMoreIfNeeded()
                                                }
                                            }
                                    }

                                    if let loadError {
                                        MovementTimelineStatusCard(
                                            title: "Timeline load issue",
                                            detail: loadError
                                        )
                                    } else if loading && displayItems.isEmpty {
                                        MovementTimelineStatusCard(
                                            title: "Loading movement history",
                                            detail: "Forge is paging your stay and trip history from the canonical movement store."
                                        )
                                    }

                                    ForEach(displayItems) { item in
                                        MovementTimelineRow(
                                            item: item,
                                            width: proxy.size.width - 28,
                                            isSelected: selectedId == item.id,
                                            onSelect: {
                                                withAnimation(.spring(response: 0.34, dampingFraction: 0.86)) {
                                                    selectedId = selectedId == item.id ? nil : item.id
                                                }
                                            },
                                            onEdit: {
                                                editorDraft = MovementTimelineEditorDraft(item: item)
                                            }
                                        )
                                        .id(item.id)
                                        .background(
                                            GeometryReader { rowProxy in
                                                Color.clear
                                                    .preference(
                                                        key: MovementTimelineVisiblePositionKey.self,
                                                        value: [item.id: rowProxy.frame(in: .named("MovementLifeTimelineScroll")).midY]
                                                    )
                                            }
                                        )
                                    }
                                }
                                .padding(.horizontal, 14)
                                .padding(.bottom, proxy.safeAreaInsets.bottom + 80)
                            }
                        }
                        .coordinateSpace(name: "MovementLifeTimelineScroll")
                        .onPreferenceChange(MovementTimelineVisiblePositionKey.self) { values in
                            let center = proxy.size.height / 2
                            guard let nextFocusedId = values.min(by: { abs($0.value - center) < abs($1.value - center) })?.key else {
                                return
                            }
                            if focusedVisibleId != nextFocusedId {
                                focusedVisibleId = nextFocusedId
                            }
                        }
                        .onAppear {
                            _ = appModel.movementStore.runCoverageRepair(
                                reason: "life timeline open",
                                referenceDate: Date()
                            )
                            if initialLoadComplete == false {
                                Task {
                                    await loadInitialPage()
                                }
                            }
                            guard scrolledToCurrent == false else {
                                return
                            }
                            scrolledToCurrent = true
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                                withAnimation(.easeInOut(duration: 0.45)) {
                                    reader.scrollTo(initialScrollTargetId, anchor: .center)
                                }
                            }
                        }
                    }

                        VStack {
                            HStack {
                                Spacer()
                            VStack(spacing: 4) {
                                Text("VISIBLE DAY")
                                    .font(.system(size: 9, weight: .bold, design: .rounded))
                                    .tracking(2.2)
                                    .foregroundStyle(Color.white.opacity(0.34))
                                Text(visibleDateLabel)
                                    .font(.system(size: 13, weight: .bold, design: .rounded))
                                    .foregroundStyle(CompanionStyle.textPrimary)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(Color.black.opacity(0.28), in: Capsule())
                            .overlay(
                                Capsule()
                                    .stroke(Color.white.opacity(0.08), lineWidth: 1)
                            )
                            Spacer()
                        }
                        .padding(.top, 12)

                        Spacer()
                    }
                    .allowsHitTesting(false)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close", action: close)
                        .foregroundStyle(CompanionStyle.textPrimary)
                }

                ToolbarItem(placement: .principal) {
                    VStack(spacing: 2) {
                        Text("Life Timeline")
                            .font(.system(size: 17, weight: .bold, design: .rounded))
                            .foregroundStyle(CompanionStyle.textPrimary)
                        Text("Stays, trips, edits, and sync truth")
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(CompanionStyle.textMuted)
                    }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task {
                            await reload()
                        }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .foregroundStyle(CompanionStyle.accentStrong)
                    }
                }
            }
        }
        .sheet(item: $editorDraft) { draft in
            MovementTimelineEditSheet(
                draft: draft,
                save: { updatedDraft in
                    await saveEditor(updatedDraft)
                },
                close: {
                    editorDraft = nil
                }
            )
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
    }

    private var liveOverlayItem: MovementLifeTimelineItem? {
        if let trip = appModel.movementStore.activeTrip {
            return MovementLifeTimelineItem(liveTrip: trip)
        }
        if let stay = appModel.movementStore.activeStay {
            return MovementLifeTimelineItem(liveStay: stay)
        }
        return nil
    }

    private var localHistoricalItems: [MovementLifeTimelineItem] {
        appModel.movementStore
            .buildHistoricalTimelineSegments(referenceDate: Date())
            .compactMap(MovementLifeTimelineItem.init(localHistorySegment:))
    }

    private var displayItems: [MovementLifeTimelineItem] {
        let remoteItems = segments.compactMap(MovementLifeTimelineItem.init(remote:))
        var items = remoteItems.isEmpty ? localHistoricalItems : remoteItems
        if let liveOverlayItem {
            items.append(liveOverlayItem)
        }
        return normalizedTimelineItems(items, referenceDate: Date()) + [.currentAnchor]
    }

    private var visibleDateLabel: String {
        let candidate =
            displayItems.first(where: { $0.id == focusedVisibleId })
            ?? displayItems.first(where: { $0.id == selectedId })
            ?? displayItems.last
        guard let candidate else {
            return Date().formatted(Date.FormatStyle().day(.twoDigits).month(.twoDigits).year(.twoDigits))
        }
        return candidate.startedAtDate.formatted(Date.FormatStyle().day(.twoDigits).month(.twoDigits).year(.twoDigits))
    }

    private var initialScrollTargetId: String {
        displayItems.last?.id ?? MovementLifeTimelineItem.currentAnchorId
    }

    private var oldestTimelineItem: MovementLifeTimelineItem? {
        displayItems.first(where: { $0.kind != .anchor })
    }

    private func normalizedTimelineItems(
        _ items: [MovementLifeTimelineItem],
        referenceDate: Date
    ) -> [MovementLifeTimelineItem] {
        let sorted = items
            .filter { $0.kind != .anchor && $0.endedAtDate > $0.startedAtDate }
            .sorted { left, right in
                if left.startedAtDate == right.startedAtDate {
                    return left.endedAtDate < right.endedAtDate
                }
                return left.startedAtDate < right.startedAtDate
            }

        guard sorted.isEmpty == false else {
            return []
        }

        func stayAnchorKey(for item: MovementLifeTimelineItem) -> String? {
            guard item.kind == .stay else {
                return nil
            }
            let candidate = item.placeLabel?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
                ? item.placeLabel
                : item.title
            let normalized = candidate?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            return normalized?.isEmpty == false ? normalized : nil
        }

        func sharesStayAnchor(_ left: MovementLifeTimelineItem, _ right: MovementLifeTimelineItem) -> Bool {
            guard left.kind == .stay, right.kind == .stay else {
                return false
            }
            guard let leftAnchor = stayAnchorKey(for: left),
                  let rightAnchor = stayAnchorKey(for: right)
            else {
                return left.origin != .recorded || right.origin != .recorded
            }
            return leftAnchor == rightAnchor
        }

        func makeDerivedGapItem(
            from previous: MovementLifeTimelineItem,
            to next: MovementLifeTimelineItem
        ) -> MovementLifeTimelineItem? {
            let gapSeconds = next.startedAtDate.timeIntervalSince(previous.endedAtDate)
            guard gapSeconds > 0 else {
                return nil
            }
            if gapSeconds <= 60 * 60, sharesStayAnchor(previous, next) {
                return MovementLifeTimelineItem(
                    id: "display-continued-\(previous.id)-\(next.id)",
                    source: .derived("display-continued-\(previous.id)-\(next.id)"),
                    kind: .stay,
                    title: previous.placeLabel ?? next.placeLabel ?? previous.title,
                    subtitle: "Short stationary gap carried forward into one continuous stay.",
                    placeLabel: previous.placeLabel ?? next.placeLabel,
                    tags: Array(Set(previous.tags + next.tags + ["continued-stay"])).sorted(),
                    syncSource: "display repair",
                    startedAtDate: previous.endedAtDate,
                    endedAtDate: next.startedAtDate,
                    durationSeconds: max(60, Int(gapSeconds)),
                    laneSide: .left,
                    connectorFromLane: .left,
                    connectorToLane: .left,
                    distanceMeters: nil,
                    averageSpeedMps: nil,
                    origin: .continuedStay,
                    editable: false,
                    isCurrent: false
                )
            }
            return MovementLifeTimelineItem(
                id: "display-missing-\(previous.id)-\(next.id)",
                source: .derived("display-missing-\(previous.id)-\(next.id)"),
                kind: .missing,
                title: "Missing data",
                subtitle: "Forge backfilled an uncovered interval so the timeline never goes silent.",
                placeLabel: nil,
                tags: ["missing-data", "display-repair"],
                syncSource: "display repair",
                startedAtDate: previous.endedAtDate,
                endedAtDate: next.startedAtDate,
                durationSeconds: max(60, Int(gapSeconds)),
                laneSide: .left,
                connectorFromLane: previous.kind == .trip ? .right : .left,
                connectorToLane: next.kind == .trip ? .right : .left,
                distanceMeters: nil,
                averageSpeedMps: nil,
                origin: .missing,
                editable: false,
                isCurrent: false
            )
        }

        func makeTrailingCoverageItem(
            after item: MovementLifeTimelineItem
        ) -> MovementLifeTimelineItem? {
            let gapSeconds = referenceDate.timeIntervalSince(item.endedAtDate)
            guard gapSeconds > 0 else {
                return nil
            }
            if item.kind == .stay, gapSeconds <= 60 * 60 {
                return MovementLifeTimelineItem(
                    id: "display-trailing-stay-\(item.id)",
                    source: .derived("display-trailing-stay-\(item.id)"),
                    kind: .stay,
                    title: item.placeLabel ?? item.title,
                    subtitle: "Short stationary gap carried forward into one continuous stay.",
                    placeLabel: item.placeLabel,
                    tags: Array(Set(item.tags + ["continued-stay"])).sorted(),
                    syncSource: "display repair",
                    startedAtDate: item.endedAtDate,
                    endedAtDate: referenceDate,
                    durationSeconds: max(60, Int(gapSeconds)),
                    laneSide: .left,
                    connectorFromLane: .left,
                    connectorToLane: .left,
                    distanceMeters: nil,
                    averageSpeedMps: nil,
                    origin: .continuedStay,
                    editable: false,
                    isCurrent: false
                )
            }
            return MovementLifeTimelineItem(
                id: "display-trailing-missing-\(item.id)",
                source: .derived("display-trailing-missing-\(item.id)"),
                kind: .missing,
                title: "Missing data",
                subtitle: "Forge backfilled the trailing interval so the view stays fully labelled.",
                placeLabel: nil,
                tags: ["missing-data", "display-repair"],
                syncSource: "display repair",
                startedAtDate: item.endedAtDate,
                endedAtDate: referenceDate,
                durationSeconds: max(60, Int(gapSeconds)),
                laneSide: .left,
                connectorFromLane: item.kind == .trip ? .right : .left,
                connectorToLane: .left,
                distanceMeters: nil,
                averageSpeedMps: nil,
                origin: .missing,
                editable: false,
                isCurrent: false
            )
        }

        func mergedItem(
            _ previous: MovementLifeTimelineItem,
            _ next: MovementLifeTimelineItem
        ) -> MovementLifeTimelineItem? {
            guard previous.kind == next.kind else {
                return nil
            }
            let touchingOrOverlapping = next.startedAtDate <= previous.endedAtDate
                || abs(next.startedAtDate.timeIntervalSince(previous.endedAtDate)) < 1
            guard touchingOrOverlapping else {
                return nil
            }
            let canMerge: Bool
            switch previous.kind {
            case .stay:
                canMerge = sharesStayAnchor(previous, next)
            case .trip, .missing:
                canMerge = true
            case .anchor:
                canMerge = false
            }
            guard canMerge else {
                return nil
            }
            let mergedOrigin: MovementLifeTimelineItem.Origin
            if previous.origin == .continuedStay || next.origin == .continuedStay {
                mergedOrigin = .continuedStay
            } else if previous.origin == .repairedGap || next.origin == .repairedGap {
                mergedOrigin = .repairedGap
            } else if previous.origin == .missing || next.origin == .missing {
                mergedOrigin = .missing
            } else {
                mergedOrigin = .recorded
            }
            return MovementLifeTimelineItem(
                id: "merged-\(previous.id)-\(next.id)",
                source: mergedOrigin == .recorded ? previous.source : .derived("merged-\(previous.id)-\(next.id)"),
                kind: previous.kind,
                title: previous.placeLabel ?? next.placeLabel ?? previous.title,
                subtitle:
                    mergedOrigin == .continuedStay
                    ? "Short stationary gap carried forward into one continuous stay."
                    : previous.subtitle,
                placeLabel: previous.placeLabel ?? next.placeLabel,
                tags: Array(Set(previous.tags + next.tags)).sorted(),
                syncSource: previous.syncSource == next.syncSource ? previous.syncSource : "display repair",
                startedAtDate: min(previous.startedAtDate, next.startedAtDate),
                endedAtDate: max(previous.endedAtDate, next.endedAtDate),
                durationSeconds: max(
                    60,
                    Int(max(previous.endedAtDate, next.endedAtDate).timeIntervalSince(min(previous.startedAtDate, next.startedAtDate)))
                ),
                laneSide: previous.kind == .trip ? .right : .left,
                connectorFromLane: previous.connectorFromLane,
                connectorToLane: next.connectorToLane,
                distanceMeters:
                    previous.kind == .trip
                    ? max(previous.distanceMeters ?? 0, next.distanceMeters ?? 0)
                    : nil,
                averageSpeedMps: previous.averageSpeedMps ?? next.averageSpeedMps,
                origin: mergedOrigin,
                editable: mergedOrigin == .recorded && previous.editable && next.editable,
                isCurrent: previous.isCurrent || next.isCurrent
            )
        }

        func trimmedItem(
            _ item: MovementLifeTimelineItem,
            startingAt newStart: Date
        ) -> MovementLifeTimelineItem? {
            guard item.endedAtDate > newStart else {
                return nil
            }
            return MovementLifeTimelineItem(
                id: "\(item.id)-trimmed-\(Int(newStart.timeIntervalSince1970))",
                source: item.source,
                kind: item.kind,
                title: item.title,
                subtitle: item.subtitle,
                placeLabel: item.placeLabel,
                tags: item.tags,
                syncSource: item.syncSource,
                startedAtDate: newStart,
                endedAtDate: item.endedAtDate,
                durationSeconds: max(60, Int(item.endedAtDate.timeIntervalSince(newStart))),
                laneSide: item.laneSide,
                connectorFromLane: item.connectorFromLane,
                connectorToLane: item.connectorToLane,
                distanceMeters: item.distanceMeters,
                averageSpeedMps: item.averageSpeedMps,
                origin: item.origin,
                editable: item.editable,
                isCurrent: item.isCurrent
            )
        }

        var normalized: [MovementLifeTimelineItem] = []
        for raw in sorted {
            var current: MovementLifeTimelineItem? = raw
            while let candidate = current, let previous = normalized.last {
                if let merged = mergedItem(previous, candidate) {
                    normalized[normalized.count - 1] = merged
                    current = nil
                    break
                }

                if candidate.startedAtDate > previous.endedAtDate,
                   let gapItem = makeDerivedGapItem(from: previous, to: candidate)
                {
                    normalized.append(gapItem)
                    continue
                }

                if candidate.startedAtDate < previous.endedAtDate {
                    current = trimmedItem(candidate, startingAt: previous.endedAtDate)
                    if current == nil {
                        break
                    }
                    continue
                }
                break
            }
            if let current {
                normalized.append(current)
            }
        }

        if let last = normalized.last,
           let trailingCoverage = makeTrailingCoverageItem(after: last)
        {
            if let merged = mergedItem(last, trailingCoverage) {
                normalized[normalized.count - 1] = merged
            } else {
                normalized.append(trailingCoverage)
            }
        }

        return normalized
    }

    private func reload() async {
        _ = appModel.movementStore.runCoverageRepair(
            reason: "life timeline reload",
            referenceDate: Date()
        )
        nextCursor = nil
        hasMore = true
        segments = []
        loadError = nil
        selectedId = nil
        initialLoadComplete = false
        scrolledToCurrent = false
        await loadInitialPage()
    }

    private func loadInitialPage() async {
        guard loading == false else {
            return
        }
        loading = true
        defer {
            loading = false
            initialLoadComplete = true
        }
        if appModel.screenshotScenario != nil {
            segments = []
            nextCursor = nil
            hasMore = false
            loadError = nil
            return
        }
        let resolvedPairing = await appModel.ensureActivePairingIfPossible(reason: "life-timeline-initial") ?? appModel.pairing
        guard let pairing = resolvedPairing else {
            loadError = localHistoricalItems.isEmpty
                ? "Connect the companion to Forge to page historical movement. The phone has no repaired local history cached yet."
                : "Showing repaired local movement history from the phone. Reconnect to Forge to page older canonical segments."
            hasMore = false
            return
        }
        do {
            let page = try await appModel.syncClient.fetchMovementTimeline(
                payload: pairing,
                before: nil,
                limit: 36
            )
            segments = page.segments.reversed()
            nextCursor = page.nextCursor
            hasMore = page.hasMore
            loadError = nil
        } catch {
            if error.localizedDescription.localizedCaseInsensitiveContains("pairing session expired"),
               let renewedPairing = await appModel.ensureActivePairingIfPossible(
                reason: "life-timeline-expired-session",
                forceRenewal: true
               )
            {
                do {
                    let page = try await appModel.syncClient.fetchMovementTimeline(
                        payload: renewedPairing,
                        before: nil,
                        limit: 36
                    )
                    segments = page.segments.reversed()
                    nextCursor = page.nextCursor
                    hasMore = page.hasMore
                    loadError = nil
                    return
                } catch {
                    loadError = localHistoricalItems.isEmpty
                        ? error.localizedDescription
                        : "Showing repaired local movement history while Forge reconnects. \(error.localizedDescription)"
                    hasMore = false
                    return
                }
            }
            loadError = localHistoricalItems.isEmpty
                ? error.localizedDescription
                : "Showing repaired local movement history while Forge reconnects. \(error.localizedDescription)"
            hasMore = false
        }
    }

    private func loadMoreIfNeeded() async {
        guard loadingMore == false, loading == false, hasMore else {
            return
        }
        if appModel.screenshotScenario != nil {
            hasMore = false
            return
        }
        let resolvedPairing = await appModel.ensureActivePairingIfPossible(reason: "life-timeline-pagination") ?? appModel.pairing
        guard let pairing = resolvedPairing else {
            hasMore = false
            return
        }
        guard let nextCursor else {
            return
        }
        loadingMore = true
        defer {
            loadingMore = false
        }
        do {
            let page = try await appModel.syncClient.fetchMovementTimeline(
                payload: pairing,
                before: nextCursor,
                limit: 32
            )
            segments = page.segments.reversed() + segments
            self.nextCursor = page.nextCursor
            hasMore = page.hasMore
            loadError = nil
        } catch {
            if error.localizedDescription.localizedCaseInsensitiveContains("pairing session expired"),
               let renewedPairing = await appModel.ensureActivePairingIfPossible(
                reason: "life-timeline-pagination-expired",
                forceRenewal: true
               )
            {
                do {
                    let page = try await appModel.syncClient.fetchMovementTimeline(
                        payload: renewedPairing,
                        before: nextCursor,
                        limit: 32
                    )
                    segments = page.segments.reversed() + segments
                    self.nextCursor = page.nextCursor
                    hasMore = page.hasMore
                    loadError = nil
                    return
                } catch {
                    loadError = localHistoricalItems.isEmpty
                        ? error.localizedDescription
                        : "Showing repaired local movement history while Forge reconnects. \(error.localizedDescription)"
                    hasMore = false
                    return
                }
            }
            loadError = localHistoricalItems.isEmpty
                ? error.localizedDescription
                : "Showing repaired local movement history while Forge reconnects. \(error.localizedDescription)"
            hasMore = false
        }
    }

    private func saveEditor(_ draft: MovementTimelineEditorDraft) async {
        let trimmedLabel = draft.label.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedPlace = draft.placeLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        let tags = draft.tags
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.isEmpty == false }

        do {
            switch draft.item.source {
            case .remoteStay(let stayId, let center):
                guard let pairing = appModel.pairing else {
                    throw NSError(
                        domain: "MovementLifeTimeline",
                        code: 1,
                        userInfo: [NSLocalizedDescriptionKey: "Reconnect to Forge before editing historical movement."]
                    )
                }
                let resolvedPlaceExternalUid = try await resolveCanonicalPlaceExternalUid(
                    label: trimmedPlace,
                    tags: tags,
                    coordinates: center,
                    pairing: pairing
                )
                _ = try await appModel.syncClient.patchMovementStay(
                    stayId: stayId,
                    patch: ForgeMovementStayPatch(
                        label: trimmedLabel,
                        status: nil,
                        classification: nil,
                        startedAt: MovementTimelineFormatting.isoFormatter.string(from: draft.startedAt),
                        endedAt: MovementTimelineFormatting.isoFormatter.string(from: draft.endedAt),
                        centerLatitude: nil,
                        centerLongitude: nil,
                        radiusMeters: nil,
                        sampleCount: nil,
                        placeId: nil,
                        placeExternalUid: resolvedPlaceExternalUid == nil ? nil : .some(resolvedPlaceExternalUid),
                        placeLabel: trimmedPlace.isEmpty ? nil : trimmedPlace,
                        tags: tags,
                        metadata: nil
                    ),
                    pairing: pairing
                )
                await reload()
            case .remoteTrip(let tripId):
                guard let pairing = appModel.pairing else {
                    throw NSError(
                        domain: "MovementLifeTimeline",
                        code: 1,
                        userInfo: [NSLocalizedDescriptionKey: "Reconnect to Forge before editing historical movement."]
                    )
                }
                _ = try await appModel.syncClient.patchMovementTrip(
                    tripId: tripId,
                    patch: ForgeMovementTripPatch(
                        label: trimmedLabel,
                        status: nil,
                        travelMode: nil,
                        activityType: nil,
                        startedAt: MovementTimelineFormatting.isoFormatter.string(from: draft.startedAt),
                        endedAt: MovementTimelineFormatting.isoFormatter.string(from: draft.endedAt),
                        startPlaceId: nil,
                        endPlaceId: nil,
                        startPlaceExternalUid: nil,
                        endPlaceExternalUid: nil,
                        distanceMeters: nil,
                        movingSeconds: nil,
                        idleSeconds: nil,
                        averageSpeedMps: nil,
                        maxSpeedMps: nil,
                        caloriesKcal: nil,
                        expectedMet: nil,
                        tags: tags,
                        metadata: nil
                    ),
                    pairing: pairing
                )
                await reload()
            case .liveStay(let stayId, let center):
                let resolvedLocalPlace = appModel.movementStore.addKnownPlace(
                    label: trimmedPlace.isEmpty ? trimmedLabel : trimmedPlace,
                    categoryTags: tags,
                    latitude: center.latitude,
                    longitude: center.longitude
                )
                appModel.movementStore.updateLocalStay(
                    id: stayId,
                    label: trimmedLabel,
                    tags: tags,
                    placeLabel: trimmedPlace,
                    placeExternalUid: resolvedLocalPlace?.externalUid ?? ""
                )
            case .liveTrip(let tripId):
                appModel.movementStore.updateLocalTrip(
                    id: tripId,
                    label: trimmedLabel,
                    tags: tags
                )
            case .derived:
                throw NSError(
                    domain: "MovementLifeTimeline",
                    code: 3,
                    userInfo: [NSLocalizedDescriptionKey: "Repaired segments are synthesized and cannot be edited."]
                )
            case .remoteMissing:
                throw NSError(
                    domain: "MovementLifeTimeline",
                    code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "Missing-data segments are synthesized and cannot be edited."]
                )
            case .anchor:
                break
            }
            editorDraft = nil
        } catch {
            companionDebugLog(
                "MovementLifeTimelineView",
                "saveEditor failed error=\(error.localizedDescription)"
            )
            loadError = error.localizedDescription
        }
    }

    private func resolveCanonicalPlaceExternalUid(
        label: String,
        tags: [String],
        coordinates: MovementTimelineCoordinate?,
        pairing: PairingPayload
    ) async throws -> String? {
        guard label.isEmpty == false, let coordinates else {
            return nil
        }
        if let existing = appModel.movementStore.knownPlaces.first(where: {
            $0.label.caseInsensitiveCompare(label) == .orderedSame
        }) {
            return existing.externalUid
        }
        let place = try await appModel.syncClient.createMovementPlace(
            label: label,
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
            categoryTags: tags,
            pairing: pairing
        )
        _ = appModel.movementStore.addKnownPlace(
            label: place.label,
            categoryTags: place.categoryTags,
            latitude: place.latitude,
            longitude: place.longitude
        )
        return place.externalUid
    }
}

private struct MovementTimelineRow: View {
    let item: MovementLifeTimelineItem
    let width: CGFloat
    let isSelected: Bool
    let onSelect: () -> Void
    let onEdit: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            if detailOnLeadingSide {
                detailPanel
                    .frame(width: detailWidth)
                    .transition(.move(edge: .leading).combined(with: .opacity))
            }

            segmentPanel
                .frame(width: segmentWidth, alignment: item.isCurrent ? .center : item.laneSide == .left ? .leading : .trailing)

            if detailOnTrailingSide {
                detailPanel
                    .frame(width: detailWidth)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .frame(maxWidth: .infinity)
        .id(item.id)
    }

    private var detailOnLeadingSide: Bool {
        false
    }

    private var detailOnTrailingSide: Bool {
        isSelected
    }

    private var segmentWidth: CGFloat {
        max(176, detailOnTrailingSide ? width * 0.46 : width * 0.92)
    }

    private var detailWidth: CGFloat {
        max(176, width * 0.39)
    }

    private var segmentPanel: some View {
        Button(action: onSelect) {
            VStack(alignment: .leading, spacing: 10) {
                if item.kind == .stay {
                    MovementTimelineStayShape(item: item)
                } else if item.kind == .trip {
                    MovementTimelineTripShape(item: item)
                } else if item.kind == .missing {
                    MovementTimelineMissingShape(item: item)
                } else {
                    currentAnchor
                }
            }
            .padding(.horizontal, 4)
            .offset(x: isSelected ? item.selectionOffset : 0)
        }
        .buttonStyle(.plain)
    }

    private var detailPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 8) {
                Text(item.title)
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)
                if item.origin == .continuedStay {
                    Text("CONTINUED")
                        .font(.system(size: 9, weight: .black, design: .rounded))
                        .foregroundStyle(Color.white.opacity(0.74))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.blue.opacity(0.18), in: Capsule())
                }
                if item.origin == .repairedGap {
                    Text("REPAIRED")
                        .font(.system(size: 9, weight: .black, design: .rounded))
                        .foregroundStyle(Color.white.opacity(0.74))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.white.opacity(0.08), in: Capsule())
                }
            }
            Text(item.subtitle)
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(CompanionStyle.textSecondary)
            detailRow("Started", item.startedAtDate.formatted(.dateTime.day().month(.abbreviated).year().hour().minute()))
            detailRow(
                "Ended",
                item.kind == .stay && item.isCurrent
                    ? "Ongoing"
                    : item.endedAtDate.formatted(.dateTime.day().month(.abbreviated).year().hour().minute())
            )
            detailRow("Duration", item.durationLabel)
            if let placeLabel = item.placeLabel, placeLabel.isEmpty == false {
                detailRow("Place", placeLabel)
            }
            if let distance = item.distanceMeters {
                detailRow("Distance", "\(String(format: "%.1f", distance / 1000)) km")
            }
            if let speed = item.averageSpeedMps {
                detailRow("Avg speed", "\(String(format: "%.1f", speed)) m/s")
            }
            detailRow("Sync source", item.syncSource.capitalized)
            if item.tags.isEmpty == false {
                FlowTagCloud(tags: item.tags)
            }
            HStack {
                Spacer()
                Button("Edit") {
                    onEdit()
                }
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(CompanionStyle.textPrimary)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Color.white.opacity(0.08), in: Capsule())
                .overlay(
                    Capsule()
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
                .buttonStyle(.plain)
                .disabled(item.kind == .anchor || item.editable == false)
            }
        }
        .padding(16)
        .background(CompanionStyle.sheetBackground(cornerRadius: 24))
    }

    private func detailRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(label.uppercased())
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundStyle(CompanionStyle.textMuted)
            Spacer(minLength: 8)
            Text(value)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(CompanionStyle.textPrimary)
                .multilineTextAlignment(.trailing)
        }
    }

    private var currentAnchor: some View {
        VStack(spacing: 8) {
            Text("NOW")
                .font(.system(size: 11, weight: .black, design: .rounded))
                .foregroundStyle(CompanionStyle.accentStrong)
            Capsule()
                .fill(CompanionStyle.accentStrong.opacity(0.9))
                .frame(width: 82, height: 4)
        }
        .frame(maxWidth: .infinity)
        .id(MovementLifeTimelineItem.currentAnchorId)
    }
}

private struct MovementTimelineStayShape: View {
    let item: MovementLifeTimelineItem

    var body: some View {
        VStack(alignment: item.horizontalAlignment, spacing: 8) {
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(item.gradient)
                .overlay(alignment: .top) {
                    MovementTimelineStayHandle(position: .top)
                }
                .overlay(alignment: .bottom) {
                    MovementTimelineStayHandle(position: .bottom)
                }
                .overlay(
                    RoundedRectangle(cornerRadius: 26, style: .continuous)
                        .stroke(Color.white.opacity(item.isCurrent ? 0.26 : 0.14), lineWidth: 1)
                )
                .overlay(alignment: .topLeading) {
                    Text(item.durationLabel)
                        .font(.system(size: 16, weight: .black, design: .rounded))
                        .foregroundStyle(CompanionStyle.textPrimary)
                        .padding(16)
                }
                .overlay(alignment: .bottomLeading) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("STAY")
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                            .foregroundStyle(CompanionStyle.textSecondary)
                            .tracking(2)
                        Text("\(item.startedAtDate.formatted(.dateTime.hour().minute())) → \(item.endedAtDate.formatted(.dateTime.hour().minute()))")
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(CompanionStyle.textSecondary)
                    }
                    .padding(16)
                }
                .overlay {
                    MovementTimelineTimeLadder(
                        startedAt: item.startedAtDate,
                        endedAt: item.endedAtDate,
                        durationSeconds: item.durationSeconds
                    )
                }
                .overlay(alignment: .topTrailing) {
                    if item.durationSeconds > 6 * 60 * 60 {
                        VStack(alignment: .trailing, spacing: 5) {
                            Capsule()
                                .fill(Color.white.opacity(0.16))
                                .frame(width: 38, height: 1)
                            Capsule()
                                .fill(Color.white.opacity(0.1))
                                .frame(width: 28, height: 1)
                            Text("wrapped")
                                .font(.system(size: 8, weight: .bold, design: .rounded))
                                .foregroundStyle(Color.white.opacity(0.32))
                                .tracking(1.4)
                        }
                        .padding(16)
                    }
                }
                .frame(width: item.isCurrent ? 196 : 172, height: item.displayHeight)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .id(item.isCurrent ? MovementLifeTimelineItem.currentAnchorId : item.id)
    }
}

private struct MovementTimelineTripShape: View {
    let item: MovementLifeTimelineItem

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack {
                MovementTimelineTimeLadder(
                    startedAt: item.startedAtDate,
                    endedAt: item.endedAtDate,
                    durationSeconds: item.durationSeconds
                )

                if item.isCurrent {
                    RoundedRectangle(cornerRadius: 999, style: .continuous)
                        .fill(item.gradient)
                        .frame(width: 4, height: item.displayHeight)
                        .overlay(
                            RoundedRectangle(cornerRadius: 999, style: .continuous)
                                .stroke(
                                    item.gradient,
                                    style: StrokeStyle(
                                        lineWidth: 4,
                                        lineCap: .round,
                                        dash: [3, 8]
                                    )
                                )
                        )
                    VStack {
                        MovementTimelineTripEndpointCapsule(
                            emphasized: true
                        )
                        Spacer(minLength: 0)
                        MovementTimelineTripEndpointCapsule(
                            emphasized: true
                        )
                    }
                    .padding(.vertical, 12)
                } else {
                    TripConnectorShape(
                        from: item.connectorFromLane,
                        to: item.connectorToLane
                    )
                    .stroke(
                        item.gradient,
                        style: StrokeStyle(
                            lineWidth: 3,
                            lineCap: .round,
                            dash: [7, 10]
                        )
                    )
                    .frame(height: item.displayHeight)
                    VStack {
                        MovementTimelineTripEndpointCapsule(
                            emphasized: false
                        )
                        Spacer(minLength: 0)
                        MovementTimelineTripEndpointCapsule(
                            emphasized: false
                        )
                    }
                    .padding(.vertical, 12)
                }

                HStack {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("MOVE")
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                            .foregroundStyle(CompanionStyle.textSecondary)
                            .tracking(2)
                        Text(item.durationLabel)
                            .font(.system(size: 12, weight: .black, design: .rounded))
                            .foregroundStyle(CompanionStyle.accentStrong)
                        if let distance = item.distanceMeters {
                            Text("\(String(format: "%.1f", distance / 1000)) km")
                                .font(.system(size: 11, weight: .medium, design: .rounded))
                                .foregroundStyle(CompanionStyle.textSecondary)
                        }
                        Text("\(item.startedAtDate.formatted(.dateTime.hour().minute())) → \(item.endedAtDate.formatted(.dateTime.hour().minute()))")
                            .font(.system(size: 10, weight: .medium, design: .rounded))
                            .foregroundStyle(CompanionStyle.textMuted)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(Color.black.opacity(0.22), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 22, style: .continuous)
                            .stroke(Color.white.opacity(0.08), lineWidth: 1)
                    )
                    .frame(maxWidth: 184, alignment: .leading)
                    .offset(y: 10)
                }
            }
            .frame(width: item.isCurrent ? 196 : 184, height: item.displayHeight, alignment: .topLeading)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .id(item.isCurrent ? MovementLifeTimelineItem.currentAnchorId : item.id)
    }
}

private struct MovementTimelineMissingShape: View {
    let item: MovementLifeTimelineItem

    var body: some View {
        RoundedRectangle(cornerRadius: 24, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [
                        Color(red: 148 / 255, green: 163 / 255, blue: 184 / 255).opacity(0.24),
                        Color(red: 71 / 255, green: 85 / 255, blue: 105 / 255).opacity(0.18)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(Color.white.opacity(0.12), lineWidth: 1)
            )
            .overlay(alignment: .topLeading) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("MISSING")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.white.opacity(0.7))
                        .tracking(2)
                    Text(item.durationLabel)
                        .font(.system(size: 15, weight: .black, design: .rounded))
                        .foregroundStyle(CompanionStyle.textPrimary)
                }
                .padding(16)
            }
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.title)
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(CompanionStyle.textPrimary)
                    Text("\(item.startedAtDate.formatted(.dateTime.hour().minute())) → \(item.endedAtDate.formatted(.dateTime.hour().minute()))")
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(CompanionStyle.textSecondary)
                }
                .padding(16)
            }
            .frame(width: 172, height: max(112, item.displayHeight * 0.72))
            .frame(maxWidth: .infinity, alignment: .center)
    }
}

private struct MovementTimelineTripEndpointCapsule: View {
    let emphasized: Bool

    var body: some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(Color.black.opacity(0.26))
            .frame(width: 32, height: 26)
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(
                        emphasized ? CompanionStyle.accentStrong.opacity(0.36) : Color.white.opacity(0.08),
                        lineWidth: 1
                    )
            )
            .shadow(color: Color.black.opacity(0.18), radius: 8, y: 3)
    }
}

private struct MovementTimelineTimeLadder: View {
    let startedAt: Date
    let endedAt: Date
    let durationSeconds: Int

    var body: some View {
        GeometryReader { proxy in
            let markers = timelineMarkers(height: proxy.size.height)
            ZStack(alignment: .topLeading) {
                ForEach(markers) { marker in
                    VStack(alignment: .leading, spacing: 2) {
                        Rectangle()
                            .fill(Color.white.opacity(marker.isDate ? 0.14 : 0.07))
                            .frame(height: 1)
                        Text(marker.label)
                            .font(.system(size: marker.isDate ? 9 : 8, weight: .thin, design: .rounded))
                            .foregroundStyle(Color.white.opacity(marker.isDate ? 0.26 : 0.12))
                    }
                    .offset(y: marker.y)
                }
            }
        }
        .allowsHitTesting(false)
        .padding(.horizontal, 10)
        .padding(.vertical, 10)
    }

    private func timelineMarkers(height: CGFloat) -> [MovementTimelineMarker] {
        let maxDurationSeconds = 6 * 60 * 60
        let effectiveHours = max(1, min(6, Int(ceil(Double(min(durationSeconds, maxDurationSeconds)) / 3600))))
        var markers: [MovementTimelineMarker] = []
        for hour in 0...effectiveHours {
            let fraction = CGFloat(hour) / CGFloat(max(1, effectiveHours))
            let y = height * fraction
            let sourceDate: Date
            if durationSeconds <= maxDurationSeconds {
                sourceDate = endedAt.addingTimeInterval(-Double(hour) * 3600)
            } else {
                let compressedFraction = pow(fraction, 1.8)
                sourceDate = endedAt.addingTimeInterval(-Double(durationSeconds) * Double(compressedFraction))
            }
            let isDate = Calendar.current.component(.hour, from: sourceDate) == 0 || hour == effectiveHours
            markers.append(
                MovementTimelineMarker(
                    y: y,
                    label: isDate
                        ? sourceDate.formatted(Date.FormatStyle().day(.twoDigits).month(.twoDigits).year(.twoDigits))
                        : sourceDate.formatted(Date.FormatStyle().hour(.twoDigits(amPM: .omitted))),
                    isDate: isDate
                )
            )
        }
        return markers
    }
}

private struct MovementTimelineBackdropGrid: View {
    let anchorDate: Date

    var body: some View {
        GeometryReader { proxy in
            let rows = Int(proxy.size.height / 42) + 8
            ZStack(alignment: .topLeading) {
                ForEach(0..<rows, id: \.self) { index in
                    let date = anchorDate.addingTimeInterval(TimeInterval(-index * 3600))
                    let y = CGFloat(index) * 42
                    Rectangle()
                        .fill(Color.white.opacity(index.isMultiple(of: 24) ? 0.08 : 0.04))
                        .frame(height: 1)
                        .offset(y: y)
                    Text(index.isMultiple(of: 24)
                         ? date.formatted(Date.FormatStyle().day(.twoDigits).month(.twoDigits).year(.twoDigits))
                         : date.formatted(Date.FormatStyle().hour(.twoDigits(amPM: .omitted))))
                        .font(.system(size: index.isMultiple(of: 24) ? 9 : 8, weight: .thin, design: .rounded))
                        .foregroundStyle(Color.white.opacity(index.isMultiple(of: 24) ? 0.24 : 0.14))
                        .offset(x: 12, y: y - 10)
                }
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}

private struct MovementTimelineStatusCard: View {
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundStyle(CompanionStyle.textPrimary)
            Text(detail)
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(CompanionStyle.textSecondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(CompanionStyle.sheetBackground(cornerRadius: 24))
    }
}

private struct MovementTimelineEditSheet: View {
    @State var draft: MovementTimelineEditorDraft

    let save: (MovementTimelineEditorDraft) async -> Void
    let close: () -> Void

    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Summary") {
                    TextField("Label", text: $draft.label)
                    if draft.item.kind == .stay {
                        TextField("Place", text: $draft.placeLabel)
                    }
                    TextField("Tags", text: $draft.tags)
                }

                Section("Timing") {
                    DatePicker("Started", selection: $draft.startedAt, displayedComponents: [.date, .hourAndMinute])
                    DatePicker("Ended", selection: $draft.endedAt, displayedComponents: [.date, .hourAndMinute])
                }

                Section("Sync") {
                    Text(draft.item.syncSource.capitalized)
                    if draft.item.isCurrent {
                        Text("This is the live local overlay. Changes save locally and will sync on the next movement upload.")
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(CompanionStyle.textSecondary)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(CompanionStyle.background)
            .navigationTitle("Edit segment")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel", action: close)
                        .foregroundStyle(CompanionStyle.textPrimary)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(saving ? "Saving…" : "Save") {
                        saving = true
                        Task {
                            await save(draft)
                            saving = false
                        }
                    }
                    .foregroundStyle(CompanionStyle.accentStrong)
                    .disabled(saving)
                }
            }
        }
    }
}

private struct FlowTagCloud: View {
    let tags: [String]

    var body: some View {
        ViewThatFits(in: .vertical) {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(tags.chunked(into: 3).enumerated()), id: \.offset) { _, chunk in
                    HStack(spacing: 6) {
                        ForEach(chunk, id: \.self) { tag in
                            Text(tag)
                                .font(.system(size: 11, weight: .semibold, design: .rounded))
                                .foregroundStyle(CompanionStyle.textPrimary)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(Color.white.opacity(0.08), in: Capsule())
                        }
                    }
                }
            }
            Text(tags.joined(separator: " · "))
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(CompanionStyle.textSecondary)
        }
    }
}

private struct TripConnectorShape: Shape {
    let from: MovementTimelineLaneSide
    let to: MovementTimelineLaneSide

    func path(in rect: CGRect) -> Path {
        let centerX = rect.midX
        var path = Path()
        path.move(to: CGPoint(x: centerX, y: rect.minY + 22))
        path.addLine(to: CGPoint(x: centerX, y: rect.maxY - 22))
        return path
    }
}

private struct MovementTimelineStayHandle: View {
    enum Position {
        case top
        case bottom
    }

    let position: Position

    var body: some View {
        Capsule()
            .fill(Color.white.opacity(0.82))
            .frame(width: 3, height: 20)
            .shadow(color: CompanionStyle.accentStrong.opacity(0.24), radius: 8)
            .offset(y: position == .top ? -10 : 10)
    }
}

private struct MovementTimelineHistoryCap: View {
    let item: MovementLifeTimelineItem

    var body: some View {
        VStack(spacing: 4) {
            Text("HISTORY BEGINS HERE")
                .font(.system(size: 9, weight: .bold, design: .rounded))
                .tracking(2)
                .foregroundStyle(Color.white.opacity(0.34))
            VStack(spacing: 3) {
                Text(item.placeLabel?.isEmpty == false ? item.placeLabel! : item.title)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)
                Text(item.kind == .stay ? "Oldest loaded stay" : "Earlier anchor before this move")
                    .font(.system(size: 9, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.textMuted)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(CompanionStyle.sheetBackground(cornerRadius: 18))
            .overlay(alignment: .bottom) {
                MovementTimelineStayHandle(position: .bottom)
            }
        }
    }
}

private struct MovementTimelineMarker: Identifiable {
    let id = UUID()
    let y: CGFloat
    let label: String
    let isDate: Bool
}

private struct MovementTimelineVisiblePositionKey: PreferenceKey {
    static var defaultValue: [String: CGFloat] = [:]

    static func reduce(value: inout [String: CGFloat], nextValue: () -> [String: CGFloat]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

private struct MovementTimelineCoordinate: Hashable {
    let latitude: Double
    let longitude: Double
}

private struct MovementTimelineEditorDraft: Identifiable {
    let id: String
    let item: MovementLifeTimelineItem
    var label: String
    var placeLabel: String
    var tags: String
    var startedAt: Date
    var endedAt: Date

    init(item: MovementLifeTimelineItem) {
        self.id = item.id
        self.item = item
        self.label = item.title
        self.placeLabel = item.placeLabel ?? ""
        self.tags = item.tags.joined(separator: ", ")
        self.startedAt = item.startedAtDate
        self.endedAt = item.endedAtDate
    }
}

private struct MovementLifeTimelineItem: Identifiable, Hashable {
    enum Kind: Hashable {
        case stay
        case trip
        case missing
        case anchor
    }

    enum DetailSide {
        case leading
        case trailing
    }

    enum Source: Hashable {
        case remoteStay(String, MovementTimelineCoordinate?)
        case remoteTrip(String)
        case remoteMissing(String)
        case liveStay(String, MovementTimelineCoordinate)
        case liveTrip(String)
        case derived(String)
        case anchor
    }

    enum Origin: Hashable {
        case recorded
        case continuedStay
        case repairedGap
        case missing
    }

    static let currentAnchorId = "life-timeline-current-anchor"
    static let currentAnchor = MovementLifeTimelineItem(
        id: currentAnchorId,
        source: .anchor,
        kind: .anchor,
        title: "Now",
        subtitle: "",
        placeLabel: nil,
        tags: [],
        syncSource: "local",
        startedAtDate: Date(),
        endedAtDate: Date(),
        durationSeconds: 0,
        laneSide: .left,
        connectorFromLane: .left,
        connectorToLane: .right,
        distanceMeters: nil,
        averageSpeedMps: nil,
        isCurrent: false
    )

    let id: String
    let source: Source
    let kind: Kind
    let title: String
    let subtitle: String
    let placeLabel: String?
    let tags: [String]
    let syncSource: String
    let startedAtDate: Date
    let endedAtDate: Date
    let durationSeconds: Int
    let laneSide: MovementTimelineLaneSide
    let connectorFromLane: MovementTimelineLaneSide
    let connectorToLane: MovementTimelineLaneSide
    let distanceMeters: Double?
    let averageSpeedMps: Double?
    let origin: Origin
    let editable: Bool
    let isCurrent: Bool

    init(
        id: String,
        source: Source,
        kind: Kind,
        title: String,
        subtitle: String,
        placeLabel: String?,
        tags: [String],
        syncSource: String,
        startedAtDate: Date,
        endedAtDate: Date,
        durationSeconds: Int,
        laneSide: MovementTimelineLaneSide,
        connectorFromLane: MovementTimelineLaneSide,
        connectorToLane: MovementTimelineLaneSide,
        distanceMeters: Double?,
        averageSpeedMps: Double?,
        origin: Origin = .recorded,
        editable: Bool = true,
        isCurrent: Bool
    ) {
        self.id = id
        self.source = source
        self.kind = kind
        self.title = title
        self.subtitle = subtitle
        self.placeLabel = placeLabel
        self.tags = tags
        self.syncSource = syncSource
        self.startedAtDate = startedAtDate
        self.endedAtDate = endedAtDate
        self.durationSeconds = durationSeconds
        self.laneSide = laneSide
        self.connectorFromLane = connectorFromLane
        self.connectorToLane = connectorToLane
        self.distanceMeters = distanceMeters
        self.averageSpeedMps = averageSpeedMps
        self.origin = origin
        self.editable = editable
        self.isCurrent = isCurrent
    }

    init?(remote segment: ForgeMovementTimelineSegment) {
        let startedAtDate = MovementTimelineFormatting.parse(segment.startedAt)
        let endedAtDate = MovementTimelineFormatting.parse(segment.endedAt)
        if segment.kind == "stay", let stay = segment.stay {
            self.init(
                id: "remote-stay-\(segment.id)",
                source: .remoteStay(
                    stay.id,
                    .init(latitude: stay.centerLatitude, longitude: stay.centerLongitude)
                ),
                kind: .stay,
                title: segment.title,
                subtitle: segment.subtitle,
                placeLabel: segment.placeLabel,
                tags: segment.tags,
                syncSource: segment.syncSource,
                startedAtDate: startedAtDate,
                endedAtDate: endedAtDate,
                durationSeconds: segment.durationSeconds,
                laneSide: segment.laneSide,
                connectorFromLane: segment.connectorFromLane,
                connectorToLane: segment.connectorToLane,
                distanceMeters: nil,
                averageSpeedMps: nil,
                origin:
                    segment.origin == "continued_stay"
                    ? .continuedStay
                    : segment.origin == "repaired_gap"
                        ? .repairedGap
                        : .recorded,
                editable: segment.origin == "recorded",
                isCurrent: false
            )
            return
        }
        if segment.kind == "trip", let trip = segment.trip {
            self.init(
                id: "remote-trip-\(segment.id)",
                source: .remoteTrip(trip.id),
                kind: .trip,
                title: segment.title,
                subtitle: segment.subtitle,
                placeLabel: segment.placeLabel,
                tags: segment.tags,
                syncSource: segment.syncSource,
                startedAtDate: startedAtDate,
                endedAtDate: endedAtDate,
                durationSeconds: segment.durationSeconds,
                laneSide: segment.laneSide,
                connectorFromLane: segment.connectorFromLane,
                connectorToLane: segment.connectorToLane,
                distanceMeters: trip.distanceMeters,
                averageSpeedMps: trip.averageSpeedMps,
                origin:
                    segment.origin == "continued_stay"
                    ? .continuedStay
                    : segment.origin == "repaired_gap"
                        ? .repairedGap
                        : .recorded,
                editable: segment.origin == "recorded",
                isCurrent: false
            )
            return
        }
        if segment.kind == "missing" {
            self.init(
                id: "remote-missing-\(segment.id)",
                source: .remoteMissing(segment.id),
                kind: .missing,
                title: segment.title,
                subtitle: segment.subtitle,
                placeLabel: segment.placeLabel,
                tags: segment.tags,
                syncSource: segment.syncSource,
                startedAtDate: startedAtDate,
                endedAtDate: endedAtDate,
                durationSeconds: segment.durationSeconds,
                laneSide: segment.laneSide,
                connectorFromLane: segment.connectorFromLane,
                connectorToLane: segment.connectorToLane,
                distanceMeters: nil,
                averageSpeedMps: nil,
                origin: .missing,
                editable: false,
                isCurrent: false
            )
            return
        }
        return nil
    }

    init(liveStay stay: MovementSyncStore.StoredStay) {
        let title = stay.placeLabel.isEmpty ? stay.label : stay.placeLabel
        self.init(
            id: "live-stay-\(stay.id)",
            source: .liveStay(
                stay.id,
                .init(latitude: stay.centerLatitude, longitude: stay.centerLongitude)
            ),
            kind: .stay,
            title: title,
            subtitle: stay.tags.isEmpty ? "Current stay" : stay.tags.joined(separator: " · "),
            placeLabel: stay.placeLabel,
            tags: stay.tags,
            syncSource: "local overlay",
            startedAtDate: stay.startedAt,
            endedAtDate: max(stay.endedAt, Date()),
            durationSeconds: max(60, Int(max(stay.endedAt, Date()).timeIntervalSince(stay.startedAt))),
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            distanceMeters: nil,
            averageSpeedMps: nil,
            origin: .recorded,
            editable: true,
            isCurrent: true
        )
    }

    init(liveTrip trip: MovementSyncStore.StoredTrip) {
        self.init(
            id: "live-trip-\(trip.id)",
            source: .liveTrip(trip.id),
            kind: .trip,
            title: trip.label,
            subtitle: trip.tags.isEmpty ? (trip.activityType.isEmpty ? "Current trip" : trip.activityType) : trip.tags.joined(separator: " · "),
            placeLabel: nil,
            tags: trip.tags,
            syncSource: "local overlay",
            startedAtDate: trip.startedAt,
            endedAtDate: max(trip.endedAt, Date()),
            durationSeconds: max(60, Int(max(trip.endedAt, Date()).timeIntervalSince(trip.startedAt))),
            laneSide: .right,
            connectorFromLane: .left,
            connectorToLane: .right,
            distanceMeters: trip.distanceMeters,
            averageSpeedMps: trip.averageSpeedMps,
            origin: .recorded,
            editable: true,
            isCurrent: true
        )
    }

    init?(localHistorySegment segment: MovementSyncStore.TimelineSegment) {
        guard segment.endedAt > segment.startedAt else {
            return nil
        }
        let source: Source
        switch segment.kind {
        case .stay:
            if segment.origin == .recorded, let stayId = segment.stayId {
                source = .liveStay(
                    stayId,
                    .init(
                        latitude: segment.coordinate?.latitude ?? 0,
                        longitude: segment.coordinate?.longitude ?? 0
                    )
                )
            } else {
                source = .derived(segment.id)
            }
        case .trip:
            if segment.origin == .recorded, let tripId = segment.tripId {
                source = .liveTrip(tripId)
            } else {
                source = .derived(segment.id)
            }
        case .missing:
            source = .derived(segment.id)
        }
        self.init(
            id: "local-\(segment.id)",
            source: source,
            kind: segment.kind == .stay ? .stay : segment.kind == .trip ? .trip : .missing,
            title: segment.title,
            subtitle: segment.subtitle,
            placeLabel: segment.placeLabel,
            tags: segment.tags,
            syncSource: segment.origin == .recorded ? "local cache" : "local derived",
            startedAtDate: segment.startedAt,
            endedAtDate: segment.endedAt,
            durationSeconds: max(60, Int(segment.endedAt.timeIntervalSince(segment.startedAt))),
            laneSide: segment.kind == .trip ? .right : .left,
            connectorFromLane: .left,
            connectorToLane: segment.kind == .trip ? .right : .left,
            distanceMeters: segment.distanceMeters,
            averageSpeedMps: segment.averageSpeedMps,
            origin:
                segment.origin == .recorded
                ? .recorded
                : segment.origin == .continuedStay
                    ? .continuedStay
                    : segment.origin == .repairedGap
                        ? .repairedGap
                        : .missing,
            editable: segment.editable,
            isCurrent: false
        )
    }

    var displayHeight: CGFloat {
        let maxDisplaySeconds = 6.0 * 60.0 * 60.0
        let minHeight: CGFloat = kind == .trip ? 90 : kind == .missing ? 96 : 72
        let maxHeight: CGFloat = 320
        let fraction = CGFloat(min(Double(durationSeconds), maxDisplaySeconds) / maxDisplaySeconds)
        return minHeight + ((maxHeight - minHeight) * max(fraction, 0.04))
    }

    var durationLabel: String {
        let hours = Double(durationSeconds) / 3600
        if hours >= 24 {
            return "\(Int(round(hours)))h"
        }
        if hours >= 1 {
            return "\(String(format: "%.1f", hours))h"
        }
        return "\(max(1, durationSeconds / 60))m"
    }

    var timeHeader: String {
        startedAtDate.formatted(Date.FormatStyle().day(.twoDigits).month(.twoDigits).year(.twoDigits))
    }

    var horizontalAlignment: HorizontalAlignment {
        .center
    }

    var detailSide: DetailSide {
        .trailing
    }

    var selectionOffset: CGFloat {
        -46
    }

    func promotedToCurrent(referenceDate: Date) -> MovementLifeTimelineItem {
        MovementLifeTimelineItem(
            id: id,
            source: source,
            kind: kind,
            title: title,
            subtitle: subtitle,
            placeLabel: placeLabel,
            tags: tags,
            syncSource: syncSource,
            startedAtDate: startedAtDate,
            endedAtDate: max(referenceDate, endedAtDate),
            durationSeconds: max(durationSeconds, Int(max(referenceDate, endedAtDate).timeIntervalSince(startedAtDate))),
            laneSide: laneSide,
            connectorFromLane: connectorFromLane,
            connectorToLane: connectorToLane,
            distanceMeters: distanceMeters,
            averageSpeedMps: averageSpeedMps,
            origin: origin,
            editable: editable,
            isCurrent: true
        )
    }

    var gradient: LinearGradient {
        if kind == .missing {
            return LinearGradient(
                colors: [
                    Color(red: 148 / 255, green: 163 / 255, blue: 184 / 255).opacity(0.9),
                    Color(red: 100 / 255, green: 116 / 255, blue: 139 / 255).opacity(0.72)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
        let lowercasedTags = Set(tags.map { $0.lowercased() })
        let colors: [Color]
        if lowercasedTags.contains("home") {
            colors = [Color(red: 0.27, green: 0.46, blue: 0.93), Color(red: 0.39, green: 0.68, blue: 0.98)]
        } else if lowercasedTags.contains("grocery") {
            colors = [Color(red: 0.94, green: 0.55, blue: 0.24), Color(red: 0.99, green: 0.79, blue: 0.36)]
        } else if lowercasedTags.contains("gym") {
            colors = [Color(red: 0.22, green: 0.72, blue: 0.66), Color(red: 0.35, green: 0.89, blue: 0.58)]
        } else if lowercasedTags.contains("holiday") {
            colors = [Color(red: 0.95, green: 0.44, blue: 0.54), Color(red: 0.98, green: 0.66, blue: 0.35)]
        } else if lowercasedTags.contains("nature") || lowercasedTags.contains("forest") {
            colors = [Color(red: 0.18, green: 0.67, blue: 0.49), Color(red: 0.46, green: 0.82, blue: 0.46)]
        } else {
            colors = [CompanionStyle.accent.opacity(0.94), CompanionStyle.accentStrong.opacity(0.82)]
        }
        return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

private enum MovementTimelineFormatting {
    static let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static func parse(_ value: String) -> Date {
        isoFormatter.date(from: value) ?? Date()
    }
}

private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        guard size > 0 else {
            return [self]
        }
        return stride(from: 0, to: count, by: size).map { index in
            Array(self[index..<Swift.min(index + size, count)])
        }
    }
}
