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
        for metadataObject in metadataObjects {
            guard
                let object = metadataObject as? AVMetadataMachineReadableCodeObject,
                let stringValue = object.stringValue
            else {
                continue
            }
            do {
                let payload = try PairingPayload.decodePairingText(stringValue)
                companionDebugLog(
                    "QRPairingScanner",
                    "metadataOutput decoded session=\(payload.sessionId) apiBaseUrl=\(payload.apiBaseUrl)"
                )
                onPayload?(payload)
                return
            } catch {
                companionDebugLog(
                    "QRPairingScanner",
                    "metadataOutput ignored invalid payload error=\(error.localizedDescription)"
                )
            }
        }
    }
}
