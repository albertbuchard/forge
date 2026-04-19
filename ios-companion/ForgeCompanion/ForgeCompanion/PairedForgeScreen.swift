import SwiftUI
import MapKit

struct PairedForgeScreen: View {
    @EnvironmentObject private var appModel: CompanionAppModel

    let reopenSetup: () -> Void

    @State private var menuVisible = false
    @State private var reloadToken = UUID()
    @State private var isLoading = true
    @State private var webError: String?
    @State private var movementSettingsVisible = false
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
                close: { settingsVisible = false }
            )
            .environmentObject(appModel)
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
    @State private var creatingDraft: MovementTimelineEditorDraft?
    @State private var detailSnapshot: MovementTimelineDetailSnapshot?
    @State private var detailLoading = false
    @State private var placeLabelDraft: MovementTimelinePlaceLabelDraft?
    @State private var placeDraft: MovementTimelinePlaceDraft?
    @State private var queuedEditorDraft: MovementTimelineEditorDraft?
    @State private var queuedPlaceLabelDraft: MovementTimelinePlaceLabelDraft?
    @State private var queuedPlaceDraft: MovementTimelinePlaceDraft?
    @State private var pendingPlaceAssignmentWarning: MovementTimelinePlaceAssignmentWarning?
    @State private var scrolledToCurrent = false
    @State private var focusedVisibleId: String?

    private var timelineReferenceDate: Date {
        if appModel.screenshotScenario != nil {
            return CompanionScreenshotFixtures.referenceDate
        }
        return Date()
    }

    private var isScreenshotPreview: Bool {
        appModel.screenshotScenario != nil
    }

    private var hasPresentedModal: Bool {
        editorDraft != nil
            || creatingDraft != nil
            || detailSnapshot != nil
            || placeLabelDraft != nil
            || placeDraft != nil
    }

    var body: some View {
        NavigationStack {
            GeometryReader { proxy in
                let rangeEnd = timelineReferenceDate.addingTimeInterval(
                    TimeInterval(MovementTimelineViewportLayout.futureGridHours * 3600)
                )
                let timelineBottomPadding = proxy.safeAreaInsets.bottom + 80
                let timelineContentHeight = movementTimelineContentHeight(
                    viewportHeight: proxy.size.height,
                    safeTopInset: proxy.safeAreaInsets.top,
                    bottomPadding: timelineBottomPadding,
                    rangeEnd: rangeEnd
                )
                ZStack {
                    CompanionStyle.background
                    Color.black.opacity(0.16)
                        .ignoresSafeArea()

                    ScrollViewReader { reader in
                        ScrollView(.vertical, showsIndicators: false) {
                            ZStack(alignment: .topLeading) {
                                MovementTimelineViewportGrid(
                                    items: displayItems,
                                    viewportHeight: proxy.size.height,
                                    safeTopInset: proxy.safeAreaInsets.top,
                                    bottomPadding: timelineBottomPadding,
                                    rangeEnd: rangeEnd
                                )
                                .frame(height: timelineContentHeight)

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
                                                    if item.sourceKind == "automatic" {
                                                        Task {
                                                            await invalidateAutomaticItem(item)
                                                        }
                                                    } else {
                                                        editorDraft = MovementTimelineEditorDraft(item: item)
                                                    }
                                                },
                                                onDetail: {
                                                    Task {
                                                        await openDetail(item)
                                                    }
                                                },
                                                onDefinePlace: {
                                                    openPlaceLabelDraft(for: item)
                                                },
                                                onDelete: {
                                                    Task {
                                                        await deleteUserDefinedItem(item)
                                                    }
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
                                    .padding(.bottom, timelineBottomPadding)
                                }
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
                                referenceDate: timelineReferenceDate
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
                    .opacity(isScreenshotPreview ? 0 : 1)
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
                            .font(.system(size: isScreenshotPreview ? 19 : 17, weight: .bold, design: .rounded))
                            .foregroundStyle(CompanionStyle.textPrimary)
                        if isScreenshotPreview {
                            Text(visibleDateLabel)
                                .font(.system(size: 11, weight: .semibold, design: .rounded))
                                .foregroundStyle(CompanionStyle.textMuted)
                        } else {
                            Text("Stays, trips, edits, and sync truth")
                                .font(.system(size: 11, weight: .medium, design: .rounded))
                                .foregroundStyle(CompanionStyle.textMuted)
                        }
                    }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 14) {
                        if isScreenshotPreview == false {
                            Menu {
                                Button("Manual stay") {
                                    creatingDraft = makeCreateDraft(kind: .stay)
                                }
                                Button("Manual move") {
                                    creatingDraft = makeCreateDraft(kind: .trip)
                                }
                                Button("Manual missing") {
                                    creatingDraft = makeCreateDraft(kind: .missing)
                                }
                            } label: {
                                Image(systemName: "plus")
                                    .foregroundStyle(CompanionStyle.accentStrong)
                            }
                        }

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
        }
        .sheet(item: Binding<MovementTimelineEditorDraft?>(
            get: { creatingDraft ?? editorDraft },
            set: { nextValue in
                if creatingDraft != nil {
                    creatingDraft = nextValue
                } else {
                    editorDraft = nextValue
                }
            }
        ), onDismiss: flushQueuedModalIfPossible) { draft in
            MovementTimelineEditSheet(
                draft: draft,
                creating: creatingDraft != nil,
                preflight: { updatedDraft in
                    await preflightEditor(updatedDraft)
                },
                save: { updatedDraft in
                    await saveEditor(updatedDraft)
                },
                close: {
                    editorDraft = nil
                    creatingDraft = nil
                }
            )
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .sheet(item: $detailSnapshot, onDismiss: flushQueuedModalIfPossible) { snapshot in
            MovementTimelineDetailSheet(
                snapshot: snapshot,
                loading: detailLoading,
                definePlace: {
                    if let item = displayItems.first(where: { $0.id == snapshot.itemId }) {
                        openPlaceLabelDraft(for: item)
                        detailSnapshot = nil
                    }
                },
                edit: {
                    if let item = displayItems.first(where: { $0.id == snapshot.itemId }) {
                        openEditorDraft(for: item)
                        detailSnapshot = nil
                    }
                }
            )
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .sheet(item: $placeLabelDraft, onDismiss: flushQueuedModalIfPossible) { draft in
            MovementTimelinePlaceLabelSheet(
                draft: draft,
                knownPlaces: rankedKnownPlaces(for: draft.item),
                close: { placeLabelDraft = nil },
                selectPlace: { place in
                    await selectKnownPlace(place, for: draft.item)
                },
                createNewPlace: { labelHint in
                    openPlaceDraft(for: draft.item, labelHint: labelHint)
                    placeLabelDraft = nil
                }
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .sheet(item: $placeDraft, onDismiss: flushQueuedModalIfPossible) { draft in
            MovementTimelinePlaceSheet(
                draft: draft,
                close: { placeDraft = nil },
                save: { updatedDraft in
                    await savePlaceDraft(updatedDraft)
                }
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .alert(item: $pendingPlaceAssignmentWarning) { warning in
            Alert(
                title: Text("Link distant saved location?"),
                message: Text(
                    "\"\(warning.place.label)\" is \(warning.formattedDistance) away from this stay's recorded center. Link it anyway?"
                ),
                primaryButton: .default(Text("Link location")) {
                    Task {
                        await assignKnownPlace(warning.place, to: warning.item)
                    }
                },
                secondaryButton: .cancel()
            )
        }
    }

    private var liveOverlayItem: MovementLifeTimelineItem? {
        if let stay = appModel.movementStore.activeStay,
           let trip = appModel.movementStore.activeTrip
        {
            let tripDuration = max(trip.endedAt, timelineReferenceDate).timeIntervalSince(trip.startedAt)
            if tripDuration < 5 * 60 || trip.distanceMeters < 100 {
                return MovementLifeTimelineItem(liveStay: stay, referenceDate: timelineReferenceDate)
            }
        }
        if let trip = appModel.movementStore.activeTrip {
            return MovementLifeTimelineItem(liveTrip: trip, referenceDate: timelineReferenceDate)
        }
        if let stay = appModel.movementStore.activeStay {
            return MovementLifeTimelineItem(liveStay: stay, referenceDate: timelineReferenceDate)
        }
        return nil
    }

    private var localHistoricalItems: [MovementLifeTimelineItem] {
        appModel.movementStore
            .buildHistoricalTimelineSegments(referenceDate: timelineReferenceDate)
            .compactMap(MovementLifeTimelineItem.init(localHistorySegment:))
    }

    private var cachedCanonicalItems: [MovementLifeTimelineItem] {
        appModel.movementStore.cachedProjectedBoxes
            .compactMap(MovementLifeTimelineItem.init(remote:))
    }

    private var displayItems: [MovementLifeTimelineItem] {
        let remoteItems = segments.compactMap(MovementLifeTimelineItem.init(remote:))
        let canonicalItems = remoteItems.isEmpty ? cachedCanonicalItems : remoteItems
        if canonicalItems.isEmpty == false {
            return canonicalTimelineItems(
                canonicalItems,
                liveOverlay: liveOverlayItem,
                referenceDate: timelineReferenceDate
            ) + [.currentAnchor(referenceDate: timelineReferenceDate)]
        }
        var localItems = localHistoricalItems
        if let liveOverlayItem {
            localItems.append(liveOverlayItem)
        }
        return normalizedTimelineItems(localItems, referenceDate: timelineReferenceDate)
            + [.currentAnchor(referenceDate: timelineReferenceDate)]
    }

    private var visibleDateLabel: String {
        let candidate =
            displayItems.first(where: { $0.id == focusedVisibleId })
            ?? displayItems.first(where: { $0.id == selectedId })
            ?? displayItems.last
        guard let candidate else {
            return timelineReferenceDate.formatted(Date.FormatStyle().day(.twoDigits).month(.twoDigits).year(.twoDigits))
        }
        return candidate.startedAtDate.formatted(Date.FormatStyle().day(.twoDigits).month(.twoDigits).year(.twoDigits))
    }

    private var initialScrollTargetId: String {
        displayItems.last?.id ?? MovementLifeTimelineItem.currentAnchorId
    }

    private var oldestTimelineItem: MovementLifeTimelineItem? {
        displayItems.first(where: { $0.kind != .anchor })
    }

    private func movementTimelineContentHeight(
        viewportHeight: CGFloat,
        safeTopInset: CGFloat,
        bottomPadding: CGFloat,
        rangeEnd: Date
    ) -> CGFloat {
        let rows = buildMovementViewportGridMetrics(
            items: displayItems,
            viewportHeight: viewportHeight,
            safeTopInset: safeTopInset
        )
        let trailingReference = displayItems.last(where: { $0.kind != .anchor })?.endedAtDate ?? rangeEnd
        let trailingHeight = max(
            CGFloat(MovementTimelineViewportLayout.futureGridHours)
                * MovementTimelineViewportLayout.gridRowHeight,
            CGFloat(max(0, rangeEnd.timeIntervalSince(trailingReference)) / 3600)
                * MovementTimelineViewportLayout.gridRowHeight
        )
        let minimumContentHeight =
            (oldestTimelineItem == nil
                ? 0
                : safeTopInset
                    + 12
                    + MovementTimelineViewportLayout.historyCapHeight
                    + MovementTimelineViewportLayout.historyCapBottomSpacing
            )
            + MovementTimelineViewportLayout.leadSpacerHeight(for: viewportHeight)
            + trailingHeight
            + bottomPadding
        let baseHeight = (rows.last?.boxBottom ?? 0) + trailingHeight + bottomPadding
        return max(baseHeight, minimumContentHeight, viewportHeight + 260)
    }

    private func makeCreateDraft(kind: MovementLifeTimelineItem.Kind) -> MovementTimelineEditorDraft {
        let seed = displayItems.last(where: { $0.kind != .anchor })
        let seedDate = timelineReferenceDate
        return MovementTimelineEditorDraft(
            item: MovementLifeTimelineItem(
                id: "create-\(UUID().uuidString)",
                source: .derived("create"),
                kind: kind,
                title: kind == .missing ? "User-defined missing data" : kind == .stay ? "Manual stay" : "Manual move",
                subtitle: "User-defined movement box",
                placeLabel: seed?.placeLabel,
                tags: [],
                syncSource: "companion",
                startedAtDate: seed?.endedAtDate ?? seedDate.addingTimeInterval(-60 * 60),
                endedAtDate: seedDate,
                durationSeconds: 60 * 60,
                laneSide: kind == .trip ? .right : .left,
                connectorFromLane: .left,
                connectorToLane: kind == .trip ? .right : .left,
                distanceMeters: nil,
                averageSpeedMps: nil,
                sourceKind: "user_defined",
                overrideCount: 0,
                origin: kind == .missing ? .userInvalidated : .userDefined,
                editable: true,
                isCurrent: false
            )
        )
    }

    private func normalizedTimelineItems(
        _ items: [MovementLifeTimelineItem],
        referenceDate: Date
    ) -> [MovementLifeTimelineItem] {
        MovementTimelineDisplayNormalizer.normalize(items: items, referenceDate: referenceDate)
    }

    private func canonicalTimelineItems(
        _ items: [MovementLifeTimelineItem],
        liveOverlay: MovementLifeTimelineItem?,
        referenceDate: Date
    ) -> [MovementLifeTimelineItem] {
        MovementTimelineCanonicalNormalizer.normalize(
            items: items,
            liveOverlay: liveOverlay,
            referenceDate: referenceDate
        )
    }

    private func reload() async {
        _ = appModel.movementStore.runCoverageRepair(
            reason: "life timeline reload",
            referenceDate: timelineReferenceDate
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
            appModel.movementStore.cacheCanonicalProjectedBoxes(page.segments)
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
                    appModel.movementStore.cacheCanonicalProjectedBoxes(page.segments)
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
            appModel.movementStore.cacheCanonicalProjectedBoxes(
                page.segments + appModel.movementStore.cachedProjectedBoxes
            )
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
                    appModel.movementStore.cacheCanonicalProjectedBoxes(
                        page.segments + appModel.movementStore.cachedProjectedBoxes
                    )
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
        do {
            let payload = makeMovementUserBoxPayload(
                draft,
                metadataSource: creatingDraft != nil ? "companion-create" : "companion-edit"
            )
            switch draft.item.source {
            case .remoteUserBox(let boxId, _):
                _ = try await performMovementOperation(
                    reason: "life-timeline-save-editor-patch",
                    reconnectMessage: "Reconnect to Forge before editing historical movement."
                ) { pairing in
                    try await appModel.syncClient.patchMovementUserBox(
                        boxId: boxId,
                        patch: payload,
                        pairing: pairing
                    )
                }
                await reload()
            case .remoteAutomatic:
                throw NSError(
                    domain: "MovementLifeTimeline",
                    code: 4,
                    userInfo: [NSLocalizedDescriptionKey: "Automatic movement boxes cannot be edited. Invalidate them into missing data instead."]
                )
            case .liveStay, .liveTrip:
                _ = try await performMovementOperation(
                    reason: "life-timeline-save-editor-live",
                    reconnectMessage: "Reconnect to Forge before editing historical movement."
                ) { pairing in
                    try await appModel.syncClient.createMovementUserBox(
                        box: payload,
                        pairing: pairing
                    )
                }
                await reload()
            case .derived:
                _ = try await performMovementOperation(
                    reason: "life-timeline-save-editor-derived",
                    reconnectMessage: "Reconnect to Forge before creating a canonical movement box."
                ) { pairing in
                    try await appModel.syncClient.createMovementUserBox(
                        box: payload,
                        pairing: pairing
                    )
                }
                await reload()
            case .anchor:
                break
            }
            editorDraft = nil
            creatingDraft = nil
        } catch {
            companionDebugLog(
                "MovementLifeTimelineView",
                "saveEditor failed error=\(error.localizedDescription)"
            )
            loadError = error.localizedDescription
        }
    }

    private func makeMovementUserBoxPayload(
        _ draft: MovementTimelineEditorDraft,
        metadataSource: String
    ) -> ForgeMovementUserBoxPayload {
        let trimmedLabel = draft.label.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedPlace = draft.placeLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        let tags = draft.tags
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.isEmpty == false }
        return ForgeMovementUserBoxPayload(
            kind: draft.kind == .stay ? "stay" : draft.kind == .trip ? "trip" : "missing",
            startedAt: MovementTimelineFormatting.isoFormatter.string(from: draft.startedAt),
            endedAt: MovementTimelineFormatting.isoFormatter.string(from: draft.endedAt),
            title: trimmedLabel,
            subtitle:
                draft.kind == .missing
                ? "User-defined missing-data override."
                : "User-defined movement box.",
            placeLabel: draft.kind == .trip ? nil : .some(trimmedPlace.isEmpty ? nil : trimmedPlace),
            anchorExternalUid: nil,
            tags: tags,
            distanceMeters: draft.kind == .trip ? 150 : nil,
            averageSpeedMps: nil,
            metadata: ["updatedFrom": metadataSource]
        )
    }

    private func preflightEditor(
        _ draft: MovementTimelineEditorDraft
    ) async -> ForgeMovementUserBoxPreflight? {
        let rangeStart = segments.first?.startedAt
        let rangeEnd = segments.last?.endedAt
        let excludeBoxId: String?
        switch draft.item.source {
        case .remoteUserBox(let boxId, _):
            excludeBoxId = boxId
        default:
            excludeBoxId = nil
        }
        do {
            return try await performMovementOperation(
                reason: "life-timeline-preflight-editor",
                reconnectMessage: "Reconnect to Forge before editing historical movement."
            ) { pairing in
                try await appModel.syncClient.preflightMovementUserBox(
                    draft: ForgeMovementUserBoxPreflightPayload(
                        kind: draft.kind == .stay ? "stay" : draft.kind == .trip ? "trip" : "missing",
                        startedAt: MovementTimelineFormatting.isoFormatter.string(from: draft.startedAt),
                        endedAt: MovementTimelineFormatting.isoFormatter.string(from: draft.endedAt),
                        title: draft.label.trimmingCharacters(in: .whitespacesAndNewlines),
                        subtitle:
                            draft.kind == .missing
                            ? "User-defined missing-data override."
                            : "User-defined movement box.",
                        placeLabel: draft.kind == .trip ? nil : draft.placeLabel.trimmingCharacters(in: .whitespacesAndNewlines),
                        anchorExternalUid: nil,
                        tags: draft.tags
                            .split(separator: ",")
                            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                            .filter { $0.isEmpty == false },
                        distanceMeters: draft.kind == .trip ? 150 : nil,
                        averageSpeedMps: nil,
                        metadata: ["preflightFrom": "companion-life-timeline"],
                        excludeBoxId: excludeBoxId,
                        rangeStart: rangeStart,
                        rangeEnd: rangeEnd
                    ),
                    pairing: pairing
                )
            }
        } catch {
            return nil
        }
    }

    private func invalidateAutomaticItem(_ item: MovementLifeTimelineItem) async {
        guard case let .remoteAutomatic(boxId, _) = item.source else {
            return
        }
        do {
            _ = try await performMovementOperation(
                reason: "life-timeline-invalidate-automatic",
                reconnectMessage: "Reconnect to Forge before invalidating automatic movement."
            ) { pairing in
                try await appModel.syncClient.invalidateAutomaticMovementBox(
                    boxId: boxId,
                    payload: ForgeMovementUserBoxPayload(
                        kind: nil,
                        startedAt: nil,
                        endedAt: nil,
                        title: "User invalidated automatic movement",
                        subtitle: "Overrides this automatic movement box with missing data.",
                        placeLabel: nil,
                        anchorExternalUid: nil,
                        tags: ["user-invalidated", "missing-data"],
                        distanceMeters: nil,
                        averageSpeedMps: nil,
                        metadata: ["invalidatedFrom": "companion-life-timeline"]
                    ),
                    pairing: pairing
                )
            }
            await reload()
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func deleteUserDefinedItem(_ item: MovementLifeTimelineItem) async {
        guard case let .remoteUserBox(boxId, _) = item.source else {
            return
        }
        do {
            _ = try await performMovementOperation(
                reason: "life-timeline-delete-user-defined",
                reconnectMessage: "Reconnect to Forge before deleting historical movement."
            ) { pairing in
                try await appModel.syncClient.deleteMovementUserBox(
                    boxId: boxId,
                    pairing: pairing
                )
            }
            await reload()
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func flushQueuedModalIfPossible() {
        guard hasPresentedModal == false else {
            return
        }
        if let draft = queuedEditorDraft {
            companionDebugLog(
                "MovementLifeTimeline",
                "flushQueuedModal presenting queued editor item=\(movementTimelineLogDescriptor(for: draft.item))"
            )
            queuedEditorDraft = nil
            editorDraft = draft
            return
        }
        if let draft = queuedPlaceLabelDraft {
            companionDebugLog(
                "MovementLifeTimeline",
                "flushQueuedModal presenting queued place-label item=\(movementTimelineLogDescriptor(for: draft.item)) query=\(draft.query)"
            )
            queuedPlaceLabelDraft = nil
            placeLabelDraft = draft
            return
        }
        if let draft = queuedPlaceDraft {
            companionDebugLog(
                "MovementLifeTimeline",
                "flushQueuedModal presenting queued place-create item=\(movementTimelineLogDescriptor(for: draft.item)) label=\(draft.label)"
            )
            queuedPlaceDraft = nil
            placeDraft = draft
        }
    }

    private func openEditorDraft(for item: MovementLifeTimelineItem) {
        let draft = MovementTimelineEditorDraft(item: item)
        companionDebugLog(
            "MovementLifeTimeline",
            "openEditorDraft item=\(movementTimelineLogDescriptor(for: item)) queued=\(hasPresentedModal)"
        )
        if hasPresentedModal {
            queuedEditorDraft = draft
        } else {
            editorDraft = draft
        }
    }

    private func openPlaceLabelDraft(for item: MovementLifeTimelineItem) {
        guard item.kind == .stay else {
            companionDebugLog(
                "MovementLifeTimeline",
                "openPlaceLabelDraft skipped unsupported item=\(movementTimelineLogDescriptor(for: item))"
            )
            return
        }
        let draft = MovementTimelinePlaceLabelDraft(
            item: item,
            query: item.placeLabel?.isEmpty == false ? item.placeLabel! : item.displayTitle
        )
        companionDebugLog(
            "MovementLifeTimeline",
            "openPlaceLabelDraft item=\(movementTimelineLogDescriptor(for: item)) initialQuery=\(draft.query) queued=\(hasPresentedModal)"
        )
        if hasPresentedModal {
            queuedPlaceLabelDraft = draft
        } else {
            placeLabelDraft = draft
        }
    }

    private func openPlaceDraft(
        for item: MovementLifeTimelineItem,
        labelHint: String? = nil
    ) {
        guard item.kind == .stay, let coordinate = item.coordinate else {
            companionDebugLog(
                "MovementLifeTimeline",
                "openPlaceDraft skipped unsupported item=\(movementTimelineLogDescriptor(for: item))"
            )
            return
        }
        let draft = MovementTimelinePlaceDraft(
            item: item,
            label:
                labelHint?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
                ? labelHint!.trimmingCharacters(in: .whitespacesAndNewlines)
                : item.placeLabel?.isEmpty == false
                    ? item.placeLabel!
                : item.displayTitle,
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            radiusMeters: item.stayRadiusMeters(using: appModel.movementStore),
            tags: movementTimelineSeededCategoryTagsForNewPlace(from: item)
        )
        companionDebugLog(
            "MovementLifeTimeline",
            "openPlaceDraft item=\(movementTimelineLogDescriptor(for: item)) label=\(draft.label) latitude=\(draft.latitude) longitude=\(draft.longitude) radius=\(draft.radiusMeters) tags=\(draft.tags.joined(separator: "|")) queued=\(hasPresentedModal)"
        )
        if hasPresentedModal {
            queuedPlaceDraft = draft
        } else {
            placeDraft = draft
        }
    }

    private func rankedKnownPlaces(
        for item: MovementLifeTimelineItem
    ) -> [MovementSyncStore.StoredKnownPlace] {
        let places = appModel.movementStore.knownPlaces
        guard let draft = placeLabelDraft, draft.item.id == item.id else {
            return places.sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
        }
        let normalizedQuery = draft.query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let coordinate = item.coordinate
        return places
            .filter { place in
                guard normalizedQuery.isEmpty == false else {
                    return true
                }
                let haystack = (
                    [place.label] + place.aliases
                )
                    .joined(separator: " ")
                    .lowercased()
                return haystack.contains(normalizedQuery)
            }
            .sorted { left, right in
                if normalizedQuery.isEmpty == false {
                    let leftStartsWith = left.label.lowercased().hasPrefix(normalizedQuery)
                    let rightStartsWith = right.label.lowercased().hasPrefix(normalizedQuery)
                    if leftStartsWith != rightStartsWith {
                        return leftStartsWith && rightStartsWith == false
                    }
                }
                if let coordinate {
                    let leftDistance = CLLocation(
                        latitude: coordinate.latitude,
                        longitude: coordinate.longitude
                    ).distance(
                        from: CLLocation(latitude: left.latitude, longitude: left.longitude)
                    )
                    let rightDistance = CLLocation(
                        latitude: coordinate.latitude,
                        longitude: coordinate.longitude
                    ).distance(
                        from: CLLocation(latitude: right.latitude, longitude: right.longitude)
                    )
                    if abs(leftDistance - rightDistance) > 1 {
                        return leftDistance < rightDistance
                    }
                }
                return left.label.localizedCaseInsensitiveCompare(right.label) == .orderedAscending
            }
    }

    private func placeAssignmentDistanceMeters(
        from item: MovementLifeTimelineItem,
        to place: MovementSyncStore.StoredKnownPlace
    ) -> Double? {
        guard let coordinate = item.coordinate else {
            return nil
        }
        return CLLocation(
            latitude: coordinate.latitude,
            longitude: coordinate.longitude
        ).distance(
            from: CLLocation(latitude: place.latitude, longitude: place.longitude)
        )
    }

    @MainActor
    private func selectKnownPlace(
        _ place: MovementSyncStore.StoredKnownPlace,
        for item: MovementLifeTimelineItem
    ) async {
        if let distanceMeters = placeAssignmentDistanceMeters(from: item, to: place),
           distanceMeters > 100
        {
            companionDebugLog(
                "MovementLifeTimeline",
                level: .warn,
                "place label select-known warning item=\(movementTimelineLogDescriptor(for: item)) place=\(knownPlaceLogDescriptor(place)) distanceMeters=\(Int(distanceMeters.rounded()))"
            )
            pendingPlaceAssignmentWarning = MovementTimelinePlaceAssignmentWarning(
                item: item,
                place: place,
                distanceMeters: distanceMeters
            )
            return
        }
        await assignKnownPlace(place, to: item)
    }

    @MainActor
    private func assignKnownPlace(
        _ place: MovementSyncStore.StoredKnownPlace,
        to item: MovementLifeTimelineItem
    ) async {
        do {
            let linkedStayIds = item.rawStayIds.filter { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false }
            guard linkedStayIds.isEmpty == false else {
                throw NSError(
                    domain: "MovementLifeTimeline",
                    code: 9,
                    userInfo: [NSLocalizedDescriptionKey: "This stay cannot be linked to a saved location."]
                )
            }
            companionDebugLog(
                "MovementLifeTimeline",
                "assignKnownPlace start item=\(movementTimelineLogDescriptor(for: item)) place=\(knownPlaceLogDescriptor(place)) linkedStayIds=\(linkedStayIds.joined(separator: "|"))"
            )
            var learnedPlace: ForgeMovementTimelinePlace?
            for stayId in linkedStayIds {
                let patchedPlace = try await performMovementOperation(
                    reason: "life-timeline-assign-known-place",
                    reconnectMessage: "Reconnect to Forge before labeling stay locations."
                ) { pairing in
                    try await appModel.syncClient.patchMovementStay(
                        stayId: stayId,
                        placeExternalUid: place.externalUid,
                        placeLabel: place.label,
                        pairing: pairing
                    )
                }
                learnedPlace = patchedPlace ?? learnedPlace
            }

            if let learnedPlace {
                appModel.movementStore.storeKnownPlace(
                    MovementSyncStore.StoredKnownPlace(
                        id: learnedPlace.id,
                        externalUid: learnedPlace.externalUid,
                        label: learnedPlace.label,
                        aliases: learnedPlace.aliases,
                        latitude: learnedPlace.latitude,
                        longitude: learnedPlace.longitude,
                        radiusMeters: learnedPlace.radiusMeters,
                        categoryTags: learnedPlace.categoryTags,
                        visibility: learnedPlace.visibility,
                        wikiNoteId: learnedPlace.wikiNoteId,
                        metadata: [:]
                    )
                )
            }

            for stayId in item.linkableStayIds(using: appModel.movementStore) {
                appModel.movementStore.updateLocalStay(
                    id: stayId,
                    label: preservedStayTitle(for: item, fallbackPlaceLabel: place.label),
                    tags: item.tags,
                    placeLabel: place.label,
                    placeExternalUid: place.externalUid
                )
            }

            companionDebugLog(
                "MovementLifeTimeline",
                "assignKnownPlace complete item=\(movementTimelineLogDescriptor(for: item)) place=\(knownPlaceLogDescriptor(place)) linkedStayIds=\(item.linkableStayIds(using: appModel.movementStore).joined(separator: "|"))"
            )
            placeLabelDraft = nil
            await reload()
        } catch {
            companionDebugLog(
                "MovementLifeTimeline",
                level: .error,
                "assignKnownPlace failed item=\(movementTimelineLogDescriptor(for: item)) place=\(knownPlaceLogDescriptor(place)) error=\(error.localizedDescription)"
            )
            loadError = error.localizedDescription
        }
    }

    private func makePlaceLabelUserBoxPayload(
        for item: MovementLifeTimelineItem,
        placeLabel: String,
        metadataSource: String
    ) -> ForgeMovementUserBoxPayload {
        let trimmedPlaceLabel = placeLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        let tags = item.tags.filter { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false }
        return ForgeMovementUserBoxPayload(
            kind: "stay",
            startedAt: MovementTimelineFormatting.isoFormatter.string(from: item.startedAtDate),
            endedAt: MovementTimelineFormatting.isoFormatter.string(from: item.endedAtDate),
            title: preservedStayTitle(for: item, fallbackPlaceLabel: trimmedPlaceLabel),
            subtitle: "User-defined movement box.",
            placeLabel: .some(trimmedPlaceLabel.isEmpty ? nil : trimmedPlaceLabel),
            anchorExternalUid: nil,
            tags: tags,
            distanceMeters: nil,
            averageSpeedMps: nil,
            metadata: ["updatedFrom": metadataSource]
        )
    }

    private func preservedStayTitle(
        for item: MovementLifeTimelineItem,
        fallbackPlaceLabel: String
    ) -> String {
        let linkedStayIds = item.linkableStayIds(using: appModel.movementStore)
        if let localLabel = appModel.movementStore.storedStays
            .first(where: { linkedStayIds.contains($0.id) })?
            .label
            .trimmingCharacters(in: .whitespacesAndNewlines),
           localLabel.isEmpty == false
        {
            return localLabel
        }

        let baseTitle = item.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if baseTitle.isEmpty == false, baseTitle.lowercased() != "stay" {
            return baseTitle
        }
        return fallbackPlaceLabel
    }

    private func openDetail(_ item: MovementLifeTimelineItem) async {
        detailLoading = true
        defer { detailLoading = false }
        do {
            companionDebugLog(
                "MovementLifeTimeline",
                "openDetail start item=\(movementTimelineLogDescriptor(for: item))"
            )
            if let boxId = item.boxId {
                let detail = try await performMovementOperation(
                    reason: "life-timeline-open-detail",
                    reconnectMessage: "Reconnect to Forge before loading stay details."
                ) { pairing in
                    try await appModel.syncClient.fetchMovementBoxDetail(
                        boxId: boxId,
                        pairing: pairing
                    )
                }
                detailSnapshot = MovementTimelineDetailSnapshot(
                    detail: detail,
                    itemId: item.id
                )
                companionDebugLog(
                    "MovementLifeTimeline",
                    "openDetail remote success item=\(movementTimelineLogDescriptor(for: item)) boxId=\(boxId)"
                )
                return
            }
            detailSnapshot = MovementTimelineDetailSnapshot(
                item: item,
                movementStore: appModel.movementStore
            )
            companionDebugLog(
                "MovementLifeTimeline",
                "openDetail local success item=\(movementTimelineLogDescriptor(for: item))"
            )
        } catch {
            companionDebugLog(
                "MovementLifeTimeline",
                "openDetail failed item=\(movementTimelineLogDescriptor(for: item)) error=\(error.localizedDescription)"
            )
            loadError = error.localizedDescription
        }
    }

    @MainActor
    private func savePlaceDraft(_ draft: MovementTimelinePlaceDraft) async {
        do {
            companionDebugLog(
                "MovementLifeTimeline",
                "savePlaceDraft start item=\(movementTimelineLogDescriptor(for: draft.item)) label=\(draft.label) latitude=\(draft.latitude) longitude=\(draft.longitude) radius=\(draft.radiusMeters) tags=\(draft.tags.joined(separator: "|"))"
            )
            let place = try await performMovementOperation(
                reason: "life-timeline-save-place",
                reconnectMessage: "Reconnect to Forge before creating locations."
            ) { pairing in
                try await appModel.syncClient.createMovementPlace(
                    label: draft.label.trimmingCharacters(in: .whitespacesAndNewlines),
                    latitude: draft.latitude,
                    longitude: draft.longitude,
                    categoryTags: draft.tags,
                    pairing: pairing
                )
            }

            let storedPlace = MovementSyncStore.StoredKnownPlace(
                id: place.id,
                externalUid: place.externalUid,
                label: place.label,
                aliases: place.aliases,
                latitude: place.latitude,
                longitude: place.longitude,
                radiusMeters: place.radiusMeters,
                categoryTags: place.categoryTags,
                visibility: place.visibility,
                wikiNoteId: place.wikiNoteId,
                metadata: [:]
            )
            appModel.movementStore.storeKnownPlace(storedPlace)
            companionDebugLog(
                "MovementLifeTimeline",
                "savePlaceDraft created remote place item=\(movementTimelineLogDescriptor(for: draft.item)) place=\(knownPlaceLogDescriptor(storedPlace))"
            )

            placeDraft = nil
            await assignKnownPlace(storedPlace, to: draft.item)
        } catch {
            companionDebugLog(
                "MovementLifeTimeline",
                "savePlaceDraft failed item=\(movementTimelineLogDescriptor(for: draft.item)) label=\(draft.label) error=\(error.localizedDescription)"
            )
            loadError = error.localizedDescription
        }
    }

    private func resolveMovementPairing(
        reason: String,
        reconnectMessage: String
    ) async throws -> PairingPayload {
        let resolvedPairing = await appModel.ensureActivePairingIfPossible(reason: reason) ?? appModel.pairing
        guard let pairing = resolvedPairing else {
            companionDebugLog(
                "MovementLifeTimeline",
                "resolveMovementPairing missing reason=\(reason)"
            )
            throw NSError(
                domain: "MovementLifeTimeline",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: reconnectMessage]
            )
        }
        companionDebugLog(
            "MovementLifeTimeline",
            "resolveMovementPairing success reason=\(reason) session=\(pairing.sessionId) expiresAt=\(pairing.expiresAt)"
        )
        return pairing
    }

    private func performMovementOperation<Result>(
        reason: String,
        reconnectMessage: String,
        operation: (PairingPayload) async throws -> Result
    ) async throws -> Result {
        companionDebugLog("MovementLifeTimeline", "performMovementOperation start reason=\(reason)")
        let pairing = try await resolveMovementPairing(
            reason: reason,
            reconnectMessage: reconnectMessage
        )
        do {
            let result = try await operation(pairing)
            companionDebugLog(
                "MovementLifeTimeline",
                "performMovementOperation success reason=\(reason) session=\(pairing.sessionId)"
            )
            return result
        } catch {
            companionDebugLog(
                "MovementLifeTimeline",
                "performMovementOperation failed reason=\(reason) session=\(pairing.sessionId) error=\(error.localizedDescription)"
            )
            guard error.localizedDescription.localizedCaseInsensitiveContains("pairing session expired"),
                  let renewedPairing = await appModel.ensureActivePairingIfPossible(
                    reason: "\(reason)-expired",
                    forceRenewal: true
                  )
            else {
                throw error
            }
            companionDebugLog(
                "MovementLifeTimeline",
                "performMovementOperation renewing pairing reason=\(reason) oldSession=\(pairing.sessionId) newSession=\(renewedPairing.sessionId)"
            )
            let result = try await operation(renewedPairing)
            companionDebugLog(
                "MovementLifeTimeline",
                "performMovementOperation renewed success reason=\(reason) session=\(renewedPairing.sessionId)"
            )
            return result
        }
    }

    private func movementTimelineLogDescriptor(for item: MovementLifeTimelineItem) -> String {
        let coordinateLabel: String
        if let coordinate = item.coordinate {
            coordinateLabel = "\(coordinate.latitude),\(coordinate.longitude)"
        } else {
            coordinateLabel = "nil"
        }
        return "id=\(item.id) kind=\(movementTimelineKindLabel(item.kind)) source=\(item.sourceKind) boxId=\(item.boxId ?? "nil") title=\(item.displayTitle) placeLabel=\(item.placeLabel ?? "nil") coordinate=\(coordinateLabel)"
    }

    private func knownPlaceLogDescriptor(_ place: MovementSyncStore.StoredKnownPlace) -> String {
        "id=\(place.id) externalUid=\(place.externalUid) label=\(place.label) latitude=\(place.latitude) longitude=\(place.longitude) tags=\(place.categoryTags.joined(separator: "|"))"
    }

    private func movementTimelinePlaceLabelOperationLabel(
        _ operation: MovementTimelinePlaceLabelOperation
    ) -> String {
        switch operation {
        case .createUserBox:
            return "createUserBox"
        case .patchUserBox(let boxId):
            return "patchUserBox(\(boxId))"
        case .unsupported:
            return "unsupported"
        }
    }

    private func movementTimelineKindLabel(_ kind: MovementLifeTimelineItem.Kind) -> String {
        switch kind {
        case .stay:
            return "stay"
        case .trip:
            return "trip"
        case .missing:
            return "missing"
        case .anchor:
            return "anchor"
        }
    }
}

struct MovementTimelineDetailCoordinate: Identifiable, Hashable {
    let id: String
    let latitude: Double
    let longitude: Double
    let label: String
    let recordedAt: Date?
    let speedMps: Double?

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

enum MovementTimelinePlaceLabelOperation: Equatable {
    case createUserBox
    case patchUserBox(String)
    case unsupported
}

func movementTimelinePlaceLabelOperation(
    for item: MovementLifeTimelineItem
) -> MovementTimelinePlaceLabelOperation {
    guard item.kind == .stay else {
        return .unsupported
    }
    switch item.source {
    case .remoteUserBox(let boxId, _):
        return .patchUserBox(boxId)
    case .remoteAutomatic, .liveStay, .derived:
        return .createUserBox
    case .liveTrip, .anchor:
        return .unsupported
    }
}

func movementTimelineSeededCategoryTagsForNewPlace(
    from item: MovementLifeTimelineItem
) -> [String] {
    let blockedTags: Set<String> = [
        "movement",
        "stay",
        "trip",
        "continued-stay",
        "repaired-gap",
        "repaired-from-trip",
        "repaired_from_trip",
        "suppressed-short-jump",
        "under-distance-threshold",
        "boundary-incomplete",
        "trailing-gap"
    ]
    return item.tags.filter { tag in
        let normalized = tag
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "_", with: "-")
        guard normalized.isEmpty == false else {
            return false
        }
        if blockedTags.contains(normalized) {
            return false
        }
        if normalized.hasPrefix("repaired-") {
            return false
        }
        return true
    }
}

private struct MovementTimelinePlaceDraft: Identifiable {
    let item: MovementLifeTimelineItem
    var label: String
    var latitude: Double
    var longitude: Double
    var radiusMeters: Double
    var tags: [String]

    var id: String {
        item.id
    }
}

private struct MovementTimelinePlaceLabelDraft: Identifiable {
    let item: MovementLifeTimelineItem
    var query: String

    var id: String {
        item.id
    }
}

private struct MovementTimelinePlaceAssignmentWarning: Identifiable {
    let id = UUID()
    let item: MovementLifeTimelineItem
    let place: MovementSyncStore.StoredKnownPlace
    let distanceMeters: Double

    var formattedDistance: String {
        if distanceMeters >= 1000 {
            return String(format: "%.1f km", distanceMeters / 1000)
        }
        return "\(Int(distanceMeters.rounded())) m"
    }
}

struct MovementTimelineDetailSnapshot: Identifiable {
    enum Kind {
        case stay
        case trip
        case missing
    }

    let itemId: String
    let title: String
    let subtitle: String
    let kind: Kind
    let startedAt: Date
    let endedAt: Date
    let durationSeconds: Int
    let rawStayCount: Int
    let rawTripCount: Int
    let rawPointCount: Int
    let placeLabel: String?
    let stayPositions: [MovementTimelineDetailCoordinate]
    let averagePosition: MovementTimelineDetailCoordinate?
    let stayRadiusMeters: Double?
    let sampleCount: Int
    let tripPositions: [MovementTimelineDetailCoordinate]
    let tripStartPosition: MovementTimelineDetailCoordinate?
    let tripEndPosition: MovementTimelineDetailCoordinate?
    let tripDistanceMeters: Double?
    let tripMovingSeconds: Int?
    let tripIdleSeconds: Int?
    let averageSpeedMps: Double?
    let maxSpeedMps: Double?
    let stopCount: Int?
    let canLabelPlace: Bool
    let editable: Bool

    var id: String { itemId }

    init(detail: ForgeMovementBoxDetail, itemId: String) {
        let segment = detail.segment
        self.itemId = itemId
        self.title = segment.title
        self.subtitle = segment.subtitle
        self.kind = segment.kind == "stay" ? .stay : segment.kind == "trip" ? .trip : .missing
        self.startedAt = MovementTimelineFormatting.parse(segment.startedAt)
        self.endedAt = MovementTimelineFormatting.parse(segment.endedAt)
        self.durationSeconds = segment.durationSeconds
        self.rawStayCount = detail.rawStays.count
        self.rawTripCount = detail.rawTrips.count
        self.rawPointCount = detail.segment.rawPointCount
        self.placeLabel = detail.stayDetail?.canonicalPlace?.label ?? segment.placeLabel
        self.stayPositions = detail.stayDetail?.positions.enumerated().map { index, position in
            MovementTimelineDetailCoordinate(
                id: "stay-\(index)",
                latitude: position.latitude,
                longitude: position.longitude,
                label: position.label ?? "Position \(index + 1)",
                recordedAt: position.recordedAt.flatMap(MovementTimelineFormatting.isoFormatter.date(from:)),
                speedMps: position.speedMps
            )
        } ?? []
        self.averagePosition = detail.stayDetail?.averagePosition.map {
            MovementTimelineDetailCoordinate(
                id: "average",
                latitude: $0.latitude,
                longitude: $0.longitude,
                label: $0.label ?? "Average position",
                recordedAt: nil,
                speedMps: nil
            )
        }
        self.stayRadiusMeters = detail.stayDetail?.radiusMeters
        self.sampleCount = detail.stayDetail?.sampleCount ?? 0
        self.tripPositions = detail.tripDetail?.positions.enumerated().map { index, position in
            MovementTimelineDetailCoordinate(
                id: "trip-\(index)",
                latitude: position.latitude,
                longitude: position.longitude,
                label: position.label ?? "Point \(index + 1)",
                recordedAt: position.recordedAt.flatMap(MovementTimelineFormatting.isoFormatter.date(from:)),
                speedMps: position.speedMps
            )
        } ?? []
        self.tripStartPosition = detail.tripDetail?.startPosition.map {
            MovementTimelineDetailCoordinate(
                id: "trip-start",
                latitude: $0.latitude,
                longitude: $0.longitude,
                label: $0.label ?? "Start position",
                recordedAt: $0.recordedAt.flatMap(MovementTimelineFormatting.isoFormatter.date(from:)),
                speedMps: $0.speedMps
            )
        }
        self.tripEndPosition = detail.tripDetail?.endPosition.map {
            MovementTimelineDetailCoordinate(
                id: "trip-end",
                latitude: $0.latitude,
                longitude: $0.longitude,
                label: $0.label ?? "End position",
                recordedAt: $0.recordedAt.flatMap(MovementTimelineFormatting.isoFormatter.date(from:)),
                speedMps: $0.speedMps
            )
        }
        self.tripDistanceMeters = detail.tripDetail?.totalDistanceMeters
        self.tripMovingSeconds = detail.tripDetail?.movingSeconds
        self.tripIdleSeconds = detail.tripDetail?.idleSeconds
        self.averageSpeedMps = detail.tripDetail?.averageSpeedMps
        self.maxSpeedMps = detail.tripDetail?.maxSpeedMps
        self.stopCount = detail.tripDetail?.stopCount
        self.canLabelPlace = kind == .stay
        self.editable = segment.editable
    }

    @MainActor
    init(item: MovementLifeTimelineItem, movementStore: MovementSyncStore) {
        self.itemId = item.id
        self.title = item.displayTitle
        self.subtitle = item.subtitle
        self.kind = item.kind == .stay ? .stay : item.kind == .trip ? .trip : .missing
        self.startedAt = item.startedAtDate
        self.endedAt = item.endedAtDate
        self.durationSeconds = item.durationSeconds
        let stays = movementStore.storedStays.filter { item.linkableStayIds(using: movementStore).contains($0.id) }
        let trips = movementStore.storedTrips.filter {
            item.rawTripIds.contains($0.id) || item.rawTripIds.contains($0.id.replacingOccurrences(of: "trip_", with: ""))
        }
        self.rawStayCount = stays.count
        self.rawTripCount = trips.count
        self.rawPointCount = trips.reduce(0) { $0 + $1.points.count }
        self.placeLabel = item.placeLabel
        var localStayPositions = stays.enumerated().map { index, stay in
            MovementTimelineDetailCoordinate(
                id: "local-stay-\(stay.id)",
                latitude: stay.centerLatitude,
                longitude: stay.centerLongitude,
                label: stay.placeLabel.isEmpty ? "Position \(index + 1)" : stay.placeLabel,
                recordedAt: stay.startedAt,
                speedMps: nil
            )
        }
        if localStayPositions.isEmpty, let coordinate = item.coordinate {
            localStayPositions = [
                MovementTimelineDetailCoordinate(
                    id: "fallback-stay",
                    latitude: coordinate.latitude,
                    longitude: coordinate.longitude,
                    label: item.displayTitle,
                    recordedAt: item.startedAtDate,
                    speedMps: nil
                )
            ]
        }
        self.stayPositions = localStayPositions
        if localStayPositions.isEmpty == false {
            let avgLatitude = localStayPositions.map(\.latitude).reduce(0, +) / Double(localStayPositions.count)
            let avgLongitude = localStayPositions.map(\.longitude).reduce(0, +) / Double(localStayPositions.count)
            self.averagePosition = MovementTimelineDetailCoordinate(
                id: "local-average",
                latitude: avgLatitude,
                longitude: avgLongitude,
                label: "Average position",
                recordedAt: nil,
                speedMps: nil
            )
        } else {
            self.averagePosition = nil
        }
        self.stayRadiusMeters = item.stayRadiusMeters(using: movementStore)
        self.sampleCount = stays.map(\.sampleCount).reduce(0, +)
        let localTripPositions = trips
            .flatMap(\.points)
            .sorted(by: { $0.recordedAt < $1.recordedAt })
            .enumerated()
            .map { index, point in
                MovementTimelineDetailCoordinate(
                    id: "local-trip-\(point.id)",
                    latitude: point.latitude,
                    longitude: point.longitude,
                    label: index == 0 ? "Start position" : "Point \(index + 1)",
                    recordedAt: point.recordedAt,
                    speedMps: point.speedMps
                )
            }
        self.tripPositions = localTripPositions
        self.tripStartPosition = localTripPositions.first
        self.tripEndPosition = localTripPositions.last
        self.tripDistanceMeters = trips.isEmpty ? item.distanceMeters : trips.map(\.distanceMeters).reduce(0, +)
        self.tripMovingSeconds = trips.isEmpty ? nil : trips.map(\.movingSeconds).reduce(0, +)
        self.tripIdleSeconds = trips.isEmpty ? nil : trips.map(\.idleSeconds).reduce(0, +)
        self.averageSpeedMps = trips.isEmpty ? item.averageSpeedMps : trips.compactMap(\.averageSpeedMps).last
        self.maxSpeedMps = trips.isEmpty ? nil : trips.compactMap(\.maxSpeedMps).max()
        self.stopCount = trips.isEmpty ? nil : trips.map { $0.stops.count }.reduce(0, +)
        self.canLabelPlace = kind == .stay
        self.editable = item.editable
    }
}

private struct MovementTimelinePlaceSheet: View {
    @State var draft: MovementTimelinePlaceDraft
    let close: () -> Void
    let save: (MovementTimelinePlaceDraft) async -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("Location details") {
                    TextField("Label", text: $draft.label)
                    TextField("Latitude", value: $draft.latitude, format: .number.precision(.fractionLength(6)))
                    TextField("Longitude", value: $draft.longitude, format: .number.precision(.fractionLength(6)))
                }
                Section("Optional details") {
                    TextField("Radius meters", value: $draft.radiusMeters, format: .number.precision(.fractionLength(0)))
                    TextField(
                        "Category tags",
                        text: Binding(
                            get: { draft.tags.joined(separator: ", ") },
                            set: { draft.tags = $0.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { $0.isEmpty == false } }
                        )
                    )
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                }
            }
            .navigationTitle("Create Location")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") {
                        companionDebugLog(
                            "MovementLifeTimeline",
                            "place create cancel item=\(draft.item.id) label=\(draft.label)"
                        )
                        close()
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Create") {
                        companionDebugLog(
                            "MovementLifeTimeline",
                            "place create tap item=\(draft.item.id) label=\(draft.label) latitude=\(draft.latitude) longitude=\(draft.longitude) radius=\(draft.radiusMeters) tags=\(draft.tags.joined(separator: "|"))"
                        )
                        Task {
                            await save(draft)
                        }
                    }
                    .disabled(draft.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}

private struct MovementTimelinePlaceLabelSheet: View {
    @State var draft: MovementTimelinePlaceLabelDraft
    let knownPlaces: [MovementSyncStore.StoredKnownPlace]
    let close: () -> Void
    let selectPlace: (MovementSyncStore.StoredKnownPlace) async -> Void
    let createNewPlace: (String) -> Void

    private var coordinate: MovementTimelineCoordinate? {
        draft.item.coordinate
    }

    private var hasExactMatch: Bool {
        let normalizedQuery = draft.query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard normalizedQuery.isEmpty == false else {
            return false
        }
        return knownPlaces.contains { $0.label.lowercased() == normalizedQuery }
    }

    var body: some View {
        NavigationStack {
            List {
                if let coordinate {
                    Section("Stay center") {
                        detailRow("Latitude", coordinate.latitude.formatted(.number.precision(.fractionLength(6))))
                        detailRow("Longitude", coordinate.longitude.formatted(.number.precision(.fractionLength(6))))
                    }
                }

                Section("Label name") {
                    TextField("Type a label name or pick an existing location", text: $draft.query)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                }

                Section("Matching saved locations") {
                    if knownPlaces.isEmpty {
                        Text("No saved places match yet.")
                            .font(.system(size: 14, weight: .medium, design: .rounded))
                            .foregroundStyle(CompanionStyle.textSecondary)
                    } else {
                        ForEach(knownPlaces) { place in
                            Button {
                                companionDebugLog(
                                    "MovementLifeTimeline",
                                    "place label select-known tap item=\(draft.item.id) place=\(place.label) externalUid=\(place.externalUid)"
                                )
                                Task {
                                    await selectPlace(place)
                                }
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack(alignment: .center, spacing: 8) {
                                        Text(place.label)
                                            .font(.system(size: 15, weight: .semibold, design: .rounded))
                                            .foregroundStyle(CompanionStyle.textPrimary)
                                        if let coordinate {
                                            Text(
                                                movementKnownPlaceDistanceLabel(
                                                    from: coordinate,
                                                    to: place
                                                )
                                            )
                                            .font(.system(size: 11, weight: .bold, design: .rounded))
                                            .foregroundStyle(CompanionStyle.textMuted)
                                            .padding(.horizontal, 8)
                                            .padding(.vertical, 4)
                                            .background(Color.white.opacity(0.06), in: Capsule())
                                        }
                                    }
                                    if place.aliases.isEmpty == false || place.categoryTags.isEmpty == false {
                                        Text((place.aliases + place.categoryTags).joined(separator: " · "))
                                            .font(.system(size: 12, weight: .medium, design: .rounded))
                                            .foregroundStyle(CompanionStyle.textSecondary)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Set Location Label")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") {
                        companionDebugLog(
                            "MovementLifeTimeline",
                            "place label cancel item=\(draft.item.id) query=\(draft.query)"
                        )
                        close()
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(hasExactMatch == false && draft.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? "Create \"\(draft.query.trimmingCharacters(in: .whitespacesAndNewlines))\"" : "Create Label") {
                        companionDebugLog(
                            "MovementLifeTimeline",
                            "place label create-new tap item=\(draft.item.id) query=\(draft.query.trimmingCharacters(in: .whitespacesAndNewlines)) hasExactMatch=\(hasExactMatch)"
                        )
                        createNewPlace(
                            draft.query.trimmingCharacters(in: .whitespacesAndNewlines)
                        )
                    }
                    .disabled(coordinate == nil)
                }
            }
        }
    }

    private func detailRow(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundStyle(CompanionStyle.textMuted)
            Text(value)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .foregroundStyle(CompanionStyle.textPrimary)
        }
        .padding(.vertical, 2)
    }

    private func movementKnownPlaceDistanceLabel(
        from coordinate: MovementTimelineCoordinate,
        to place: MovementSyncStore.StoredKnownPlace
    ) -> String {
        let meters = CLLocation(
            latitude: coordinate.latitude,
            longitude: coordinate.longitude
        ).distance(
            from: CLLocation(latitude: place.latitude, longitude: place.longitude)
        )
        if meters >= 1000 {
            return String(format: "%.1f km away", meters / 1000)
        }
        return "\(Int(meters.rounded())) m away"
    }
}

private struct MovementTimelineDetailSheet: View {
    let snapshot: MovementTimelineDetailSnapshot
    let loading: Bool
    let definePlace: () -> Void
    let edit: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if loading {
                        ProgressView("Loading movement detail…")
                            .tint(CompanionStyle.accentStrong)
                    }

                    Group {
                        detailCard("Started", snapshot.startedAt.formatted(.dateTime.day().month(.abbreviated).year().hour().minute()))
                        detailCard("Ended", snapshot.endedAt.formatted(.dateTime.day().month(.abbreviated).year().hour().minute()))
                        detailCard("Duration", MovementTimelineFormatting.durationLabel(snapshot.durationSeconds))
                        detailCard("Raw coverage", "\(snapshot.rawStayCount) stays · \(snapshot.rawTripCount) trips · \(snapshot.rawPointCount) points")
                    }

                    if snapshot.kind == .stay {
                        if snapshot.canLabelPlace {
                            Button("Label location") {
                                definePlace()
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(CompanionStyle.accentStrong)
                        }
                        MovementTimelineMapCard(
                            title: "Stay map",
                            coordinates: snapshot.stayPositions,
                            averagePosition: snapshot.averagePosition
                        )
                        detailCard("Location", snapshot.placeLabel ?? "Not linked yet")
                        if let averagePosition = snapshot.averagePosition {
                            detailCard("Average position", averagePosition.latitude.formatted(.number.precision(.fractionLength(6))) + ", " + averagePosition.longitude.formatted(.number.precision(.fractionLength(6))))
                        }
                        if let radius = snapshot.stayRadiusMeters {
                            detailCard("Radius", "\(Int(radius.rounded())) m")
                        }
                        detailCard("Samples", "\(snapshot.sampleCount)")
                        if snapshot.stayPositions.isEmpty == false {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Exact positions")
                                    .font(.system(size: 13, weight: .bold, design: .rounded))
                                    .foregroundStyle(CompanionStyle.textPrimary)
                                ForEach(snapshot.stayPositions) { position in
                                    Text("\(position.label): \(position.latitude.formatted(.number.precision(.fractionLength(6)))), \(position.longitude.formatted(.number.precision(.fractionLength(6))))")
                                        .font(.system(size: 12, weight: .medium, design: .rounded))
                                        .foregroundStyle(CompanionStyle.textSecondary)
                                }
                            }
                        }
                    } else if snapshot.kind == .trip {
                        MovementTimelineMapCard(
                            title: "Travel map",
                            coordinates: snapshot.tripPositions,
                            averagePosition: nil
                        )
                        if let start = snapshot.tripStartPosition {
                            detailCard("Start position", "\(start.latitude.formatted(.number.precision(.fractionLength(6)))), \(start.longitude.formatted(.number.precision(.fractionLength(6))))")
                        }
                        if let end = snapshot.tripEndPosition {
                            detailCard("End position", "\(end.latitude.formatted(.number.precision(.fractionLength(6)))), \(end.longitude.formatted(.number.precision(.fractionLength(6))))")
                        }
                        if let distance = snapshot.tripDistanceMeters {
                            detailCard("Distance", "\(String(format: "%.2f", distance / 1000)) km")
                        }
                        if let moving = snapshot.tripMovingSeconds {
                            detailCard("Moving time", MovementTimelineFormatting.durationLabel(moving))
                        }
                        if let idle = snapshot.tripIdleSeconds {
                            detailCard("Idle time", MovementTimelineFormatting.durationLabel(idle))
                        }
                        if let speed = snapshot.averageSpeedMps {
                            detailCard("Average speed", "\(String(format: "%.2f", speed)) m/s")
                        }
                        if let speed = snapshot.maxSpeedMps {
                            detailCard("Max speed", "\(String(format: "%.2f", speed)) m/s")
                        }
                        if let stopCount = snapshot.stopCount {
                            detailCard("Stops", "\(stopCount)")
                        }
                    }
                }
                .padding(16)
            }
            .background(CompanionStyle.background)
            .navigationTitle(snapshot.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if snapshot.editable {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Edit", action: edit)
                            .disabled(snapshot.kind == .missing)
                    }
                }
            }
        }
    }

    private func detailCard(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased())
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundStyle(CompanionStyle.textMuted)
            Text(value)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .foregroundStyle(CompanionStyle.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(CompanionStyle.sheetBackground(cornerRadius: 22))
    }
}

private struct MovementTimelineMapCard: View {
    let title: String
    let coordinates: [MovementTimelineDetailCoordinate]
    let averagePosition: MovementTimelineDetailCoordinate?

    var body: some View {
        let region = movementDetailRegion(
            coordinates: coordinates,
            averagePosition: averagePosition
        )
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(CompanionStyle.textPrimary)
            Map(initialPosition: .region(region)) {
                if coordinates.count > 1 {
                    MapPolyline(coordinates: coordinates.map(\.coordinate))
                        .stroke(CompanionStyle.accentStrong, lineWidth: 4)
                }
                ForEach(coordinates) { coordinate in
                    Annotation(coordinate.label, coordinate: coordinate.coordinate) {
                        Circle()
                            .fill(Color.white)
                            .frame(width: 10, height: 10)
                            .overlay(
                                Circle()
                                    .stroke(CompanionStyle.accentStrong.opacity(0.5), lineWidth: 2)
                            )
                    }
                }
                if let averagePosition {
                    Annotation("Average", coordinate: averagePosition.coordinate) {
                        Circle()
                            .fill(Color.yellow)
                            .frame(width: 12, height: 12)
                    }
                }
            }
            .allowsHitTesting(false)
            .frame(height: 220)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .padding(14)
        .background(CompanionStyle.sheetBackground(cornerRadius: 22))
    }
}

private func movementDetailRegion(
    coordinates: [MovementTimelineDetailCoordinate],
    averagePosition: MovementTimelineDetailCoordinate?
) -> MKCoordinateRegion {
    let points = coordinates + (averagePosition.map { [$0] } ?? [])
    guard let first = points.first else {
        return MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 0, longitude: 0),
            span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02)
        )
    }
    let latitudes = points.map(\.latitude)
    let longitudes = points.map(\.longitude)
    let minLat = latitudes.min() ?? first.latitude
    let maxLat = latitudes.max() ?? first.latitude
    let minLng = longitudes.min() ?? first.longitude
    let maxLng = longitudes.max() ?? first.longitude
    return MKCoordinateRegion(
        center: CLLocationCoordinate2D(
            latitude: (minLat + maxLat) / 2,
            longitude: (minLng + maxLng) / 2
        ),
        span: MKCoordinateSpan(
            latitudeDelta: max(0.01, (maxLat - minLat) * 1.8),
            longitudeDelta: max(0.01, (maxLng - minLng) * 1.8)
        )
    )
}

private struct MovementTimelineRow: View {
    let item: MovementLifeTimelineItem
    let width: CGFloat
    let isSelected: Bool
    let onSelect: () -> Void
    let onEdit: () -> Void
    let onDetail: () -> Void
    let onDefinePlace: () -> Void
    let onDelete: () -> Void

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
                Text(item.displayTitle)
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
                if item.origin == .userDefined || item.origin == .userInvalidated {
                    Text(item.origin == .userInvalidated ? "USER INVALIDATED" : "USER")
                        .font(.system(size: 9, weight: .black, design: .rounded))
                        .foregroundStyle(Color.white.opacity(0.74))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.pink.opacity(0.18), in: Capsule())
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
                detailRow("Location", placeLabel)
            }
            if let distance = item.distanceMeters {
                detailRow("Distance", "\(String(format: "%.1f", distance / 1000)) km")
            }
            if let speed = item.averageSpeedMps {
                detailRow("Avg speed", "\(String(format: "%.1f", speed)) m/s")
            }
            detailRow("Sync source", item.syncSource.capitalized)
            detailRow("Box source", item.sourceKind == "user_defined" ? "User-defined" : "Automatic")
            if item.overrideCount > 0 {
                detailRow("Overrides", "\(item.overrideCount) automatic boxes")
            }
            detailRow(
                "Projection",
                "Raw phone measurements stay immutable. Forge projects automatic boxes from raw evidence, then overlays user-defined boxes without mutating the imported raw data."
            )
            detailRow("Raw stays", "\(item.rawStayIds.count)")
            detailRow("Raw trips", "\(item.rawTripIds.count)")
            detailRow("Raw points", "\(item.rawPointCount)")
            if item.hasLegacyCorrections {
                detailRow("Legacy corrections", "Present")
            }
            if item.tags.isEmpty == false {
                FlowTagCloud(tags: item.tags)
            }
            if item.kind == .stay {
                Button("Label location") {
                    onDefinePlace()
                }
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(CompanionStyle.textPrimary)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Color.blue.opacity(0.16), in: Capsule())
                .overlay(
                    Capsule()
                        .stroke(Color.blue.opacity(0.22), lineWidth: 1)
                )
                .buttonStyle(.plain)
            }
            HStack {
                Spacer()
                HStack(spacing: 8) {
                    Button("Details") {
                        onDetail()
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
                    if item.sourceKind == "user_defined" {
                        Button("Delete") {
                            onDelete()
                        }
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(Color.red.opacity(0.92))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .background(Color.red.opacity(0.12), in: Capsule())
                        .overlay(
                            Capsule()
                                .stroke(Color.red.opacity(0.18), lineWidth: 1)
                        )
                        .buttonStyle(.plain)
                        .disabled(item.kind == .anchor || item.editable == false)
                    }
                    Button(item.sourceKind == "automatic" ? "Invalidate" : "Edit") {
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
                    .disabled(item.kind == .anchor || (item.sourceKind != "automatic" && item.editable == false))
                }
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
                        Text(
                            "\(item.startedAtDate.formatted(.dateTime.hour().minute())) → \(item.isCurrent ? "Now" : item.endedAtDate.formatted(.dateTime.hour().minute()))"
                        )
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(CompanionStyle.textSecondary)
                    }
                    .padding(16)
                }
                .overlay(alignment: .center) {
                    VStack(spacing: 8) {
                        Text(item.displayTitle)
                            .font(.system(size: item.isCurrent ? 17 : 16, weight: .bold, design: .rounded))
                            .foregroundStyle(CompanionStyle.textPrimary)
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                            .padding(.horizontal, 20)
                        if let placeLabel = item.secondaryPlaceLabel {
                            Text(placeLabel)
                                .font(.system(size: 11, weight: .bold, design: .rounded))
                                .foregroundStyle(CompanionStyle.textPrimary)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(Color.white.opacity(0.12), in: Capsule())
                                .overlay(
                                    Capsule()
                                        .stroke(Color.white.opacity(0.12), lineWidth: 1)
                                )
                                .padding(.horizontal, 18)
                        }
                    }
                    .padding(.vertical, item.secondaryPlaceLabel == nil ? 22 : 18)
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
                .frame(width: item.isCurrent ? 206 : 182, height: item.displayHeight)
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
                    .frame(maxWidth: 192, alignment: .leading)
                    .offset(y: 10)
                }
            }
            .frame(width: item.isCurrent ? 206 : 192, height: item.displayHeight, alignment: .topLeading)
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
                    Text(item.displayTitle)
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(CompanionStyle.textPrimary)
                    Text("\(item.startedAtDate.formatted(.dateTime.hour().minute())) → \(item.endedAtDate.formatted(.dateTime.hour().minute()))")
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(CompanionStyle.textSecondary)
                }
                .padding(16)
            }
            .frame(width: 182, height: max(112, item.displayHeight * 0.72))
            .frame(maxWidth: .infinity, alignment: .center)
    }
}

private enum MovementTimelineViewportLayout {
    static let gridRowHeight: CGFloat = 64
    static let historyLeadHours: Int = 5
    static let futureGridHours: Int = 1
    static let rowSpacing: CGFloat = 18
    static let historyCapHeight: CGFloat = 64
    static let historyCapBottomSpacing: CGFloat = 18

    static func leadSpacerHeight(for viewportHeight: CGFloat) -> CGFloat {
        max(viewportHeight * 0.42, 260)
    }
}

private struct MovementTimelineViewportGridRowMetric {
    let item: MovementLifeTimelineItem
    let rowStart: CGFloat
    let rowHeight: CGFloat
    let displayHeight: CGFloat
    let boxTop: CGFloat
    let boxBottom: CGFloat
}

private struct MovementTimelineHourMarker: Identifiable {
    let id: String
    let y: CGFloat
    let label: String
    let strong: Bool
}

private func movementWarpDisplayRatio(_ ratio: CGFloat, severity: CGFloat) -> CGFloat {
    let eased = ratio + ((sin((ratio - 0.5) * .pi) + 1) * 0.5) - ratio
    let centered = ratio - 0.5
    let cubicCompression =
        centered * (1 - severity * 0.64)
        + centered * centered * centered * severity * 2.56
    let warped = 0.5 + cubicCompression
    return max(0, min(1, warped - (eased - ratio) * severity * 0.08))
}

private func nextMovementHourBoundary(after date: Date) -> Date {
    let calendar = Calendar.current
    let components = calendar.dateComponents([.year, .month, .day, .hour], from: date)
    let hourStart = calendar.date(from: components) ?? date
    return hourStart <= date ? hourStart.addingTimeInterval(3600) : hourStart
}

private func movementHourMarkers(
    startedAt: Date,
    endedAt: Date,
    durationSeconds: Int,
    displayHeight: CGFloat
) -> [MovementTimelineHourMarker] {
    let maxDisplaySeconds = 6.0 * 60.0 * 60.0
    let duration = max(1, durationSeconds)
    let durationInterval = max(1, endedAt.timeIntervalSince(startedAt))
    let compressionSeverity = max(
        0,
        1 - min(1, maxDisplaySeconds / Double(duration))
    )
    var markers: [MovementTimelineHourMarker] = []
    var cursor = nextMovementHourBoundary(after: startedAt)
    while cursor < endedAt {
        let ratio = CGFloat(cursor.timeIntervalSince(startedAt) / durationInterval)
        let displayRatio =
            duration > Int(maxDisplaySeconds)
            ? movementWarpDisplayRatio(ratio, severity: CGFloat(compressionSeverity))
            : ratio
        let isStrong = Calendar.current.component(.hour, from: cursor) == 0
        markers.append(
            MovementTimelineHourMarker(
                id: "segment-\(startedAt.timeIntervalSince1970)-\(cursor.timeIntervalSince1970)",
                y: displayHeight * displayRatio,
                label: isStrong
                    ? cursor.formatted(Date.FormatStyle().day(.twoDigits).month(.twoDigits).year(.twoDigits))
                    : cursor.formatted(Date.FormatStyle().hour(.twoDigits(amPM: .omitted))),
                strong: isStrong
            )
        )
        cursor = cursor.addingTimeInterval(3600)
    }
    return markers
}

private func buildMovementViewportGridMetrics(
    items: [MovementLifeTimelineItem],
    viewportHeight: CGFloat,
    safeTopInset: CGFloat
) -> [MovementTimelineViewportGridRowMetric] {
    let timelineItems = items.filter { $0.kind != .anchor }
    let historyOffset =
        timelineItems.isEmpty
        ? 0
        : safeTopInset
            + 12
            + MovementTimelineViewportLayout.historyCapHeight
            + MovementTimelineViewportLayout.historyCapBottomSpacing
    var cursor = historyOffset + MovementTimelineViewportLayout.leadSpacerHeight(for: viewportHeight)
    return timelineItems.map { item in
        let displayHeight = item.kind == .missing ? max(112, item.displayHeight * 0.72) : item.displayHeight
        let rowStart = cursor
        let rowHeight = displayHeight + MovementTimelineViewportLayout.rowSpacing
        let metric = MovementTimelineViewportGridRowMetric(
            item: item,
            rowStart: rowStart,
            rowHeight: rowHeight,
            displayHeight: displayHeight,
            boxTop: rowStart,
            boxBottom: rowStart + displayHeight
        )
        cursor += rowHeight
        return metric
    }
}

private func buildMovementViewportHourMarkers(
    items: [MovementLifeTimelineItem],
    viewportHeight: CGFloat,
    safeTopInset: CGFloat,
    rangeEnd: Date
) -> [MovementTimelineHourMarker] {
    let rows = buildMovementViewportGridMetrics(
        items: items,
        viewportHeight: viewportHeight,
        safeTopInset: safeTopInset
    )
    guard let first = rows.first else {
        return []
    }

    var markers: [MovementTimelineHourMarker] = []
    let firstStart = first.item.startedAtDate
    var leadHour = nextMovementHourBoundary(
        after: firstStart.addingTimeInterval(
            TimeInterval(-MovementTimelineViewportLayout.historyLeadHours * 3600)
        )
    )
    while leadHour < firstStart {
        let hoursBeforeStart = firstStart.timeIntervalSince(leadHour) / 3600
        markers.append(
            MovementTimelineHourMarker(
                id: "lead-\(leadHour.timeIntervalSince1970)",
                y: first.boxTop - CGFloat(hoursBeforeStart) * MovementTimelineViewportLayout.gridRowHeight,
                label: Calendar.current.component(.hour, from: leadHour) == 0
                    ? leadHour.formatted(Date.FormatStyle().day(.twoDigits).month(.twoDigits).year(.twoDigits))
                    : leadHour.formatted(Date.FormatStyle().hour(.twoDigits(amPM: .omitted))),
                strong: Calendar.current.component(.hour, from: leadHour) == 0
            )
        )
        leadHour = leadHour.addingTimeInterval(3600)
    }

    for index in rows.indices {
        let row = rows[index]
        let itemMarkers = movementHourMarkers(
            startedAt: row.item.startedAtDate,
            endedAt: row.item.endedAtDate,
            durationSeconds: row.item.durationSeconds,
            displayHeight: row.displayHeight
        ).map { marker in
            MovementTimelineHourMarker(
                id: "row-\(row.item.id)-\(marker.id)",
                y: row.boxTop + marker.y,
                label: marker.label,
                strong: marker.strong
            )
        }
        markers.append(contentsOf: itemMarkers)

        if index + 1 < rows.count {
            let nextRow = rows[index + 1]
            let gapStart = row.item.endedAtDate
            let gapEnd = nextRow.item.startedAtDate
            let gapDuration = gapEnd.timeIntervalSince(gapStart)
            if gapDuration > 0 {
                var hour = nextMovementHourBoundary(after: gapStart)
                while hour < gapEnd {
                    let ratio = hour.timeIntervalSince(gapStart) / gapDuration
                    let y = row.boxBottom + (nextRow.boxTop - row.boxBottom) * CGFloat(ratio)
                    let isStrong = Calendar.current.component(.hour, from: hour) == 0
                    markers.append(
                        MovementTimelineHourMarker(
                            id: "gap-\(row.item.id)-\(nextRow.item.id)-\(hour.timeIntervalSince1970)",
                            y: y,
                            label: isStrong
                                ? hour.formatted(Date.FormatStyle().day(.twoDigits).month(.twoDigits).year(.twoDigits))
                                : hour.formatted(Date.FormatStyle().hour(.twoDigits(amPM: .omitted))),
                            strong: isStrong
                        )
                    )
                    hour = hour.addingTimeInterval(3600)
                }
            }
            continue
        }

        var trailingHour = nextMovementHourBoundary(after: row.item.endedAtDate)
        while trailingHour <= rangeEnd {
            let y = row.boxBottom + CGFloat(trailingHour.timeIntervalSince(row.item.endedAtDate) / 3600) * MovementTimelineViewportLayout.gridRowHeight
            let isStrong = Calendar.current.component(.hour, from: trailingHour) == 0
            markers.append(
                MovementTimelineHourMarker(
                    id: "tail-\(row.item.id)-\(trailingHour.timeIntervalSince1970)",
                    y: y,
                    label: isStrong
                        ? trailingHour.formatted(Date.FormatStyle().day(.twoDigits).month(.twoDigits).year(.twoDigits))
                        : trailingHour.formatted(Date.FormatStyle().hour(.twoDigits(amPM: .omitted))),
                    strong: isStrong
                )
            )
            trailingHour = trailingHour.addingTimeInterval(3600)
        }
    }

    return markers.sorted { left, right in
        if left.y == right.y {
            return left.label < right.label
        }
        return left.y < right.y
    }
}

private struct MovementTimelineViewportGrid: View {
    let items: [MovementLifeTimelineItem]
    let viewportHeight: CGFloat
    let safeTopInset: CGFloat
    let bottomPadding: CGFloat
    let rangeEnd: Date

    var body: some View {
        let rows = buildMovementViewportGridMetrics(
            items: items,
            viewportHeight: viewportHeight,
            safeTopInset: safeTopInset
        )
        let markers = buildMovementViewportHourMarkers(
            items: items,
            viewportHeight: viewportHeight,
            safeTopInset: safeTopInset,
            rangeEnd: rangeEnd
        )
        let contentHeight =
            (rows.last?.boxBottom ?? 0)
            + max(
                CGFloat(rangeEnd.timeIntervalSince(rows.last?.item.endedAtDate ?? rangeEnd) / 3600)
                    * MovementTimelineViewportLayout.gridRowHeight,
                CGFloat(MovementTimelineViewportLayout.futureGridHours) * MovementTimelineViewportLayout.gridRowHeight
            )
            + bottomPadding
        ZStack(alignment: .topLeading) {
            Rectangle()
                .fill(Color.clear)
                .frame(height: max(contentHeight, viewportHeight))
            ForEach(markers) { marker in
                VStack(alignment: .leading, spacing: 2) {
                    Rectangle()
                        .fill(Color.white.opacity(marker.strong ? 0.14 : 0.07))
                        .frame(height: 1)
                    Text(marker.label)
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.white.opacity(marker.strong ? 0.26 : 0.12))
                }
                .offset(x: 12, y: marker.y - 10)
            }
        }
        .allowsHitTesting(false)
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

    let creating: Bool
    let preflight: (MovementTimelineEditorDraft) async -> ForgeMovementUserBoxPreflight?
    let save: (MovementTimelineEditorDraft) async -> Void
    let close: () -> Void

    @State private var saving = false
    @State private var preflightState: ForgeMovementUserBoxPreflight?
    @State private var preflightLoading = false

    private var preflightKey: String {
        "\(kindKey(draft.kind))|\(draft.startedAt.timeIntervalSince1970)|\(draft.endedAt.timeIntervalSince1970)|\(draft.item.id)"
    }

    private func kindKey(_ kind: MovementLifeTimelineItem.Kind) -> String {
        switch kind {
        case .stay:
            return "stay"
        case .trip:
            return "trip"
        case .missing:
            return "missing"
        case .anchor:
            return "anchor"
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Summary") {
                    Picker("Kind", selection: $draft.kind) {
                        Text("Stay").tag(MovementLifeTimelineItem.Kind.stay)
                        Text("Move").tag(MovementLifeTimelineItem.Kind.trip)
                        Text("Missing").tag(MovementLifeTimelineItem.Kind.missing)
                    }
                    TextField("Label", text: $draft.label)
                    if draft.kind != .trip {
                        TextField("Place", text: $draft.placeLabel)
                    }
                    TextField("Tags", text: $draft.tags)
                }

                Section("Timing") {
                    DatePicker("Started", selection: $draft.startedAt, displayedComponents: [.date, .hourAndMinute])
                    DatePicker("Ended", selection: $draft.endedAt, displayedComponents: [.date, .hourAndMinute])
                }

                Section("Overlap guidance") {
                    if preflightLoading {
                        Text("Checking visible overlaps and missing windows…")
                            .foregroundStyle(CompanionStyle.textSecondary)
                    } else if let preflightState {
                        Text(
                            preflightState.overlapsAnything
                                ? "This box overlaps \(preflightState.affectedAutomaticBoxIds.count) automatic and \(preflightState.affectedUserBoxIds.count) manual boxes. Saving will fully override \(preflightState.fullyOverriddenUserBoxIds.count) manual boxes and trim \(preflightState.trimmedUserBoxIds.count)."
                                : "No overlap in the currently visible timeline window."
                        )
                        .foregroundStyle(CompanionStyle.textPrimary)
                        if let start = preflightState.visibleRangeStart,
                           let end = preflightState.visibleRangeEnd
                        {
                            Text("Visible range: \(MovementTimelineFormatting.dayFormatter.string(from: MovementTimelineFormatting.isoFormatter.date(from: start) ?? draft.startedAt)) \(MovementTimelineFormatting.timeFormatter.string(from: MovementTimelineFormatting.isoFormatter.date(from: start) ?? draft.startedAt)) -> \(MovementTimelineFormatting.dayFormatter.string(from: MovementTimelineFormatting.isoFormatter.date(from: end) ?? draft.endedAt)) \(MovementTimelineFormatting.timeFormatter.string(from: MovementTimelineFormatting.isoFormatter.date(from: end) ?? draft.endedAt))")
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .foregroundStyle(CompanionStyle.textSecondary)
                        }
                        Button("Fit Missing Time") {
                            guard let start = preflightState.nearestMissingStartedAt,
                                  let end = preflightState.nearestMissingEndedAt,
                                  let startDate = MovementTimelineFormatting.isoFormatter.date(from: start),
                                  let endDate = MovementTimelineFormatting.isoFormatter.date(from: end)
                            else {
                                return
                            }
                            draft.startedAt = startDate
                            draft.endedAt = endDate
                        }
                        .disabled(
                            preflightState.nearestMissingStartedAt == nil ||
                            preflightState.nearestMissingEndedAt == nil
                        )
                    }
                }

                Section("Sync") {
                    Text(draft.item.syncSource.capitalized)
                    if draft.item.isCurrent {
                        Text("This is the live local overlay. Changes save locally and will sync on the next movement upload.")
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(CompanionStyle.textSecondary)
                    }
                    Text(
                        creating
                            ? "This will create a user-defined movement box that overrides automatic movement boxes without mutating raw phone measurements."
                            : draft.item.sourceKind == "user_defined"
                                ? "This edits a user-defined movement box and syncs the same canonical box to Forge web and iPhone."
                                : "Automatic movement boxes are immutable. Create a user-defined box or invalidate an automatic box instead."
                    )
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.textSecondary)
                }
            }
            .scrollContentBackground(.hidden)
            .background(CompanionStyle.background)
            .task(id: preflightKey) {
                preflightLoading = true
                preflightState = await preflight(draft)
                preflightLoading = false
            }
            .navigationTitle(creating ? "Create box" : "Edit box")
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

private struct MovementTimelineVisiblePositionKey: PreferenceKey {
    static var defaultValue: [String: CGFloat] = [:]

    static func reduce(value: inout [String: CGFloat], nextValue: () -> [String: CGFloat]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

struct MovementTimelineCoordinate: Hashable {
    let latitude: Double
    let longitude: Double
}

private struct MovementTimelineEditorDraft: Identifiable {
    let id: String
    let item: MovementLifeTimelineItem
    var kind: MovementLifeTimelineItem.Kind
    var label: String
    var placeLabel: String
    var tags: String
    var startedAt: Date
    var endedAt: Date

    init(item: MovementLifeTimelineItem) {
        self.id = item.id
        self.item = item
        self.kind = item.kind
        self.label = item.title
        self.placeLabel = item.placeLabel ?? ""
        self.tags = item.tags.joined(separator: ", ")
        self.startedAt = item.startedAtDate
        self.endedAt = item.endedAtDate
    }
}

enum MovementTimelineDisplayNormalizer {
    /*
     Movement display repair rules are binding:

     1. Every positive-duration interval in the rendered window must be labelled as
        stay, trip, or missing. Blank time is a bug.
     2. Missing is never allowed for gaps under 1 hour.
     3. Any trip under 5 minutes is invalid and must be repaired into stay continuity.
     4. Any trip under 100 meters cumulative distance is invalid and must be repaired
        into stay continuity.
     5. For gaps under 1 hour:
        - same place -> continue stay
        - different place -> repaired trip only if boundary displacement is clearly
          meaningful and the gap is at least 5 minutes
        - otherwise -> repaired stay
     6. The tail must always stay labelled through Now. If the user is still at the
        same place, the last stay should remain ongoing instead of fragmenting into
        tiny stay/trip/stay boxes.
     */

    static func normalize(
        items: [MovementLifeTimelineItem],
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

        let preRepaired = sorted.enumerated().map { index, item in
            repairedInvalidTripItem(item, index: index, items: sorted, referenceDate: referenceDate) ?? item
        }

        var normalized: [MovementLifeTimelineItem] = []
        for raw in preRepaired {
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
           let trailingCoverage = makeTrailingCoverageItem(after: last, referenceDate: referenceDate)
        {
            if let merged = mergedItem(last, trailingCoverage) {
                normalized[normalized.count - 1] = merged
            } else {
                normalized.append(trailingCoverage)
            }
        }

        if let last = normalized.last,
           last.kind == .stay,
           last.endedAtDate >= referenceDate.addingTimeInterval(-60 * 60)
        {
            normalized[normalized.count - 1] = last.promotedToCurrent(referenceDate: referenceDate)
        }

        return normalized
    }

    private static func stayAnchorKey(for item: MovementLifeTimelineItem) -> String? {
        guard item.kind == .stay else {
            return nil
        }
        let candidate = item.placeLabel?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            ? item.placeLabel
            : item.title
        let normalized = candidate?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return normalized?.isEmpty == false ? normalized : nil
    }

    private static func sharesStayAnchor(_ left: MovementLifeTimelineItem, _ right: MovementLifeTimelineItem) -> Bool {
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

    private static func tripLooksInvalid(_ item: MovementLifeTimelineItem) -> Bool {
        guard item.kind == .trip else {
            return false
        }
        return item.durationSeconds < 5 * 60 || (item.distanceMeters ?? 0) < 100
    }

    private static func repairedInvalidTripItem(
        _ item: MovementLifeTimelineItem,
        index: Int,
        items: [MovementLifeTimelineItem],
        referenceDate: Date
    ) -> MovementLifeTimelineItem? {
        guard tripLooksInvalid(item) else {
            return nil
        }

        let previousStay = items[..<index].reversed().first(where: { $0.kind == .stay })
        let nextStay = items.dropFirst(index + 1).first(where: { $0.kind == .stay })
        let preferredStay =
            (previousStay != nil && nextStay != nil && sharesStayAnchor(previousStay!, nextStay!))
            ? previousStay
            : previousStay ?? nextStay

        let title = preferredStay?.placeLabel ?? preferredStay?.title ?? item.placeLabel ?? item.title
        let placeLabel = preferredStay?.placeLabel ?? item.placeLabel
        let tags = Array(Set(item.tags + (preferredStay?.tags ?? []) + ["invalid-trip-display-repair"])).sorted()
        let origin: MovementLifeTimelineItem.Origin =
            preferredStay?.kind == .stay ? .continuedStay : .repairedGap
        let isCurrent = item.isCurrent || item.endedAtDate >= referenceDate.addingTimeInterval(-5 * 60)

        return MovementLifeTimelineItem(
            id: "display-invalid-trip-stay-\(item.id)",
            source: .derived("display-invalid-trip-stay-\(item.id)"),
            kind: .stay,
            title: title,
            subtitle: "Invalid short-distance or short-duration trip repaired into stay continuity.",
            placeLabel: placeLabel,
            tags: tags,
            syncSource: "display repair",
            startedAtDate: item.startedAtDate,
            endedAtDate: item.endedAtDate,
            durationSeconds: max(60, Int(item.endedAtDate.timeIntervalSince(item.startedAtDate))),
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            distanceMeters: nil,
            averageSpeedMps: nil,
            origin: origin,
            editable: false,
            isCurrent: isCurrent
        )
    }

    private static func makeDerivedGapItem(
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
        if gapSeconds <= 60 * 60 {
            let previousPlace = previous.placeLabel?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let nextPlace = next.placeLabel?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if gapSeconds >= 5 * 60,
               let previousPlace,
               let nextPlace,
               previousPlace.isEmpty == false,
               nextPlace.isEmpty == false,
               previousPlace != nextPlace
            {
                return MovementLifeTimelineItem(
                    id: "display-repaired-trip-\(previous.id)-\(next.id)",
                    source: .derived("display-repaired-trip-\(previous.id)-\(next.id)"),
                    kind: .trip,
                    title: "\(previous.placeLabel ?? previous.title) → \(next.placeLabel ?? next.title)",
                    subtitle: "Short different-place gap repaired as a move between known anchors.",
                    placeLabel: next.placeLabel ?? previous.placeLabel,
                    tags: ["repaired-gap"],
                    syncSource: "display repair",
                    startedAtDate: previous.endedAtDate,
                    endedAtDate: next.startedAtDate,
                    durationSeconds: max(60, Int(gapSeconds)),
                    laneSide: .right,
                    connectorFromLane: previous.kind == .trip ? .right : .left,
                    connectorToLane: next.kind == .trip ? .right : .left,
                    distanceMeters: nil,
                    averageSpeedMps: nil,
                    origin: .repairedGap,
                    editable: false,
                    isCurrent: false
                )
            }
            return MovementLifeTimelineItem(
                id: "display-repaired-stay-\(previous.id)-\(next.id)",
                source: .derived("display-repaired-stay-\(previous.id)-\(next.id)"),
                kind: .stay,
                title: previous.placeLabel ?? next.placeLabel ?? previous.title,
                subtitle: "Short uncovered gap repaired into stay continuity so the timeline never goes silent.",
                placeLabel: previous.placeLabel ?? next.placeLabel,
                tags: Array(Set(previous.tags + next.tags + ["repaired-gap"])).sorted(),
                syncSource: "display repair",
                startedAtDate: previous.endedAtDate,
                endedAtDate: next.startedAtDate,
                durationSeconds: max(60, Int(gapSeconds)),
                laneSide: .left,
                connectorFromLane: .left,
                connectorToLane: .left,
                distanceMeters: nil,
                averageSpeedMps: nil,
                origin: .repairedGap,
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

    private static func makeTrailingCoverageItem(
        after item: MovementLifeTimelineItem,
        referenceDate: Date
    ) -> MovementLifeTimelineItem? {
        let gapSeconds = referenceDate.timeIntervalSince(item.endedAtDate)
        guard gapSeconds > 0 else {
            return nil
        }
        if gapSeconds <= 60 * 60 {
            return MovementLifeTimelineItem(
                id: "display-trailing-stay-\(item.id)",
                source: .derived("display-trailing-stay-\(item.id)"),
                kind: .stay,
                title: item.placeLabel ?? item.title,
                subtitle:
                    item.kind == .stay
                    ? "Short stationary gap carried forward into one continuous stay."
                    : "Short trailing gap repaired into stay continuity until fresher signal arrives.",
                placeLabel: item.placeLabel,
                tags: Array(Set(item.tags + [item.kind == .stay ? "continued-stay" : "repaired-gap"])).sorted(),
                syncSource: "display repair",
                startedAtDate: item.endedAtDate,
                endedAtDate: referenceDate,
                durationSeconds: max(60, Int(gapSeconds)),
                laneSide: .left,
                connectorFromLane: .left,
                connectorToLane: .left,
                distanceMeters: nil,
                averageSpeedMps: nil,
                origin: item.kind == .stay ? .continuedStay : .repairedGap,
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

    private static func mergedItem(
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

    private static func trimmedItem(
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
}

enum MovementTimelineCanonicalNormalizer {
    /*
     Canonical movement timeline rules for synced rendering:

     1. When Forge canonical boxes are available, iPhone renders those as the
        source of truth.
     2. The phone may only apply a limited local tail repair on top:
        - dedupe duplicate canonical boxes
        - merge same-place ongoing stay continuity
        - extend the final stay to Now when it is still the same ongoing place
     3. The phone must not invent a second product-divergent box history while
        connected. Internal gaps and repair semantics come from Forge.
     */

    static func normalize(
        items: [MovementLifeTimelineItem],
        liveOverlay: MovementLifeTimelineItem?,
        referenceDate: Date
    ) -> [MovementLifeTimelineItem] {
        let deduplicated = deduplicate(items)
        guard deduplicated.isEmpty == false else {
            return []
        }

        var canonical = deduplicated
        if let liveOverlay {
            canonical = applyLiveOverlay(liveOverlay, to: canonical, referenceDate: referenceDate)
        } else if let last = canonical.last,
                  last.kind == .stay,
                  referenceDate.timeIntervalSince(last.endedAtDate) > 0,
                  referenceDate.timeIntervalSince(last.endedAtDate) <= 60 * 60
        {
            canonical[canonical.count - 1] = last.promotedToCurrent(referenceDate: referenceDate)
        }
        return canonical
    }

    private static func deduplicate(
        _ items: [MovementLifeTimelineItem]
    ) -> [MovementLifeTimelineItem] {
        var byId: [String: MovementLifeTimelineItem] = [:]
        for item in items where item.kind != .anchor && item.endedAtDate > item.startedAtDate {
            if let existing = byId[item.id] {
                if item.startedAtDate < existing.startedAtDate || item.endedAtDate > existing.endedAtDate {
                    byId[item.id] = item
                }
            } else {
                byId[item.id] = item
            }
        }
        return byId.values.sorted { left, right in
            if left.startedAtDate == right.startedAtDate {
                if left.endedAtDate == right.endedAtDate {
                    return left.id < right.id
                }
                return left.endedAtDate < right.endedAtDate
            }
            return left.startedAtDate < right.startedAtDate
        }
    }

    private static func stayAnchorKey(for item: MovementLifeTimelineItem) -> String? {
        guard item.kind == .stay else {
            return nil
        }
        let candidate = item.placeLabel?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            ? item.placeLabel
            : item.title
        let normalized = candidate?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return normalized?.isEmpty == false ? normalized : nil
    }

    private static func sharesStayAnchor(
        _ left: MovementLifeTimelineItem,
        _ right: MovementLifeTimelineItem
    ) -> Bool {
        guard left.kind == .stay, right.kind == .stay else {
            return false
        }
        guard let leftAnchor = stayAnchorKey(for: left),
              let rightAnchor = stayAnchorKey(for: right)
        else {
            return false
        }
        return leftAnchor == rightAnchor
    }

    private static func mergedCanonicalStay(
        _ left: MovementLifeTimelineItem,
        _ right: MovementLifeTimelineItem,
        referenceDate: Date
    ) -> MovementLifeTimelineItem {
        let mergedEnd = max(max(left.endedAtDate, right.endedAtDate), referenceDate)
        let mergedStart = min(left.startedAtDate, right.startedAtDate)
        return MovementLifeTimelineItem(
            id: left.id,
            source: left.source,
            kind: .stay,
            title: left.placeLabel ?? right.placeLabel ?? left.title,
            subtitle: left.subtitle,
            placeLabel: left.placeLabel ?? right.placeLabel,
            tags: Array(Set(left.tags + right.tags)).sorted(),
            syncSource: left.syncSource == right.syncSource ? left.syncSource : "canonical",
            startedAtDate: mergedStart,
            endedAtDate: mergedEnd,
            durationSeconds: max(
                60,
                Int(mergedEnd.timeIntervalSince(mergedStart))
            ),
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            distanceMeters: nil,
            averageSpeedMps: nil,
            sourceKind: left.sourceKind,
            overrideCount: max(left.overrideCount, right.overrideCount),
            origin:
                left.origin == .continuedStay || right.origin == .continuedStay
                ? .continuedStay
                : left.origin,
            editable: left.editable && right.editable,
            isCurrent: true
        )
    }

    private static func applyLiveOverlay(
        _ overlay: MovementLifeTimelineItem,
        to items: [MovementLifeTimelineItem],
        referenceDate: Date
    ) -> [MovementLifeTimelineItem] {
        guard var last = items.last else {
            return [overlay.promotedToCurrent(referenceDate: referenceDate)]
        }
        let gapToOverlay = overlay.startedAtDate.timeIntervalSince(last.endedAtDate)
        if overlay.kind == .stay,
           last.kind == .stay,
           sharesStayAnchor(last, overlay),
           gapToOverlay <= 60 * 60
        {
            var merged = items
            merged[merged.count - 1] = mergedCanonicalStay(last, overlay, referenceDate: referenceDate)
            return merged
        }
        if overlay.startedAtDate <= last.endedAtDate {
            if overlay.kind == .stay,
               last.kind == .stay,
               sharesStayAnchor(last, overlay)
            {
                var merged = items
                merged[merged.count - 1] = mergedCanonicalStay(last, overlay, referenceDate: referenceDate)
                return merged
            }
            return items
        }
        if last.kind == .stay,
           overlay.kind == .stay,
           gapToOverlay <= 60 * 60,
           sharesStayAnchor(last, overlay)
        {
            var merged = items
            last = mergedCanonicalStay(last, overlay, referenceDate: referenceDate)
            merged[merged.count - 1] = last
            return merged
        }
        var next = items
        next.append(overlay.promotedToCurrent(referenceDate: referenceDate))
        return next
    }
}

struct MovementLifeTimelineItem: Identifiable, Hashable {
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
        case remoteAutomatic(String, MovementTimelineCoordinate?)
        case remoteUserBox(String, MovementTimelineCoordinate?)
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
        case userDefined
        case userInvalidated
    }

    static let currentAnchorId = "life-timeline-current-anchor"
    static func currentAnchor(referenceDate: Date) -> MovementLifeTimelineItem {
        MovementLifeTimelineItem(
            id: currentAnchorId,
            source: .anchor,
            kind: .anchor,
            title: "Now",
            subtitle: "",
            placeLabel: nil,
            tags: [],
            syncSource: "local",
            startedAtDate: referenceDate,
            endedAtDate: referenceDate,
            durationSeconds: 0,
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .right,
            distanceMeters: nil,
            averageSpeedMps: nil,
            isCurrent: false
        )
    }

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
    let sourceKind: String
    let overrideCount: Int
    let rawStayIds: [String]
    let rawTripIds: [String]
    let rawPointCount: Int
    let hasLegacyCorrections: Bool
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
        sourceKind: String = "automatic",
        overrideCount: Int = 0,
        rawStayIds: [String] = [],
        rawTripIds: [String] = [],
        rawPointCount: Int = 0,
        hasLegacyCorrections: Bool = false,
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
        self.sourceKind = sourceKind
        self.overrideCount = overrideCount
        self.rawStayIds = rawStayIds
        self.rawTripIds = rawTripIds
        self.rawPointCount = rawPointCount
        self.hasLegacyCorrections = hasLegacyCorrections
        self.origin = origin
        self.editable = editable
        self.isCurrent = isCurrent
    }

    init?(remote segment: ForgeMovementTimelineSegment) {
        let startedAtDate = MovementTimelineFormatting.parse(segment.startedAt)
        let endedAtDate = MovementTimelineFormatting.parse(segment.endedAt)
        if segment.kind == "stay" {
            self.init(
                id: "remote-stay-\(segment.id)",
                source: segment.sourceKind == "user_defined"
                    ? .remoteUserBox(
                        segment.boxId ?? segment.id,
                        segment.stay.map {
                            .init(latitude: $0.centerLatitude, longitude: $0.centerLongitude)
                        }
                    )
                    : .remoteAutomatic(
                        segment.boxId ?? segment.id,
                        segment.stay.map {
                            .init(latitude: $0.centerLatitude, longitude: $0.centerLongitude)
                        }
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
                sourceKind: segment.sourceKind,
                overrideCount: segment.overrideCount,
                rawStayIds: segment.rawStayIds,
                rawTripIds: segment.rawTripIds,
                rawPointCount: segment.rawPointCount,
                hasLegacyCorrections: segment.hasLegacyCorrections,
                origin:
                    segment.origin == "continued_stay"
                    ? .continuedStay
                    : segment.origin == "repaired_gap"
                        ? .repairedGap
                        : segment.origin == "user_defined"
                            ? .userDefined
                            : segment.origin == "user_invalidated"
                                ? .userInvalidated
                        : .recorded,
                editable: segment.editable,
                isCurrent: false
            )
            return
        }
        if segment.kind == "trip" {
            self.init(
                id: "remote-trip-\(segment.id)",
                source: segment.sourceKind == "user_defined"
                    ? .remoteUserBox(segment.boxId ?? segment.id, nil)
                    : .remoteAutomatic(segment.boxId ?? segment.id, nil),
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
                distanceMeters: segment.trip?.distanceMeters,
                averageSpeedMps: segment.trip?.averageSpeedMps,
                sourceKind: segment.sourceKind,
                overrideCount: segment.overrideCount,
                rawStayIds: segment.rawStayIds,
                rawTripIds: segment.rawTripIds,
                rawPointCount: segment.rawPointCount,
                hasLegacyCorrections: segment.hasLegacyCorrections,
                origin:
                    segment.origin == "continued_stay"
                    ? .continuedStay
                    : segment.origin == "repaired_gap"
                        ? .repairedGap
                        : segment.origin == "user_defined"
                            ? .userDefined
                            : segment.origin == "user_invalidated"
                                ? .userInvalidated
                        : .recorded,
                editable: segment.editable,
                isCurrent: false
            )
            return
        }
        if segment.kind == "missing" {
            self.init(
                id: "remote-missing-\(segment.id)",
                source: segment.sourceKind == "user_defined"
                    ? .remoteUserBox(segment.boxId ?? segment.id, nil)
                    : .remoteAutomatic(segment.boxId ?? segment.id, nil),
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
                sourceKind: segment.sourceKind,
                overrideCount: segment.overrideCount,
                rawStayIds: segment.rawStayIds,
                rawTripIds: segment.rawTripIds,
                rawPointCount: segment.rawPointCount,
                hasLegacyCorrections: segment.hasLegacyCorrections,
                origin:
                    segment.origin == "user_defined"
                    ? .userDefined
                    : segment.origin == "user_invalidated"
                        ? .userInvalidated
                        : .missing,
                editable: segment.editable,
                isCurrent: false
            )
            return
        }
        return nil
    }

    init(liveStay stay: MovementSyncStore.StoredStay, referenceDate: Date = Date()) {
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
            endedAtDate: max(stay.endedAt, referenceDate),
            durationSeconds: max(60, Int(max(stay.endedAt, referenceDate).timeIntervalSince(stay.startedAt))),
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            distanceMeters: nil,
            averageSpeedMps: nil,
            sourceKind: "automatic",
            overrideCount: 0,
            origin: .recorded,
            editable: true,
            isCurrent: true
        )
    }

    init(liveTrip trip: MovementSyncStore.StoredTrip, referenceDate: Date = Date()) {
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
            endedAtDate: max(trip.endedAt, referenceDate),
            durationSeconds: max(60, Int(max(trip.endedAt, referenceDate).timeIntervalSince(trip.startedAt))),
            laneSide: .right,
            connectorFromLane: .left,
            connectorToLane: .right,
            distanceMeters: trip.distanceMeters,
            averageSpeedMps: trip.averageSpeedMps,
            sourceKind: "automatic",
            overrideCount: 0,
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
            sourceKind: "automatic",
            overrideCount: 0,
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

    var displayTitle: String {
        if kind == .missing {
            let normalized = title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if normalized.isEmpty || normalized == "stay" || normalized == "continued stay" || normalized == "repaired stay" {
                return sourceKind == "user_defined"
                    ? (origin == .userInvalidated ? "User invalidated movement" : "User-defined missing data")
                    : "Missing data"
            }
        }
        return title
    }

    var secondaryPlaceLabel: String? {
        guard let placeLabel else {
            return nil
        }
        let trimmedPlaceLabel = placeLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedPlaceLabel.isEmpty == false else {
            return nil
        }
        let normalizedPlaceLabel = trimmedPlaceLabel.lowercased()
        let normalizedTitle = displayTitle.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return normalizedPlaceLabel == normalizedTitle ? nil : trimmedPlaceLabel
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

    var coordinate: MovementTimelineCoordinate? {
        switch source {
        case .remoteAutomatic(_, let coordinate), .remoteUserBox(_, let coordinate):
            return coordinate
        case .liveStay(_, let coordinate):
            return coordinate
        case .liveTrip, .derived, .anchor:
            return nil
        }
    }

    var boxId: String? {
        switch source {
        case .remoteAutomatic(let boxId, _), .remoteUserBox(let boxId, _):
            return boxId
        case .liveStay, .liveTrip, .derived, .anchor:
            return nil
        }
    }

    var hasCanonicalPlace: Bool {
        guard let placeLabel else {
            return false
        }
        return placeLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }

    @MainActor
    func linkableStayIds(using movementStore: MovementSyncStore) -> [String] {
        if rawStayIds.isEmpty == false {
            let direct = rawStayIds
            let stripped = rawStayIds.map { $0.replacingOccurrences(of: "stay_", with: "") }
            return Array(Set(direct + stripped)).sorted()
        }
        switch source {
        case .liveStay(let stayId, _):
            return [stayId]
        default:
            return []
        }
    }

    @MainActor
    func stayRadiusMeters(using movementStore: MovementSyncStore) -> Double {
        let linkedStays = movementStore.storedStays.filter { linkableStayIds(using: movementStore).contains($0.id) }
        if let radius = linkedStays.map(\.radiusMeters).max() {
            return radius
        }
        return 100
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
            sourceKind: sourceKind,
            overrideCount: overrideCount,
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

    static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "dd/MM/yy"
        return formatter
    }()

    static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    static func parse(_ value: String) -> Date {
        isoFormatter.date(from: value) ?? Date()
    }

    static func durationLabel(_ seconds: Int) -> String {
        let hours = Double(seconds) / 3600
        if hours >= 24 {
            return "\(Int(round(hours)))h"
        }
        if hours >= 1 {
            return "\(String(format: "%.1f", hours))h"
        }
        return "\(max(1, seconds / 60))m"
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
