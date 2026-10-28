import AVFoundation
import Capacitor
import UIKit
import WebKit

/// The `HighSpeed` Capacitor plugin on iOS (CAP-14): the JavaScript API in src/definitions.ts, backed by
/// HighSpeedController. This is the only file the Capacitor CLI should register as a plugin class.
@objc(HighSpeedPlugin)
public class HighSpeedPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HighSpeedPlugin"
    public let jsName = "HighSpeed"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startPreview", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMirrored", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopPreview", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startMotionSampling", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopMotionSampling", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listRecordings", returnType: CAPPluginReturnPromise)
    ]

    private lazy var controller = HighSpeedController(
        webView: { [weak self] in self?.bridge?.webView },
        emit: { [weak self] name, data in self?.notifyListeners(name, data: data) }
    )

    // MARK: - Capabilities and permissions

    @objc func capabilities(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            call.resolve(self.controller.capabilities())
        }
    }

    @objc override public func checkPermissions(_ call: CAPPluginCall) {
        call.resolve([
            "camera": permissionState(for: .video),
            "microphone": permissionState(for: .audio)
        ])
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        let wanted = call.getArray("permissions", String.self) ?? ["camera", "microphone"]
        let group = DispatchGroup()
        if wanted.contains("camera") {
            group.enter()
            AVCaptureDevice.requestAccess(for: .video) { _ in group.leave() }
        }
        if wanted.contains("microphone") {
            group.enter()
            AVCaptureDevice.requestAccess(for: .audio) { _ in group.leave() }
        }
        group.notify(queue: .main) { [weak self] in
            self?.checkPermissions(call)
        }
    }

    private func permissionState(for type: AVMediaType) -> String {
        switch AVCaptureDevice.authorizationStatus(for: type) {
        case .authorized: return "granted"
        case .notDetermined: return "prompt"
        default: return "denied"
        }
    }

    // MARK: - Preview

    @objc func startPreview(_ call: CAPPluginCall) {
        guard let fps = call.getInt("fps"), let width = call.getInt("width"), let height = call.getInt("height") else {
            call.reject("fps, width and height are required.", "unsupported")
            return
        }
        let request = PreviewRequest(
            lensId: call.getString("lens"),
            fps: fps,
            width: width,
            height: height,
            codec: call.getString("codec"),
            mirror: call.getBool("mirror") ?? false,
            audio: call.getBool("audio") ?? false
        )
        controller.startPreview(request) { result in
            switch result {
            case .success(let details): call.resolve(details.dictionary)
            case .failure(let error): call.reject(error.message, error.code)
            }
        }
    }

    @objc func setMirrored(_ call: CAPPluginCall) {
        controller.setMirrored(call.getBool("mirrored") ?? false)
        call.resolve()
    }

    @objc func stopPreview(_ call: CAPPluginCall) {
        controller.stopPreview { call.resolve() }
    }

    // MARK: - Motion sampling

    @objc func startMotionSampling(_ call: CAPPluginCall) {
        let interval = call.getInt("intervalMs") ?? 100
        DispatchQueue.main.async {
            self.controller.startMotion(intervalMs: interval, interface: HighSpeedOrientation.currentInterface()) { result in
                switch result {
                case .success: call.resolve()
                case .failure(let error): call.reject(error.message, error.code)
                }
            }
        }
    }

    @objc func stopMotionSampling(_ call: CAPPluginCall) {
        controller.stopMotion { call.resolve() }
    }

    // MARK: - Recording

    @objc func startRecording(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty else {
            call.reject("A recording needs an id.", "unsupported")
            return
        }
        DispatchQueue.main.async {
            self.controller.startRecording(id: id, interface: HighSpeedOrientation.currentInterface()) { result in
                switch result {
                case .success: call.resolve(["id": id])
                case .failure(let error): call.reject(error.message, error.code)
                }
            }
        }
    }

    @objc func stopRecording(_ call: CAPPluginCall) {
        controller.stopRecording { result in
            switch result {
            case .success(let summary): call.resolve(summary.dictionary)
            case .failure(let error): call.reject(error.message, error.code)
            }
        }
    }

    @objc func deleteRecording(_ call: CAPPluginCall) {
        if let id = call.getString("id") {
            controller.deleteRecording(id: id)
        }
        call.resolve()
    }

    @objc func listRecordings(_ call: CAPPluginCall) {
        controller.listRecordings { recordings in
            call.resolve(["recordings": recordings])
        }
    }
}
