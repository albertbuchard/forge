import Foundation
import Combine
import CoreLocation
import CoreMotion
import UIKit

@MainActor
final class MovementSyncStore: NSObject, ObservableObject, @preconcurrency CLLocationManagerDelegate {
    // Movement repair rules are intentionally duplicated here and on the server.
    // They are binding, and the tests are expected to enforce them:
    // 1. Every positive-duration interval must be labeled as stay, trip, or missing.
    // 2. Missing is never allowed for gaps under one hour.
    // 3. Any move with cumulative distance under 100m is invalid and must be repaired into stay.
    // 4. Any move with duration under 5 minutes is invalid and must be repaired into stay.
    // 5. For gaps under one hour:
    //    - same place / same anchor => continue stay
    //    - different place => repaired trip only when boundary displacement is >100m
    //      and the gap lasts at least 5 minutes
    //    - otherwise => repaired stay
    private enum DetectionThresholds {
        static let stayRadiusMeters: Double = 100
        static let stayConfirmationSeconds: TimeInterval = 10 * 60
        static let tripMinimumSeconds: TimeInterval = 5 * 60
        static let tripMinimumDisplacementMeters: Double = 100
        static let stopMinimumSeconds: TimeInterval = 3 * 60
        static let stayContinuityGapSeconds: TimeInterval = 60 * 60
        static let coverageAuditWindowSeconds: TimeInterval = 30 * 60
    }

    struct StoredKnownPlace: Codable, Identifiable, Hashable {
        let id: String
        var externalUid: String
        var label: String
        var aliases: [String]
        var latitude: Double
        var longitude: Double
        var radiusMeters: Double
        var categoryTags: [String]
        var visibility: String
        var wikiNoteId: String?
        var metadata: [String: String]
    }

    struct StoredStay: Codable, Identifiable {
        let id: String
        var label: String
        var status: String
        var classification: String
        var startedAt: Date
        var endedAt: Date
        var centerLatitude: Double
        var centerLongitude: Double
        var radiusMeters: Double
        var sampleCount: Int
        var placeExternalUid: String
        var placeLabel: String
        var tags: [String]
        var metadata: [String: String]
    }

    struct StoredTripPoint: Codable, Identifiable {
        let id: String
        var externalUid: String
        var recordedAt: Date
        var latitude: Double
        var longitude: Double
        var accuracyMeters: Double?
        var altitudeMeters: Double?
        var speedMps: Double?
        var isStopAnchor: Bool

        init(
            id: String,
            externalUid: String,
            recordedAt: Date,
            latitude: Double,
            longitude: Double,
            accuracyMeters: Double?,
            altitudeMeters: Double?,
            speedMps: Double?,
            isStopAnchor: Bool
        ) {
            self.id = id
            self.externalUid = externalUid
            self.recordedAt = recordedAt
            self.latitude = latitude
            self.longitude = longitude
            self.accuracyMeters = accuracyMeters
            self.altitudeMeters = altitudeMeters
            self.speedMps = speedMps
            self.isStopAnchor = isStopAnchor
        }

        private enum CodingKeys: String, CodingKey {
            case id
            case externalUid
            case recordedAt
            case latitude
            case longitude
            case accuracyMeters
            case altitudeMeters
            case speedMps
            case isStopAnchor
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            let id = try container.decode(String.self, forKey: .id)
            self.id = id
            self.externalUid =
                try container.decodeIfPresent(String.self, forKey: .externalUid)
                ?? id
            self.recordedAt = try container.decode(Date.self, forKey: .recordedAt)
            self.latitude = try container.decode(Double.self, forKey: .latitude)
            self.longitude = try container.decode(Double.self, forKey: .longitude)
            self.accuracyMeters = try container.decodeIfPresent(Double.self, forKey: .accuracyMeters)
            self.altitudeMeters = try container.decodeIfPresent(Double.self, forKey: .altitudeMeters)
            self.speedMps = try container.decodeIfPresent(Double.self, forKey: .speedMps)
            self.isStopAnchor = try container.decode(Bool.self, forKey: .isStopAnchor)
        }
    }

    struct StoredTripStop: Codable, Identifiable {
        let id: String
        var externalUid: String
        var label: String
        var startedAt: Date
        var endedAt: Date
        var latitude: Double
        var longitude: Double
        var radiusMeters: Double
        var placeExternalUid: String
        var metadata: [String: String]
    }

    struct StoredTrip: Codable, Identifiable {
        let id: String
        var label: String
        var status: String
        var travelMode: String
        var activityType: String
        var startedAt: Date
        var endedAt: Date
        var startPlaceExternalUid: String
        var endPlaceExternalUid: String
        var distanceMeters: Double
        var movingSeconds: Int
        var idleSeconds: Int
        var averageSpeedMps: Double?
        var maxSpeedMps: Double?
        var caloriesKcal: Double?
        var expectedMet: Double?
        var tags: [String]
        var metadata: [String: String]
        var points: [StoredTripPoint]
        var stops: [StoredTripStop]
    }

    struct PersistedState: Codable {
        var trackingEnabled: Bool
        var publishMode: String
        var retentionMode: String
        var knownPlaces: [StoredKnownPlace]
        var stays: [StoredStay]
        var trips: [StoredTrip]
        var projectedBoxes: [ForgeMovementTimelineSegment] = []
    }

    struct TimelineSegment: Identifiable {
        enum Kind: String, Hashable {
            case stay
            case trip
            case missing
        }

        enum Origin: String, Hashable {
            case recorded = "recorded"
            case continuedStay = "continued_stay"
            case repairedGap = "repaired_gap"
            case missing = "missing"
        }

        let id: String
        let kind: Kind
        let origin: Origin
        let startedAt: Date
        let endedAt: Date
        let title: String
        let subtitle: String
        let placeLabel: String?
        let anchorExternalUid: String?
        let coordinate: CLLocationCoordinate2D?
        let tags: [String]
        let distanceMeters: Double?
        let averageSpeedMps: Double?
        let stayId: String?
        let tripId: String?
        let editable: Bool

        init(
            id: String,
            kind: Kind,
            origin: Origin,
            startedAt: Date,
            endedAt: Date,
            title: String,
            subtitle: String,
            placeLabel: String?,
            anchorExternalUid: String? = nil,
            coordinate: CLLocationCoordinate2D?,
            tags: [String],
            distanceMeters: Double?,
            averageSpeedMps: Double?,
            stayId: String?,
            tripId: String?,
            editable: Bool
        ) {
            self.id = id
            self.kind = kind
            self.origin = origin
            self.startedAt = startedAt
            self.endedAt = endedAt
            self.title = title
            self.subtitle = subtitle
            self.placeLabel = placeLabel
            self.anchorExternalUid = anchorExternalUid
            self.coordinate = coordinate
            self.tags = tags
            self.distanceMeters = distanceMeters
            self.averageSpeedMps = averageSpeedMps
            self.stayId = stayId
            self.tripId = tripId
            self.editable = editable
        }
    }

    private enum StorageKeys {
        static let movementState = "forge_companion_movement_state"
    }

    private enum KnownPlaceDeduplicationContext: String {
        case bootstrapLocal = "bootstrap_local"
        case bootstrapRemote = "bootstrap_remote"
        case localMutation = "local_mutation"
        case persistedState = "persisted_state"
        case testingState = "testing_state"
    }

    @Published private(set) var trackingEnabled = false
    @Published private(set) var publishMode = "auto_publish"
    @Published private(set) var retentionMode = "aggregates_only"
    @Published private(set) var knownPlaces: [StoredKnownPlace] = []
    @Published private(set) var storedStays: [StoredStay] = []
    @Published private(set) var storedTrips: [StoredTrip] = []
    @Published private(set) var cachedProjectedBoxes: [ForgeMovementTimelineSegment] = []
    @Published private(set) var latestLocationSummary = "No location yet"
    @Published private(set) var locationPermissionStatus = "not_determined"
    @Published private(set) var motionPermissionStatus = "unknown"
    @Published private(set) var backgroundTrackingReady = false
    @Published private(set) var recentRepairDiagnostics: [String] = []

    private let locationManager = CLLocationManager()
    private let activityManager = CMMotionActivityManager()
    private let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private var recentLocations: [CLLocation] = []
    private var latestActivity: CMMotionActivity?
    private var lastAcceptedLocationAt: Date?
    private var currentStayId: String?
    private var currentTripId: String?
    private var stationaryCandidateStartedAt: Date?
    private var lastStopWindowStartedAt: Date?
    private var shouldEscalateToAlwaysAuthorization = false
    private var suspendedStayIdBeforeTrip: String?
    private let testingMode: Bool

    override init() {
        self.testingMode = false
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        locationManager.distanceFilter = 3
        locationManager.pausesLocationUpdatesAutomatically = false
        loadState()
        refreshPermissionState()
        startMotionUpdatesIfAvailable()
        applyTrackingState()
    }

    #if DEBUG
    init(testingState: PersistedState? = nil) {
        self.testingMode = true
        super.init()
        if let testingState {
            trackingEnabled = testingState.trackingEnabled
            publishMode = testingState.publishMode
            retentionMode = testingState.retentionMode
            knownPlaces = deduplicatedKnownPlaces(
                testingState.knownPlaces,
                context: .testingState
            )
            storedStays = testingState.stays
            storedTrips = testingState.trips
            cachedProjectedBoxes = testingState.projectedBoxes
            currentStayId = storedStays.first(where: { $0.status == "active" })?.id
            currentTripId = storedTrips.first(where: { $0.status == "active" })?.id
            repairStoredTimelineState(referenceDate: testingReferenceDate(for: testingState))
        } else {
            trackingEnabled = false
            publishMode = "auto_publish"
            retentionMode = "aggregates_only"
            knownPlaces = []
            storedStays = []
            storedTrips = []
            cachedProjectedBoxes = []
        }
        locationPermissionStatus = "always"
        motionPermissionStatus = "ready"
        backgroundTrackingReady = true
    }
    #endif

    func setTrackingEnabled(_ enabled: Bool) {
        trackingEnabled = enabled
        persistState()
        applyTrackingState()
    }

    func setPublishMode(_ mode: String) {
        publishMode = mode
        persistState()
    }

    func requestLocationAuthorization() {
        companionDebugLog("MovementSyncStore", "requestLocationAuthorization start")
        refreshPermissionState()
        switch locationManager.authorizationStatus {
        case .notDetermined:
            shouldEscalateToAlwaysAuthorization = true
            locationManager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse:
            shouldEscalateToAlwaysAuthorization = false
            locationManager.requestAlwaysAuthorization()
        case .authorizedAlways:
            shouldEscalateToAlwaysAuthorization = false
            applyTrackingState()
        case .denied, .restricted:
            shouldEscalateToAlwaysAuthorization = false
            openAppSettings()
        @unknown default:
            shouldEscalateToAlwaysAuthorization = false
        }
    }

    @discardableResult
    func addKnownPlace(
        label: String,
        categoryTags: [String],
        latitude: Double? = nil,
        longitude: Double? = nil
    ) -> StoredKnownPlace? {
        let resolvedLatitude: Double
        let resolvedLongitude: Double
        if let latitude, let longitude {
            resolvedLatitude = latitude
            resolvedLongitude = longitude
        } else if let latestLocation = recentLocations.last {
            resolvedLatitude = latestLocation.coordinate.latitude
            resolvedLongitude = latestLocation.coordinate.longitude
        } else {
            companionDebugLog("MovementSyncStore", "addKnownPlace skipped no coordinates")
            return nil
        }
        let place = StoredKnownPlace(
            id: "place_\(UUID().uuidString.lowercased())",
            externalUid: "ios-place-\(UUID().uuidString.lowercased())",
            label: label,
            aliases: [],
            latitude: resolvedLatitude,
            longitude: resolvedLongitude,
            radiusMeters: 100,
            categoryTags: categoryTags,
            visibility: "shared",
            wikiNoteId: nil,
            metadata: [:]
        )
        knownPlaces = [place] + knownPlaces.filter { $0.label != place.label }
        persistState()
        return place
    }

    func storeKnownPlace(_ place: StoredKnownPlace) {
        let placeKey = knownPlaceKey(for: place)
        knownPlaces = deduplicatedKnownPlaces(
            [place] + knownPlaces.filter { knownPlaceKey(for: $0) != placeKey },
            context: .localMutation
        )
        persistState()
    }

    func mergeBootstrap(_ bootstrap: SyncReceipt.MovementBootstrapEnvelope?) {
        guard let bootstrap else {
            return
        }
        publishMode = bootstrap.settings.publishMode
        retentionMode = bootstrap.settings.retentionMode
        let remotePlaces = bootstrap.places.map { place in
            StoredKnownPlace(
                id: place.id,
                externalUid: place.externalUid,
                label: place.label,
                aliases: place.aliases,
                latitude: place.latitude,
                longitude: place.longitude,
                radiusMeters: place.radiusMeters,
                categoryTags: place.categoryTags,
                visibility: "shared",
                wikiNoteId: nil,
                metadata: [:]
            )
        }
        let normalizedLocalPlaces = deduplicatedKnownPlaces(
            knownPlaces,
            context: .bootstrapLocal
        )
        let normalizedRemotePlaces = deduplicatedKnownPlaces(
            remotePlaces,
            context: .bootstrapRemote
        )
        let localByExternalUid = Dictionary(
            uniqueKeysWithValues: normalizedLocalPlaces.map { (knownPlaceKey(for: $0), $0) }
        )
        let remotePlaceKeys = Set(normalizedRemotePlaces.map(knownPlaceKey(for:)))
        knownPlaces = normalizedRemotePlaces.map { remotePlace in
            localByExternalUid[knownPlaceKey(for: remotePlace)] ?? remotePlace
        } + normalizedLocalPlaces.filter { localPlace in
            !remotePlaceKeys.contains(knownPlaceKey(for: localPlace))
        }
        if bootstrap.deletedStayExternalUids.isEmpty == false {
            storedStays.removeAll { stay in
                bootstrap.deletedStayExternalUids.contains(stay.id)
            }
        }
        if bootstrap.deletedTripExternalUids.isEmpty == false {
            storedTrips.removeAll { trip in
                bootstrap.deletedTripExternalUids.contains(trip.id)
            }
        }
        bootstrap.stayOverrides.forEach { stay in
            reconcileCanonicalStay(stay)
        }
        bootstrap.tripOverrides.forEach { trip in
            reconcileCanonicalTrip(trip)
        }
        cacheCanonicalProjectedBoxes(bootstrap.projectedBoxes)
        repairStoredTimelineState(referenceDate: Date())
        persistState()
    }

    func cacheCanonicalProjectedBoxes(_ boxes: [ForgeMovementTimelineSegment]) {
        var deduplicated: [String: ForgeMovementTimelineSegment] = [:]
        for box in boxes {
            if let existing = deduplicated[box.id] {
                if box.startedAt < existing.startedAt || box.endedAt > existing.endedAt {
                    deduplicated[box.id] = box
                }
            } else {
                deduplicated[box.id] = box
            }
        }
        cachedProjectedBoxes = deduplicated.values.sorted { left, right in
            left.startedAt < right.startedAt
        }
        persistState()
    }

    func buildMovementPayload() -> CompanionSyncPayload.MovementPayload {
        refreshDerivedTimelineState(referenceDate: Date())
        pruneLongTermRawPointsIfNeeded()
        if trackingEnabled == false {
            return CompanionSyncPayload.MovementPayload(
                settings: .init(
                    trackingEnabled: false,
                    publishMode: publishMode,
                    retentionMode: retentionMode,
                    locationPermissionStatus: locationPermissionStatus,
                    motionPermissionStatus: motionPermissionStatus,
                    backgroundTrackingReady: backgroundTrackingReady,
                    metadata: [
                        "latestLocationSummary": latestLocationSummary
                    ]
                ),
                knownPlaces: [],
                stays: [],
                trips: []
            )
        }
        let syncableTrips = storedTrips.filter(tripQualifies)
        return CompanionSyncPayload.MovementPayload(
            settings: .init(
                trackingEnabled: trackingEnabled,
                publishMode: publishMode,
                retentionMode: retentionMode,
                locationPermissionStatus: locationPermissionStatus,
                motionPermissionStatus: motionPermissionStatus,
                backgroundTrackingReady: backgroundTrackingReady,
                metadata: [
                    "latestLocationSummary": latestLocationSummary
                ]
            ),
            knownPlaces: knownPlaces.map { place in
                .init(
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
                    metadata: place.metadata
                )
            },
            stays: storedStays.map { stay in
                .init(
                    externalUid: stay.id,
                    label: stay.label,
                    status: stay.status,
                    classification: stay.classification,
                    startedAt: isoString(stay.startedAt),
                    endedAt: isoString(stay.endedAt),
                    centerLatitude: stay.centerLatitude,
                    centerLongitude: stay.centerLongitude,
                    radiusMeters: stay.radiusMeters,
                    sampleCount: stay.sampleCount,
                    placeExternalUid: stay.placeExternalUid,
                    placeLabel: stay.placeLabel,
                    tags: stay.tags,
                    metadata: stay.metadata
                )
            },
            trips: syncableTrips.map { trip in
                .init(
                    externalUid: trip.id,
                    label: trip.label,
                    status: trip.status,
                    travelMode: trip.travelMode,
                    activityType: trip.activityType,
                    startedAt: isoString(trip.startedAt),
                    endedAt: isoString(trip.endedAt),
                    startPlaceExternalUid: trip.startPlaceExternalUid,
                    endPlaceExternalUid: trip.endPlaceExternalUid,
                    distanceMeters: trip.distanceMeters,
                    movingSeconds: trip.movingSeconds,
                    idleSeconds: trip.idleSeconds,
                    averageSpeedMps: trip.averageSpeedMps,
                    maxSpeedMps: trip.maxSpeedMps,
                    caloriesKcal: trip.caloriesKcal,
                    expectedMet: trip.expectedMet,
                    tags: trip.tags,
                    metadata: trip.metadata,
                    points: trip.points.map { point in
                        .init(
                            externalUid: point.externalUid,
                            recordedAt: isoString(point.recordedAt),
                            latitude: point.latitude,
                            longitude: point.longitude,
                            accuracyMeters: point.accuracyMeters,
                            altitudeMeters: point.altitudeMeters,
                            speedMps: point.speedMps,
                            isStopAnchor: point.isStopAnchor
                        )
                    },
                    stops: trip.stops.map { stop in
                        .init(
                            externalUid: stop.externalUid,
                            label: stop.label,
                            startedAt: isoString(stop.startedAt),
                            endedAt: isoString(stop.endedAt),
                            latitude: stop.latitude,
                            longitude: stop.longitude,
                            radiusMeters: stop.radiusMeters,
                            placeExternalUid: stop.placeExternalUid,
                            metadata: stop.metadata
                        )
                    }
                )
            }
        )
    }

    var captureSummary: String {
        if trackingEnabled == false {
            return "Passive capture is off"
        }
        let staysCount = storedStays.count
        let tripsCount = storedTrips.count
        return "\(staysCount) stays · \(tripsCount) trips"
    }

    var activeStay: StoredStay? {
        guard let currentStayId else {
            return nil
        }
        return storedStays.first(where: { $0.id == currentStayId })
    }

    var activeTrip: StoredTrip? {
        guard let currentTripId else {
            return nil
        }
        return storedTrips.first(where: { $0.id == currentTripId })
    }

    func refreshDerivedTimelineState(referenceDate: Date = Date()) {
        repairStoredTimelineState(referenceDate: referenceDate)
        if currentTripId != nil {
            latestLocationSummary = "Current state: moving"
        } else if currentStayId != nil {
            latestLocationSummary = "Current state: staying"
        } else {
            latestLocationSummary = "Current state: unknown"
        }
        persistState()
    }

    @discardableResult
    func runCoverageRepair(
        reason: String,
        referenceDate: Date = Date()
    ) -> [TimelineSegment] {
        companionDebugLog(
            "MovementSyncStore",
            "runCoverageRepair start reason=\(reason)"
        )
        refreshDerivedTimelineState(referenceDate: referenceDate)
        let timeline = buildHistoricalTimelineSegments(referenceDate: referenceDate)
        companionDebugLog(
            "MovementSyncStore",
            "runCoverageRepair complete reason=\(reason) segments=\(timeline.count) diagnostics=\(recentRepairDiagnostics.joined(separator: "|"))"
        )
        return timeline
    }

    func buildHistoricalTimelineSegments(referenceDate: Date = Date()) -> [TimelineSegment] {
        repairStoredTimelineState(referenceDate: referenceDate)

        struct Boundary {
            let coordinate: CLLocationCoordinate2D?
            let placeLabel: String?
            let placeExternalUid: String?
        }

        struct RecordedSegment {
            let id: String
            let kind: TimelineSegment.Kind
            let startedAt: Date
            let endedAt: Date
            let title: String
            let subtitle: String
            let placeLabel: String?
            let tags: [String]
            let distanceMeters: Double?
            let averageSpeedMps: Double?
            let stayId: String?
            let tripId: String?
            let startBoundary: Boundary
            let endBoundary: Boundary
        }

        struct NormalizedSegment {
            let id: String
            let kind: TimelineSegment.Kind
            let origin: TimelineSegment.Origin
            let startedAt: Date
            let endedAt: Date
            let title: String
            let subtitle: String
            let placeLabel: String?
            let anchorExternalUid: String?
            let coordinate: CLLocationCoordinate2D?
            let tags: [String]
            let distanceMeters: Double?
            let averageSpeedMps: Double?
            let stayId: String?
            let tripId: String?
            let editable: Bool
            let startBoundary: Boundary
            let endBoundary: Boundary
        }

        let activeStayId = currentStayId
        let activeTripId = currentTripId
        let recordedSegments =
            storedStays
                .filter { $0.id != activeStayId }
                .compactMap { stay -> RecordedSegment? in
                    guard stay.endedAt > stay.startedAt else {
                        return nil
                    }
                    let title = stay.placeLabel.isEmpty ? stay.label : stay.placeLabel
                    let coordinate = CLLocationCoordinate2D(
                        latitude: stay.centerLatitude,
                        longitude: stay.centerLongitude
                    )
                    return RecordedSegment(
                        id: "stay-\(stay.id)",
                        kind: .stay,
                        startedAt: stay.startedAt,
                        endedAt: stay.endedAt,
                        title: title.isEmpty ? "Stay" : title,
                        subtitle: stay.tags.isEmpty ? "Recorded stay" : stay.tags.joined(separator: " · "),
                        placeLabel: stay.placeLabel.isEmpty ? nil : stay.placeLabel,
                        tags: stay.tags,
                        distanceMeters: nil,
                        averageSpeedMps: nil,
                        stayId: stay.id,
                        tripId: nil,
                        startBoundary: Boundary(
                            coordinate: coordinate,
                            placeLabel: stay.placeLabel.isEmpty ? nil : stay.placeLabel,
                            placeExternalUid: stay.placeExternalUid.isEmpty ? nil : stay.placeExternalUid
                        ),
                        endBoundary: Boundary(
                            coordinate: coordinate,
                            placeLabel: stay.placeLabel.isEmpty ? nil : stay.placeLabel,
                            placeExternalUid: stay.placeExternalUid.isEmpty ? nil : stay.placeExternalUid
                        )
                    )
                }
                +
                storedTrips
                .filter { $0.id != activeTripId && $0.status != "invalid" }
                .compactMap { trip -> RecordedSegment? in
                    guard trip.endedAt > trip.startedAt else {
                        return nil
                    }
                    if trip.status != "active" && tripQualifies(trip) == false {
                        return nil
                    }
                    let startPoint = trip.points.first
                    let endPoint = trip.points.last
                    let startPlace = place(forExternalUid: trip.startPlaceExternalUid)
                    let endPlace = place(forExternalUid: trip.endPlaceExternalUid)
                    let title = trip.label.isEmpty ? "Trip" : trip.label
                    return RecordedSegment(
                        id: "trip-\(trip.id)",
                        kind: .trip,
                        startedAt: trip.startedAt,
                        endedAt: trip.endedAt,
                        title: title,
                        subtitle: trip.tags.isEmpty
                            ? (trip.activityType.isEmpty ? "Recorded trip" : trip.activityType)
                            : trip.tags.joined(separator: " · "),
                        placeLabel: endPlace?.label ?? startPlace?.label,
                        tags: trip.tags,
                        distanceMeters: trip.distanceMeters,
                        averageSpeedMps: trip.averageSpeedMps,
                        stayId: nil,
                        tripId: trip.id,
                        startBoundary: Boundary(
                            coordinate: startPoint.map {
                                CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
                            } ?? startPlace.map {
                                CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
                            },
                            placeLabel: startPlace?.label,
                            placeExternalUid: trip.startPlaceExternalUid.isEmpty ? nil : trip.startPlaceExternalUid
                        ),
                        endBoundary: Boundary(
                            coordinate: endPoint.map {
                                CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
                            } ?? endPlace.map {
                                CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
                            },
                            placeLabel: endPlace?.label,
                            placeExternalUid: trip.endPlaceExternalUid.isEmpty ? nil : trip.endPlaceExternalUid
                        )
                    )
                }

        let sorted = recordedSegments.sorted {
            $0.startedAt < $1.startedAt
        }

        func distanceMeters(
            from start: CLLocationCoordinate2D?,
            to end: CLLocationCoordinate2D?
        ) -> Double? {
            guard let start, let end else {
                return nil
            }
            return CLLocation(latitude: start.latitude, longitude: start.longitude)
                .distance(from: CLLocation(latitude: end.latitude, longitude: end.longitude))
        }

        func boundariesShareAnchor(
            _ left: Boundary,
            _ right: Boundary
        ) -> Bool {
            if let leftExternalUid = left.placeExternalUid,
               let rightExternalUid = right.placeExternalUid,
               leftExternalUid == rightExternalUid
            {
                return true
            }
            guard let displacement = distanceMeters(from: left.coordinate, to: right.coordinate) else {
                return false
            }
            return displacement <= DetectionThresholds.tripMinimumDisplacementMeters
        }

        func makeMissingSegment(
            id: String,
            startedAt: Date,
            endedAt: Date,
            subtitle: String
        ) -> NormalizedSegment {
            NormalizedSegment(
                id: id,
                kind: .missing,
                origin: .missing,
                startedAt: startedAt,
                endedAt: endedAt,
                title: "Missing data",
                subtitle: subtitle,
                placeLabel: nil,
                anchorExternalUid: nil,
                coordinate: nil,
                tags: ["missing-data"],
                distanceMeters: nil,
                averageSpeedMps: nil,
                stayId: nil,
                tripId: nil,
                editable: false,
                startBoundary: Boundary(coordinate: nil, placeLabel: nil, placeExternalUid: nil),
                endBoundary: Boundary(coordinate: nil, placeLabel: nil, placeExternalUid: nil)
            )
        }

        func classifyGap(
            from previous: NormalizedSegment,
            to next: NormalizedSegment
        ) -> NormalizedSegment? {
            let gapSeconds = next.startedAt.timeIntervalSince(previous.endedAt)
            guard gapSeconds > 0 else {
                return nil
            }
            if gapSeconds > DetectionThresholds.stayContinuityGapSeconds {
                return makeMissingSegment(
                    id: "missing-\(previous.id)-\(next.id)",
                    startedAt: previous.endedAt,
                    endedAt: next.startedAt,
                    subtitle: "No reliable movement signal reached the phone here."
                )
            }

            if boundariesShareAnchor(previous.endBoundary, next.startBoundary) {
                let placeLabel = previous.endBoundary.placeLabel ?? next.startBoundary.placeLabel
                let anchorExternalUid =
                    previous.endBoundary.placeExternalUid ?? next.startBoundary.placeExternalUid
                return NormalizedSegment(
                    id: "repaired-stay-\(previous.id)-\(next.id)",
                    kind: .stay,
                    origin: .repairedGap,
                    startedAt: previous.endedAt,
                    endedAt: next.startedAt,
                    title: placeLabel ?? "Repaired stay",
                    subtitle: "Short quiet gap repaired as one stay.",
                    placeLabel: placeLabel,
                    anchorExternalUid: anchorExternalUid,
                    coordinate: previous.endBoundary.coordinate ?? next.startBoundary.coordinate,
                    tags: ["repaired-gap"],
                    distanceMeters: nil,
                    averageSpeedMps: nil,
                    stayId: nil,
                    tripId: nil,
                    editable: false,
                    startBoundary: previous.endBoundary,
                    endBoundary: next.startBoundary
                )
            }

            let displacement = distanceMeters(
                from: previous.endBoundary.coordinate,
                to: next.startBoundary.coordinate
            )

            if gapSeconds < DetectionThresholds.tripMinimumSeconds {
                let placeLabel = previous.endBoundary.placeLabel ?? next.startBoundary.placeLabel
                let anchorExternalUid =
                    previous.endBoundary.placeExternalUid ?? next.startBoundary.placeExternalUid
                return NormalizedSegment(
                    id: "repaired-short-jump-\(previous.id)-\(next.id)",
                    kind: .stay,
                    origin: .repairedGap,
                    startedAt: previous.endedAt,
                    endedAt: next.startedAt,
                    title: placeLabel ?? "Repaired stay",
                    subtitle: "Short jump under five minutes suppressed into stay continuity.",
                    placeLabel: placeLabel,
                    anchorExternalUid: anchorExternalUid,
                    coordinate: previous.endBoundary.coordinate ?? next.startBoundary.coordinate,
                    tags: ["repaired-gap", "suppressed-short-jump"],
                    distanceMeters: nil,
                    averageSpeedMps: nil,
                    stayId: nil,
                    tripId: nil,
                    editable: false,
                    startBoundary: previous.endBoundary,
                    endBoundary: next.startBoundary
                )
            }

            guard let displacement else {
                let placeLabel = previous.endBoundary.placeLabel ?? next.startBoundary.placeLabel
                let anchorExternalUid =
                    previous.endBoundary.placeExternalUid ?? next.startBoundary.placeExternalUid
                return NormalizedSegment(
                    id: "repaired-gap-stay-\(previous.id)-\(next.id)",
                    kind: .stay,
                    origin: .repairedGap,
                    startedAt: previous.endedAt,
                    endedAt: next.startedAt,
                    title: placeLabel ?? "Repaired stay",
                    subtitle: "Short gap defaulted to stay continuity because boundary movement evidence was incomplete.",
                    placeLabel: placeLabel,
                    anchorExternalUid: anchorExternalUid,
                    coordinate: previous.endBoundary.coordinate ?? next.startBoundary.coordinate,
                    tags: ["repaired-gap", "boundary-incomplete"],
                    distanceMeters: nil,
                    averageSpeedMps: nil,
                    stayId: nil,
                    tripId: nil,
                    editable: false,
                    startBoundary: previous.endBoundary,
                    endBoundary: next.startBoundary
                )
            }

            guard displacement > DetectionThresholds.tripMinimumDisplacementMeters else {
                let placeLabel = previous.endBoundary.placeLabel ?? next.startBoundary.placeLabel
                let anchorExternalUid =
                    previous.endBoundary.placeExternalUid ?? next.startBoundary.placeExternalUid
                return NormalizedSegment(
                    id: "repaired-short-distance-\(previous.id)-\(next.id)",
                    kind: .stay,
                    origin: .repairedGap,
                    startedAt: previous.endedAt,
                    endedAt: next.startedAt,
                    title: placeLabel ?? "Repaired stay",
                    subtitle: "Short gap stayed under the 100m move threshold, so it was kept as stay continuity.",
                    placeLabel: placeLabel,
                    anchorExternalUid: anchorExternalUid,
                    coordinate: previous.endBoundary.coordinate ?? next.startBoundary.coordinate,
                    tags: ["repaired-gap", "under-distance-threshold"],
                    distanceMeters: nil,
                    averageSpeedMps: nil,
                    stayId: nil,
                    tripId: nil,
                    editable: false,
                    startBoundary: previous.endBoundary,
                    endBoundary: next.startBoundary
                )
            }

            return NormalizedSegment(
                id: "repaired-trip-\(previous.id)-\(next.id)",
                kind: .trip,
                origin: .repairedGap,
                startedAt: previous.endedAt,
                endedAt: next.startedAt,
                title: "\(previous.endBoundary.placeLabel ?? previous.title) → \(next.startBoundary.placeLabel ?? next.title)",
                subtitle: "Short gap repaired as a move between known anchors.",
                placeLabel: next.startBoundary.placeLabel ?? previous.endBoundary.placeLabel,
                anchorExternalUid: nil,
                coordinate: nil,
                tags: ["repaired-gap"],
                distanceMeters: displacement,
                averageSpeedMps: displacement / max(gapSeconds, 1),
                stayId: nil,
                tripId: nil,
                editable: false,
                startBoundary: previous.endBoundary,
                endBoundary: next.startBoundary
            )
        }

        func coalesceStaySegments(_ segments: [NormalizedSegment]) -> [NormalizedSegment] {
            var output: [NormalizedSegment] = []
            for segment in segments {
                guard let previous = output.last else {
                    output.append(segment)
                    continue
                }
                let shouldMerge =
                    previous.kind == .stay
                    && segment.kind == .stay
                    && (previous.origin != .recorded || segment.origin != .recorded)
                    && segment.startedAt.timeIntervalSince(previous.endedAt) == 0
                    && boundariesShareAnchor(previous.endBoundary, segment.startBoundary)
                if !shouldMerge {
                    output.append(segment)
                    continue
                }
                let mergedOrigin: TimelineSegment.Origin =
                    previous.origin == .continuedStay || segment.origin == .continuedStay
                    ? .continuedStay
                    : .repairedGap
                output[output.count - 1] = NormalizedSegment(
                    id: "coalesced-\(previous.id)-\(segment.id)",
                    kind: .stay,
                    origin: mergedOrigin,
                    startedAt: previous.startedAt,
                    endedAt: segment.endedAt,
                    title: previous.placeLabel ?? segment.placeLabel ?? "Continued stay",
                    subtitle:
                        mergedOrigin == .continuedStay
                        ? "Short stationary gap carried forward into one continuous stay."
                        : previous.tags.contains("suppressed-short-jump") || segment.tags.contains("suppressed-short-jump")
                            ? "Short jump under five minutes suppressed into stay continuity."
                            : "Short quiet gap repaired as one stay.",
                    placeLabel: previous.placeLabel ?? segment.placeLabel,
                    anchorExternalUid: previous.anchorExternalUid ?? segment.anchorExternalUid,
                    coordinate: previous.coordinate ?? segment.coordinate,
                    tags: Array(NSOrderedSet(array: previous.tags + segment.tags)) as? [String] ?? previous.tags,
                    distanceMeters: nil,
                    averageSpeedMps: nil,
                    stayId: nil,
                    tripId: nil,
                    editable: false,
                    startBoundary: previous.startBoundary,
                    endBoundary: segment.endBoundary
                )
            }
            return output
        }

        func updatedSegment(
            _ segment: NormalizedSegment,
            startedAt newStartedAt: Date? = nil,
            endedAt newEndedAt: Date? = nil
        ) -> NormalizedSegment? {
            let resolvedStartedAt = newStartedAt ?? segment.startedAt
            let resolvedEndedAt = newEndedAt ?? segment.endedAt
            guard resolvedEndedAt > resolvedStartedAt else {
                return nil
            }
            return NormalizedSegment(
                id: segment.id,
                kind: segment.kind,
                origin: segment.origin,
                startedAt: resolvedStartedAt,
                endedAt: resolvedEndedAt,
                title: segment.title,
                subtitle: segment.subtitle,
                placeLabel: segment.placeLabel,
                anchorExternalUid: segment.anchorExternalUid,
                coordinate: segment.coordinate,
                tags: segment.tags,
                distanceMeters:
                    segment.kind == .trip
                    ? segment.distanceMeters
                    : nil,
                averageSpeedMps: segment.averageSpeedMps,
                stayId: segment.stayId,
                tripId: segment.tripId,
                editable: segment.editable,
                startBoundary: segment.startBoundary,
                endBoundary: segment.endBoundary
            )
        }

        func mergeTimelineSegments(
            _ previous: NormalizedSegment,
            _ next: NormalizedSegment
        ) -> NormalizedSegment? {
            guard previous.kind == next.kind else {
                return nil
            }
            let overlapOrTouch = next.startedAt <= previous.endedAt
                || abs(next.startedAt.timeIntervalSince(previous.endedAt)) < 1
            guard overlapOrTouch else {
                return nil
            }
            let canMerge: Bool
            switch previous.kind {
            case .stay:
                canMerge = boundariesShareAnchor(previous.endBoundary, next.startBoundary)
                    || previous.origin != .recorded
                    || next.origin != .recorded
            case .trip, .missing:
                canMerge = true
            }
            guard canMerge else {
                return nil
            }
            let mergedOrigin: TimelineSegment.Origin
            if previous.origin == .continuedStay || next.origin == .continuedStay {
                mergedOrigin = .continuedStay
            } else if previous.origin == .repairedGap || next.origin == .repairedGap {
                mergedOrigin = .repairedGap
            } else if previous.origin == .missing || next.origin == .missing {
                mergedOrigin = .missing
            } else {
                mergedOrigin = .recorded
            }
            return NormalizedSegment(
                id: "merged-\(previous.id)-\(next.id)",
                kind: previous.kind,
                origin: mergedOrigin,
                startedAt: min(previous.startedAt, next.startedAt),
                endedAt: max(previous.endedAt, next.endedAt),
                title: previous.placeLabel ?? next.placeLabel ?? previous.title,
                subtitle:
                    mergedOrigin == .continuedStay
                    ? "Short stationary gap carried forward into one continuous stay."
                    : previous.tags.contains("suppressed-short-jump") || next.tags.contains("suppressed-short-jump")
                        ? "Short jump under five minutes suppressed into stay continuity."
                        : previous.subtitle,
                placeLabel: previous.placeLabel ?? next.placeLabel,
                anchorExternalUid: previous.anchorExternalUid ?? next.anchorExternalUid,
                coordinate: previous.coordinate ?? next.coordinate,
                tags: Array(NSOrderedSet(array: previous.tags + next.tags)) as? [String] ?? previous.tags,
                distanceMeters:
                    previous.kind == .trip
                    ? max(previous.distanceMeters ?? 0, next.distanceMeters ?? 0)
                    : nil,
                averageSpeedMps: previous.averageSpeedMps ?? next.averageSpeedMps,
                stayId:
                    mergedOrigin == .recorded
                    ? previous.stayId ?? next.stayId
                    : nil,
                tripId:
                    mergedOrigin == .recorded
                    ? previous.tripId ?? next.tripId
                    : nil,
                editable: mergedOrigin == .recorded,
                startBoundary: previous.startBoundary,
                endBoundary: next.endBoundary
            )
        }

        func ensureCoverageSegments(_ segments: [NormalizedSegment]) -> [NormalizedSegment] {
            let sorted = segments.sorted { left, right in
                if left.startedAt == right.startedAt {
                    return left.endedAt < right.endedAt
                }
                return left.startedAt < right.startedAt
            }
            guard sorted.isEmpty == false else {
                return []
            }

            var ensured: [NormalizedSegment] = []
            for segment in sorted {
                guard segment.endedAt > segment.startedAt else {
                    continue
                }
                guard let previous = ensured.last else {
                    ensured.append(segment)
                    continue
                }

                if let merged = mergeTimelineSegments(previous, segment) {
                    ensured[ensured.count - 1] = merged
                    continue
                }

                if segment.startedAt > previous.endedAt {
                    if let gap = classifyGap(from: previous, to: segment) {
                        ensured.append(gap)
                    } else {
                        ensured.append(
                            makeMissingSegment(
                                id: "coverage-gap-\(previous.id)-\(segment.id)",
                                startedAt: previous.endedAt,
                                endedAt: segment.startedAt,
                                subtitle: "A repair pass backfilled this uncovered movement gap."
                            )
                        )
                    }
                    ensured.append(segment)
                    continue
                }

                guard let trimmed = updatedSegment(segment, startedAt: previous.endedAt) else {
                    continue
                }
                if let merged = mergeTimelineSegments(previous, trimmed) {
                    ensured[ensured.count - 1] = merged
                } else {
                    ensured.append(trimmed)
                }
            }

            if let latest = ensured.last {
                let hasActiveSegment = activeStayId != nil || activeTripId != nil
                let trailingGap = referenceDate.timeIntervalSince(latest.endedAt)
                if trailingGap > 0, hasActiveSegment == false {
                    if trailingGap <= DetectionThresholds.stayContinuityGapSeconds {
                        let trailingOrigin: TimelineSegment.Origin =
                            latest.kind == .stay ? .continuedStay : .repairedGap
                        ensured.append(
                            NormalizedSegment(
                                id: "continued-tail-\(latest.id)",
                                kind: .stay,
                                origin: trailingOrigin,
                                startedAt: latest.endedAt,
                                endedAt: referenceDate,
                                title: latest.placeLabel ?? latest.title,
                                subtitle:
                                    latest.kind == .stay
                                    ? "Short stationary gap carried forward into one continuous stay."
                                    : "Short trailing gap repaired into stay continuity until newer movement evidence arrives.",
                                placeLabel: latest.placeLabel,
                                anchorExternalUid: latest.anchorExternalUid,
                                coordinate: latest.endBoundary.coordinate,
                                tags: latest.kind == .stay ? ["continued-stay"] : ["repaired-gap", "trailing-gap"],
                                distanceMeters: nil,
                                averageSpeedMps: nil,
                                stayId: nil,
                                tripId: nil,
                                editable: false,
                                startBoundary: latest.endBoundary,
                                endBoundary: latest.endBoundary
                            )
                        )
                    } else {
                        ensured.append(
                            makeMissingSegment(
                                id: "missing-tail-\(latest.id)",
                                startedAt: latest.endedAt,
                                endedAt: referenceDate,
                                subtitle: "No reliable movement signal reached the phone after this point."
                            )
                        )
                    }
                }
            }

            return coalesceStaySegments(ensured)
        }

        func coverageAuditDiagnostics(for timeline: [NormalizedSegment]) -> [String] {
            let sorted = timeline.sorted { $0.startedAt < $1.startedAt }
            guard let first = sorted.first else {
                return []
            }
            var diagnostics: [String] = []
            var windowStart = first.startedAt
            while windowStart < referenceDate {
                let windowEnd = min(
                    windowStart.addingTimeInterval(DetectionThresholds.coverageAuditWindowSeconds),
                    referenceDate
                )
                let overlapping = sorted
                    .filter { $0.startedAt < windowEnd && $0.endedAt > windowStart }
                    .sorted { $0.startedAt < $1.startedAt }
                var coveredUntil = windowStart
                for segment in overlapping {
                    if segment.startedAt > coveredUntil {
                        diagnostics.append(
                            "coverage-gap:\(Int(coveredUntil.timeIntervalSince1970))-\(Int(segment.startedAt.timeIntervalSince1970))"
                        )
                        break
                    }
                    coveredUntil = max(coveredUntil, min(segment.endedAt, windowEnd))
                    if coveredUntil >= windowEnd {
                        break
                    }
                }
                if coveredUntil < windowEnd {
                    diagnostics.append(
                        "coverage-gap:\(Int(coveredUntil.timeIntervalSince1970))-\(Int(windowEnd.timeIntervalSince1970))"
                    )
                }
                windowStart = windowEnd
            }
            if diagnostics.isEmpty {
                return ["coverage-ok:30m-windows"]
            }
            return diagnostics
        }

        var normalized: [NormalizedSegment] = []
        for (index, segment) in sorted.enumerated() {
            let recorded = NormalizedSegment(
                id: segment.id,
                kind: segment.kind,
                origin: .recorded,
                startedAt: segment.startedAt,
                endedAt: segment.endedAt,
                title: segment.title,
                subtitle: segment.subtitle,
                placeLabel: segment.placeLabel,
                anchorExternalUid:
                    segment.kind == .stay
                    ? segment.startBoundary.placeExternalUid
                    : nil,
                coordinate: segment.startBoundary.coordinate,
                tags: segment.tags,
                distanceMeters: segment.distanceMeters,
                averageSpeedMps: segment.averageSpeedMps,
                stayId: segment.stayId,
                tripId: segment.tripId,
                editable: true,
                startBoundary: segment.startBoundary,
                endBoundary: segment.endBoundary
            )
            if index > 0, let gap = classifyGap(from: normalized.last!, to: recorded) {
                normalized.append(gap)
            }
            normalized.append(recorded)
        }

        let timeline = ensureCoverageSegments(normalized).map { segment in
            TimelineSegment(
                id: segment.id,
                kind: segment.kind,
                origin: segment.origin,
                startedAt: segment.startedAt,
                endedAt: segment.endedAt,
                title: segment.title,
                subtitle: segment.subtitle,
                placeLabel: segment.placeLabel,
                anchorExternalUid: segment.anchorExternalUid,
                coordinate: segment.coordinate,
                tags: segment.tags,
                distanceMeters: segment.distanceMeters,
                averageSpeedMps: segment.averageSpeedMps,
                stayId: segment.stayId,
                tripId: segment.tripId,
                editable: segment.editable
            )
        }

        let diagnostics = timeline
            .filter { $0.origin != .recorded }
            .map { segment in
                "\(segment.origin.rawValue):\(segment.kind.rawValue):\(Int(segment.endedAt.timeIntervalSince(segment.startedAt)))s"
            }
        let coverageDiagnostics = coverageAuditDiagnostics(
            for: ensureCoverageSegments(normalized)
        )
        recentRepairDiagnostics = Array((diagnostics + coverageDiagnostics).suffix(16))

        return timeline
    }

    func reconcileCanonicalStay(_ stay: ForgeMovementTimelineStay) {
        guard let index = storedStays.firstIndex(where: { $0.id == stay.externalUid }) else {
            return
        }
        storedStays[index].label = stay.label
        storedStays[index].status = stay.status
        storedStays[index].classification = stay.classification
        storedStays[index].startedAt = isoFormatter.date(from: stay.startedAt) ?? storedStays[index].startedAt
        storedStays[index].endedAt = isoFormatter.date(from: stay.endedAt) ?? storedStays[index].endedAt
        storedStays[index].centerLatitude = stay.centerLatitude
        storedStays[index].centerLongitude = stay.centerLongitude
        storedStays[index].radiusMeters = stay.radiusMeters
        storedStays[index].sampleCount = stay.sampleCount
        storedStays[index].placeExternalUid = stay.place?.externalUid ?? storedStays[index].placeExternalUid
        storedStays[index].placeLabel = stay.place?.label ?? storedStays[index].placeLabel
        storedStays[index].tags = stay.place?.categoryTags ?? stay.metrics.values["tags"]?.components(separatedBy: ", ").filter { $0.isEmpty == false } ?? storedStays[index].tags
        storedStays[index].metadata = stay.metadata.values
        persistState()
    }

    func reconcileCanonicalTrip(_ trip: ForgeMovementTimelineTrip) {
        let fallbackStart = isoFormatter.date(from: trip.startedAt) ?? Date()
        let fallbackEnd = isoFormatter.date(from: trip.endedAt) ?? fallbackStart
        let canonicalPoints = trip.points.map { point in
            StoredTripPoint(
                id: point.id,
                externalUid: point.externalUid,
                recordedAt: isoFormatter.date(from: point.recordedAt) ?? fallbackStart,
                latitude: point.latitude,
                longitude: point.longitude,
                accuracyMeters: point.accuracyMeters,
                altitudeMeters: point.altitudeMeters,
                speedMps: point.speedMps,
                isStopAnchor: point.isStopAnchor
            )
        }
        let canonicalStops = trip.stops.map { stop in
            StoredTripStop(
                id: stop.id,
                externalUid: stop.externalUid,
                label: stop.label,
                startedAt: isoFormatter.date(from: stop.startedAt) ?? fallbackStart,
                endedAt: isoFormatter.date(from: stop.endedAt) ?? fallbackEnd,
                latitude: stop.latitude,
                longitude: stop.longitude,
                radiusMeters: stop.radiusMeters,
                placeExternalUid: stop.place?.externalUid ?? "",
                metadata: stop.metadata.values
            )
        }
        if let index = storedTrips.firstIndex(where: { $0.id == trip.externalUid }) {
            storedTrips[index].label = trip.label
            storedTrips[index].status = trip.status
            storedTrips[index].travelMode = trip.travelMode
            storedTrips[index].activityType = trip.activityType
            storedTrips[index].startedAt = fallbackStart
            storedTrips[index].endedAt = fallbackEnd
            storedTrips[index].startPlaceExternalUid = trip.startPlace?.externalUid ?? storedTrips[index].startPlaceExternalUid
            storedTrips[index].endPlaceExternalUid = trip.endPlace?.externalUid ?? storedTrips[index].endPlaceExternalUid
            storedTrips[index].distanceMeters = trip.distanceMeters
            storedTrips[index].movingSeconds = trip.movingSeconds
            storedTrips[index].idleSeconds = trip.idleSeconds
            storedTrips[index].averageSpeedMps = trip.averageSpeedMps
            storedTrips[index].maxSpeedMps = trip.maxSpeedMps
            storedTrips[index].caloriesKcal = trip.caloriesKcal
            storedTrips[index].expectedMet = trip.expectedMet
            storedTrips[index].tags = trip.tags
            storedTrips[index].metadata = trip.metadata.values
            storedTrips[index].points = canonicalPoints
            storedTrips[index].stops = canonicalStops
        } else {
            storedTrips.insert(
                StoredTrip(
                    id: trip.externalUid,
                    label: trip.label,
                    status: trip.status,
                    travelMode: trip.travelMode,
                    activityType: trip.activityType,
                    startedAt: fallbackStart,
                    endedAt: fallbackEnd,
                    startPlaceExternalUid: trip.startPlace?.externalUid ?? "",
                    endPlaceExternalUid: trip.endPlace?.externalUid ?? "",
                    distanceMeters: trip.distanceMeters,
                    movingSeconds: trip.movingSeconds,
                    idleSeconds: trip.idleSeconds,
                    averageSpeedMps: trip.averageSpeedMps,
                    maxSpeedMps: trip.maxSpeedMps,
                    caloriesKcal: trip.caloriesKcal,
                    expectedMet: trip.expectedMet,
                    tags: trip.tags,
                    metadata: trip.metadata.values,
                    points: canonicalPoints,
                    stops: canonicalStops
                ),
                at: 0
            )
        }
        persistState()
    }

    func updateLocalStay(
        id: String,
        label: String,
        tags: [String],
        placeLabel: String,
        placeExternalUid: String
    ) {
        guard let index = storedStays.firstIndex(where: { $0.id == id }) else {
            return
        }
        storedStays[index].label = label
        storedStays[index].placeLabel = placeLabel
        storedStays[index].placeExternalUid = placeExternalUid
        storedStays[index].tags = tags
        persistState()
    }

    func updateLocalTrip(id: String, label: String, tags: [String]) {
        guard let index = storedTrips.firstIndex(where: { $0.id == id }) else {
            return
        }
        storedTrips[index].label = label
        storedTrips[index].tags = tags
        persistState()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        refreshPermissionState()
        if shouldEscalateToAlwaysAuthorization, manager.authorizationStatus == .authorizedWhenInUse {
            shouldEscalateToAlwaysAuthorization = false
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                self.locationManager.requestAlwaysAuthorization()
            }
        } else if manager.authorizationStatus == .authorizedAlways
                    || manager.authorizationStatus == .denied
                    || manager.authorizationStatus == .restricted {
            shouldEscalateToAlwaysAuthorization = false
        }
        applyTrackingState()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        for location in locations {
            process(location)
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        companionDebugLog(
            "MovementSyncStore",
            "locationManager didFail error=\(error.localizedDescription)"
        )
    }

    private func process(_ location: CLLocation) {
        guard trackingEnabled else { return }
        repairStoredTimelineState(referenceDate: location.timestamp)
        let travelMode = shouldUseTravelMode(for: location)
        let minimumInterval: TimeInterval = travelMode ? 1 : 15
        if
            let lastAcceptedLocationAt,
            location.timestamp.timeIntervalSince(lastAcceptedLocationAt) < minimumInterval
        {
            return
        }
        lastAcceptedLocationAt = location.timestamp
        recentLocations.append(location)
        recentLocations = Array(recentLocations.suffix(10))
        latestLocationSummary = travelMode ? "Current state: moving" : "Current state: staying"

        if travelMode {
            stationaryCandidateStartedAt = nil
            enterTravelMode(with: location)
        } else {
            let stationaryReferenceDate = earliestStationaryReferenceDate(around: location) ?? location.timestamp
            if stationaryCandidateStartedAt == nil || stationaryReferenceDate < stationaryCandidateStartedAt! {
                stationaryCandidateStartedAt = stationaryReferenceDate
            }
            if let stationaryCandidateStartedAt,
               location.timestamp.timeIntervalSince(stationaryCandidateStartedAt) >= DetectionThresholds.stayConfirmationSeconds
            {
                finalizeTripIfNeeded(with: location)
                enterStationaryMode(
                    with: location,
                    retroactiveStart: stationaryCandidateStartedAt
                )
            } else if currentStayId != nil {
                enterStationaryMode(with: location)
            }
        }
        repairStoredTimelineState(referenceDate: location.timestamp)
        persistState()
    }

    private func enterStationaryMode(
        with location: CLLocation,
        retroactiveStart: Date? = nil
    ) {
        let matchedPlace = matchKnownPlace(for: location)
        if let tripId = currentTripId,
           let index = storedTrips.firstIndex(where: { $0.id == tripId })
        {
            var trip = storedTrips[index]
            if let point = trip.points.last {
                let stopDuration = max(
                    0,
                    Int(location.timestamp.timeIntervalSince(point.recordedAt))
                )
                if Double(stopDuration) >= DetectionThresholds.stopMinimumSeconds {
                    let stop = StoredTripStop(
                        id: "stop_\(UUID().uuidString.lowercased())",
                        externalUid: "ios-stop-\(UUID().uuidString.lowercased())",
                        label: matchedPlace?.label ?? "Stop",
                        startedAt: point.recordedAt,
                        endedAt: location.timestamp,
                        latitude: location.coordinate.latitude,
                        longitude: location.coordinate.longitude,
                        radiusMeters: 80,
                        placeExternalUid: matchedPlace?.externalUid ?? "",
                        metadata: [:]
                    )
                    if trip.stops.last?.id != stop.id {
                        trip.stops.append(stop)
                        storedTrips[index] = trip
                    }
                }
            }
        }

        if let stayId = currentStayId,
           let index = storedStays.firstIndex(where: { $0.id == stayId })
        {
            var stay = storedStays[index]
            stay.endedAt = location.timestamp
            stay.sampleCount += 1
            stay.centerLatitude = ((stay.centerLatitude * Double(max(1, stay.sampleCount - 1))) + location.coordinate.latitude) / Double(stay.sampleCount)
            stay.centerLongitude = ((stay.centerLongitude * Double(max(1, stay.sampleCount - 1))) + location.coordinate.longitude) / Double(stay.sampleCount)
            stay.placeExternalUid = matchedPlace?.externalUid ?? ""
            stay.placeLabel = matchedPlace?.label ?? stay.placeLabel
            stay.label = matchedPlace?.label ?? stay.label
            storedStays[index] = stay
            return
        }

        let startedAt = retroactiveStart ?? location.timestamp
        let stay = StoredStay(
            id: "stay_\(UUID().uuidString.lowercased())",
            label: matchedPlace?.label ?? "Unlabeled stay",
            status: "active",
            classification: "stationary",
            startedAt: startedAt,
            endedAt: location.timestamp,
            centerLatitude: location.coordinate.latitude,
            centerLongitude: location.coordinate.longitude,
            radiusMeters: DetectionThresholds.stayRadiusMeters,
            sampleCount: 1,
            placeExternalUid: matchedPlace?.externalUid ?? "",
            placeLabel: matchedPlace?.label ?? "",
            tags: matchedPlace?.categoryTags ?? [],
            metadata: [:]
        )
        currentStayId = stay.id
        storedStays.insert(stay, at: 0)
    }

    private func enterTravelMode(with location: CLLocation) {
        if let stayId = currentStayId,
           let index = storedStays.firstIndex(where: { $0.id == stayId })
        {
            var stay = storedStays[index]
            stay.status = "completed"
            stay.endedAt = location.timestamp
            storedStays[index] = stay
            suspendedStayIdBeforeTrip = stay.id
            currentStayId = nil
        }

        let matchedPlace = matchKnownPlace(for: location)
        if let tripId = currentTripId,
           let index = storedTrips.firstIndex(where: { $0.id == tripId })
        {
            var trip = storedTrips[index]
            if let previousPoint = trip.points.last {
                let distance = CLLocation(
                    latitude: previousPoint.latitude,
                    longitude: previousPoint.longitude
                ).distance(from: location)
                trip.distanceMeters += distance
                trip.movingSeconds += max(
                    1,
                    Int(location.timestamp.timeIntervalSince(previousPoint.recordedAt))
                )
                let inferredSpeed = location.speed > 0 ? location.speed : distance / max(1, location.timestamp.timeIntervalSince(previousPoint.recordedAt))
                trip.maxSpeedMps = max(trip.maxSpeedMps ?? 0, inferredSpeed)
                let speedSamples = [trip.averageSpeedMps ?? inferredSpeed, inferredSpeed]
                trip.averageSpeedMps = speedSamples.reduce(0, +) / Double(speedSamples.count)
            }
            trip.endedAt = location.timestamp
            trip.endPlaceExternalUid = matchedPlace?.externalUid ?? ""
            trip.points.append(point(from: location, isStopAnchor: false))
            trip.activityType = activeTravelLabel
            trip.expectedMet = inferExpectedMet()
            storedTrips[index] = trip
            detectStopIfNeeded(for: index, newLocation: location)
            return
        }

        let trip = StoredTrip(
            id: "trip_\(UUID().uuidString.lowercased())",
            label: matchedPlace?.label ?? "Travel",
            status: "active",
            travelMode: "travel",
            activityType: activeTravelLabel,
            startedAt: location.timestamp,
            endedAt: location.timestamp,
            startPlaceExternalUid: matchedPlace?.externalUid ?? "",
            endPlaceExternalUid: matchedPlace?.externalUid ?? "",
            distanceMeters: 0,
            movingSeconds: 0,
            idleSeconds: 0,
            averageSpeedMps: nil,
            maxSpeedMps: nil,
            caloriesKcal: nil,
            expectedMet: inferExpectedMet(),
            tags: matchedPlace?.categoryTags ?? [],
            metadata: [:],
            points: [point(from: location, isStopAnchor: false)],
            stops: []
        )
        currentTripId = trip.id
        storedTrips.insert(trip, at: 0)
    }

    private func finalizeTripIfNeeded(with location: CLLocation) {
        guard let tripId = currentTripId,
              let index = storedTrips.firstIndex(where: { $0.id == tripId }) else {
            return
        }
        var trip = storedTrips[index]
        trip.endedAt = location.timestamp
        trip.points.append(point(from: location, isStopAnchor: true))
        if tripQualifies(trip) == false {
            trip.status = "invalid"
            trip.tags = Array(Set(trip.tags + ["invalid"]))
            storedTrips.remove(at: index)
            currentTripId = nil
            lastStopWindowStartedAt = nil
            replaceInvalidTripWithStay(trip, at: location)
            return
        }
        trip.status = "completed"
        storedTrips[index] = trip
        currentTripId = nil
        suspendedStayIdBeforeTrip = nil
        lastStopWindowStartedAt = nil
    }

    private func detectStopIfNeeded(for index: Int, newLocation: CLLocation) {
        var trip = storedTrips[index]
        let recentPoints = Array(trip.points.suffix(6))
        guard recentPoints.count >= 4 else {
            return
        }
        let first = recentPoints.first!
        let latest = recentPoints.last!
        let displacement = CLLocation(
            latitude: first.latitude,
            longitude: first.longitude
        ).distance(from: CLLocation(latitude: latest.latitude, longitude: latest.longitude))
        if displacement <= 60 {
            if lastStopWindowStartedAt == nil {
                lastStopWindowStartedAt = first.recordedAt
            }
            if let lastStopWindowStartedAt,
               newLocation.timestamp.timeIntervalSince(lastStopWindowStartedAt) >= DetectionThresholds.stopMinimumSeconds
            {
                let matchedPlace = matchKnownPlace(for: newLocation)
                let stop = StoredTripStop(
                    id: "stop_\(UUID().uuidString.lowercased())",
                    externalUid: "ios-stop-\(UUID().uuidString.lowercased())",
                    label: matchedPlace?.label ?? "Stop",
                    startedAt: lastStopWindowStartedAt,
                    endedAt: newLocation.timestamp,
                    latitude: newLocation.coordinate.latitude,
                    longitude: newLocation.coordinate.longitude,
                    radiusMeters: 80,
                    placeExternalUid: matchedPlace?.externalUid ?? "",
                    metadata: [:]
                )
                if trip.stops.last?.placeExternalUid != stop.placeExternalUid ||
                    trip.stops.last?.endedAt != stop.endedAt
                {
                    trip.stops.append(stop)
                    storedTrips[index] = trip
                }
            }
        } else {
            lastStopWindowStartedAt = nil
        }
    }

    private func shouldUseTravelMode(for location: CLLocation) -> Bool {
        let activitySuggestsTravel = latestActivity?.walking == true
            || latestActivity?.running == true
            || latestActivity?.automotive == true
            || latestActivity?.cycling == true
        let clusterIsStationary = isStationaryCluster(around: location)
        if clusterIsStationary {
            return false
        }
        if let tripId = currentTripId,
           let trip = storedTrips.first(where: { $0.id == tripId }),
           tripHasCollapsedIntoStay(trip, currentLocation: location, referenceDate: location.timestamp)
        {
            return false
        }
        if activitySuggestsTravel {
            return true
        }
        if let stayId = currentStayId,
           let stay = storedStays.first(where: { $0.id == stayId })
        {
            let distance = CLLocation(
                latitude: stay.centerLatitude,
                longitude: stay.centerLongitude
            ).distance(from: location)
            if distance > max(DetectionThresholds.tripMinimumDisplacementMeters, stay.radiusMeters) {
                return true
            }
        }
        return clusterIsStationary == false
    }

    private func isStationaryCluster(around location: CLLocation) -> Bool {
        let cluster = Array(recentLocations.suffix(10))
        guard cluster.count == 10 else {
            return false
        }
        return cluster.allSatisfy { sample in
            sample.distance(from: location) <= DetectionThresholds.stayRadiusMeters
        }
    }

    private func earliestStationaryReferenceDate(around location: CLLocation) -> Date? {
        let cluster = Array(recentLocations.suffix(10))
        guard cluster.count >= 2 else {
            return nil
        }
        let stationary = cluster.filter { sample in
            sample.distance(from: location) <= DetectionThresholds.stayRadiusMeters
        }
        guard stationary.count >= 2 else {
            return nil
        }
        return stationary.first?.timestamp
    }

    private func matchKnownPlace(for location: CLLocation) -> StoredKnownPlace? {
        knownPlaces
            .map { place in
                (
                    place: place,
                    distance: CLLocation(latitude: place.latitude, longitude: place.longitude)
                        .distance(from: location)
                )
            }
            .filter { pair in
                pair.distance <= max(DetectionThresholds.stayRadiusMeters, pair.place.radiusMeters)
            }
            .sorted { left, right in
                left.distance < right.distance
            }
            .first?
            .place
    }

    private func place(forExternalUid externalUid: String) -> StoredKnownPlace? {
        guard externalUid.isEmpty == false else {
            return nil
        }
        return knownPlaces.first(where: { $0.externalUid == externalUid })
    }

    private var activeTravelLabel: String {
        if latestActivity?.cycling == true {
            return "cycling"
        }
        if latestActivity?.running == true {
            return "running"
        }
        if latestActivity?.walking == true {
            return "walking"
        }
        if latestActivity?.automotive == true {
            return "automotive"
        }
        return "travel"
    }

    private func inferExpectedMet() -> Double {
        switch activeTravelLabel {
        case "cycling":
            return 6.8
        case "running":
            return 8.5
        case "walking":
            return 3.2
        default:
            return 1.8
        }
    }

    private func point(from location: CLLocation, isStopAnchor: Bool) -> StoredTripPoint {
        StoredTripPoint(
            id: "point_\(UUID().uuidString.lowercased())",
            externalUid: "ios-point-\(UUID().uuidString.lowercased())",
            recordedAt: location.timestamp,
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude,
            accuracyMeters: location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil,
            altitudeMeters: location.verticalAccuracy >= 0 ? location.altitude : nil,
            speedMps: location.speed >= 0 ? location.speed : nil,
            isStopAnchor: isStopAnchor
        )
    }

    private func invalidTripReason(_ trip: StoredTrip) -> String? {
        let duration = trip.endedAt.timeIntervalSince(trip.startedAt)
        if duration < DetectionThresholds.tripMinimumSeconds {
            return "under_duration_threshold"
        }
        if trip.distanceMeters < DetectionThresholds.tripMinimumDisplacementMeters {
            return "under_cumulative_distance_threshold"
        }
        return nil
    }

    private func tripQualifies(_ trip: StoredTrip) -> Bool {
        invalidTripReason(trip) == nil
    }

    private func reviveSuspendedStayIfNeeded(with location: CLLocation) {
        guard let suspendedStayIdBeforeTrip else {
            return
        }
        self.suspendedStayIdBeforeTrip = nil
        guard let index = storedStays.firstIndex(where: { $0.id == suspendedStayIdBeforeTrip }) else {
            return
        }
        let matchedPlace = matchKnownPlace(for: location)
        var stay = storedStays[index]
        stay.status = "active"
        stay.endedAt = location.timestamp
        stay.sampleCount += 1
        stay.centerLatitude = ((stay.centerLatitude * Double(max(1, stay.sampleCount - 1))) + location.coordinate.latitude) / Double(stay.sampleCount)
        stay.centerLongitude = ((stay.centerLongitude * Double(max(1, stay.sampleCount - 1))) + location.coordinate.longitude) / Double(stay.sampleCount)
        stay.placeExternalUid = matchedPlace?.externalUid ?? stay.placeExternalUid
        stay.placeLabel = matchedPlace?.label ?? stay.placeLabel
        stay.label = matchedPlace?.label ?? stay.label
        storedStays[index] = stay
        currentStayId = stay.id
    }

    private func tripHasCollapsedIntoStay(
        _ trip: StoredTrip,
        currentLocation: CLLocation,
        referenceDate: Date
    ) -> Bool {
        guard
            let startPoint = trip.points.first
        else {
            return false
        }
        let elapsedSinceTripStart = max(referenceDate.timeIntervalSince(trip.startedAt), currentLocation.timestamp.timeIntervalSince(trip.startedAt))
        guard elapsedSinceTripStart >= DetectionThresholds.stayConfirmationSeconds else {
            return false
        }
        let displacement = CLLocation(latitude: startPoint.latitude, longitude: startPoint.longitude)
            .distance(from: currentLocation)
        return displacement <= DetectionThresholds.tripMinimumDisplacementMeters
    }

    private func repairStoredTimelineState(referenceDate: Date) {
        if let tripId = currentTripId,
           let index = storedTrips.firstIndex(where: { $0.id == tripId })
        {
            let trip = storedTrips[index]
            let lastLocation = recentLocations.last ?? trip.points.last.map {
                CLLocation(
                    coordinate: CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude),
                    altitude: $0.altitudeMeters ?? 0,
                    horizontalAccuracy: $0.accuracyMeters ?? DetectionThresholds.stayRadiusMeters,
                    verticalAccuracy: $0.altitudeMeters == nil ? -1 : 0,
                    course: 0,
                    speed: $0.speedMps ?? 0,
                    timestamp: $0.recordedAt
                )
            }
            if let lastLocation,
               tripHasCollapsedIntoStay(trip, currentLocation: lastLocation, referenceDate: referenceDate)
            {
                storedTrips.remove(at: index)
                currentTripId = nil
                lastStopWindowStartedAt = nil
                replaceInvalidTripWithStay(trip, at: lastLocation)
            } else if let lastLocation,
                      let stationaryTailStartedAt = stationaryTailStart(for: trip, referenceDate: referenceDate)
            {
                finalizeTripIntoStay(
                    tripIndex: index,
                    stationaryStartedAt: stationaryTailStartedAt,
                    currentLocation: lastLocation,
                    referenceDate: referenceDate
                )
            }
        }

        rewriteInvalidPersistedTrips(referenceDate: referenceDate)
        repairMissingStayContinuity(referenceDate: referenceDate)

        storedStays.sort { $0.startedAt > $1.startedAt }
        storedTrips.sort { $0.startedAt > $1.startedAt }

        storedStays = normalizedStays(from: storedStays)
        storedTrips = normalizedTrips(from: storedTrips)

        if let activeStayId = currentStayId,
           storedStays.contains(where: { $0.id == activeStayId }) == false
        {
            currentStayId = storedStays.first(where: { $0.status == "active" })?.id
        }
        if let activeTripId = currentTripId,
           storedTrips.contains(where: { $0.id == activeTripId }) == false
        {
            currentTripId = storedTrips.first(where: { $0.status == "active" })?.id
        }

        if let stayId = currentStayId,
           let index = storedStays.firstIndex(where: { $0.id == stayId }),
           storedStays[index].endedAt < referenceDate
        {
            storedStays[index].endedAt = referenceDate
        }
    }

    private func repairMissingStayContinuity(referenceDate: Date) {
        guard currentTripId == nil else {
            return
        }

        if let stayId = currentStayId,
           let index = storedStays.firstIndex(where: { $0.id == stayId })
        {
            storedStays[index].status = "active"
            storedStays[index].endedAt = max(storedStays[index].endedAt, referenceDate)
        } else {
            currentStayId = nil
        }
    }

    private func normalizedStays(from stays: [StoredStay]) -> [StoredStay] {
        var normalized: [StoredStay] = []
        for stay in stays.sorted(by: { $0.startedAt < $1.startedAt }) {
            guard stay.endedAt > stay.startedAt else {
                continue
            }
            if let previous = normalized.last, stay.startedAt < previous.endedAt {
                continue
            }
            normalized.append(stay)
        }
        return normalized.sorted(by: { $0.startedAt > $1.startedAt })
    }

    private func normalizedTrips(from trips: [StoredTrip]) -> [StoredTrip] {
        var normalized: [StoredTrip] = []
        for trip in trips.sorted(by: { $0.startedAt < $1.startedAt }) {
            if trip.status != "active" && trip.endedAt <= trip.startedAt {
                continue
            }
            if let previous = normalized.last, trip.startedAt < previous.endedAt {
                continue
            }
            normalized.append(trip)
        }
        return normalized.sorted(by: { $0.startedAt > $1.startedAt })
    }

    private func stationaryTailStart(
        for trip: StoredTrip,
        referenceDate: Date
    ) -> Date? {
        guard let lastPoint = trip.points.last else {
            return nil
        }
        let anchorLocation = CLLocation(
            latitude: lastPoint.latitude,
            longitude: lastPoint.longitude
        )
        var earliestStationaryPoint = lastPoint.recordedAt
        for point in trip.points.reversed() {
            let pointLocation = CLLocation(latitude: point.latitude, longitude: point.longitude)
            if pointLocation.distance(from: anchorLocation) <= DetectionThresholds.stayRadiusMeters {
                earliestStationaryPoint = point.recordedAt
            } else {
                break
            }
        }
        guard referenceDate.timeIntervalSince(earliestStationaryPoint) >= DetectionThresholds.stayConfirmationSeconds else {
            return nil
        }
        return earliestStationaryPoint
    }

    private func finalizeTripIntoStay(
        tripIndex: Int,
        stationaryStartedAt: Date,
        currentLocation: CLLocation,
        referenceDate: Date
    ) {
        guard storedTrips.indices.contains(tripIndex) else {
            return
        }

        var trip = storedTrips[tripIndex]
        trip.points = trip.points.filter { $0.recordedAt <= stationaryStartedAt }
        trip.stops = trip.stops.filter { $0.startedAt < stationaryStartedAt }
        trip.endedAt = max(trip.startedAt, stationaryStartedAt)
        trip.status = "completed"

        if tripQualifies(trip) == false {
            storedTrips.remove(at: tripIndex)
            currentTripId = nil
            lastStopWindowStartedAt = nil
            replaceInvalidTripWithStay(trip, at: currentLocation)
            return
        }

        storedTrips[tripIndex] = trip
        currentTripId = nil
        lastStopWindowStartedAt = nil

        let matchedPlace = matchKnownPlace(for: currentLocation)
        let stay = StoredStay(
            id: "stay_\(UUID().uuidString.lowercased())",
            label: matchedPlace?.label ?? "Unlabeled stay",
            status: "active",
            classification: "passive",
            startedAt: stationaryStartedAt,
            endedAt: max(referenceDate, stationaryStartedAt),
            centerLatitude: currentLocation.coordinate.latitude,
            centerLongitude: currentLocation.coordinate.longitude,
            radiusMeters: DetectionThresholds.stayRadiusMeters,
            sampleCount: 1,
            placeExternalUid: matchedPlace?.externalUid ?? "",
            placeLabel: matchedPlace?.label ?? "",
            tags: Array(Set((matchedPlace?.categoryTags ?? []) + ["movement", "stay", "repaired_from_trip"])),
            metadata: [
                "derivedFrom": "trip_stationary_tail_repair"
            ]
        )
        currentStayId = stay.id
        storedStays.insert(stay, at: 0)
    }

    private func repairLocation(for trip: StoredTrip, referenceDate: Date) -> CLLocation? {
        if let lastPoint = trip.points.last {
            return CLLocation(
                coordinate: CLLocationCoordinate2D(
                    latitude: lastPoint.latitude,
                    longitude: lastPoint.longitude
                ),
                altitude: lastPoint.altitudeMeters ?? 0,
                horizontalAccuracy: lastPoint.accuracyMeters ?? DetectionThresholds.stayRadiusMeters,
                verticalAccuracy: lastPoint.altitudeMeters == nil ? -1 : 0,
                course: 0,
                speed: lastPoint.speedMps ?? 0,
                timestamp: max(referenceDate, lastPoint.recordedAt)
            )
        }
        if let resolvedPlace = place(forExternalUid: trip.endPlaceExternalUid) ?? place(forExternalUid: trip.startPlaceExternalUid) {
            return CLLocation(
                coordinate: CLLocationCoordinate2D(
                    latitude: resolvedPlace.latitude,
                    longitude: resolvedPlace.longitude
                ),
                altitude: 0,
                horizontalAccuracy: resolvedPlace.radiusMeters,
                verticalAccuracy: -1,
                course: 0,
                speed: 0,
                timestamp: referenceDate
            )
        }
        if let firstPoint = trip.points.first {
            return CLLocation(
                coordinate: CLLocationCoordinate2D(
                    latitude: firstPoint.latitude,
                    longitude: firstPoint.longitude
                ),
                altitude: firstPoint.altitudeMeters ?? 0,
                horizontalAccuracy: firstPoint.accuracyMeters ?? DetectionThresholds.stayRadiusMeters,
                verticalAccuracy: firstPoint.altitudeMeters == nil ? -1 : 0,
                course: 0,
                speed: firstPoint.speedMps ?? 0,
                timestamp: max(referenceDate, firstPoint.recordedAt)
            )
        }
        return nil
    }

    private func replaceInvalidTripWithStay(_ trip: StoredTrip, at location: CLLocation) {
        if suspendedStayIdBeforeTrip != nil {
            reviveSuspendedStayIfNeeded(with: location)
            return
        }

        let matchedPlace = matchKnownPlace(for: location)
        let coordinates = trip.points + [point(from: location, isStopAnchor: true)]
        let latitudeAverage =
            coordinates.map(\.latitude).reduce(0, +) / Double(max(1, coordinates.count))
        let longitudeAverage =
            coordinates.map(\.longitude).reduce(0, +) / Double(max(1, coordinates.count))
        let stay = StoredStay(
            id: "stay_\(UUID().uuidString.lowercased())",
            label: matchedPlace?.label ?? "Unlabeled stay",
            status: "active",
            classification: "passive",
            startedAt: trip.startedAt,
            endedAt: location.timestamp,
            centerLatitude: latitudeAverage,
            centerLongitude: longitudeAverage,
            radiusMeters: DetectionThresholds.stayRadiusMeters,
            sampleCount: max(1, coordinates.count),
            placeExternalUid: matchedPlace?.externalUid ?? "",
            placeLabel: matchedPlace?.label ?? "",
            tags: Array(Set((matchedPlace?.categoryTags ?? []) + ["movement", "stay", "invalid_trip_replaced"])),
            metadata: [
                "derivedFrom": "invalid_trip",
                "invalidTripReason": invalidTripReason(trip) ?? "under_duration_or_cumulative_distance_threshold"
            ]
        )
        currentStayId = stay.id
        storedStays.insert(stay, at: 0)
        suspendedStayIdBeforeTrip = nil
    }

    private func rewriteInvalidPersistedTrips(referenceDate: Date) {
        let invalidTripIds = storedTrips.compactMap { trip -> String? in
            guard trip.status == "completed" else {
                return nil
            }
            return tripQualifies(trip) ? nil : trip.id
        }
        guard invalidTripIds.isEmpty == false else {
            return
        }
        for tripId in invalidTripIds {
            guard let index = storedTrips.firstIndex(where: { $0.id == tripId }) else {
                continue
            }
            let trip = storedTrips.remove(at: index)
            guard let location = repairLocation(for: trip, referenceDate: max(referenceDate, trip.endedAt)) else {
                continue
            }
            replaceInvalidTripWithStay(trip, at: location)
        }
    }

    private func startMotionUpdatesIfAvailable() {
        guard CMMotionActivityManager.isActivityAvailable() else {
            motionPermissionStatus = "unavailable"
            return
        }
        motionPermissionStatus = "ready"
        activityManager.startActivityUpdates(to: .main) { [weak self] activity in
            guard let self else { return }
            self.latestActivity = activity
        }
    }

    private func refreshPermissionState() {
        if testingMode {
            locationPermissionStatus = "always"
            backgroundTrackingReady = true
            return
        }
        switch locationManager.authorizationStatus {
        case .authorizedAlways:
            locationPermissionStatus = "always"
        case .authorizedWhenInUse:
            locationPermissionStatus = "when_in_use"
        case .denied:
            locationPermissionStatus = "denied"
        case .restricted:
            locationPermissionStatus = "restricted"
        case .notDetermined:
            locationPermissionStatus = "not_determined"
        @unknown default:
            locationPermissionStatus = "unknown"
        }
        backgroundTrackingReady = locationManager.authorizationStatus == .authorizedAlways
            && UIApplication.shared.backgroundRefreshStatus == .available
        updateBackgroundLocationConfiguration()
    }

    private func applyTrackingState() {
        if testingMode {
            return
        }
        updateBackgroundLocationConfiguration()
        guard trackingEnabled else {
            locationManager.stopUpdatingLocation()
            locationManager.stopMonitoringSignificantLocationChanges()
            return
        }
        if locationManager.authorizationStatus == .notDetermined {
            locationManager.requestAlwaysAuthorization()
            return
        }
        guard locationManager.authorizationStatus == .authorizedAlways || locationManager.authorizationStatus == .authorizedWhenInUse else {
            return
        }
        locationManager.startUpdatingLocation()
        locationManager.startMonitoringSignificantLocationChanges()
    }

    private func updateBackgroundLocationConfiguration() {
        if testingMode {
            return
        }
        #if targetEnvironment(simulator)
        if locationManager.allowsBackgroundLocationUpdates {
            locationManager.allowsBackgroundLocationUpdates = false
        }
        return
        #else
        let backgroundModes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
        let canUseBackgroundLocation = backgroundModes.contains("location")
        let shouldAllowBackgroundUpdates =
            trackingEnabled
            && canUseBackgroundLocation
            && locationManager.authorizationStatus == .authorizedAlways
            && UIApplication.shared.backgroundRefreshStatus == .available
        if locationManager.allowsBackgroundLocationUpdates != shouldAllowBackgroundUpdates {
            locationManager.allowsBackgroundLocationUpdates = shouldAllowBackgroundUpdates
        }
        #endif
    }

    private func pruneLongTermRawPointsIfNeeded() {
        guard retentionMode == "aggregates_only" else {
            return
        }
        let cutoff = Date().addingTimeInterval(-30 * 24 * 60 * 60)
        storedTrips = storedTrips.map { trip in
            guard trip.endedAt < cutoff else {
                return trip
            }
            var copy = trip
            let anchors = copy.points.enumerated().compactMap { index, point -> StoredTripPoint? in
                if index == 0 || index == copy.points.count - 1 || point.isStopAnchor {
                    return point
                }
                return nil
            }
            copy.points = anchors
            return copy
        }
        persistState()
    }

    private func loadState() {
        if testingMode {
            return
        }
        guard
            let data = UserDefaults.standard.data(forKey: StorageKeys.movementState),
            let decoded = try? JSONDecoder().decode(PersistedState.self, from: data)
        else {
            return
        }
        trackingEnabled = decoded.trackingEnabled
        publishMode = decoded.publishMode
        retentionMode = decoded.retentionMode
        knownPlaces = deduplicatedKnownPlaces(
            decoded.knownPlaces,
            context: .persistedState
        )
        storedStays = decoded.stays
        storedTrips = decoded.trips
        cachedProjectedBoxes = decoded.projectedBoxes.sorted { left, right in
            left.startedAt < right.startedAt
        }
        currentStayId = storedStays.first(where: { $0.status == "active" })?.id
        currentTripId = storedTrips.first(where: { $0.status == "active" })?.id
        repairStoredTimelineState(referenceDate: Date())
    }

    private func testingReferenceDate(for state: PersistedState) -> Date {
        let stayDates = state.stays.flatMap { [$0.startedAt, $0.endedAt] }
        let tripDates = state.trips.flatMap { trip in
            [trip.startedAt, trip.endedAt]
                + trip.points.map(\.recordedAt)
                + trip.stops.flatMap { [$0.startedAt, $0.endedAt] }
        }
        return (stayDates + tripDates).max() ?? Date(timeIntervalSince1970: 0)
    }

    private func persistState() {
        if testingMode {
            return
        }
        let state = PersistedState(
            trackingEnabled: trackingEnabled,
            publishMode: publishMode,
            retentionMode: retentionMode,
            knownPlaces: knownPlaces,
            stays: storedStays,
            trips: storedTrips,
            projectedBoxes: cachedProjectedBoxes
        )
        if let data = try? JSONEncoder().encode(state) {
            UserDefaults.standard.set(data, forKey: StorageKeys.movementState)
        }
    }

    private func knownPlaceKey(for place: StoredKnownPlace) -> String {
        let trimmedExternalUid = place.externalUid.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        if trimmedExternalUid.isEmpty == false {
            return trimmedExternalUid
        }
        return "__place_id__\(place.id)"
    }

    private func deduplicatedKnownPlaces(
        _ places: [StoredKnownPlace],
        context: KnownPlaceDeduplicationContext
    ) -> [StoredKnownPlace] {
        guard places.count > 1 else {
            return places
        }
        var seenKeys: Set<String> = []
        var duplicateKeys: [String] = []
        var deduplicated: [StoredKnownPlace] = []
        deduplicated.reserveCapacity(places.count)
        for place in places {
            let key = knownPlaceKey(for: place)
            if seenKeys.insert(key).inserted {
                deduplicated.append(place)
            } else {
                duplicateKeys.append(key)
            }
        }
        if duplicateKeys.isEmpty == false {
            companionDebugLog(
                "MovementSyncStore",
                "deduplicatedKnownPlaces context=\(context.rawValue) removed=\(duplicateKeys.count) keys=\(Array(Set(duplicateKeys)).sorted().joined(separator: ","))"
            )
        }
        return deduplicated
    }

    private func isoString(_ value: Date) -> String {
        isoFormatter.string(from: value)
    }

    private func openAppSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else {
            return
        }
        UIApplication.shared.open(url)
    }

    #if DEBUG
    struct DebugSnapshot {
        let activeStay: StoredStay?
        let activeTrip: StoredTrip?
        let stays: [StoredStay]
        let trips: [StoredTrip]
        let timeline: [TimelineSegment]
        let recentRepairDiagnostics: [String]
        let latestLocationSummary: String
    }

    func debugSetTrackingEnabled(_ enabled: Bool) {
        trackingEnabled = enabled
    }

    func debugProcessLocations(_ locations: [CLLocation]) {
        for location in locations {
            process(location)
        }
    }

    func debugRepair(referenceDate: Date = Date()) {
        repairStoredTimelineState(referenceDate: referenceDate)
    }

    func debugSnapshot() -> DebugSnapshot {
        DebugSnapshot(
            activeStay: activeStay,
            activeTrip: activeTrip,
            stays: storedStays,
            trips: storedTrips,
            timeline: buildHistoricalTimelineSegments(referenceDate: Date()),
            recentRepairDiagnostics: recentRepairDiagnostics,
            latestLocationSummary: latestLocationSummary
        )
    }
    #endif
}
