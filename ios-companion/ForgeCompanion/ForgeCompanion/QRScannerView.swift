@preconcurrency import AVFoundation
import SwiftUI

struct QRScannerScreen: View {
    let close: () -> Void
    let onPayload: (PairingPayload) -> Void

    var body: some View {
        ZStack {
            QRScannerCameraView(onPayload: onPayload)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                HStack {
                    Spacer()

                    Button(action: close) {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 34, height: 34)
                            .background(Color.black.opacity(0.32), in: Circle())
                            .overlay(Circle().stroke(Color.white.opacity(0.12), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 16)
                .padding(.top, 16)

                Spacer()

                Text("Scan the Forge QR code.")
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(Color.black.opacity(0.28), in: Capsule())
                    .padding(.bottom, 28)
            }
        }
    }
}

struct QRScannerCameraView: UIViewRepresentable {
    let onPayload: (PairingPayload) -> Void

    func makeUIView(context: Context) -> ScannerPreviewView {
        let view = ScannerPreviewView()
        context.coordinator.onPayload = onPayload
        context.coordinator.configure(on: view)
        return view
    }

    func updateUIView(_ uiView: ScannerPreviewView, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
        private let session = AVCaptureSession()
        private var configured = false
        private var previewLayer: AVCaptureVideoPreviewLayer?
        var onPayload: ((PairingPayload) -> Void)?

        @MainActor
        func configure(on view: ScannerPreviewView) {
            guard !configured else {
                previewLayer?.frame = view.bounds
                return
            }
            guard let device = AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: device),
                  session.canAddInput(input)
            else {
                return
            }

            session.addInput(input)

            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else {
                return
            }
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]

            let previewLayer = AVCaptureVideoPreviewLayer(session: session)
            previewLayer.videoGravity = .resizeAspectFill
            previewLayer.frame = view.bounds
            view.layer.addSublayer(previewLayer)
            view.previewLayer = previewLayer
            self.previewLayer = previewLayer
            configured = true

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
                let code = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
                let stringValue = code.stringValue,
                let data = stringValue.data(using: .utf8),
                let payload = try? JSONDecoder().decode(PairingPayload.self, from: data)
            else {
                return
            }

            session.stopRunning()
            onPayload?(payload)
        }
    }
}

final class ScannerPreviewView: UIView {
    var previewLayer: AVCaptureVideoPreviewLayer?

    override func layoutSubviews() {
        super.layoutSubviews()
        previewLayer?.frame = bounds
    }
}
