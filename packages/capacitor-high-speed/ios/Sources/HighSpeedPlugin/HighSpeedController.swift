import AVFoundation
import UIKit
import WebKit

/// An error the web layer can show: `code` is one of HighSpeedErrorCode in definitions.ts.
enum HighSpeedError: Error {
    case permissionDenied(String)
    case noHighSpeedFormat(String)
    case lensNotFound
    case notPreviewing
    case notRecording
    case alreadyRecording
    case storage(String)
    case recordingFailed(String)
    case sessionFailed(String)
    case unsupported(String)

    var code: String {
        switch self {
        case .permissionDenied: return "permission_denied"
        case .noHighSpeedFormat: return "no_high_speed_format"
        case .lensNotFound: return "lens_not_found"
        case .notPreviewing: return "not_previewing"
        case .notRecording: return "not_recording"
        case .alreadyRecording: return "already_recording"
        case .storage: return "storage"
        case .recordingFailed: return "recording_failed"
        case .sessionFailed: return "session_failed"
        case .unsupported: return "unsupported"
        }
    }

    var message: String {
        switch self {
        case .permissionDenied(let what): return "Permission to use the \(what) was refused."
        case .noHighSpeedFormat(let why): return why
        case .lensNotFound: return "That camera is not on this device."
        case .notPreviewing: return "The preview is not running."
        case .notRecording: return "Nothing is being recorded."
        case .alreadyRecording: return "A recording is already running."
        case .storage(let why): return why
        case .recordingFailed(let why): return why
        case .sessionFailed(let why): return why
        case .unsupported(let why): return why
        }
    }
}

struct PreviewRequest {
    let lensId: String?
    let fps: Int
    let width: Int
    let height: Int
    let codec: String?
    let mirror: Bool
    let audio: Bool
}

struct PreviewDetails {
    let lens: String
    let label: String
    let facing: String
    let kind: String
    let width: Int
    let height: Int
    let fps: Int
    let mime: String
    let codec: String?
    let audio: Bool

    var dictionary: [String: Any] {
        return [
            "lens": lens,
            "label": label,
            "facing": facing,
            "kind": kind,
            "width": width,
            "height": height,
            "fps": fps,
            "mime": mime,
            "codec": codec ?? NSNull(),
            "audio": audio
        ]
    }
}

struct RecordingSummary {
    let id: String
    let url: URL
    let bytes: Int64
    let durationMs: Int
    let width: Int
    let height: Int
    let fps: Int
    let codec: String?
    let mime: String
    let interrupted: Bool

    var dictionary: [String: Any] {
        return [
            "id": id,
            "path": url.absoluteString,
            "mime": mime,
            "bytes": bytes,
            "durationMs": durationMs,
            "width": width,
            "height": height,
            "fps": fps,
            "codec": codec ?? NSNull(),
            "interrupted": interrupted
        ]
    }
}

/// The native camera session: a high-frame-rate AVCaptureSession whose preview is drawn behind the
/// transparent WebView and whose recordings are movie files in the app's own storage (CAP-14).
///
/// AVFoundation work runs on `sessionQueue`; the preview view and the WebView are touched on the main
/// thread; results go back to the caller on the main thread.
final class HighSpeedController: NSObject, AVCaptureFileOutputRecordingDelegate {
    static let mime = "video/quicktime"
    /// Capacitor's iOS scheme handler answers `.mov` and `.mp4` URLs with a header-less response, which a
    /// cross-origin `fetch` (the booth page is served from the deployed origin) rejects, while any other
    /// extension gets the CORS headers. So a finished movie is renamed to this; its bytes are unchanged.
    static let finishedExtension = "hfr"
    private static let minimumFreeBytes: Int64 = 500 * 1024 * 1024
    private static let paper = UIColor(red: 247.0 / 255.0, green: 246.0 / 255.0, blue: 242.0 / 255.0, alpha: 1)

    private let webViewProvider: () -> WKWebView?
    private let emit: (String, [String: Any]) -> Void
    private let sessionQueue = DispatchQueue(label: "com.immersia.highspeed.session")
    private let samplerQueue = DispatchQueue(label: "com.immersia.highspeed.motion")

    // sessionQueue only.
    private var session: AVCaptureSession?
    private var movieOutput: AVCaptureMovieFileOutput?
    private var dataOutput: AVCaptureVideoDataOutput?
    private var details: PreviewDetails?
    private var recording: ActiveRecording?
    private var finishedByItself: RecordingSummary?
    private var observers: [NSObjectProtocol] = []

    // Main thread only.
    private var previewView: HighSpeedPreviewView?
    private var savedBackground: UIColor?
    private var savedScrollBackground: UIColor?

    private final class ActiveRecording {
        let id: String
        let url: URL
        /// What the preview was when it started: the session may be torn down before the file is finished.
        let info: PreviewDetails?
        var started = false
        var stopRequested = false
        var startCompletion: ((Result<Void, HighSpeedError>) -> Void)?
        var stopWaiters: [(Result<RecordingSummary, HighSpeedError>) -> Void] = []

        init(id: String, url: URL, info: PreviewDetails?, startCompletion: @escaping (Result<Void, HighSpeedError>) -> Void) {
            self.id = id
            self.url = url
            self.info = info
            self.startCompletion = startCompletion
        }
    }

    init(webView: @escaping () -> WKWebView?, emit: @escaping (String, [String: Any]) -> Void) {
        self.webViewProvider = webView
        self.emit = emit
        super.init()
    }

    // MARK: - Capabilities

    func capabilities() -> [String: Any] {
        let lenses = HighSpeedFormats.lensDevices().compactMap { HighSpeedFormats.describe($0) }
        var codecs = ["h264"]
        if AVAssetExportSession.allExportPresets().contains(AVAssetExportPresetHEVCHighestQuality) {
            codecs.append("hevc")
        }
        return [
            "available": !lenses.isEmpty,
            "platform": "ios",
            "mime": HighSpeedController.mime,
            "codecs": codecs,
            "motionSampling": true,
            "lenses": lenses
        ]
    }

    // MARK: - Preview

    func startPreview(_ request: PreviewRequest, completion: @escaping (Result<PreviewDetails, HighSpeedError>) -> Void) {
        sessionQueue.async { [weak self] in
            guard let self = self else { return }
            do {
                let (session, details) = try self.configureAndStart(request)
                DispatchQueue.main.async {
                    self.attachPreview(session, mirror: request.mirror)
                    completion(.success(details))
                }
            } catch let error as HighSpeedError {
                self.teardownLocked()
                DispatchQueue.main.async { completion(.failure(error)) }
            } catch {
                self.teardownLocked()
                DispatchQueue.main.async {
                    completion(.failure(.sessionFailed(error.localizedDescription)))
                }
            }
        }
    }

    func stopPreview(completion: @escaping () -> Void) {
        sessionQueue.async { [weak self] in
            self?.teardownLocked()
            DispatchQueue.main.async { completion() }
        }
    }

    func setMirrored(_ mirrored: Bool) {
        DispatchQueue.main.async { [weak self] in
            self?.previewView?.setMirrored(mirrored)
        }
    }

    /// Open the lens at a format that reaches the wanted rate and start the session. sessionQueue.
    private func configureAndStart(_ request: PreviewRequest) throws -> (AVCaptureSession, PreviewDetails) {
        teardownLocked()

        guard ensureAccess(.video) else { throw HighSpeedError.permissionDenied("camera") }
        if request.audio && !ensureAccess(.audio) { throw HighSpeedError.permissionDenied("microphone") }

        let device: AVCaptureDevice
        if let id = request.lensId {
            guard let found = HighSpeedFormats.device(withId: id) else { throw HighSpeedError.lensNotFound }
            device = found
        } else {
            guard let found = HighSpeedFormats.defaultDevice() else {
                throw HighSpeedError.noHighSpeedFormat("This device has no camera that records \(request.fps) fps.")
            }
            device = found
        }
        guard let option = HighSpeedFormats.choose(
            device: device, width: request.width, height: request.height, fps: request.fps
        ) else {
            throw HighSpeedError.noHighSpeedFormat("\(device.localizedName) cannot record \(request.fps) fps.")
        }
        if let free = HighSpeedController.freeBytes(), free < HighSpeedController.minimumFreeBytes {
            throw HighSpeedError.storage("This device is almost out of storage.")
        }

        let session = AVCaptureSession()
        let movie = AVCaptureMovieFileOutput()
        var includesAudio = false

        session.beginConfiguration()
        // The format is chosen below, per device; a preset would override it.
        session.sessionPreset = .inputPriority
        do {
            let input = try AVCaptureDeviceInput(device: device)
            guard session.canAddInput(input) else {
                session.commitConfiguration()
                throw HighSpeedError.sessionFailed("The camera cannot be added to the session.")
            }
            session.addInput(input)
            if request.audio {
                guard let microphone = AVCaptureDevice.default(for: .audio),
                      let audioInput = try? AVCaptureDeviceInput(device: microphone),
                      session.canAddInput(audioInput) else {
                    session.commitConfiguration()
                    throw HighSpeedError.sessionFailed("The microphone is not available.")
                }
                session.addInput(audioInput)
                includesAudio = true
            }
            guard session.canAddOutput(movie) else {
                session.commitConfiguration()
                throw HighSpeedError.sessionFailed("The recorder cannot be added to the session.")
            }
            session.addOutput(movie)
        } catch let error as HighSpeedError {
            throw error
        } catch {
            session.commitConfiguration()
            throw HighSpeedError.sessionFailed(error.localizedDescription)
        }
        session.commitConfiguration()

        // The codec: H.264 unless the web layer asked for HEVC and this device can encode it.
        var codec: String?
        if let connection = movie.connection(with: .video) {
            let wanted: AVVideoCodecType = request.codec == "hevc" ? .hevc : .h264
            if movie.availableVideoCodecTypes.contains(wanted) {
                movie.setOutputSettings([AVVideoCodecKey: wanted], for: connection)
            }
            let chosen = movie.outputSettings(for: connection)[AVVideoCodecKey] as? String
            if chosen == AVVideoCodecType.hevc.rawValue {
                codec = "hevc"
            } else if chosen == AVVideoCodecType.h264.rawValue {
                codec = "h264"
            }
        }

        // Lock the device, take the high-speed format and pin the frame rate (min = max = one frame
        // duration), so the camera neither drops to a slower rate in dim light nor varies it.
        do {
            try device.lockForConfiguration()
            device.activeFormat = option.format
            let frameDuration = CMTime(value: 1, timescale: CMTimeScale(request.fps))
            device.activeVideoMinFrameDuration = frameDuration
            device.activeVideoMaxFrameDuration = frameDuration
            if device.isLowLightBoostSupported {
                device.automaticallyEnablesLowLightBoostWhenAvailable = false
            }
            device.unlockForConfiguration()
        } catch {
            throw HighSpeedError.sessionFailed("The camera refused the high-speed format: \(error.localizedDescription)")
        }

        self.session = session
        self.movieOutput = movie
        observe(session)
        session.startRunning()
        guard session.isRunning else {
            throw HighSpeedError.sessionFailed("The camera session did not start.")
        }

        let result = PreviewDetails(
            lens: device.uniqueID,
            label: device.localizedName,
            facing: HighSpeedFormats.facing(of: device),
            kind: HighSpeedFormats.kind(of: device),
            width: option.width,
            height: option.height,
            fps: request.fps,
            mime: HighSpeedController.mime,
            codec: codec,
            audio: includesAudio
        )
        details = result
        return (session, result)
    }

    /// Camera and microphone access, asking once when it was never asked. sessionQueue.
    private func ensureAccess(_ type: AVMediaType) -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: type) {
        case .authorized:
            return true
        case .notDetermined:
            let wait = DispatchSemaphore(value: 0)
            var granted = false
            AVCaptureDevice.requestAccess(for: type) { allowed in
                granted = allowed
                wait.signal()
            }
            wait.wait()
            return granted
        default:
            return false
        }
    }

    /// Free storage the system would let the app use, or nil when it cannot be told.
    private static func freeBytes() -> Int64? {
        let values = try? URL(fileURLWithPath: NSHomeDirectory())
            .resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return values?.volumeAvailableCapacityForImportantUsage
    }

    /// Stop everything and forget it. sessionQueue.
    private func teardownLocked() {
        for token in observers { NotificationCenter.default.removeObserver(token) }
        observers = []
        if let movie = movieOutput, movie.isRecording { movie.stopRecording() }
        if let session = session {
            if session.isRunning { session.stopRunning() }
            session.beginConfiguration()
            for input in session.inputs { session.removeInput(input) }
            for output in session.outputs { session.removeOutput(output) }
            session.commitConfiguration()
        }
        session = nil
        movieOutput = nil
        dataOutput = nil
        details = nil
        DispatchQueue.main.async { [weak self] in self?.detachPreview() }
    }

    // MARK: - The preview behind the WebView (main thread)

    private func attachPreview(_ session: AVCaptureSession, mirror: Bool) {
        detachPreview()
        guard let webView = webViewProvider() else { return }
        let view = HighSpeedPreviewView(frame: webView.frame)
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        // The view controller's own view IS the web view, so the preview goes behind it, next to it.
        if let parent = webView.superview {
            parent.insertSubview(view, belowSubview: webView)
        } else {
            webView.window?.insertSubview(view, at: 0)
        }
        view.attach(session)
        view.setMirrored(mirror)
        savedBackground = webView.backgroundColor
        savedScrollBackground = webView.scrollView.backgroundColor
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        // A booth must not go to sleep in front of a guest.
        UIApplication.shared.isIdleTimerDisabled = true
        previewView = view
    }

    private func detachPreview() {
        guard let view = previewView else { return }
        view.detach()
        view.removeFromSuperview()
        previewView = nil
        if let webView = webViewProvider() {
            webView.isOpaque = true
            webView.backgroundColor = savedBackground ?? HighSpeedController.paper
            webView.scrollView.backgroundColor = savedScrollBackground ?? HighSpeedController.paper
        }
        UIApplication.shared.isIdleTimerDisabled = false
    }

    // MARK: - Motion sampling

    func startMotion(
        intervalMs: Int,
        interface: UIInterfaceOrientation,
        completion: @escaping (Result<Void, HighSpeedError>) -> Void
    ) {
        sessionQueue.async { [weak self] in
            guard let self = self else { return }
            guard let session = self.session, session.isRunning, let details = self.details else {
                DispatchQueue.main.async { completion(.failure(.notPreviewing)) }
                return
            }
            self.removeDataOutputLocked()
            let output = AVCaptureVideoDataOutput()
            output.alwaysDiscardsLateVideoFrames = true
            // The sensor is landscape: a portrait screen shows the buffer turned a quarter.
            let sensorIsLandscape = details.width >= details.height
            let swapAxes = HighSpeedOrientation.isPortrait(interface) == sensorIsLandscape
            let sampler = HighSpeedMotionSampler(
                interval: Double(max(50, intervalMs)) / 1000.0,
                swapAxes: swapAxes
            ) { [weak self] grid in
                let luma = grid.base64EncodedString()
                DispatchQueue.main.async {
                    self?.emit("motionFrame", [
                        "luma": luma,
                        "width": HighSpeedMotionSampler.gridWidth,
                        "height": HighSpeedMotionSampler.gridHeight
                    ])
                }
            }
            output.setSampleBufferDelegate(sampler, queue: self.samplerQueue)
            session.beginConfiguration()
            let added = session.canAddOutput(output)
            if added { session.addOutput(output) }
            session.commitConfiguration()
            if added {
                self.dataOutput = output
                DispatchQueue.main.async { completion(.success(())) }
            } else {
                DispatchQueue.main.async {
                    completion(.failure(.unsupported("This camera format cannot also be sampled for motion.")))
                }
            }
        }
    }

    func stopMotion(completion: @escaping () -> Void) {
        sessionQueue.async { [weak self] in
            self?.removeDataOutputLocked()
            DispatchQueue.main.async { completion() }
        }
    }

    private func removeDataOutputLocked() {
        guard let output = dataOutput else { return }
        output.setSampleBufferDelegate(nil, queue: nil)
        if let session = session {
            session.beginConfiguration()
            session.removeOutput(output)
            session.commitConfiguration()
        }
        dataOutput = nil
    }

    // MARK: - Recording

    static func recordingsDirectory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        var directory = base.appendingPathComponent("immersia-hfr", isDirectory: true)
        if !FileManager.default.fileExists(atPath: directory.path) {
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            // A booth's raw takes are not worth backing up to iCloud.
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? directory.setResourceValues(values)
        }
        return directory
    }

    func startRecording(
        id: String,
        interface: UIInterfaceOrientation,
        completion: @escaping (Result<Void, HighSpeedError>) -> Void
    ) {
        sessionQueue.async { [weak self] in
            guard let self = self else { return }
            func fail(_ error: HighSpeedError) {
                DispatchQueue.main.async { completion(.failure(error)) }
            }
            guard let session = self.session, session.isRunning, let movie = self.movieOutput else {
                return fail(.notPreviewing)
            }
            if self.recording != nil || movie.isRecording { return fail(.alreadyRecording) }
            if let free = HighSpeedController.freeBytes(), free < HighSpeedController.minimumFreeBytes {
                return fail(.storage("This device is almost out of storage."))
            }
            let safeId = id.replacingOccurrences(of: "/", with: "_")
            let url = HighSpeedController.recordingsDirectory().appendingPathComponent("\(safeId).mov")
            try? FileManager.default.removeItem(at: url)
            if let connection = movie.connection(with: .video) {
                HighSpeedOrientation.apply(to: connection, interface: interface)
            }
            self.finishedByItself = nil
            let active = ActiveRecording(id: safeId, url: url, info: self.details) { result in
                DispatchQueue.main.async { completion(result) }
            }
            self.recording = active
            movie.startRecording(to: url, recordingDelegate: self)
        }
    }

    func stopRecording(completion: @escaping (Result<RecordingSummary, HighSpeedError>) -> Void) {
        sessionQueue.async { [weak self] in
            guard let self = self else { return }
            func deliver(_ result: Result<RecordingSummary, HighSpeedError>) {
                DispatchQueue.main.async { completion(result) }
            }
            if let active = self.recording {
                active.stopRequested = true
                active.stopWaiters.append(deliver)
                if let movie = self.movieOutput, movie.isRecording { movie.stopRecording() }
                return
            }
            // An interruption already ended it: hand over what it kept.
            if let summary = self.finishedByItself {
                self.finishedByItself = nil
                return deliver(.success(summary))
            }
            deliver(.failure(.notRecording))
        }
    }

    func deleteRecording(id: String) {
        sessionQueue.async {
            let safeId = id.replacingOccurrences(of: "/", with: "_")
            let directory = HighSpeedController.recordingsDirectory()
            for ext in ["mov", HighSpeedController.finishedExtension] {
                try? FileManager.default.removeItem(at: directory.appendingPathComponent("\(safeId).\(ext)"))
            }
            if self.finishedByItself?.id == safeId { self.finishedByItself = nil }
        }
    }

    /// Movies still on disk: the finished ones, and a `.mov` that a crash cut short (it is not being written
    /// by this session, and its fragments may still play), which is given the finished name so the web layer
    /// can bring it home like the others.
    func listRecordings(completion: @escaping ([[String: Any]]) -> Void) {
        sessionQueue.async { [weak self] in
            let directory = HighSpeedController.recordingsDirectory()
            let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
            let activeURL = self?.recording?.url
            var files = (try? FileManager.default.contentsOfDirectory(
                at: directory, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles]
            )) ?? []
            files = files.map { file -> URL in
                guard file.pathExtension == "mov", file != activeURL else { return file }
                let finished = file.deletingPathExtension().appendingPathExtension(HighSpeedController.finishedExtension)
                try? FileManager.default.removeItem(at: finished)
                return (try? FileManager.default.moveItem(at: file, to: finished)) != nil ? finished : file
            }
            let list = files.compactMap { file -> [String: Any]? in
                guard file.pathExtension == HighSpeedController.finishedExtension else { return nil }
                let values = try? file.resourceValues(forKeys: Set(keys))
                return [
                    "id": file.deletingPathExtension().lastPathComponent,
                    "path": file.absoluteString,
                    "bytes": Int64(values?.fileSize ?? 0),
                    "modifiedMs": Int64((values?.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000)
                ]
            }
            DispatchQueue.main.async { completion(list) }
        }
    }

    // MARK: - AVCaptureFileOutputRecordingDelegate

    func fileOutput(
        _ output: AVCaptureFileOutput,
        didStartRecordingTo fileURL: URL,
        from connections: [AVCaptureConnection]
    ) {
        sessionQueue.async { [weak self] in
            guard let active = self?.recording, active.url == fileURL else { return }
            active.started = true
            active.startCompletion?(.success(()))
            active.startCompletion = nil
        }
    }

    func fileOutput(
        _ output: AVCaptureFileOutput,
        didFinishRecordingTo outputFileURL: URL,
        from connections: [AVCaptureConnection],
        error: Error?
    ) {
        let recordedSeconds = CMTimeGetSeconds(output.recordedDuration)
        sessionQueue.async { [weak self] in
            self?.finishRecording(url: outputFileURL, error: error, recordedSeconds: recordedSeconds)
        }
    }

    /// sessionQueue.
    private func finishRecording(url: URL, error: Error?, recordedSeconds: Double) {
        guard let active = recording, active.url == url else { return }
        recording = nil

        // An interruption or a full disk reports an error but can still leave a finished, playable movie.
        var usable = error == nil
        if let nsError = error as NSError?,
           let finished = nsError.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool, finished {
            usable = true
        }
        let reason = error?.localizedDescription ?? "The recording failed."

        guard active.started, usable, FileManager.default.fileExists(atPath: url.path) else {
            try? FileManager.default.removeItem(at: url)
            let failure = HighSpeedError.recordingFailed(reason)
            // Nobody is waiting for it (the camera ended it on its own): tell the web layer instead.
            let hadListeners = active.startCompletion != nil || !active.stopWaiters.isEmpty
            if let start = active.startCompletion {
                active.startCompletion = nil
                start(.failure(failure))
            }
            for waiter in active.stopWaiters { waiter(.failure(failure)) }
            if !hadListeners { emitError(failure, fatal: false) }
            return
        }

        // Movie duration, read while it still has its `.mov` name: AVFoundation needs a known extension.
        var seconds = recordedSeconds
        if !seconds.isFinite || seconds <= 0 {
            seconds = CMTimeGetSeconds(AVURLAsset(url: url).duration)
        }
        let finalURL = url.deletingPathExtension().appendingPathExtension(HighSpeedController.finishedExtension)
        try? FileManager.default.removeItem(at: finalURL)
        do {
            try FileManager.default.moveItem(at: url, to: finalURL)
        } catch {
            let failure = HighSpeedError.storage("The recording could not be finished: \(error.localizedDescription)")
            for waiter in active.stopWaiters { waiter(.failure(failure)) }
            return
        }
        let attributes = try? FileManager.default.attributesOfItem(atPath: finalURL.path)
        let bytes = (attributes?[.size] as? NSNumber)?.int64Value ?? 0
        let summary = RecordingSummary(
            id: active.id,
            url: finalURL,
            bytes: bytes,
            durationMs: seconds.isFinite ? Int((seconds * 1000).rounded()) : 0,
            width: active.info?.width ?? 0,
            height: active.info?.height ?? 0,
            fps: active.info?.fps ?? 0,
            codec: active.info?.codec,
            mime: HighSpeedController.mime,
            interrupted: !active.stopRequested
        )
        if active.stopRequested {
            for waiter in active.stopWaiters { waiter(.success(summary)) }
        } else {
            // It ended by itself; the web layer collects it with stopRecording().
            finishedByItself = summary
        }
    }

    // MARK: - Events

    private func emitError(_ error: HighSpeedError, fatal: Bool) {
        let data: [String: Any] = ["code": error.code, "message": error.message, "fatal": fatal]
        DispatchQueue.main.async { [weak self] in self?.emit("error", data) }
    }

    private func emitInterruption(reason: String, began: Bool, recording: Bool) {
        let data: [String: Any] = ["reason": reason, "state": began ? "began" : "ended", "recording": recording]
        DispatchQueue.main.async { [weak self] in self?.emit("interruption", data) }
    }

    private func observe(_ session: AVCaptureSession) {
        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: .AVCaptureSessionWasInterrupted, object: session, queue: nil
        ) { [weak self] note in
            let raw = note.userInfo?[AVCaptureSessionInterruptionReasonKey] as? Int
            self?.sessionQueue.async { self?.interrupted(reasonCode: raw) }
        })
        observers.append(center.addObserver(
            forName: .AVCaptureSessionInterruptionEnded, object: session, queue: nil
        ) { [weak self] _ in
            self?.sessionQueue.async { self?.emitInterruption(reason: "other", began: false, recording: false) }
        })
        observers.append(center.addObserver(
            forName: .AVCaptureSessionRuntimeError, object: session, queue: nil
        ) { [weak self] note in
            let error = note.userInfo?[AVCaptureSessionErrorKey] as? NSError
            self?.sessionQueue.async { self?.runtimeError(error) }
        })
        observers.append(center.addObserver(
            forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: nil
        ) { [weak self] _ in
            let state = ProcessInfo.processInfo.thermalState
            self?.sessionQueue.async {
                self?.emitInterruption(
                    reason: "thermal",
                    began: state == .serious || state == .critical,
                    recording: false
                )
            }
        })
    }

    /// sessionQueue.
    private func interrupted(reasonCode: Int?) {
        var reason = "other"
        if let raw = reasonCode, let known = AVCaptureSession.InterruptionReason(rawValue: raw) {
            switch known {
            case .videoDeviceNotAvailableDueToSystemPressure:
                reason = "thermal"
            case .audioDeviceInUseByAnotherClient, .videoDeviceInUseByAnotherClient:
                reason = "call"
            case .videoDeviceNotAvailableInBackground:
                reason = "background"
            default:
                reason = "other"
            }
        }
        emitInterruption(reason: reason, began: true, recording: recording != nil)
    }

    /// sessionQueue.
    private func runtimeError(_ error: NSError?) {
        // The media services daemon restarted: the session can simply be started again.
        if let error = error, error.code == AVError.Code.mediaServicesWereReset.rawValue,
           let session = session, !session.isRunning {
            session.startRunning()
            if session.isRunning { return }
        }
        emitError(
            .sessionFailed(error?.localizedDescription ?? "The camera session stopped."),
            fatal: true
        )
    }
}
