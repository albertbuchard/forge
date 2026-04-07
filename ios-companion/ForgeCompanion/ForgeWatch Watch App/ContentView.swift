import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var appModel: WatchAppModel

    var body: some View {
        TabView(selection: $appModel.selectedSurface) {
            NavigationStack {
                WatchHabitsView()
            }
            .tag(WatchSurface.habits)

            NavigationStack {
                WatchCheckInView()
            }
            .tag(WatchSurface.checkIn)

            NavigationStack {
                WatchMarkMomentView()
            }
            .tag(WatchSurface.markMoment)

            NavigationStack {
                WatchPromptInboxView()
            }
            .tag(WatchSurface.promptInbox)
        }
        .tabViewStyle(.carousel)
        .onAppear {
            appModel.consumePendingLaunchDestination()
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(WatchAppModel(preview: true))
}
