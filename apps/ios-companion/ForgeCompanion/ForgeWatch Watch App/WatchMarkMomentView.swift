import SwiftUI

struct WatchMarkMomentView: View {
    @EnvironmentObject private var appModel: WatchAppModel
    @State private var noteDraft = ""

    var body: some View {
        ZStack {
            WatchSurfaceBackground()

            VStack(spacing: 14) {
                Button {
                    appModel.queueCaptureEvent(eventType: "mark_moment")
                } label: {
                    VStack(spacing: 8) {
                        Image(systemName: "bookmark.circle.fill")
                            .font(.system(size: 34))
                        Text("Mark this moment")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 18)
                }
                .buttonStyle(.borderedProminent)
                .tint(WatchTheme.accent)

                WatchCard {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Optional note")
                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                            .foregroundStyle(WatchTheme.textPrimary)
                        TextField("Add 2-8 words", text: $noteDraft)
                        Button("Save note") {
                            let note = noteDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                            guard note.isEmpty == false else { return }
                            appModel.queueCaptureEvent(
                                eventType: "dictated_note",
                                payload: ["note": note, "source": "mark_moment"]
                            )
                            noteDraft = ""
                        }
                        .disabled(noteDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }

                Text(appModel.lastStatusMessage)
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(WatchTheme.textMuted)
            }
            .padding()
        }
        .navigationTitle("Mark Moment")
    }
}
