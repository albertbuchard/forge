import Foundation

nonisolated
func companionDebugLog(_ scope: String, _ message: @autoclosure () -> String) {
#if DEBUG
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let timestamp = formatter.string(from: Date())
    print("[ForgeCompanion][\(timestamp)][\(scope)] \(message())")
#endif
}
