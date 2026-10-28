package com.immersia.highspeed

import android.hardware.camera2.CameraCharacteristics
import android.util.Range
import android.util.Size
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.core.CameraFilter
import androidx.camera.core.CameraInfo
import androidx.camera.core.CameraSelector
import androidx.camera.core.DynamicRange
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.HighSpeedVideoSessionConfig
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.VideoCapture
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import kotlin.math.hypot

/** One way a lens records at high speed: a CameraX quality and a frame-rate range that CameraX accepts for it. */
internal data class HighSpeedFormat(
    val quality: Quality,
    val width: Int,
    val height: Int,
    val fps: Int,
    val range: Range<Int>,
)

internal data class HighSpeedLens(
    val id: String,
    val label: String,
    val facing: String,
    val kind: String,
    val formats: List<HighSpeedFormat>,
) {
    /** Picks this lens (and no other) when bound. */
    val selector: CameraSelector = CameraSelector.Builder()
        .addCameraFilter(CameraFilter { infos -> infos.filter { HighSpeedLenses.idOf(it) == id } })
        .build()

    fun toJson(): JSObject {
        val list = JSArray()
        for (format in formats) {
            list.put(JSObject().put("width", format.width).put("height", format.height).put("fps", format.fps))
        }
        return JSObject()
            .put("id", id)
            .put("label", label)
            .put("facing", facing)
            .put("kind", kind)
            .put("formats", list)
    }
}

/**
 * Lens discovery for CAP-14. CameraX 1.5+ reports high-speed qualities per camera
 * (`Recorder.getHighSpeedVideoCapabilities`) and the frame-rate ranges a high-speed session accepts
 * (`CameraInfo.getSupportedFrameRateRanges(HighSpeedVideoSessionConfig)`); CameraX drives the Camera2
 * constrained high-speed session underneath. A device with no such capability simply lists no lens.
 */
internal object HighSpeedLenses {
    /** The 16:9 qualities worth offering to a booth, largest first. Below 720p is not worth a booth's time. */
    private val QUALITY_SIZES = listOf(
        Quality.UHD to Size(3840, 2160),
        Quality.FHD to Size(1920, 1080),
        Quality.HD to Size(1280, 720),
    )

    /** Slower than this is not "high speed" for the booth (the web cameras already do 60). */
    const val MINIMUM_FPS = 120

    /** The Camera2 id of a CameraX camera: stable across launches, which CameraX's own handles are not. */
    @Suppress("UnsafeOptInUsageError")
    fun idOf(info: CameraInfo): String? = try {
        Camera2CameraInfo.from(info).cameraId
    } catch (e: Exception) {
        null
    }

    fun discover(provider: ProcessCameraProvider): List<HighSpeedLens> {
        val lenses = mutableListOf<HighSpeedLens>()
        for (info in provider.availableCameraInfos) {
            val id = idOf(info) ?: continue
            val capabilities = try {
                Recorder.getHighSpeedVideoCapabilities(info)
            } catch (e: Exception) {
                null
            } ?: continue
            val supported = capabilities.getSupportedQualities(DynamicRange.SDR)
            val formats = mutableListOf<HighSpeedFormat>()
            for ((quality, size) in QUALITY_SIZES) {
                if (!supported.contains(quality)) continue
                for (range in frameRates(info, quality)) {
                    formats.add(HighSpeedFormat(quality, size.width, size.height, range.upper, range))
                }
            }
            if (formats.isEmpty()) continue
            val facing = facingOf(info)
            val kind = if (facing == "back") kindOf(info) else "wide"
            lenses.add(HighSpeedLens(id, "${facing.replaceFirstChar { it.uppercase() }} camera $id", facing, kind, formats))
        }
        return lenses
    }

    /** The high-speed frame-rate ranges CameraX accepts for `quality`, one per top rate, fixed rates first. */
    private fun frameRates(info: CameraInfo, quality: Quality): List<Range<Int>> {
        val ranges: Set<Range<Int>> = try {
            val recorder = Recorder.Builder().setQualitySelector(QualitySelector.from(quality)).build()
            info.getSupportedFrameRateRanges(HighSpeedVideoSessionConfig(VideoCapture.withOutput(recorder)))
        } catch (e: Exception) {
            emptySet()
        }
        return ranges
            .filter { it.upper >= MINIMUM_FPS }
            .sortedBy { if (it.lower == it.upper) 0 else 1 }
            .distinctBy { it.upper }
            .sortedBy { it.upper }
    }

    private fun facingOf(info: CameraInfo): String = when (info.lensFacing) {
        CameraSelector.LENS_FACING_BACK -> "back"
        CameraSelector.LENS_FACING_FRONT -> "front"
        else -> "external"
    }

    /** Wide, ultra-wide or telephoto from the 35 mm-equivalent focal length. */
    @Suppress("UnsafeOptInUsageError")
    private fun kindOf(info: CameraInfo): String = try {
        val camera2 = Camera2CameraInfo.from(info)
        val focal = camera2.getCameraCharacteristic(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)
            ?.firstOrNull()
        val sensor = camera2.getCameraCharacteristic(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)
        if (focal == null || sensor == null) {
            "unknown"
        } else {
            val equivalent = focal * 43.27 / hypot(sensor.width.toDouble(), sensor.height.toDouble())
            when {
                equivalent < 20.0 -> "ultra-wide"
                equivalent > 50.0 -> "telephoto"
                else -> "wide"
            }
        }
    } catch (e: Exception) {
        "unknown"
    }

    /** The lens the web layer did not name: the main back lens, then any back lens, then any. */
    fun default(lenses: List<HighSpeedLens>): HighSpeedLens? {
        val back = lenses.filter { it.facing == "back" }
        return back.firstOrNull { it.kind == "wide" } ?: back.firstOrNull() ?: lenses.firstOrNull()
    }
}
