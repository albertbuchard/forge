import SwiftUI
import DeviceActivity
import _DeviceActivity_SwiftUI

@available(iOS 16.0, *)
struct ScreenTimeCaptureHost: View {
    @ObservedObject var screenTimeStore: ScreenTimeStore

    private var rollingWeek: DateInterval {
        let end = Date()
        let start = Calendar.current.date(byAdding: .day, value: -20, to: Calendar.current.startOfDay(for: end))
            ?? end.addingTimeInterval(-20 * 24 * 60 * 60)
        return DateInterval(start: start, end: end)
    }

    var body: some View {
        Group {
            if screenTimeStore.enabled && screenTimeStore.authorizationStatus == "approved" {
                ZStack {
                    DeviceActivityReport(
                        .forgeHourlyScreenTime,
                        filter: DeviceActivityFilter(
                            segment: .hourly(during: rollingWeek),
                            users: .all,
                            devices: .all
                        )
                    )
                    DeviceActivityReport(
                        .forgeDailyScreenTime,
                        filter: DeviceActivityFilter(
                            segment: .daily(during: rollingWeek),
                            users: .all,
                            devices: .all
                        )
                    )
                }
                .id(screenTimeStore.captureRefreshToken)
                // Screen Time report rendering is finicky when the report has no
                // measurable layout. Keep a tiny fixed-size host alive so the
                // extension reliably materializes and writes the shared snapshot.
                .frame(width: 12, height: 12)
                .opacity(0.01)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
                .onAppear {
                    companionDebugLog("ScreenTimeCaptureHost", "DeviceActivity reports mounted")
                }
                .onReceive(NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)) { _ in
                    screenTimeStore.ingestSharedSnapshots()
                }
            } else {
                EmptyView()
            }
        }
    }
}
