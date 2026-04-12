import SwiftUI

enum CompanionScreenshotScenario: String {
    case pairing
    case home
    case lifeTimeline = "life-timeline"
    case diagnostics

    static var current: CompanionScreenshotScenario? {
#if DEBUG
        ProcessInfo.processInfo.environment["FORGE_SCREENSHOT_SCENARIO"]
            .flatMap(CompanionScreenshotScenario.init(rawValue:))
#else
        nil
#endif
    }

    var usesDirectSetupFlow: Bool {
        self == .pairing
    }

    var autoOpensLifeTimeline: Bool {
        self == .lifeTimeline
    }

    var autoOpensDiagnostics: Bool {
        self == .diagnostics
    }

    var usesForgeCanvasPlaceholder: Bool {
        self != .pairing
    }
}

enum CompanionScreenshotFixtures {
    static let referenceDate: Date = {
        var components = DateComponents()
        components.calendar = Calendar(identifier: .gregorian)
        components.timeZone = TimeZone(identifier: "Europe/Zurich")
        components.year = 2026
        components.month = 4
        components.day = 8
        components.hour = 9
        components.minute = 41
        return components.date ?? Date()
    }()

    static func pairingPayload() -> PairingPayload {
        PairingPayload(
            kind: "health_pairing",
            apiBaseUrl: "https://macbook-pro--de-francis-lalanne.tail47ba04.ts.net/api/v1",
            uiBaseUrl: "https://macbook-pro--de-francis-lalanne.tail47ba04.ts.net/forge/",
            sessionId: "pair_screenshot_forge_companion",
            pairingToken: "forge-screenshot-token",
            expiresAt: isoString(referenceDate.addingTimeInterval(60 * 60 * 24 * 30)),
            capabilities: ["healthkit.sleep", "healthkit.fitness", "movement.timeline"]
        )
    }

    static func discoveredServers() -> [DiscoveredForgeServer] {
        [
            DiscoveredForgeServer(
                id: "forge-ts-bonjour-macbook-pro",
                name: "Forge on Albert's Mac",
                host: "macbook-pro--de-francis-lalanne.tail47ba04.ts.net",
                apiBaseUrl: pairingPayload().apiBaseUrl,
                uiBaseUrl: pairingPayload().uiBaseUrl ?? "https://macbook-pro--de-francis-lalanne.tail47ba04.ts.net/forge/",
                source: .tailscale,
                canBootstrapPairing: true,
                detail: "Secure Tailscale route with live /api and /forge reachability."
            ),
            DiscoveredForgeServer(
                id: "forge-lan-macbook-pro",
                name: "Forge on Home Wi-Fi",
                host: "192.168.1.60",
                apiBaseUrl: "http://192.168.1.60:4317/api/v1",
                uiBaseUrl: "http://192.168.1.60:3027/forge/",
                source: .lan,
                canBootstrapPairing: true,
                detail: "Local network runtime exposed from Albert's MacBook Pro."
            )
        ]
    }

    static func tailscaleDevices() -> [DiscoveredTailscaleDevice] {
        [
            DiscoveredTailscaleDevice(
                id: "ts-macbook-pro",
                name: "Albert's MacBook Pro",
                host: "100.81.24.6",
                dnsName: "macbook-pro--de-francis-lalanne.tail47ba04.ts.net",
                forgeApiBaseUrl: pairingPayload().apiBaseUrl,
                forgeUiBaseUrl: pairingPayload().uiBaseUrl,
                forgeApiReachable: true,
                forgeUiReachable: true,
                detail: "Forge runtime reachable through Tailscale Serve."
            ),
            DiscoveredTailscaleDevice(
                id: "ts-iphone",
                name: "Albert's iPhone",
                host: "100.74.91.9",
                dnsName: "iphone172.tail47ba04.ts.net",
                forgeApiBaseUrl: nil,
                forgeUiBaseUrl: nil,
                forgeApiReachable: false,
                forgeUiReachable: false,
                detail: "Phone is online on the tailnet. No Forge runtime advertised."
            )
        ]
    }

    static func movementState() -> MovementSyncStore.PersistedState {
        let home = MovementSyncStore.StoredKnownPlace(
            id: "place_home",
            externalUid: "known-place-home",
            label: "Home",
            aliases: ["Apartment", "Couch"],
            latitude: 46.51997,
            longitude: 6.63359,
            radiusMeters: 90,
            categoryTags: ["home"],
            visibility: "private",
            wikiNoteId: nil,
            metadata: ["seeded": "true"]
        )
        let groceries = MovementSyncStore.StoredKnownPlace(
            id: "place_grocery",
            externalUid: "known-place-grocery",
            label: "Groceries",
            aliases: ["Supermarket"],
            latitude: 46.52110,
            longitude: 6.62844,
            radiusMeters: 70,
            categoryTags: ["grocery"],
            visibility: "private",
            wikiNoteId: nil,
            metadata: ["seeded": "true"]
        )

        let previousLongStay = MovementSyncStore.StoredStay(
            id: "stay_previous_home",
            label: "Home",
            status: "completed",
            classification: "known_place",
            startedAt: referenceDate.addingTimeInterval(-60 * 60 * 11.8),
            endedAt: referenceDate.addingTimeInterval(-60 * 60 * 4.8),
            centerLatitude: home.latitude,
            centerLongitude: home.longitude,
            radiusMeters: 84,
            sampleCount: 46,
            placeExternalUid: home.externalUid,
            placeLabel: home.label,
            tags: ["home"],
            metadata: ["seeded": "true"]
        )

        let groceryTripPoints = [
            MovementSyncStore.StoredTripPoint(
                id: "trip_point_1",
                externalUid: "trip_point_1",
                recordedAt: referenceDate.addingTimeInterval(-60 * 60 * 4.78),
                latitude: 46.52002,
                longitude: 6.63350,
                accuracyMeters: 8,
                altitudeMeters: 376,
                speedMps: 1.8,
                isStopAnchor: false
            ),
            MovementSyncStore.StoredTripPoint(
                id: "trip_point_2",
                externalUid: "trip_point_2",
                recordedAt: referenceDate.addingTimeInterval(-60 * 60 * 4.63),
                latitude: 46.52054,
                longitude: 6.63152,
                accuracyMeters: 8,
                altitudeMeters: 374,
                speedMps: 2.1,
                isStopAnchor: false
            ),
            MovementSyncStore.StoredTripPoint(
                id: "trip_point_3",
                externalUid: "trip_point_3",
                recordedAt: referenceDate.addingTimeInterval(-60 * 60 * 4.45),
                latitude: groceries.latitude,
                longitude: groceries.longitude,
                accuracyMeters: 7,
                altitudeMeters: 372,
                speedMps: 0.9,
                isStopAnchor: true
            )
        ]

        let groceryTrip = MovementSyncStore.StoredTrip(
            id: "trip_to_grocery",
            label: "Groceries run",
            status: "completed",
            travelMode: "walk",
            activityType: "walking",
            startedAt: referenceDate.addingTimeInterval(-60 * 60 * 4.8),
            endedAt: referenceDate.addingTimeInterval(-60 * 60 * 4.45),
            startPlaceExternalUid: home.externalUid,
            endPlaceExternalUid: groceries.externalUid,
            distanceMeters: 1120,
            movingSeconds: 18 * 60,
            idleSeconds: 4 * 60,
            averageSpeedMps: 1.6,
            maxSpeedMps: 2.8,
            caloriesKcal: 121,
            expectedMet: 3.1,
            tags: ["errands"],
            metadata: ["seeded": "true"],
            points: groceryTripPoints,
            stops: []
        )

        let groceryStay = MovementSyncStore.StoredStay(
            id: "stay_grocery",
            label: "Groceries",
            status: "completed",
            classification: "known_place",
            startedAt: referenceDate.addingTimeInterval(-60 * 60 * 4.45),
            endedAt: referenceDate.addingTimeInterval(-60 * 60 * 4.0),
            centerLatitude: groceries.latitude,
            centerLongitude: groceries.longitude,
            radiusMeters: 38,
            sampleCount: 12,
            placeExternalUid: groceries.externalUid,
            placeLabel: groceries.label,
            tags: ["grocery"],
            metadata: ["seeded": "true"]
        )

        let homeTripPoints = [
            MovementSyncStore.StoredTripPoint(
                id: "trip_home_point_1",
                externalUid: "trip_home_point_1",
                recordedAt: referenceDate.addingTimeInterval(-60 * 60 * 4.0),
                latitude: groceries.latitude,
                longitude: groceries.longitude,
                accuracyMeters: 7,
                altitudeMeters: 372,
                speedMps: 1.1,
                isStopAnchor: false
            ),
            MovementSyncStore.StoredTripPoint(
                id: "trip_home_point_2",
                externalUid: "trip_home_point_2",
                recordedAt: referenceDate.addingTimeInterval(-60 * 60 * 3.82),
                latitude: 46.52061,
                longitude: 6.63190,
                accuracyMeters: 8,
                altitudeMeters: 374,
                speedMps: 2.0,
                isStopAnchor: false
            ),
            MovementSyncStore.StoredTripPoint(
                id: "trip_home_point_3",
                externalUid: "trip_home_point_3",
                recordedAt: referenceDate.addingTimeInterval(-60 * 60 * 3.62),
                latitude: home.latitude,
                longitude: home.longitude,
                accuracyMeters: 8,
                altitudeMeters: 376,
                speedMps: 0.7,
                isStopAnchor: true
            )
        ]

        let returnTrip = MovementSyncStore.StoredTrip(
            id: "trip_home",
            label: "Back home",
            status: "completed",
            travelMode: "walk",
            activityType: "walking",
            startedAt: referenceDate.addingTimeInterval(-60 * 60 * 4.0),
            endedAt: referenceDate.addingTimeInterval(-60 * 60 * 3.62),
            startPlaceExternalUid: groceries.externalUid,
            endPlaceExternalUid: home.externalUid,
            distanceMeters: 1260,
            movingSeconds: 20 * 60,
            idleSeconds: 2 * 60,
            averageSpeedMps: 1.8,
            maxSpeedMps: 3.0,
            caloriesKcal: 134,
            expectedMet: 3.4,
            tags: ["return"],
            metadata: ["seeded": "true"],
            points: homeTripPoints,
            stops: []
        )

        let ongoingStay = MovementSyncStore.StoredStay(
            id: "stay_current_home",
            label: "Home",
            status: "active",
            classification: "known_place",
            startedAt: referenceDate.addingTimeInterval(-60 * 60 * 3.62),
            endedAt: referenceDate,
            centerLatitude: home.latitude,
            centerLongitude: home.longitude,
            radiusMeters: 62,
            sampleCount: 31,
            placeExternalUid: home.externalUid,
            placeLabel: home.label,
            tags: ["home", "recovery"],
            metadata: ["seeded": "true"]
        )

        return MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [home, groceries],
            stays: [previousLongStay, groceryStay, ongoingStay],
            trips: [groceryTrip, returnTrip]
        )
    }

    static func syncReport() -> SyncReport {
        SyncReport(
            syncedAt: referenceDate.addingTimeInterval(-4 * 60),
            sleepSessions: 7,
            workouts: 3,
            createdCount: 8,
            updatedCount: 19,
            mergedCount: 6,
            movementStays: 3,
            movementTrips: 2,
            movementKnownPlaces: 2,
            screenTimeDaySummaries: 3,
            screenTimeHourlySegments: 12,
            screenTimeTotalActivitySeconds: 15_300
        )
    }

    static func syncPayloadSummary() -> SyncPayloadSummary {
        SyncPayloadSummary(
            builtAt: referenceDate.addingTimeInterval(-4 * 60),
            sleepSessions: 7,
            sleepStageEntries: 26,
            workouts: 3,
            workoutsWithAverageHeartRate: 2,
            workoutsWithMaxHeartRate: 2,
            workoutsWithStepCount: 3,
            movementKnownPlaces: 2,
            movementStays: 3,
            movementTrips: 2,
            movementTripPoints: 6,
            movementTripStops: 0,
            screenTimeDaySummaries: 3,
            screenTimeHourlySegments: 12,
            screenTimeTotalActivitySeconds: 15_300,
            rawHeartRateDatapointsSynced: 0
        )
    }

    @MainActor
    static func seedLogs() {
        let store = CompanionDebugLogStore.shared
        store.clear()
        let seededEntries: [(String, String, TimeInterval)] = [
            ("CompanionAppModel", "Pairing restored over Tailscale.", -8 * 60),
            ("MovementSyncStore", "Repaired local history into an active Home stay.", -6 * 60),
            ("ForgeSyncClient", "POST /mobile/healthkit/sync accepted with status 200.", -4 * 60),
            ("CompanionAppModel", "Background sync scheduled for low-friction capture.", -3 * 60),
            ("ForgeSyncClient", "Fetched movement timeline page from canonical Forge store.", -2 * 60)
        ]
        for (scope, message, offset) in seededEntries {
            store.record(
                scope: scope,
                message: message,
                timestamp: referenceDate.addingTimeInterval(offset)
            )
        }
    }

    static func isoString(_ value: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: value)
    }
}

struct CompanionScreenshotForgeCanvas: View {
    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 18) {
                RoundedRectangle(cornerRadius: 30, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [
                                CompanionStyle.accentStrong.opacity(0.96),
                                CompanionStyle.accent.opacity(0.8)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(height: 196)
                    .overlay(alignment: .topLeading) {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Forge")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                                .foregroundStyle(Color(red: 11 / 255, green: 19 / 255, blue: 38 / 255).opacity(0.74))

                            Text("Companion linked")
                                .font(.system(size: 31, weight: .bold, design: .rounded))
                                .foregroundStyle(Color(red: 11 / 255, green: 19 / 255, blue: 38 / 255))

                            Text("Health, movement, and life history are flowing into your Forge runtime.")
                                .font(.system(size: 15, weight: .medium, design: .rounded))
                                .foregroundStyle(Color(red: 11 / 255, green: 19 / 255, blue: 38 / 255).opacity(0.82))
                                .frame(maxWidth: 260, alignment: .leading)

                            Spacer()

                            HStack(spacing: 12) {
                                screenshotPill("Healthy sync")
                                screenshotPill("Tailscale")
                            }
                        }
                        .padding(22)
                    }

                HStack(spacing: 14) {
                    screenshotMetricCard(
                        title: "Last sync",
                        value: "09:37",
                        detail: "7 sleep sessions"
                    )
                    screenshotMetricCard(
                        title: "Movement",
                        value: "3 stays",
                        detail: "2 repaired trips"
                    )
                }

                screenshotTimelineCard
                screenshotCoverageCard
            }
            .padding(.horizontal, 18)
            .padding(.top, 76)
            .padding(.bottom, 38)
        }
    }

    private func screenshotPill(_ label: String) -> some View {
        Text(label)
            .font(.system(size: 12, weight: .bold, design: .rounded))
            .foregroundStyle(Color(red: 11 / 255, green: 19 / 255, blue: 38 / 255))
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color.white.opacity(0.56), in: Capsule())
    }

    private func screenshotMetricCard(title: String, value: String, detail: String) -> some View {
        CompanionSectionCard {
            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textMuted)
                Text(value)
                    .font(.system(size: 24, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)
                Text(detail)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.textSecondary)
            }
        }
    }

    private var screenshotTimelineCard: some View {
        CompanionSectionCard {
            VStack(alignment: .leading, spacing: 16) {
                Text("Today")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)

                HStack(alignment: .top, spacing: 16) {
                    VStack(spacing: 0) {
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(CompanionStyle.accentStrong.opacity(0.88))
                            .frame(width: 18, height: 92)
                        Rectangle()
                            .fill(CompanionStyle.accentStrong.opacity(0.58))
                            .frame(width: 2, height: 54)
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(Color.white.opacity(0.14))
                            .frame(width: 18, height: 38)
                    }

                    VStack(alignment: .leading, spacing: 18) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Home")
                                .font(.system(size: 17, weight: .bold, design: .rounded))
                                .foregroundStyle(CompanionStyle.textPrimary)
                            Text("Ongoing stay · 3.6h")
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .foregroundStyle(CompanionStyle.textSecondary)
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Groceries run")
                                .font(.system(size: 16, weight: .bold, design: .rounded))
                                .foregroundStyle(CompanionStyle.textPrimary)
                            Text("1.1 km walk · 22 min")
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .foregroundStyle(CompanionStyle.textSecondary)
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Groceries")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                                .foregroundStyle(CompanionStyle.textPrimary)
                            Text("Short stop before heading home")
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .foregroundStyle(CompanionStyle.textSecondary)
                        }
                    }
                }
            }
        }
    }

    private var screenshotCoverageCard: some View {
        CompanionSectionCard {
            VStack(alignment: .leading, spacing: 12) {
                Text("Captured automatically")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)

                ForEach(
                    [
                        ("HealthKit sleep", "7 sessions"),
                        ("Workout imports", "3 summaries"),
                        ("Known places", "2 canonical places"),
                        ("Movement timeline", "Repairs gaps and keeps stays active")
                    ],
                    id: \.0
                ) { row in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(row.0)
                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                            .foregroundStyle(CompanionStyle.textSecondary)
                        Spacer()
                        Text(row.1)
                            .font(.system(size: 12, weight: .bold, design: .rounded))
                            .foregroundStyle(CompanionStyle.accentStrong)
                    }
                }
            }
        }
    }
}
