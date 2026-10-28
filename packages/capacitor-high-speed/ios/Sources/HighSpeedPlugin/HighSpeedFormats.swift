import AVFoundation
import CoreMedia

/// A capture format that can record at high speed, with the picture size it delivers.
struct HighSpeedFormatOption {
    let format: AVCaptureDevice.Format
    let width: Int
    let height: Int
    let maxFps: Double
}

/// Lens discovery and format choice (CAP-14). Pure AVFoundation queries: no session is opened here.
enum HighSpeedFormats {
    /// Slower than this is not "high speed" for the booth (the web cameras already do 60).
    static let minimumFps = 120.0

    /// The fps values worth offering for a format that tops out at `maxFps`.
    private static let commonFps: [Double] = [120, 240]

    /// Every physical lens (the virtual dual/triple cameras fuse lenses and have their own formats).
    static func lensDevices() -> [AVCaptureDevice] {
        var types: [AVCaptureDevice.DeviceType] = [
            .builtInWideAngleCamera,
            .builtInUltraWideCamera,
            .builtInTelephotoCamera
        ]
        if #available(iOS 17.0, *) {
            types.append(.external)
        }
        return AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .unspecified).devices
    }

    static func device(withId id: String) -> AVCaptureDevice? {
        return lensDevices().first { $0.uniqueID == id }
    }

    /// The main back lens when the web layer did not name one.
    static func defaultDevice() -> AVCaptureDevice? {
        let devices = lensDevices().filter { !options(for: $0).isEmpty }
        let back = devices.filter { $0.position == .back }
        return back.first { $0.deviceType == .builtInWideAngleCamera } ?? back.first ?? devices.first
    }

    static func facing(of device: AVCaptureDevice) -> String {
        switch device.position {
        case .back: return "back"
        case .front: return "front"
        default: return "external"
        }
    }

    static func kind(of device: AVCaptureDevice) -> String {
        switch device.deviceType {
        case .builtInWideAngleCamera: return "wide"
        case .builtInUltraWideCamera: return "ultra-wide"
        case .builtInTelephotoCamera: return "telephoto"
        default: return "unknown"
        }
    }

    /// A four-character code ("420v") as text, so no CoreVideo constant has to be compared.
    static func fourCC(_ code: FourCharCode) -> String {
        let bytes: [UInt8] = [
            UInt8((code >> 24) & 255),
            UInt8((code >> 16) & 255),
            UInt8((code >> 8) & 255),
            UInt8(code & 255)
        ]
        return String(bytes: bytes, encoding: .ascii) ?? ""
    }

    /// 8-bit SDR formats only: the renderer and every encoder handle them, and 10-bit HDR formats can turn
    /// on Dolby Vision, which the web layer cannot decode.
    private static func isEightBit(_ format: AVCaptureDevice.Format) -> Bool {
        let subtype = CMFormatDescriptionGetMediaSubType(format.formatDescription)
        return ["420v", "420f"].contains(fourCC(subtype))
    }

    static func supports(_ ranges: [AVFrameRateRange], fps: Double) -> Bool {
        return ranges.contains { $0.minFrameRate <= fps && fps <= $0.maxFrameRate }
    }

    /// The device's formats that can run at 120 fps or more.
    static func options(for device: AVCaptureDevice) -> [HighSpeedFormatOption] {
        return device.formats.compactMap { format in
            guard isEightBit(format) else { return nil }
            let maxFps = format.videoSupportedFrameRateRanges.map { $0.maxFrameRate }.max() ?? 0
            guard maxFps >= minimumFps else { return nil }
            let dimensions = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            return HighSpeedFormatOption(
                format: format,
                width: Int(dimensions.width),
                height: Int(dimensions.height),
                maxFps: maxFps
            )
        }
    }

    /// 120 and 240 where the format reaches them, plus its own top rate when that is something else.
    static func fpsValues(for option: HighSpeedFormatOption) -> [Int] {
        let ranges = option.format.videoSupportedFrameRateRanges
        var values = commonFps.filter { supports(ranges, fps: $0) }.map { Int($0) }
        let top = option.maxFps.rounded()
        if top >= minimumFps, supports(ranges, fps: top), !values.contains(Int(top)) {
            values.append(Int(top))
        }
        return values
    }

    /// The format to record `width`x`height` at `fps` with: the closest picture size among the formats that
    /// reach `fps`, then the wider field of view, then the higher top frame rate. Nil when none reaches it.
    static func choose(device: AVCaptureDevice, width: Int, height: Int, fps: Int) -> HighSpeedFormatOption? {
        let wanted = Double(width * height)
        let candidates = options(for: device).filter { supports($0.format.videoSupportedFrameRateRanges, fps: Double(fps)) }
        func rank(_ option: HighSpeedFormatOption) -> (Double, Double, Double) {
            return (
                abs(Double(option.width * option.height) - wanted),
                -Double(option.format.videoFieldOfView),
                -option.maxFps
            )
        }
        return candidates.min { rank($0) < rank($1) }
    }

    /// The lens as the web layer sees it; nil for lenses with no high-speed format.
    static func describe(_ device: AVCaptureDevice) -> [String: Any]? {
        var formats: [[String: Any]] = []
        var seen = Set<String>()
        for option in options(for: device) {
            for fps in fpsValues(for: option) {
                let key = "\(option.width)x\(option.height)@\(fps)"
                if seen.insert(key).inserted {
                    formats.append(["width": option.width, "height": option.height, "fps": fps])
                }
            }
        }
        if formats.isEmpty { return nil }
        return [
            "id": device.uniqueID,
            "label": device.localizedName,
            "facing": facing(of: device),
            "kind": kind(of: device),
            "formats": formats
        ]
    }
}
