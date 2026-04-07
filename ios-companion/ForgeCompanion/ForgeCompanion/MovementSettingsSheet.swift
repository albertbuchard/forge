import SwiftUI

struct MovementSettingsSheet: View {
    @ObservedObject var movementStore: MovementSyncStore
    let close: () -> Void

    @State private var newPlaceLabel = ""
    @State private var newPlaceTags = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    heroCard
                    statusCard
                    controlsCard
                    knownPlacesCard
                }
                .padding(18)
            }
            .background(CompanionStyle.background.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done", action: close)
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundStyle(CompanionStyle.textPrimary)
                }
            }
        }
    }

    private var heroCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Movement capture")
                .font(.system(size: 26, weight: .bold, design: .rounded))
                .foregroundStyle(CompanionStyle.textPrimary)

            Text("Let Forge quietly detect stays, trips, and stops so movement becomes self-observation rather than forgotten background noise.")
                .font(.system(size: 14, weight: .medium, design: .rounded))
                .foregroundStyle(CompanionStyle.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 8) {
                badge(movementStore.trackingEnabled ? "Tracking on" : "Tracking off")
                badge(movementStore.publishMode.replacingOccurrences(of: "_", with: " "))
                badge(movementStore.retentionMode.replacingOccurrences(of: "_", with: " "))
            }
        }
        .padding(18)
        .background(CompanionStyle.sheetBackground(cornerRadius: 28))
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Readiness")
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(CompanionStyle.textPrimary)

            statusRow("Location", movementStore.locationPermissionStatus)
            statusRow("Motion", movementStore.motionPermissionStatus)
            statusRow(
                "Background",
                movementStore.backgroundTrackingReady ? "ready" : "not ready"
            )
            statusRow("Capture", movementStore.captureSummary)
            statusRow("Latest", movementStore.latestLocationSummary)
        }
        .padding(18)
        .background(CompanionStyle.sheetBackground(cornerRadius: 28))
    }

    private var controlsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Guided controls")
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(CompanionStyle.textPrimary)

            Text("At rest the companion keeps a slow cadence and only promotes a place when the last 10 samples stay within 100 meters. Once you move, it shifts into trip capture.")
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(CompanionStyle.textMuted)
                .fixedSize(horizontal: false, vertical: true)

            Toggle(isOn: Binding(
                get: { movementStore.trackingEnabled },
                set: { movementStore.setTrackingEnabled($0) }
            )) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Passive location tracking")
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundStyle(CompanionStyle.textPrimary)
                    Text("Use background location to build stays, trips, and stops.")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(CompanionStyle.textMuted)
                }
            }
            .toggleStyle(.switch)

            Button("Request background location permission") {
                movementStore.requestLocationAuthorization()
            }
            .buttonStyle(CompanionFilledButtonStyle())

            HStack(spacing: 10) {
                publishModeButton("auto_publish", label: "Auto publish")
                publishModeButton("draft_review", label: "Draft first")
                publishModeButton("no_publish", label: "No notes")
            }
        }
        .padding(18)
        .background(CompanionStyle.sheetBackground(cornerRadius: 28))
    }

    private var knownPlacesCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Known places")
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(CompanionStyle.textPrimary)

            Text("Seed the landmarks that matter in your life so stays and trips can resolve to something meaningful.")
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(CompanionStyle.textMuted)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 10) {
                TextField("Current place label", text: $newPlaceLabel)
                    .textInputAutocapitalization(.words)
                    .font(.system(size: 15, weight: .medium, design: .rounded))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(Color.white.opacity(0.06))
                            .overlay(
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .stroke(Color.white.opacity(0.09), lineWidth: 1)
                            )
                    )

                TextField("Tags: home, grocery, nature", text: $newPlaceTags)
                    .font(.system(size: 15, weight: .medium, design: .rounded))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(Color.white.opacity(0.06))
                            .overlay(
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .stroke(Color.white.opacity(0.09), lineWidth: 1)
                            )
                    )

                Button("Add from current position") {
                    movementStore.addKnownPlace(
                        label: newPlaceLabel,
                        categoryTags: newPlaceTags
                            .split(separator: ",")
                            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                            .filter { $0.isEmpty == false }
                    )
                    newPlaceLabel = ""
                    newPlaceTags = ""
                }
                .buttonStyle(CompanionFilledButtonStyle())
                .disabled(newPlaceLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }

            ForEach(movementStore.knownPlaces.prefix(8)) { place in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(place.label)
                            .font(.system(size: 15, weight: .semibold, design: .rounded))
                            .foregroundStyle(CompanionStyle.textPrimary)
                        Spacer()
                        Text("\(Int(place.radiusMeters))m")
                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                            .foregroundStyle(CompanionStyle.textMuted)
                    }
                    Text("\(place.latitude.formatted(.number.precision(.fractionLength(4)))), \(place.longitude.formatted(.number.precision(.fractionLength(4))))")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(CompanionStyle.textMuted)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(place.categoryTags, id: \.self) { tag in
                                badge(tag)
                            }
                        }
                    }
                }
                .padding(14)
                .background(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .fill(Color.white.opacity(0.05))
                        .overlay(
                            RoundedRectangle(cornerRadius: 22, style: .continuous)
                                .stroke(Color.white.opacity(0.08), lineWidth: 1)
                        )
                )
            }
        }
        .padding(18)
        .background(CompanionStyle.sheetBackground(cornerRadius: 28))
    }

    private func statusRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(label)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(CompanionStyle.textMuted)
            Spacer(minLength: 8)
            Text(value)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(CompanionStyle.textSecondary)
                .multilineTextAlignment(.trailing)
        }
    }

    private func publishModeButton(_ mode: String, label: String) -> some View {
        Button(label) {
            movementStore.setPublishMode(mode)
        }
        .buttonStyle(
            CompanionGhostButtonStyle()
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(
                    movementStore.publishMode == mode
                        ? CompanionStyle.accentStrong.opacity(0.8)
                        : Color.white.opacity(0.08),
                    lineWidth: 1
                )
        )
    }

    private func badge(_ label: String) -> some View {
        Text(label)
            .font(.system(size: 11, weight: .semibold, design: .rounded))
            .foregroundStyle(CompanionStyle.textSecondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                Capsule(style: .continuous)
                    .fill(Color.white.opacity(0.06))
                    .overlay(
                        Capsule(style: .continuous)
                            .stroke(Color.white.opacity(0.08), lineWidth: 1)
                    )
            )
    }
}
