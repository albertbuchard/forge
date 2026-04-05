import AVFoundation
import Foundation

final class QRPairingScanner: NSObject, AVCaptureMetadataOutputObjectsDelegate {
    var onPayload: ((PairingPayload) -> Void)?

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        companionDebugLog("QRPairingScanner", "metadataOutput count=\(metadataObjects.count)")
        guard
            let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
            let stringValue = object.stringValue,
            let data = stringValue.data(using: .utf8),
            let payload = try? JSONDecoder().decode(PairingPayload.self, from: data)
        else {
            companionDebugLog("QRPairingScanner", "metadataOutput ignored invalid payload")
            return
        }
        companionDebugLog(
            "QRPairingScanner",
            "metadataOutput decoded session=\(payload.sessionId) apiBaseUrl=\(payload.apiBaseUrl)"
        )
        onPayload?(payload)
    }
}
