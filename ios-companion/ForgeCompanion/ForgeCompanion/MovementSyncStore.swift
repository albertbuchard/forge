import Foundation
import Combine
import CoreLocation
import CoreMotion
import UIKit

@MainActor
final class MovementSyncStore: NSObject, ObservableObject, CLLocationManagerDelegate {
    private enum DetectionThresholds {
        static let stayRadiusMeters: Double = 100
        static let stayConfirmationSeconds: TimeInterval = 10 * 60
        static let tripMinimumSeconds: TimeInterval = 5 * 60
        static let tripMinimumDisplacementMeters: Double = 100
        static let stopMinimumSeconds: TimeInterval = 3 * 60
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
        var recordedAt: Date
        var latitude: Double
        var longitude: Double
        var accuracyMeters: Double?
        var altitudeMeters: Double?
        var speedMps: Double?
        var isStopAnchor: Bool
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
    }

    private enum StorageKeys {
        static let movementState = "forge_companion_movement_state"
    }

    @Published private(set) var trackingEnabled = false
    @Published private(set) var publishMode = "auto_publish"
    @Published private(set) var retentionMode = "aggregates_only"
    @Published private(set) var knownPlaces: [StoredKnownPlace] = []
    @Published private(set) var storedStays: [StoredStay] = []
    @Published private(set) var storedTrips: [StoredTrip] = []
    @Published private(set) var latestLocationSummary = "No location yet"
    @Published private(set) var locationPermissionStatus = "not_determined"
    @Published private(set) var motionPermissionStatus = "unknown"
    @Published private(set) var backgroundTrackingReady = false

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

    override init() {
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        locationManager.distanceFilter = 8
        locationManager.pausesLocationUpdatesAutomatically = false
        loadState()
        refreshPermissionState()
        startMotionUpdatesIfAvailable()
        applyTrackingState()
    }

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
        let localByExternalUid = Dictionary(uniqueKeysWithValues: knownPlaces.map { ($0.externalUid, $0) })
        knownPlaces = remotePlaces.map { remotePlace in
            localByExternalUid[remotePlace.externalUid] ?? remotePlace
        } + knownPlaces.filter { localPlace in
            !remotePlaces.contains(where: { $0.externalUid == localPlace.externalUid })
        }
        persistState()
    }

    func buildMovementPayload() -> CompanionSyncPayload.MovementPayload {
        pruneLongTermRawPointsIfNeeded()
        let syncableTrips = storedTrips.filter { trip in
            trip.status == "active" ? tripQualifies(trip) : true
        }
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
        guard let index = storedTrips.firstIndex(where: { $0.id == trip.externalUid }) else {
            return
        }
        storedTrips[index].label = trip.label
        storedTrips[index].status = trip.status
        storedTrips[index].travelMode = trip.travelMode
        storedTrips[index].activityType = trip.activityType
        storedTrips[index].startedAt = isoFormatter.date(from: trip.startedAt) ?? storedTrips[index].startedAt
        storedTrips[index].endedAt = isoFormatter.date(from: trip.endedAt) ?? storedTrips[index].endedAt
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
        let travelMode = shouldUseTravelMode(for: location)
        let minimumInterval: TimeInterval = travelMode ? 1 : 30
        if
            let lastAcceptedLocationAt,
            location.timestamp.timeIntervalSince(lastAcceptedLocationAt) < minimumInterval
        {
            return
        }
        lastAcceptedLocationAt = location.timestamp
        recentLocations.append(location)
        recentLocations = Array(recentLocations.suffix(10))
        latestLocationSummary = travelMode
            ? "Travelling near \(location.coordinate.latitude.formatted(.number.precision(.fractionLength(4)))), \(location.coordinate.longitude.formatted(.number.precision(.fractionLength(4))))"
            : "Settled near \(location.coordinate.latitude.formatted(.number.precision(.fractionLength(4)))), \(location.coordinate.longitude.formatted(.number.precision(.fractionLength(4))))"

        if travelMode {
            stationaryCandidateStartedAt = nil
            enterTravelMode(with: location)
        } else {
            if stationaryCandidateStartedAt == nil {
                stationaryCandidateStartedAt = location.timestamp
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
            storedTrips.remove(at: index)
            currentTripId = nil
            lastStopWindowStartedAt = nil
            reviveSuspendedStayIfNeeded(with: location)
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
            recordedAt: location.timestamp,
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude,
            accuracyMeters: location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil,
            altitudeMeters: location.verticalAccuracy >= 0 ? location.altitude : nil,
            speedMps: location.speed >= 0 ? location.speed : nil,
            isStopAnchor: isStopAnchor
        )
    }

    private func tripQualifies(_ trip: StoredTrip) -> Bool {
        let duration = trip.endedAt.timeIntervalSince(trip.startedAt)
        guard duration >= DetectionThresholds.tripMinimumSeconds else {
            return false
        }
        guard
            let firstPoint = trip.points.first,
            let lastPoint = trip.points.last
        else {
            return false
        }
        let displacement = CLLocation(
            latitude: firstPoint.latitude,
            longitude: firstPoint.longitude
        ).distance(
            from: CLLocation(
                latitude: lastPoint.latitude,
                longitude: lastPoint.longitude
            )
        )
        return displacement >= DetectionThresholds.tripMinimumDisplacementMeters
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
        guard
            let data = UserDefaults.standard.data(forKey: StorageKeys.movementState),
            let decoded = try? JSONDecoder().decode(PersistedState.self, from: data)
        else {
            return
        }
        trackingEnabled = decoded.trackingEnabled
        publishMode = decoded.publishMode
        retentionMode = decoded.retentionMode
        knownPlaces = decoded.knownPlaces
        storedStays = decoded.stays
        storedTrips = decoded.trips
        currentStayId = storedStays.first(where: { $0.status == "active" })?.id
        currentTripId = storedTrips.first(where: { $0.status == "active" })?.id
    }

    private func persistState() {
        let state = PersistedState(
            trackingEnabled: trackingEnabled,
            publishMode: publishMode,
            retentionMode: retentionMode,
            knownPlaces: knownPlaces,
            stays: storedStays,
            trips: storedTrips
        )
        if let data = try? JSONEncoder().encode(state) {
            UserDefaults.standard.set(data, forKey: StorageKeys.movementState)
        }
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
}
