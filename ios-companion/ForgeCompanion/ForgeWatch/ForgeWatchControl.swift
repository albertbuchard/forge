import AppIntents
import SwiftUI
import WidgetKit

struct ForgeWatchControl: ControlWidget {
    static let kind: String = "ForgeWatchControl"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenHabitsIntent()) {
                Label("Open Habits", systemImage: "circle.grid.2x2")
            }
        }
        .displayName("Open Habits")
        .description("Launch the Forge watch habits list.")
    }
}
