import SwiftUI

struct PairedForgeScreen: View {
    @EnvironmentObject private var appModel: CompanionAppModel

    let reopenSetup: () -> Void

    @State private var menuVisible = false
    @State private var reloadToken = UUID()
    @State private var isLoading = true
    @State private var webError: String?
    @State private var movementSettingsVisible = false
    @State private var diagnosticsVisible = false
    @State private var lifeTimelineVisible = false

    var body: some View {
        GeometryReader { proxy in
            let topControlsPadding = max(6, proxy.safeAreaInsets.top + 4)
            let menuSheetTopPadding = topControlsPadding + 56

            ZStack(alignment: .topTrailing) {
                CompanionStyle.background

                if let url = appModel.forgeWebURL {
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
                        reopenSetup: reopenSetup,
                        reloadForge: { reloadToken = UUID() },
                        openDiagnostics: { diagnosticsVisible = true },
                        openMovementSettings: { movementSettingsVisible = true },
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
                                    reader.scrollTo(MovementLifeTimelineItem.currentAnchorId, anchor: .center)
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

                        if let oldestTimelineItem {
                            MovementTimelineHistoryCap(item: oldestTimelineItem)
                                .padding(.top, 10)
                        }

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

    private var displayItems: [MovementLifeTimelineItem] {
        var items = segments.compactMap(MovementLifeTimelineItem.init(remote:))
        if let liveOverlayItem {
            items.append(liveOverlayItem)
        } else {
            items.append(.currentAnchor)
        }
        return items
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

    private var oldestTimelineItem: MovementLifeTimelineItem? {
        displayItems.first(where: { $0.kind != .anchor })
    }

    private func reload() async {
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
        guard let pairing = appModel.pairing else {
            loadError = "Connect the companion to Forge to page historical movement. The live local overlay still shows your current stay or trip."
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
            loadError = error.localizedDescription
        }
    }

    private func loadMoreIfNeeded() async {
        guard loadingMore == false, loading == false, hasMore, let pairing = appModel.pairing else {
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
            loadError = error.localizedDescription
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
        isSelected && item.detailSide == .leading
    }

    private var detailOnTrailingSide: Bool {
        isSelected && item.detailSide == .trailing
    }

    private var segmentWidth: CGFloat {
        max(176, detailOnLeadingSide || detailOnTrailingSide ? width * 0.42 : width * 0.92)
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
            Text(item.title)
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundStyle(CompanionStyle.textPrimary)
            Text(item.subtitle)
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(CompanionStyle.textSecondary)
            detailRow("Started", item.startedAtDate.formatted(.dateTime.day().month(.abbreviated).year().hour().minute()))
            detailRow("Ended", item.endedAtDate.formatted(.dateTime.day().month(.abbreviated).year().hour().minute()))
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
                .disabled(item.kind == .anchor)
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
            header
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
                        Text(item.title)
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundStyle(CompanionStyle.textPrimary)
                            .lineLimit(2)
                        Text(item.subtitle)
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(CompanionStyle.textSecondary)
                            .lineLimit(3)
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
        .frame(maxWidth: .infinity, alignment: item.isCurrent ? .center : item.laneSide == .left ? .leading : .trailing)
        .id(item.isCurrent ? MovementLifeTimelineItem.currentAnchorId : item.id)
    }

    private var header: some View {
        Text(item.timeHeader)
            .font(.system(size: 10, weight: .medium, design: .rounded))
            .foregroundStyle(CompanionStyle.textMuted)
    }
}

private struct MovementTimelineTripShape: View {
    let item: MovementLifeTimelineItem

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(item.timeHeader)
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundStyle(CompanionStyle.textMuted)
                .frame(maxWidth: .infinity, alignment: item.isCurrent ? .center : item.laneSide == .left ? .leading : .trailing)

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
                            label: item.title,
                            detail: "moving"
                        )
                        Spacer(minLength: 0)
                        MovementTimelineTripEndpointCapsule(
                            label: item.placeLabel?.isEmpty == false ? item.placeLabel! : "Set current place",
                            detail: "tap to label"
                        )
                    }
                    .padding(.vertical, 6)
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
                            label: "Trip start",
                            detail: item.timeHeader
                        )
                        Spacer(minLength: 0)
                        MovementTimelineTripEndpointCapsule(
                            label: item.placeLabel?.isEmpty == false ? item.placeLabel! : "Trip end",
                            detail: item.durationLabel
                        )
                    }
                    .padding(.vertical, 6)
                }

                HStack {
                    if item.laneSide == .right && item.isCurrent == false {
                        Spacer()
                    }

                    VStack(alignment: .leading, spacing: 5) {
                        Text(item.title)
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundStyle(CompanionStyle.textPrimary)
                            .lineLimit(2)
                        Text(item.subtitle)
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(CompanionStyle.textSecondary)
                            .lineLimit(3)
                        Text(item.durationLabel)
                            .font(.system(size: 12, weight: .black, design: .rounded))
                            .foregroundStyle(CompanionStyle.accentStrong)
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

                    if item.laneSide == .left && item.isCurrent == false {
                        Spacer()
                    }
                }
                .padding(.horizontal, item.isCurrent ? 0 : 8)
            }
            .frame(width: item.isCurrent ? 196 : 184, height: item.displayHeight, alignment: .topLeading)
        }
        .frame(maxWidth: .infinity, alignment: item.isCurrent ? .center : item.laneSide == .left ? .leading : .trailing)
        .id(item.isCurrent ? MovementLifeTimelineItem.currentAnchorId : item.id)
    }
}

private struct MovementTimelineTripEndpointCapsule: View {
    let label: String
    let detail: String

    var body: some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundStyle(CompanionStyle.textPrimary)
                .lineLimit(1)
            Text(detail.uppercased())
                .font(.system(size: 8, weight: .medium, design: .rounded))
                .foregroundStyle(CompanionStyle.textMuted)
                .tracking(1)
                .lineLimit(1)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(Color.black.opacity(0.26), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
        .frame(maxWidth: 120)
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
                            .foregroundStyle(Color.white.opacity(marker.isDate ? 0.34 : 0.24))
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
        let leftX = rect.minX + 24
        let rightX = rect.maxX - 24
        let centerX = rect.midX
        let startX = from == .left ? leftX : rightX
        let endX = to == .left ? leftX : rightX
        var path = Path()
        path.move(to: CGPoint(x: startX, y: rect.minY + 18))
        path.addCurve(
            to: CGPoint(x: endX, y: rect.maxY - 18),
            control1: CGPoint(x: centerX, y: rect.minY + rect.height * 0.22),
            control2: CGPoint(x: centerX, y: rect.minY + rect.height * 0.78)
        )
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
        case anchor
    }

    enum DetailSide {
        case leading
        case trailing
    }

    enum Source: Hashable {
        case remoteStay(String, MovementTimelineCoordinate?)
        case remoteTrip(String)
        case liveStay(String, MovementTimelineCoordinate)
        case liveTrip(String)
        case anchor
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
            isCurrent: true
        )
    }

    var displayHeight: CGFloat {
        let maxDisplaySeconds = 6.0 * 60.0 * 60.0
        let minHeight: CGFloat = kind == .trip ? 90 : 72
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
        if isCurrent {
            return .center
        }
        return laneSide == .left ? .leading : .trailing
    }

    var detailSide: DetailSide {
        if isCurrent {
            return .trailing
        }
        return laneSide == .left ? .trailing : .leading
    }

    var selectionOffset: CGFloat {
        guard isCurrent == false else {
            return 0
        }
        return laneSide == .left ? -34 : 34
    }

    var gradient: LinearGradient {
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
