@preconcurrency import AVFoundation
import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

enum PeerCameraAuthorizationPolicy {
    static func state(for status: AVAuthorizationStatus) -> PeerCameraAuthorizationState {
        switch status {
        case .authorized:
            return .authorized
        case .notDetermined:
            return .request
        case .denied:
            return .denied
        case .restricted:
            return .restricted
        @unknown default:
            return .restricted
        }
    }
}

struct PeoplePeerManagementView: View {
    @EnvironmentObject private var store: PeoplePeerStore

    let close: () -> Void

    @State private var scannerVisible = false
    @State private var createInvitationVisible = false
    @State private var requestDecision: (request: PeerPendingRequest, accept: Bool)?

    var body: some View {
        NavigationStack {
            List {
                if store.secureEnrollmentState != .enrolled {
                    Section("Secure People access") {
                        LabeledContent(
                            "This iPhone",
                            value: store.secureEnrollmentState == .enrolling
                                ? "Enrolling"
                                : "Approval required"
                        )
                        Button {
                            Task { await store.enrollCompanion() }
                        } label: {
                            Label("Enroll this iPhone", systemImage: "person.badge.key")
                                .frame(minHeight: 44)
                        }
                        .disabled(store.secureEnrollmentState == .enrolling)
                        .accessibilityIdentifier("PeerSecureEnrollmentButton")
                    }
                }

                Section {
                    LabeledContent("Session", value: sessionLabel)
                    LabeledContent("Host", value: "Foreground only")
                    if let peerCore = store.peerCoreStatus {
                        LabeledContent(
                            "Peer service",
                            value: peerCore.healthy ? "Reachable" : "Unavailable"
                        )
                    }
                    if let updatedAt = store.lastUpdatedAt {
                        LabeledContent("Updated") {
                            Text(updatedAt, style: .relative)
                        }
                    }
                } header: {
                    Text("Connectivity")
                } footer: {
                    Text("After secure enrollment, refresh is attempted every \(store.foregroundRefreshSeconds) seconds while this screen is open and the app is active. The paired Forge host must remain reachable; iOS does not host the peer service in the background.")
                }

                Section("Apple Watch") {
                    if store.watchGlance.selection == .selected,
                       let personName = store.watchGlance.personName
                    {
                        LabeledContent("Glance", value: personName)
                    } else {
                        LabeledContent("Glance", value: "Choose a Person on iPhone")
                    }
                    Text("The newest eligible owner-scoped Person pin is shown. Other Entity Navigation pins stay unchanged.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let error = store.watchPinErrorMessage {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(CompanionStyle.destructive)
                            .accessibilityIdentifier("PeopleWatchPinError")
                        Button {
                            Task { await store.retryWatchPinAction() }
                        } label: {
                            Label("Retry Watch selection", systemImage: "arrow.clockwise")
                        }
                        .disabled(store.watchPinOperationInFlight)
                    }
                }

                if store.requests.isEmpty == false {
                    Section("Pending review") {
                        ForEach(store.requests) { request in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(request.kind.capitalized)
                                    .font(.headline)
                                Text(request.status.capitalized)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(request.expiresAt)
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                                if store.canResume(request) {
                                    Button {
                                        store.resume(request)
                                    } label: {
                                        Label("Resume verified review", systemImage: "checkmark.shield")
                                    }
                                    .buttonStyle(.borderless)
                                }
                                if ["device", "grant"].contains(request.kind) {
                                    PeerRequestDecisionButtons(
                                        request: request,
                                        acceptDisabled: store.operationInFlight ||
                                            store.supports(.acceptPeerRequest) == false,
                                        rejectDisabled: store.operationInFlight ||
                                            store.supports(.rejectPeerRequest) == false,
                                        decide: { accept in
                                            requestDecision = (request, accept)
                                        }
                                    )
                                }
                            }
                        }
                    }
                }

                Section("Relationships") {
                    if store.relationships.isEmpty, store.loadState == .loaded {
                        ContentUnavailableView(
                            "No peer relationships",
                            systemImage: "person.2.slash"
                        )
                    } else {
                        ForEach(store.relationships) { relationship in
                            NavigationLink(value: relationship.id) {
                                PeerRelationshipRow(relationship: relationship)
                            }
                        }
                    }
                }

                if let error = store.errorMessage {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(CompanionStyle.destructive)
                            .accessibilityIdentifier("PeerErrorMessage")
                        if store.canRetry {
                            Button {
                                Task { await store.retry() }
                            } label: {
                                Label("Retry", systemImage: "arrow.clockwise")
                            }
                        }
                    }
                }
            }
            .overlay {
                if store.loadState == .loading, store.relationships.isEmpty {
                    ProgressView("Loading People")
                }
            }
            .navigationTitle("People")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: String.self) { relationshipId in
                PeerRelationshipDetailView(relationshipId: relationshipId)
            }
            .toolbar {
                ToolbarItemGroup(placement: .topBarLeading) {
                    Button(action: close) {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel("Close People")
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        scannerVisible = true
                    } label: {
                        Image(systemName: "qrcode.viewfinder")
                    }
                    .accessibilityLabel("Scan peer invitation")
                    .accessibilityIdentifier("PeerScanButton")

                    Button {
                        createInvitationVisible = true
                    } label: {
                        Image(systemName: "qrcode")
                    }
                    .accessibilityLabel("Create peer invitation")
                    .disabled(store.supports(.createPeerInvitation) == false)
                }
            }
            .refreshable {
                await store.load()
            }
            .task {
                await store.load()
            }
        }
        .accessibilityIdentifier("PeoplePeerManagement")
        .onAppear {
            store.managementDidAppear()
        }
        .onDisappear {
            store.managementDidDisappear()
        }
        .fullScreenCover(isPresented: $scannerVisible) {
            PeerInviteScannerScreen(
                close: { scannerVisible = false },
                onCode: { value in
                    let accepted = store.stageScannedInvitation(value)
                    if accepted {
                        scannerVisible = false
                    }
                    return accepted
                }
            )
        }
        .sheet(item: $store.pairingReview) { _ in
            PeerPairingReviewView()
                .environmentObject(store)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $createInvitationVisible) {
            PeerCreateInvitationView(close: { createInvitationVisible = false })
                .environmentObject(store)
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
        .sheet(item: $store.outgoingInvitation) { envelope in
            PeerOutgoingInvitationView(envelope: envelope)
                .environmentObject(store)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .confirmationDialog(
            requestDecision?.accept == true ? "Accept this request?" : "Reject this request?",
            isPresented: Binding(
                get: { requestDecision != nil },
                set: { if $0 == false { requestDecision = nil } }
            ),
            titleVisibility: .visible
        ) {
            if let decision = requestDecision {
                Button(
                    decision.accept ? "Accept \(decision.request.kind) request" : "Reject \(decision.request.kind) request",
                    role: decision.accept ? nil : .destructive
                ) {
                    requestDecision = nil
                    Task {
                        await store.decideRequest(
                            decision.request,
                            accept: decision.accept
                        )
                    }
                }
            }
            Button("Cancel", role: .cancel) { requestDecision = nil }
        } message: {
            Text("Only the exact reviewed request and version will be submitted after device authentication.")
        }
    }

    private var sessionLabel: String {
        switch store.loadState {
        case .loaded:
            return "Connected"
        case .loading:
            return "Refreshing"
        case .offline:
            return "Offline"
        case .failed:
            return "Unavailable"
        case .idle:
            return "Waiting"
        }
    }
}

private struct PeerRequestDecisionButtons: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let request: PeerPendingRequest
    let acceptDisabled: Bool
    let rejectDisabled: Bool
    let decide: (Bool) -> Void

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) {
                buttons
            }
        } else {
            HStack(spacing: 12) {
                buttons
            }
        }
    }

    @ViewBuilder
    private var buttons: some View {
        Button {
            decide(true)
        } label: {
            Label("Accept", systemImage: "checkmark.circle")
        }
        .disabled(acceptDisabled)
        .accessibilityLabel("Accept \(request.kind) request")

        Button(role: .destructive) {
            decide(false)
        } label: {
            Label("Reject", systemImage: "xmark.circle")
        }
        .disabled(rejectDisabled)
        .accessibilityLabel("Reject \(request.kind) request")
    }
}

private struct PeerRelationshipRow: View {
    let relationship: PeerRelationship

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: relationship.isRevoked ? "person.2.slash" : "person.2.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(statusColor)
                .frame(width: 26)

            VStack(alignment: .leading, spacing: 3) {
                Text(relationship.remoteDisplayLabel)
                    .font(.headline)
                    .lineLimit(2)
                Text(relationship.status.replacingOccurrences(of: "_", with: " ").capitalized)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
    }

    private var statusColor: Color {
        switch relationship.status {
        case "active":
            return Color.green
        case "pending_verification", "paused":
            return Color.orange
        case "revoked", "recovery_required":
            return CompanionStyle.destructive
        default:
            return Color.secondary
        }
    }
}

private enum PeerGrantComposerTarget: Identifiable {
    case proposal
    case counter(PeerGrant)

    var id: String {
        switch self {
        case .proposal:
            return "proposal"
        case .counter(let grant):
            return "counter:\(grant.id):\(grant.versionHash ?? "unversioned")"
        }
    }

    var grant: PeerGrant? {
        guard case .counter(let grant) = self else { return nil }
        return grant
    }
}

private struct PeerRelationshipDetailView: View {
    enum Tab: String, CaseIterable {
        case status = "Status"
        case grants = "Grants"
        case devices = "Devices"
        case diagnostics = "Diagnostics"
    }

    @EnvironmentObject private var store: PeoplePeerStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let relationshipId: String

    @State private var tab: Tab = .status
    @State private var revokeRelationshipVisible = false
    @State private var deviceAction: (PeerDevice, Bool)?
    @State private var grantToRevoke: PeerGrant?
    @State private var grantToAccept: PeerGrant?
    @State private var grantComposer: PeerGrantComposerTarget?
    @State private var resyncVisible = false
    @State private var removeWatchPinVisible = false

    var body: some View {
        VStack(spacing: 0) {
            tabPicker
            .padding(.horizontal, 12)
            .padding(.vertical, 10)

            List {
                switch tab {
                case .status:
                    statusSections
                case .grants:
                    grantSections
                case .devices:
                    deviceSections
                case .diagnostics:
                    diagnosticSections
                }

                if let error = store.errorMessage {
                    Section {
                        Text(error)
                            .foregroundStyle(CompanionStyle.destructive)
                        if store.canRetry {
                            Button("Retry") {
                                Task { await store.retry() }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(store.selectedRelationship?.remoteDisplayLabel ?? "Relationship")
        .navigationBarTitleDisplayMode(.inline)
        .overlay {
            if store.loadState == .loading, store.selectedRelationship == nil {
                ProgressView("Loading relationship")
            }
        }
        .task(id: relationshipId) {
            await store.loadDetail(relationshipId: relationshipId)
        }
        .onDisappear {
            store.clearSelectedRelationship()
        }
        .sheet(item: $grantComposer, onDismiss: store.clearGrantReview) { target in
            PeerGrantComposerView(target: target)
                .environmentObject(store)
        }
        .confirmationDialog(
            "Revoke this relationship?",
            isPresented: $revokeRelationshipVisible,
            titleVisibility: .visible
        ) {
            Button("Revoke relationship", role: .destructive) {
                Task {
                    await store.revokeSelectedRelationship()
                    if store.selectedRelationship?.isRevoked == true {
                        dismiss()
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Active grants and approved devices will be withdrawn. Managed peer cache is purged.")
        }
        .confirmationDialog(
            deviceAction?.1 == true ? "Approve this device?" : "Remove this device?",
            isPresented: Binding(
                get: { deviceAction != nil },
                set: { if $0 == false { deviceAction = nil } }
            ),
            titleVisibility: .visible
        ) {
            if let (device, approve) = deviceAction {
                Button(approve ? "Approve device" : "Remove device", role: approve ? nil : .destructive) {
                    deviceAction = nil
                    Task { await store.mutateDevice(device, approve: approve) }
                }
            }
            Button("Cancel", role: .cancel) { deviceAction = nil }
        }
        .confirmationDialog(
            "Revoke this sharing grant?",
            isPresented: Binding(
                get: { grantToRevoke != nil },
                set: { if $0 == false { grantToRevoke = nil } }
            ),
            titleVisibility: .visible
        ) {
            if let grant = grantToRevoke {
                Button("Revoke grant", role: .destructive) {
                    grantToRevoke = nil
                    Task { await store.revokeGrant(grant) }
                }
            }
            Button("Cancel", role: .cancel) { grantToRevoke = nil }
        }
        .confirmationDialog(
            "Accept this sharing grant?",
            isPresented: Binding(
                get: { grantToAccept != nil },
                set: { if $0 == false { grantToAccept = nil } }
            ),
            titleVisibility: .visible
        ) {
            if let grant = grantToAccept {
                Button("Accept grant") {
                    grantToAccept = nil
                    Task { await store.acceptGrant(grant) }
                }
            }
            Button("Cancel", role: .cancel) { grantToAccept = nil }
        } message: {
            if let grant = grantToAccept {
                Text("Version \(grant.sequence) · \(grant.rules.count) rules")
            }
        }
        .confirmationDialog(
            "Resync shared data?",
            isPresented: $resyncVisible,
            titleVisibility: .visible
        ) {
            Button("Request resync") {
                let projectionIds = store.resyncProjectionIds
                Task { await store.requestResync(projectionIds: projectionIds) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("\(store.resyncProjectionIds.count) bounded projections")
        }
        .confirmationDialog(
            "Remove this Person from Apple Watch?",
            isPresented: $removeWatchPinVisible,
            titleVisibility: .visible
        ) {
            if let relationship = store.selectedRelationship {
                Button("Remove Person pin", role: .destructive) {
                    Task { await store.removeFromWatch(relationship) }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes the existing Entity Navigation pin. The next eligible Person pin will be shown instead.")
        }
    }

    @ViewBuilder
    private var tabPicker: some View {
        if dynamicTypeSize.isAccessibilitySize {
            Picker("Relationship view", selection: $tab) {
                ForEach(Tab.allCases, id: \.self) { tab in
                    Text(tab.rawValue).tag(tab)
                }
            }
            .pickerStyle(.menu)
        } else {
            Picker("Relationship view", selection: $tab) {
                ForEach(Tab.allCases, id: \.self) { tab in
                    Text(tab.rawValue).tag(tab)
                }
            }
            .pickerStyle(.segmented)
        }
    }

    @ViewBuilder
    private var statusSections: some View {
        if let relationship = store.selectedRelationship {
            Section("Relationship") {
                LabeledContent("Status", value: display(relationship.status))
                LabeledContent("Trust", value: display(relationship.remoteTrustState))
                LabeledContent("Privacy", value: display(relationship.transportPrivacyMode))
                LabeledContent("Protocol", value: relationship.negotiatedProtocolVersion)
                if let lastConnectedAt = relationship.lastConnectedAt {
                    LabeledContent("Last reachable", value: lastConnectedAt)
                }
            }

            if let sync = store.syncStatus {
                Section("Sync") {
                    LabeledContent("Outbox", value: "\(sync.pendingOutbox)")
                    LabeledContent("Inbox", value: "\(sync.pendingInbox)")
                    LabeledContent("Current records", value: "\(sync.currentRemoteRecords)")
                    LabeledContent("Stale records", value: "\(sync.staleRemoteRecords)")
                    Button {
                        resyncVisible = true
                    } label: {
                        Label("Resync shared data", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .disabled(
                        store.resyncProjectionIds.isEmpty || store.operationInFlight ||
                            store.supports(.requestPeerResync) == false
                    )
                    .accessibilityIdentifier("PeerResyncButton")
                }
            }

            Section("Apple Watch") {
                if relationship.status != "active" || relationship.localPersonId == nil {
                    LabeledContent("Glance", value: "Unavailable")
                    Text("Only an active visible Person with a peer relationship can appear on Apple Watch.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if store.watchPin(for: relationship) != nil {
                    LabeledContent(
                        "Person pin",
                        value: store.isSelectedForWatch(relationship)
                            ? "Shown on Watch"
                            : "Pinned; newer Person shown"
                    )
                    Button(role: .destructive) {
                        removeWatchPinVisible = true
                    } label: {
                        Label("Remove from Apple Watch", systemImage: "pin.slash")
                    }
                    .disabled(store.watchPinOperationInFlight)
                    .accessibilityIdentifier("PeopleWatchUnpinButton")
                } else {
                    LabeledContent("Person pin", value: "Not pinned")
                    Button {
                        Task { await store.chooseForWatch(relationship) }
                    } label: {
                        Label("Show on Apple Watch", systemImage: "pin")
                    }
                    .disabled(store.watchPinOperationInFlight)
                    .accessibilityIdentifier("PeopleWatchPinButton")
                }

                if let error = store.watchPinErrorMessage {
                    Text(error)
                        .foregroundStyle(CompanionStyle.destructive)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("Retry") {
                        Task { await store.retryWatchPinAction() }
                    }
                    .disabled(store.watchPinOperationInFlight)
                }
            }

            Section {
                Button("Revoke relationship", role: .destructive) {
                    revokeRelationshipVisible = true
                }
                .disabled(
                    relationship.isRevoked || store.operationInFlight ||
                        store.supports(.revokePeerRelationship) == false
                )
                .accessibilityIdentifier("PeerRevokeRelationshipButton")
            }
        }
    }

    @ViewBuilder
    private var grantSections: some View {
        Section {
            Button {
                grantComposer = .proposal
            } label: {
                Label("New sharing grant", systemImage: "plus")
            }
            .disabled(
                store.approvedRemoteDeviceIds.isEmpty || store.operationInFlight ||
                    store.supports(.previewPeerGrant) == false ||
                    store.supports(.proposePeerGrant) == false
            )
            .accessibilityIdentifier("PeerNewGrantButton")
        }

        if store.grants.isEmpty {
            Section {
                ContentUnavailableView("No grants", systemImage: "lock.doc")
            }
        } else {
            ForEach(store.grants) { grant in
                Section {
                    LabeledContent("Direction", value: display(grant.direction))
                    LabeledContent("Status", value: display(grant.status))
                    LabeledContent("Version", value: "\(grant.sequence)")
                    LabeledContent("Rules", value: "\(grant.rules.count)")
                    if grant.rules.isEmpty == false {
                        Text(grant.rules.map(\.projectionId).joined(separator: " · "))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if grant.canReviewIncomingProposal {
                        Button {
                            grantToAccept = grant
                        } label: {
                            Label("Accept grant", systemImage: "checkmark.shield")
                        }
                        .disabled(
                            grant.versionHash == nil || store.operationInFlight ||
                                store.supports(.acceptPeerGrant) == false
                        )
                        .accessibilityIdentifier("PeerGrantAcceptButton")

                        Button {
                            grantComposer = .counter(grant)
                        } label: {
                            Label("Counter proposal", systemImage: "arrow.triangle.branch")
                        }
                        .disabled(
                            grant.versionHash == nil || grant.rules.isEmpty ||
                                store.operationInFlight ||
                                store.supports(.previewPeerGrant) == false ||
                                store.supports(.counterPeerGrant) == false
                        )
                        .accessibilityIdentifier("PeerGrantCounterButton")
                    }
                    if grant.canRevoke {
                        Button(role: .destructive) {
                            grantToRevoke = grant
                        } label: {
                            Label("Revoke grant", systemImage: "xmark.shield")
                        }
                        .disabled(
                            grant.versionHash == nil || store.operationInFlight ||
                                store.supports(.revokePeerGrant) == false
                        )
                    }
                } header: {
                    Text(grant.label)
                }
            }
        }
    }

    @ViewBuilder
    private var deviceSections: some View {
        if store.devices.isEmpty {
            Section {
                ContentUnavailableView("No peer devices", systemImage: "iphone.slash")
            }
        } else {
            ForEach(store.devices) { device in
                Section {
                    LabeledContent("Role", value: display(device.principalRole))
                    LabeledContent("Status", value: display(device.status))
                    LabeledContent("Type", value: display(device.deviceType))
                    if let lastSeenAt = device.lastSeenAt {
                        LabeledContent("Last seen", value: lastSeenAt)
                    }
                    if device.status == "pending" {
                        Button("Approve device") {
                            deviceAction = (device, true)
                        }
                        .disabled(store.supports(.approvePeerDevice) == false)
                    }
                    if ["pending", "approved"].contains(device.status) {
                        Button("Remove device", role: .destructive) {
                            deviceAction = (device, false)
                        }
                        .disabled(store.supports(.removePeerDevice) == false)
                        .accessibilityIdentifier("PeerRemoveDeviceButton")
                    }
                } header: {
                    Text(device.label)
                }
            }
        }
    }

    @ViewBuilder
    private var diagnosticSections: some View {
        if store.diagnostics.isEmpty {
            Section {
                ContentUnavailableView("No diagnostics", systemImage: "waveform.path.ecg")
            }
        } else {
            ForEach(store.diagnostics) { diagnostic in
                Section {
                    LabeledContent("Outcome", value: display(diagnostic.outcome))
                    LabeledContent("Actor", value: display(diagnostic.actorClass))
                    Text(diagnostic.createdAt)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                } header: {
                    Text(display(diagnostic.eventType))
                }
            }
        }
    }

    private func display(_ value: String) -> String {
        value.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

private struct PeerGrantComposerView: View {
    @EnvironmentObject private var store: PeoplePeerStore
    @Environment(\.dismiss) private var dismiss

    let target: PeerGrantComposerTarget

    @State private var label: String
    @State private var purpose: String
    @State private var selectedProjectionIds: Set<String>
    @State private var retainedAllowRuleIds: Set<String>
    @State private var rollingFutureDays = 30
    @State private var retentionHours = 24
    @State private var expiryDays = 90
    @State private var referenceDate = Date()

    init(target: PeerGrantComposerTarget) {
        self.target = target
        switch target {
        case .proposal:
            _label = State(initialValue: "Shared context")
            _purpose = State(initialValue: "Coordinate through Forge")
            _selectedProjectionIds = State(initialValue: [
                PeerGrantProjectionPreset.availability.rawValue,
                PeerGrantProjectionPreset.profile.rawValue
            ])
            _retainedAllowRuleIds = State(initialValue: [])
        case .counter(let grant):
            _label = State(initialValue: grant.label)
            _purpose = State(initialValue: grant.purpose)
            _selectedProjectionIds = State(initialValue: [])
            _retainedAllowRuleIds = State(initialValue: Set(
                grant.rules.filter { $0.effect == "allow" }.map(\.id)
            ))
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                switch target {
                case .proposal:
                    proposalControls
                case .counter(let grant):
                    counterControls(grant)
                }

                if let review = matchingReview {
                    previewSection(review.preview)
                    Section {
                        Button {
                            Task {
                                await store.submitGrantReview()
                                if store.grantReview == nil, store.errorMessage == nil {
                                    dismiss()
                                }
                            }
                        } label: {
                            Label(submitTitle, systemImage: submitIcon)
                        }
                        .disabled(store.operationInFlight)
                        .accessibilityIdentifier("PeerGrantSubmitButton")
                    }
                }

                if let error = store.errorMessage {
                    Section {
                        Text(error)
                            .foregroundStyle(CompanionStyle.destructive)
                    }
                }
            }
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") {
                        store.clearGrantReview()
                        dismiss()
                    }
                    .disabled(store.operationInFlight)
                }
            }
        }
        .interactiveDismissDisabled(store.operationInFlight)
    }

    @ViewBuilder
    private var proposalControls: some View {
        Section("Grant") {
            TextField("Label", text: $label)
                .textInputAutocapitalization(.sentences)
            TextField("Purpose", text: $purpose, axis: .vertical)
                .lineLimit(2...4)
            Stepper("Expires in \(expiryDays) days", value: $expiryDays, in: 1...365)
            Stepper(
                retentionHours == 0 ? "No remote cache" : "Cache up to \(retentionHours) hours",
                value: $retentionHours,
                in: 0...168
            )
        }

        Section("Shared data") {
            ForEach(PeerGrantProjectionPreset.allCases) { projection in
                Toggle(projection.title, isOn: projectionBinding(projection))
            }
            if selectedProjectionIds.contains(PeerGrantProjectionPreset.availability.rawValue) {
                Stepper(
                    "Availability horizon: \(rollingFutureDays) days",
                    value: $rollingFutureDays,
                    in: 1...365
                )
            }
        }

        previewButton
    }

    @ViewBuilder
    private func counterControls(_ grant: PeerGrant) -> some View {
        Section("Current proposal") {
            LabeledContent("Version", value: "\(grant.sequence)")
            LabeledContent("Rules", value: "\(grant.rules.count)")
            LabeledContent("Direction", value: display(grant.direction))
        }
        Section("Retained sharing") {
            ForEach(grant.rules.filter { $0.effect == "allow" }) { rule in
                Toggle(
                    display(rule.projectionId),
                    isOn: retainedRuleBinding(rule.id)
                )
            }
        }
        previewButton
    }

    private var previewButton: some View {
        Section {
            Button {
                guard let draft else { return }
                Task { await store.previewGrant(draft, countering: target.grant) }
            } label: {
                if store.operationInFlight {
                    ProgressView()
                } else {
                    Label("Preview exact grant", systemImage: "doc.text.magnifyingglass")
                }
            }
            .disabled(draft == nil || store.operationInFlight)
            .accessibilityIdentifier("PeerGrantPreviewButton")
        }
    }

    @ViewBuilder
    private func previewSection(_ preview: PeerGrantPreview) -> some View {
        Section("Reviewed output") {
            LabeledContent("Projections", value: "\(preview.worstCase.projectionIds.count)")
            LabeledContent("Maximum records", value: "\(preview.worstCase.maximumResultCount)")
            LabeledContent(
                "Maximum payload",
                value: ByteCountFormatter.string(
                    fromByteCount: Int64(preview.worstCase.maximumPayloadBytes),
                    countStyle: .file
                )
            )
            LabeledContent(
                "Maximum retention",
                value: retentionLabel(preview.worstCase.maximumRetentionSeconds)
            )
            LabeledContent(
                "Approved devices",
                value: "\(preview.worstCase.currentApprovedDeviceCount)"
            )
        }
    }

    private var draft: PeerGrantDraft? {
        switch target {
        case .proposal:
            let trimmedLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmedLabel.isEmpty == false,
                  selectedProjectionIds.isEmpty == false,
                  store.approvedRemoteDeviceIds.isEmpty == false
            else { return nil }
            let projections = PeerGrantProjectionPreset.allCases.filter {
                selectedProjectionIds.contains($0.rawValue)
            }
            let expiry = Calendar.current.date(
                byAdding: .day,
                value: expiryDays,
                to: referenceDate
            ).map { ISO8601DateFormatter().string(from: $0) }
            return PeerGrantDraft.proposal(
                label: trimmedLabel,
                purpose: purpose.trimmingCharacters(in: .whitespacesAndNewlines),
                projections: projections,
                approvedDeviceIds: store.approvedRemoteDeviceIds,
                rollingFutureDays: rollingFutureDays,
                retentionSeconds: retentionHours * 3_600,
                expiresAt: expiry
            )
        case .counter(let grant):
            return PeerGrantDraft.countering(
                grant,
                retainedAllowRuleIds: retainedAllowRuleIds
            )
        }
    }

    private var matchingReview: PeerGrantReview? {
        guard let draft, let review = store.grantReview, review.draft == draft else {
            return nil
        }
        switch (target, review.intent) {
        case (.proposal, .proposal):
            return review
        case (.counter(let grant), .counter(let grantId, let versionHash))
            where grant.id == grantId && grant.versionHash == versionHash:
            return review
        default:
            return nil
        }
    }

    private var navigationTitle: String {
        switch target {
        case .proposal: return "New grant"
        case .counter: return "Counter grant"
        }
    }

    private var submitTitle: String {
        switch target {
        case .proposal: return "Propose grant"
        case .counter: return "Send counter"
        }
    }

    private var submitIcon: String {
        switch target {
        case .proposal: return "paperplane"
        case .counter: return "arrow.triangle.branch"
        }
    }

    private func projectionBinding(_ projection: PeerGrantProjectionPreset) -> Binding<Bool> {
        Binding(
            get: { selectedProjectionIds.contains(projection.rawValue) },
            set: { selected in
                if selected {
                    selectedProjectionIds.insert(projection.rawValue)
                } else {
                    selectedProjectionIds.remove(projection.rawValue)
                }
            }
        )
    }

    private func retainedRuleBinding(_ ruleId: String) -> Binding<Bool> {
        Binding(
            get: { retainedAllowRuleIds.contains(ruleId) },
            set: { retained in
                if retained {
                    retainedAllowRuleIds.insert(ruleId)
                } else {
                    retainedAllowRuleIds.remove(ruleId)
                }
            }
        )
    }

    private func retentionLabel(_ seconds: Int) -> String {
        guard seconds > 0 else { return "None" }
        if seconds.isMultiple(of: 86_400) {
            return "\(seconds / 86_400) days"
        }
        return "\(seconds / 3_600) hours"
    }

    private func display(_ value: String) -> String {
        value
            .replacingOccurrences(of: ".v1", with: "")
            .replacingOccurrences(of: ".", with: " ")
            .replacingOccurrences(of: "_", with: " ")
            .capitalized
    }
}

private struct PeerPairingReviewView: View {
    @EnvironmentObject private var store: PeoplePeerStore

    @State private var identityConfirmed = false
    @State private var personName = ""

    var body: some View {
        NavigationStack {
            List {
                if let review = store.pairingReview {
                    Section("Remote Forge") {
                        LabeledContent("Identity", value: review.remoteLabel)
                        LabeledContent("Device", value: review.deviceLabel)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Fingerprint")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(review.fingerprint)
                                .font(.body.monospaced())
                                .textSelection(.disabled)
                                .accessibilityIdentifier("PeerFingerprint")
                        }
                        LabeledContent("Expires") {
                            Text(review.expiresAt)
                                .multilineTextAlignment(.trailing)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }

                    reviewStageContent(review)

                    if let error = store.errorMessage {
                        Section {
                            Label(error, systemImage: "exclamationmark.triangle.fill")
                                .foregroundStyle(CompanionStyle.destructive)
                            if case .failed = review.stage, store.canRetry {
                                Button("Retry") {
                                    Task { await store.retry() }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Peer review")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        store.closePairingReview()
                    }
                    .disabled(store.operationInFlight)
                }
            }
        }
        .interactiveDismissDisabled(store.operationInFlight)
        .onAppear {
            if personName.isEmpty {
                personName = store.pairingReview?.remoteLabel ?? ""
            }
        }
        .accessibilityIdentifier("PeerPairingReview")
    }

    @ViewBuilder
    private func reviewStageContent(_ review: PeerPairingReview) -> some View {
        switch review.stage {
        case .scanned:
            Section {
                Text("Scanning did not verify, link, accept, or share anything.")
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("PeerScanNoActionNotice")
                Button {
                    Task { await store.submitScannedInvitationForReview() }
                } label: {
                    Label("Continue review", systemImage: "faceid")
                }
                .disabled(
                    store.operationInFlight ||
                        store.supports(.acceptScannedPeerPairing) == false
                )
                .accessibilityIdentifier("PeerContinueReviewButton")
            }
        case .submitting, .confirming:
            Section {
                ProgressView(review.stage == .submitting ? "Requesting verified details" : "Confirming relationship")
            }
        case .verified:
            Section("Verification") {
                if let phrase = review.verificationPhrase {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Phrase")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(phrase)
                            .font(.headline)
                            .accessibilityIdentifier("PeerVerificationPhrase")
                    }
                } else {
                    Text("Forge did not provide a verification phrase. Confirmation remains unavailable.")
                        .foregroundStyle(.secondary)
                }
                Toggle("I verified the identity through a separate channel", isOn: $identityConfirmed)
                    .accessibilityIdentifier("PeerIdentityConfirmedToggle")
            }

            if review.initialProjections.isEmpty == false || review.initialFields.isEmpty == false {
                Section("Initial sharing") {
                    ForEach(review.initialProjections, id: \.self) { projection in
                        Label(projection, systemImage: "rectangle.stack")
                    }
                    ForEach(review.initialFields, id: \.self) { field in
                        Label(field, systemImage: "text.line.first.and.arrowtriangle.forward")
                    }
                }
            }

            Section("Person") {
                TextField("Person name", text: $personName)
                    .textInputAutocapitalization(.words)
                Button {
                    Task { await store.confirmPairing(personName: personName) }
                } label: {
                    Label("Confirm relationship", systemImage: "person.badge.shield.checkmark")
                }
                .disabled(
                    identityConfirmed == false ||
                        review.verificationPhrase?.isEmpty != false ||
                        review.transcriptHash?.isEmpty != false ||
                        personName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                        store.operationInFlight ||
                        store.supports(.confirmPeerPairing) == false
                )
                .accessibilityIdentifier("PeerConfirmRelationshipButton")
            }
        case .completed:
            Section {
                Label("Relationship confirmed", systemImage: "checkmark.shield.fill")
                    .foregroundStyle(.green)
            }
        case .expired:
            Section {
                Label("Invitation expired", systemImage: "clock.badge.xmark")
                    .foregroundStyle(CompanionStyle.destructive)
            }
        case .replayed:
            Section {
                Label("Invitation already used", systemImage: "arrow.uturn.backward.circle")
                    .foregroundStyle(CompanionStyle.destructive)
            }
        case .failed(let message):
            Section {
                Text(message)
                    .foregroundStyle(CompanionStyle.destructive)
            }
        }
    }
}

private struct PeerCreateInvitationView: View {
    @EnvironmentObject private var store: PeoplePeerStore

    let close: () -> Void

    @State private var label = ""

    var body: some View {
        NavigationStack {
            Form {
                TextField("Remote person or Forge label", text: $label)
                    .textInputAutocapitalization(.words)
                Button {
                    Task {
                        await store.createInvitation(label: label)
                        if store.outgoingInvitation != nil {
                            close()
                        }
                    }
                } label: {
                    if store.operationInFlight {
                        ProgressView()
                    } else {
                        Label("Create one-use invite", systemImage: "faceid")
                    }
                }
                .disabled(
                    label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                        store.operationInFlight ||
                        store.supports(.createPeerInvitation) == false
                )
                if let error = store.errorMessage {
                    Text(error)
                        .foregroundStyle(CompanionStyle.destructive)
                }
            }
            .navigationTitle("Create invite")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel", action: close)
                }
            }
        }
    }
}

private struct PeerOutgoingInvitationView: View {
    @EnvironmentObject private var store: PeoplePeerStore

    let envelope: PeerInviteQREnvelope

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    Label("Peer invite", systemImage: "person.2.badge.key")
                        .font(.headline)
                        .foregroundStyle(Color.red)

                    if store.outgoingInvitationIsDisplayable,
                       let image = PeerQRCodeRenderer.image(for: envelope)
                    {
                        Image(uiImage: image)
                            .interpolation(.none)
                            .resizable()
                            .scaledToFit()
                            .frame(maxWidth: 300)
                            .padding(12)
                            .background(Color.white)
                            .overlay(Rectangle().stroke(Color.red, lineWidth: 5))
                            .privacySensitive()
                            .accessibilityLabel("One-use Forge peer invitation QR code")
                            .accessibilityIdentifier("PeerOutgoingInvitationQR")
                    } else {
                        ContentUnavailableView(
                            "Invitation \(displayStatus)",
                            systemImage: "qrcode"
                        )
                    }

                    Text(envelope.invitation.fingerprint)
                        .font(.body.monospaced())
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Expires \(envelope.invitation.expiresAt)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)

                    LabeledContent("Status", value: displayStatus.capitalized)
                        .frame(maxWidth: 360)

                    if store.outgoingInvitationStatus?.isActive == true {
                        Button(role: .destructive) {
                            Task { await store.cancelOutgoingInvitation() }
                        } label: {
                            Label("Cancel invitation", systemImage: "xmark.circle")
                        }
                        .disabled(
                            store.operationInFlight ||
                                store.supports(.cancelPeerInvitation) == false
                        )
                        .accessibilityIdentifier("PeerCancelInvitationButton")
                    }

                    Button {
                        Task { await store.refreshOutgoingInvitation() }
                    } label: {
                        Label("Refresh status", systemImage: "arrow.clockwise")
                    }
                    .disabled(
                        store.operationInFlight ||
                            store.supports(.getPeerInvitationStatus) == false
                    )
                }
                .padding(24)
            }
            .navigationTitle("Peer invitation")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private var displayStatus: String {
        if let status = store.outgoingInvitationStatus?.status {
            return status.replacingOccurrences(of: "_", with: " ")
        }
        return store.outgoingInvitationIsDisplayable ? "active" : "expired"
    }
}

enum PeerQRCodeRenderer {
    static func image(for envelope: PeerInviteQREnvelope) -> UIImage? {
        guard let text = try? envelope.encodedText() else { return nil }
        let generator = CIFilter.qrCodeGenerator()
        generator.message = Data(text.utf8)
        generator.correctionLevel = "M"
        let color = CIFilter.falseColor()
        color.inputImage = generator.outputImage
        color.color0 = CIColor(red: 0.55, green: 0.02, blue: 0.08)
        color.color1 = CIColor.white
        guard let output = color.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)) else {
            return nil
        }
        let context = CIContext(options: [.useSoftwareRenderer: false])
        guard let cgImage = context.createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}

private struct PeerInviteScannerScreen: View {
    @Environment(\.scenePhase) private var scenePhase

    let close: () -> Void
    let onCode: (String) -> Bool

    @State private var authorizationState = PeerCameraAuthorizationPolicy.state(
        for: AVCaptureDevice.authorizationStatus(for: .video)
    )
    @State private var scanError: String?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            switch effectiveAuthorizationState {
            case .authorized:
                PeerInviteScannerCamera { value in
                    let accepted = onCode(value)
                    if accepted == false {
                        scanError = "This QR is not an active Forge peer invitation."
                    }
                    return accepted
                }
                .ignoresSafeArea()
            case .request:
                ProgressView("Requesting camera access")
                    .tint(.white)
                    .foregroundStyle(.white)
            case .denied, .restricted:
                ContentUnavailableView {
                    Label("Camera access is off", systemImage: "camera.fill")
                } description: {
                    Text("Allow camera access in Settings, then return to scan the peer invitation.")
                } actions: {
                    if effectiveAuthorizationState == .denied {
                        Button("Open Settings") {
                            guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                            UIApplication.shared.open(url)
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }
                .foregroundStyle(.white)
                .accessibilityIdentifier("PeerCameraDenied")
            }

            VStack {
                HStack {
                    Spacer()
                    Button(action: close) {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(Color.black.opacity(0.5), in: Circle())
                    }
                    .contentShape(Rectangle())
                    .accessibilityLabel("Close peer scanner")
                    .accessibilityIdentifier("PeerScannerCloseButton")
                }
                .padding(16)
                Spacer()
                if let scanError {
                    Text(scanError)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(12)
                        .background(Color.red.opacity(0.85))
                        .padding(.bottom, 24)
                }
            }
        }
        .task {
            refreshAuthorization()
            guard effectiveAuthorizationState == .request else { return }
            let approved = await AVCaptureDevice.requestAccess(for: .video)
            authorizationState = approved ? .authorized : .denied
        }
        .onChange(of: scenePhase) { _, nextPhase in
            guard nextPhase == .active else { return }
            refreshAuthorization()
        }
    }

    private var effectiveAuthorizationState: PeerCameraAuthorizationState {
#if DEBUG
        if ProcessInfo.processInfo.environment["FORGE_UI_TEST_PEER_CAMERA_AUTH"] == "denied" {
            return .denied
        }
#endif
        return authorizationState
    }

    private func refreshAuthorization() {
        authorizationState = PeerCameraAuthorizationPolicy.state(
            for: AVCaptureDevice.authorizationStatus(for: .video)
        )
    }
}

private struct PeerInviteScannerCamera: UIViewRepresentable {
    let onCode: (String) -> Bool

    func makeUIView(context: Context) -> ScannerPreviewView {
        let view = ScannerPreviewView()
        context.coordinator.configure(on: view)
        return view
    }

    func updateUIView(_ uiView: ScannerPreviewView, context: Context) {}

    static func dismantleUIView(_ uiView: ScannerPreviewView, coordinator: Coordinator) {
        coordinator.stop()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onCode: onCode)
    }

    final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
        private let onCode: (String) -> Bool
        private let session = AVCaptureSession()
        private var lastValue: String?
        private var lastScannedAt = Date.distantPast

        init(onCode: @escaping (String) -> Bool) {
            self.onCode = onCode
        }

        func stop() {
            if session.isRunning {
                session.stopRunning()
            }
        }

        @MainActor
        func configure(on view: ScannerPreviewView) {
            guard
                let device = AVCaptureDevice.default(for: .video),
                let input = try? AVCaptureDeviceInput(device: device),
                session.canAddInput(input)
            else {
                return
            }
            session.addInput(input)
            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else { return }
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]
            let layer = AVCaptureVideoPreviewLayer(session: session)
            layer.videoGravity = .resizeAspectFill
            layer.frame = view.bounds
            view.layer.addSublayer(layer)
            view.previewLayer = layer
            DispatchQueue.global(qos: .userInitiated).async { [session] in
                session.startRunning()
            }
        }

        func metadataOutput(
            _ output: AVCaptureMetadataOutput,
            didOutput metadataObjects: [AVMetadataObject],
            from connection: AVCaptureConnection
        ) {
            guard
                let object = metadataObjects.compactMap({ $0 as? AVMetadataMachineReadableCodeObject }).first,
                let value = object.stringValue
            else {
                return
            }
            if value == lastValue, Date().timeIntervalSince(lastScannedAt) < 1.5 {
                return
            }
            lastValue = value
            lastScannedAt = Date()
            if onCode(value) {
                session.stopRunning()
            }
        }
    }
}
