import AVFoundation
import UIKit

/// The native camera preview. It sits behind the (transparent) WebView, so the booth's web UI overlays it.
final class HighSpeedPreviewView: UIView {
    override class var layerClass: AnyClass {
        return AVCaptureVideoPreviewLayer.self
    }

    var previewLayer: AVCaptureVideoPreviewLayer? {
        return layer as? AVCaptureVideoPreviewLayer
    }

    private var mirrored = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        isUserInteractionEnabled = false
        // Fill the screen like the web preview does (`object-fit: cover`).
        previewLayer?.videoGravity = .resizeAspectFill
    }

    required init?(coder: NSCoder) {
        return nil
    }

    func attach(_ session: AVCaptureSession) {
        previewLayer?.session = session
        applyMirror()
        applyOrientation()
    }

    func detach() {
        previewLayer?.session = nil
    }

    func setMirrored(_ value: Bool) {
        mirrored = value
        applyMirror()
    }

    /// The web UI mirrors nothing it did not ask for: a front camera is not mirrored unless the operator says so.
    private func applyMirror() {
        guard let connection = previewLayer?.connection, connection.isVideoMirroringSupported else { return }
        connection.automaticallyAdjustsVideoMirroring = false
        connection.isVideoMirrored = mirrored
    }

    private func applyOrientation() {
        guard let connection = previewLayer?.connection else { return }
        HighSpeedOrientation.apply(to: connection, interface: window?.windowScene?.interfaceOrientation)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        applyOrientation()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        applyOrientation()
    }
}

/// Keeps a capture connection upright for the way the screen is held.
enum HighSpeedOrientation {
    /// The interface orientation now, or portrait when no window knows it yet. Call it on the main thread.
    static func currentInterface() -> UIInterfaceOrientation {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first
        return scene?.interfaceOrientation ?? .portrait
    }

    static func apply(to connection: AVCaptureConnection, interface: UIInterfaceOrientation?) {
        guard let interface = interface, interface != .unknown else { return }
        if #available(iOS 17.0, *) {
            // The sensor's own orientation is landscape-right: that is 0 degrees.
            let angle: CGFloat
            switch interface {
            case .portrait: angle = 90
            case .portraitUpsideDown: angle = 270
            case .landscapeLeft: angle = 180
            default: angle = 0
            }
            if connection.isVideoRotationAngleSupported(angle) {
                connection.videoRotationAngle = angle
            }
        } else if connection.isVideoOrientationSupported {
            switch interface {
            case .portrait: connection.videoOrientation = .portrait
            case .portraitUpsideDown: connection.videoOrientation = .portraitUpsideDown
            case .landscapeLeft: connection.videoOrientation = .landscapeLeft
            default: connection.videoOrientation = .landscapeRight
            }
        }
    }

    static func isPortrait(_ interface: UIInterfaceOrientation) -> Bool {
        return interface == .portrait || interface == .portraitUpsideDown
    }
}
