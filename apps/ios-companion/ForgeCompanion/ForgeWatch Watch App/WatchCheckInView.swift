import SwiftUI

struct WatchCheckInView: View {
    @EnvironmentObject private var appModel: WatchAppModel
    @State private var noteDraft = ""

    var body: some View {
        ZStack {
            WatchSurfaceBackground()

            List {
                Section("Activity") {
                    ForEach(appModel.bootstrap.checkInOptions.activities.prefix(5), id: \.self) { option in
                        Button(option) {
                            appModel.queueCaptureEvent(
                                eventType: "activity_check_in",
                                payload: ["activity": option]
                            )
                        }
                    }
                }

                Section("Emotion") {
                    ForEach(appModel.bootstrap.checkInOptions.emotions.prefix(5), id: \.self) { option in
                        Button(option) {
                            appModel.queueCaptureEvent(
                                eventType: "emotion_check_in",
                                payload: ["emotion": option]
                            )
                        }
                    }
                }

                Section("Energy / Stress") {
                    HStack {
                        ForEach(1...5, id: \.self) { level in
                            Button("\(level)") {
                                appModel.queueCaptureEvent(
                                    eventType: "emotion_check_in",
                                    payload: ["stressLevel": "\(level)"]
                                )
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                }

                Section("Social") {
                    Button("Alone") {
                        appModel.queueCaptureEvent(
                            eventType: "social_context",
                            payload: ["context": "alone"]
                        )
                    }
                    Button("With people") {
                        appModel.queueCaptureEvent(
                            eventType: "social_context",
                            payload: ["context": "with_people"]
                        )
                    }
                    ForEach(appModel.bootstrap.checkInOptions.recentPeople, id: \.self) { person in
                        Button(person) {
                            appModel.queueCaptureEvent(
                                eventType: "social_context",
                                payload: ["personLabel": person]
                            )
                        }
                    }
                }

                Section("Intent") {
                    Button("Intentional") {
                        appModel.queueCaptureEvent(
                            eventType: "activity_check_in",
                            payload: ["intentMode": "intentional"]
                        )
                    }
                    Button("Reactive") {
                        appModel.queueCaptureEvent(
                            eventType: "activity_check_in",
                            payload: ["intentMode": "reactive"]
                        )
                    }
                }

                Section("Self-observation") {
                    TextField("One short note", text: $noteDraft)
                    Button("Save note") {
                        let note = noteDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard note.isEmpty == false else { return }
                        appModel.queueCaptureEvent(
                            eventType: "dictated_note",
                            payload: ["note": note]
                        )
                        noteDraft = ""
                    }
                    .disabled(noteDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.clear)
        }
        .navigationTitle("Check In")
    }
}
