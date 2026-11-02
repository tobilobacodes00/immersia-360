import AVFoundation
import CoreVideo
import QuartzCore

/// Turns camera frames into the small luma grid the booth's motion trigger reads. The grid size is the
/// web sampler's (GRID_W x GRID_H in @immersia/capture/motion.ts), so the same detector runs on it.
final class HighSpeedMotionSampler: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    static let gridWidth = 64
    static let gridHeight = 36

    private let interval: TimeInterval
    private let swapAxes: Bool
    private let onFrame: (Data) -> Void
    private var lastSample: TimeInterval = 0

    /// - Parameters:
    ///   - interval: seconds between two grids; frames in between are dropped at once.
    ///   - swapAxes: the screen is held portrait while the sensor is landscape (or the reverse), so the
    ///     grid's horizontal axis is the buffer's vertical one. The trigger looks for sideways movement.
    ///   - onFrame: called on the sampler's queue with `gridWidth * gridHeight` luma bytes.
    init(interval: TimeInterval, swapAxes: Bool, onFrame: @escaping (Data) -> Void) {
        self.interval = interval
        self.swapAxes = swapAxes
        self.onFrame = onFrame
        super.init()
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        // The camera delivers 120-240 frames a second; only a handful are looked at.
        let now = CACurrentMediaTime()
        if now - lastSample < interval { return }
        lastSample = now
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        if let grid = HighSpeedMotionSampler.luma(from: pixelBuffer, swapAxes: swapAxes) {
            onFrame(grid)
        }
    }

    /// The luma plane of an 8-bit bi-planar 4:2:0 buffer, box-sampled down to the grid.
    static func luma(from pixelBuffer: CVPixelBuffer, swapAxes: Bool) -> Data? {
        let format = HighSpeedFormats.fourCC(CVPixelBufferGetPixelFormatType(pixelBuffer))
        guard format == "420v" || format == "420f" else { return nil }
        guard CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly) == kCVReturnSuccess else { return nil }
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 0) else { return nil }
        let width = CVPixelBufferGetWidthOfPlane(pixelBuffer, 0)
        let height = CVPixelBufferGetHeightOfPlane(pixelBuffer, 0)
        let stride = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 0)
        if width < 2 || height < 2 { return nil }
        let luma = base.assumingMemoryBound(to: UInt8.self)

        let columns = gridWidth
        let rows = gridHeight
        // 3x3 samples inside each cell: steady against sensor noise, cheap enough to run ten times a second.
        let taps = 3
        var out = [UInt8](repeating: 0, count: columns * rows)
        for row in 0..<rows {
            for column in 0..<columns {
                var sum = 0
                for tapY in 0..<taps {
                    for tapX in 0..<taps {
                        let u = (Double(column) + (Double(tapX) + 0.5) / Double(taps)) / Double(columns)
                        let v = (Double(row) + (Double(tapY) + 0.5) / Double(taps)) / Double(rows)
                        let sourceX = swapAxes ? v * Double(width) : u * Double(width)
                        let sourceY = swapAxes ? u * Double(height) : v * Double(height)
                        let x = min(width - 1, Int(sourceX))
                        let y = min(height - 1, Int(sourceY))
                        sum += Int(luma[y * stride + x])
                    }
                }
                out[row * columns + column] = UInt8(sum / (taps * taps))
            }
        }
        return Data(out)
    }
}
