package com.immersia.highspeed

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.view.Surface
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.Camera
import androidx.camera.core.CameraState
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.HighSpeedVideoSessionConfig
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.util.Consumer
import androidx.lifecycle.Observer
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import java.io.File
import kotlin.math.abs
import org.json.JSONObject

internal data class PreviewRequest(
    val lensId: String?,
    val fps: Int,
    val width: Int,
    val height: Int,
    val mirror: Boolean,
    val audio: Boolean,
)

internal class PreviewDetails(val lens: HighSpeedLens, val format: HighSpeedFormat, val audio: Boolean) {
    fun toJson(): JSObject = JSObject()
        .put("lens", lens.id)
        .put("label", lens.label)
        .put("facing", lens.facing)
        .put("kind", lens.kind)
        .put("width", format.width)
        .put("height", format.height)
        .put("fps", format.fps)
        .put("mime", HighSpeedCamera.MIME)
        // CameraX picks the encoder from the device's camcorder profile; the web layer reads it from the file.
        .put("codec", JSONObject.NULL)
        .put("audio", audio)
}

internal class RecordingSummary(
    val id: String,
    val file: File,
    val bytes: Long,
    val durationMs: Long,
    val details: PreviewDetails,
    val interrupted: Boolean,
) {
    fun toJson(): JSObject = JSObject()
        .put("id", id)
        .put("path", Uri.fromFile(file).toString())
        .put("mime", HighSpeedCamera.MIME)
        .put("bytes", bytes)
        .put("durationMs", durationMs)
        .put("width", details.format.width)
        .put("height", details.format.height)
        .put("fps", details.format.fps)
        .put("codec", JSONObject.NULL)
        .put("interrupted", interrupted)
}

/**
 * The native high-speed camera (CAP-14) on CameraX: a `HighSpeedVideoSessionConfig` of a `Preview` and a
 * `VideoCapture<Recorder>` bound to the activity, with the preview drawn in a `PreviewView` behind the
 * (transparent) WebView. Every method must be called on the main thread; every callback is called on it.
 */
internal class HighSpeedCamera(
    private val activity: AppCompatActivity,
    private val webView: WebView,
    private val emit: (String, JSObject) -> Unit,
) {
    companion object {
        const val MIME = "video/mp4"
        private const val START_TIMEOUT_MS = 8_000L
        private const val MINIMUM_FREE_BYTES = 500L * 1024 * 1024
        private const val PAPER = 0xFFF7F6F2.toInt()

        /** Finalize errors that still leave a finished, playable file. */
        private val USABLE_ERRORS = setOf(
            VideoRecordEvent.Finalize.ERROR_NONE,
            VideoRecordEvent.Finalize.ERROR_FILE_SIZE_LIMIT_REACHED,
            VideoRecordEvent.Finalize.ERROR_INSUFFICIENT_STORAGE,
            VideoRecordEvent.Finalize.ERROR_SOURCE_INACTIVE,
            VideoRecordEvent.Finalize.ERROR_DURATION_LIMIT_REACHED,
        )
    }

    private val mainExecutor = ContextCompat.getMainExecutor(activity)
    private val handler = Handler(Looper.getMainLooper())

    private var provider: ProcessCameraProvider? = null
    private var lenses: List<HighSpeedLens>? = null

    private var previewView: PreviewView? = null
    private var camera: Camera? = null
    private var recorder: Recorder? = null
    private var videoCapture: VideoCapture<Recorder>? = null
    private var details: PreviewDetails? = null
    private var mirrored = false
    private var stateObserver: Observer<CameraState>? = null
    private var pendingStart: ((HighSpeedException?) -> Unit)? = null
    private var thermalListener: PowerManager.OnThermalStatusChangedListener? = null
    private var motion: MotionSampler? = null

    private var recording: ActiveRecording? = null
    private var finishedByItself: RecordingSummary? = null

    private class ActiveRecording(
        val id: String,
        val file: File,
        /** What the preview was when it started: the preview may be torn down before the file is finished. */
        val info: PreviewDetails,
        var onStarted: (() -> Unit)?,
        var onStartError: ((HighSpeedException) -> Unit)?,
    ) {
        var handle: Recording? = null
        var started = false
        var stopRequested = false
        val waiters = mutableListOf<Pair<(JSObject) -> Unit, (HighSpeedException) -> Unit>>()
    }

    // region Provider and capabilities

    private fun withProvider(onReady: (ProcessCameraProvider) -> Unit, onError: (HighSpeedException) -> Unit) {
        provider?.let { return onReady(it) }
        val future = ProcessCameraProvider.getInstance(activity)
        future.addListener({
            try {
                val ready = future.get()
                provider = ready
                onReady(ready)
            } catch (e: Exception) {
                onError(HighSpeedException(HighSpeedException.SESSION_FAILED, "CameraX could not start: ${e.message}"))
            }
        }, mainExecutor)
    }

    private fun lensesOf(provider: ProcessCameraProvider): List<HighSpeedLens> {
        lenses?.let { return it }
        val found = try {
            HighSpeedLenses.discover(provider)
        } catch (e: Exception) {
            emptyList()
        }
        lenses = found
        return found
    }

    fun capabilities(onResult: (JSObject) -> Unit, onError: (HighSpeedException) -> Unit) {
        withProvider({ ready ->
            val found = lensesOf(ready)
            val list = JSArray()
            for (lens in found) list.put(lens.toJson())
            onResult(
                JSObject()
                    .put("available", found.isNotEmpty())
                    .put("platform", "android")
                    .put("mime", MIME)
                    // CameraX picks the encoder from the camcorder profile; there is nothing to ask for.
                    .put("codecs", JSArray())
                    .put("motionSampling", true)
                    .put("lenses", list),
            )
        }, onError)
    }

    // endregion

    // region Preview

    fun startPreview(
        request: PreviewRequest,
        onResult: (JSObject) -> Unit,
        onError: (HighSpeedException) -> Unit,
    ) {
        withProvider({ ready ->
            try {
                begin(ready, request, onResult, onError)
            } catch (e: HighSpeedException) {
                teardown()
                onError(e)
            } catch (e: IllegalArgumentException) {
                // CameraX refuses a session config the camera cannot run (a frame rate it does not have).
                teardown()
                onError(HighSpeedException(HighSpeedException.NO_HIGH_SPEED_FORMAT, e.message ?: "That high-speed format is not supported."))
            } catch (e: Exception) {
                teardown()
                onError(HighSpeedException(HighSpeedException.SESSION_FAILED, e.message ?: "The camera could not start."))
            }
        }, onError)
    }

    private fun begin(
        provider: ProcessCameraProvider,
        request: PreviewRequest,
        onResult: (JSObject) -> Unit,
        onError: (HighSpeedException) -> Unit,
    ) {
        teardown()
        if (!hasPermission(Manifest.permission.CAMERA)) {
            throw HighSpeedException(HighSpeedException.PERMISSION_DENIED, "Permission to use the camera was refused.")
        }
        if (request.audio && !hasPermission(Manifest.permission.RECORD_AUDIO)) {
            throw HighSpeedException(HighSpeedException.PERMISSION_DENIED, "Permission to use the microphone was refused.")
        }
        val all = lensesOf(provider)
        val lens = (if (request.lensId != null) all.firstOrNull { it.id == request.lensId } else HighSpeedLenses.default(all))
            ?: throw HighSpeedException(
                if (request.lensId != null) HighSpeedException.LENS_NOT_FOUND else HighSpeedException.NO_HIGH_SPEED_FORMAT,
                if (request.lensId != null) "That camera is not on this device." else "This device has no camera that records ${request.fps} fps.",
            )
        val wanted = request.width.toLong() * request.height
        val format = lens.formats
            .filter { it.fps == request.fps }
            .minByOrNull { abs(it.width.toLong() * it.height - wanted) }
            ?: throw HighSpeedException(HighSpeedException.NO_HIGH_SPEED_FORMAT, "${lens.label} cannot record ${request.fps} fps.")
        if (activity.filesDir.usableSpace < MINIMUM_FREE_BYTES) {
            throw HighSpeedException(HighSpeedException.STORAGE, "This device is almost out of storage.")
        }

        val newRecorder = Recorder.Builder().setQualitySelector(QualitySelector.from(format.quality)).build()
        val capture = VideoCapture.withOutput(newRecorder)
        if (request.audio && !audioWorks(newRecorder)) {
            throw HighSpeedException(
                HighSpeedException.UNSUPPORTED,
                "This phone's high-speed recorder cannot record sound. Turn the microphone off for the event.",
            )
        }

        val view = PreviewView(activity).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FILL_CENTER
            setBackgroundColor(Color.BLACK)
        }
        val parent = webView.parent as? ViewGroup
            ?: throw HighSpeedException(HighSpeedException.SESSION_FAILED, "The booth view has nowhere to draw the preview.")
        // Index 0: behind the WebView, which is made transparent below, so the web UI overlays the picture.
        parent.addView(view, 0, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        previewView = view
        mirrored = request.mirror
        applyMirror(lens.facing)

        val preview = Preview.Builder().build()
        preview.setSurfaceProvider(view.surfaceProvider)
        // Real-time high-speed (not slow motion): the file keeps the capture frame rate, so every frame has its true time.
        val config = HighSpeedVideoSessionConfig(capture, preview, format.range, false)
        val bound = provider.bindToLifecycle(activity, lens.selector, config)

        camera = bound
        recorder = newRecorder
        videoCapture = capture
        val info = PreviewDetails(lens, format, request.audio)
        details = info

        webView.setBackgroundColor(Color.TRANSPARENT)
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        watchCamera(bound)
        watchThermal()

        // Resolve once the picture is streaming, so the web UI never reveals a black layer.
        var settled = false
        var streamObserver: Observer<PreviewView.StreamState>? = null
        val settle: (HighSpeedException?) -> Unit = settle@{ error ->
            if (settled) return@settle
            settled = true
            pendingStart = null
            handler.removeCallbacksAndMessages(START_TOKEN)
            streamObserver?.let { view.previewStreamState.removeObserver(it) }
            if (error == null) {
                onResult(info.toJson())
            } else {
                teardown()
                onError(error)
            }
        }
        pendingStart = settle
        val observer = Observer<PreviewView.StreamState> { state ->
            if (state == PreviewView.StreamState.STREAMING) settle(null)
        }
        streamObserver = observer
        view.previewStreamState.observeForever(observer)
        handler.postAtTime(
            { settle(HighSpeedException(HighSpeedException.SESSION_FAILED, "The camera did not start.")) },
            START_TOKEN,
            android.os.SystemClock.uptimeMillis() + START_TIMEOUT_MS,
        )
    }

    private val START_TOKEN = Any()

    /** Whether the recorder can carry the microphone: asking for audio on a config that cannot throws. */
    @SuppressLint("MissingPermission")
    private fun audioWorks(recorder: Recorder): Boolean = try {
        val probe = File(recordingsDirectory(), ".probe.mp4")
        recorder.prepareRecording(activity, FileOutputOptions.Builder(probe).build()).withAudioEnabled()
        true
    } catch (e: Exception) {
        false
    }

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED

    /** Errors the camera reports while running; CameraX retries the recoverable ones by itself. */
    private fun watchCamera(bound: Camera) {
        val observer = Observer<CameraState> { state ->
            val error = state.error ?: return@Observer
            val critical = error.type == CameraState.ErrorType.CRITICAL
            val code = when (error.code) {
                CameraState.ERROR_CAMERA_IN_USE, CameraState.ERROR_MAX_CAMERAS_IN_USE -> HighSpeedException.BUSY
                else -> HighSpeedException.SESSION_FAILED
            }
            val message = "The camera reported error ${error.code}."
            if (critical) pendingStart?.invoke(HighSpeedException(code, message))
            emit("error", JSObject().put("code", code).put("message", message).put("fatal", critical))
        }
        stateObserver = observer
        bound.cameraInfo.cameraState.observeForever(observer)
    }

    private fun watchThermal() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
        val power = activity.getSystemService(PowerManager::class.java) ?: return
        val listener = PowerManager.OnThermalStatusChangedListener { status ->
            val hot = status >= PowerManager.THERMAL_STATUS_SEVERE
            emit(
                "interruption",
                JSObject().put("reason", "thermal").put("state", if (hot) "began" else "ended").put("recording", false),
            )
        }
        thermalListener = listener
        power.addThermalStatusListener(mainExecutor, listener)
    }

    fun setMirrored(value: Boolean) {
        mirrored = value
        applyMirror(details?.lens?.facing)
    }

    /**
     * The web UI shows a picture unmirrored unless the operator asked for the mirror. PreviewView mirrors a
     * front camera by itself, so for a front lens the flip is the other way round.
     */
    private fun applyMirror(facing: String?) {
        val flip = (facing == "front") != mirrored
        previewView?.scaleX = if (flip) -1f else 1f
    }

    fun stopPreview() {
        teardown()
    }

    private fun teardown() {
        motion?.stop()
        motion = null
        pendingStart = null
        handler.removeCallbacksAndMessages(START_TOKEN)
        recording?.let { it.handle?.stop() }
        stateObserver?.let { observer -> camera?.cameraInfo?.cameraState?.removeObserver(observer) }
        stateObserver = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            thermalListener?.let { activity.getSystemService(PowerManager::class.java)?.removeThermalStatusListener(it) }
        }
        thermalListener = null
        try {
            provider?.unbindAll()
        } catch (e: Exception) {
            // Already unbound: nothing left to release.
        }
        previewView?.let { view -> (view.parent as? ViewGroup)?.removeView(view) }
        previewView = null
        camera = null
        recorder = null
        videoCapture = null
        details = null
        webView.setBackgroundColor(PAPER)
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    // endregion

    // region Motion sampling

    fun startMotion(intervalMs: Long, onError: (HighSpeedException) -> Unit, onStarted: () -> Unit) {
        val view = previewView
        if (view == null || details == null) return onError(HighSpeedException(HighSpeedException.NOT_PREVIEWING, "The preview is not running."))
        motion?.stop()
        val sampler = MotionSampler(view, intervalMs) { luma ->
            emit(
                "motionFrame",
                JSObject()
                    .put("luma", android.util.Base64.encodeToString(luma, android.util.Base64.NO_WRAP))
                    .put("width", MotionSampler.GRID_WIDTH)
                    .put("height", MotionSampler.GRID_HEIGHT),
            )
        }
        motion = sampler
        sampler.start()
        onStarted()
    }

    fun stopMotion() {
        motion?.stop()
        motion = null
    }

    // endregion

    // region Recording

    private fun recordingsDirectory(): File = File(activity.filesDir, "immersia-hfr").apply { mkdirs() }

    @Suppress("DEPRECATION")
    private fun displayRotation(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            activity.display?.rotation ?: Surface.ROTATION_0
        } else {
            activity.windowManager.defaultDisplay.rotation
        }

    @SuppressLint("MissingPermission")
    fun startRecording(id: String, onStarted: () -> Unit, onError: (HighSpeedException) -> Unit) {
        val capture = videoCapture
        val currentRecorder = recorder
        val info = details
        if (capture == null || currentRecorder == null || info == null || camera == null) {
            return onError(HighSpeedException(HighSpeedException.NOT_PREVIEWING, "The preview is not running."))
        }
        if (recording != null) return onError(HighSpeedException(HighSpeedException.ALREADY_RECORDING, "A recording is already running."))
        if (activity.filesDir.usableSpace < MINIMUM_FREE_BYTES) {
            return onError(HighSpeedException(HighSpeedException.STORAGE, "This device is almost out of storage."))
        }
        val safeId = id.replace('/', '_')
        val file = File(recordingsDirectory(), "$safeId.mp4")
        file.delete()
        finishedByItself = null
        // The screen may have been turned since the preview started.
        capture.targetRotation = displayRotation()
        val active = ActiveRecording(safeId, file, info, onStarted, onError)
        recording = active
        try {
            var pending = currentRecorder.prepareRecording(activity, FileOutputOptions.Builder(file).build())
            if (info.audio) pending = pending.withAudioEnabled()
            active.handle = pending.start(mainExecutor, Consumer<VideoRecordEvent> { event -> onRecordEvent(active, event) })
        } catch (e: Exception) {
            recording = null
            file.delete()
            onError(HighSpeedException(HighSpeedException.RECORDING_FAILED, e.message ?: "The recording could not start."))
        }
    }

    fun stopRecording(onResult: (JSObject) -> Unit, onError: (HighSpeedException) -> Unit) {
        val active = recording
        if (active != null) {
            active.stopRequested = true
            active.waiters.add(Pair(onResult, onError))
            active.handle?.stop()
            return
        }
        // An interruption already ended it: hand over what it kept.
        val summary = finishedByItself
        if (summary != null) {
            finishedByItself = null
            return onResult(summary.toJson())
        }
        onError(HighSpeedException(HighSpeedException.NOT_RECORDING, "Nothing is being recorded."))
    }

    private fun onRecordEvent(active: ActiveRecording, event: VideoRecordEvent) {
        when (event) {
            is VideoRecordEvent.Start -> {
                active.started = true
                active.onStarted?.invoke()
                active.onStarted = null
                active.onStartError = null
            }
            is VideoRecordEvent.Finalize -> finishRecording(active, event)
            else -> Unit
        }
    }

    private fun finishRecording(active: ActiveRecording, event: VideoRecordEvent.Finalize) {
        if (recording === active) recording = null
        val usable = event.error in USABLE_ERRORS
        val file = active.file
        if (!active.started || !usable || !file.exists() || file.length() == 0L) {
            file.delete()
            val failure = HighSpeedException(
                HighSpeedException.RECORDING_FAILED,
                "The recording failed (CameraX error ${event.error}).",
            )
            val hadListeners = active.onStartError != null || active.waiters.isNotEmpty()
            active.onStartError?.invoke(failure)
            active.onStartError = null
            active.onStarted = null
            for ((_, reject) in active.waiters) reject(failure)
            if (!hadListeners) {
                emit("error", JSObject().put("code", failure.code).put("message", failure.message ?: "").put("fatal", false))
            }
            return
        }
        val summary = RecordingSummary(
            id = active.id,
            file = file,
            bytes = file.length(),
            durationMs = event.recordingStats.recordedDurationNanos / 1_000_000L,
            details = active.info,
            interrupted = !active.stopRequested,
        )
        if (active.stopRequested) {
            for ((resolve, _) in active.waiters) resolve(summary.toJson())
        } else {
            // It ended by itself (the activity went to the background, the disk filled): the web layer collects it.
            finishedByItself = summary
        }
    }

    fun deleteRecording(id: String) {
        val safeId = id.replace('/', '_')
        if (recording?.id == safeId) return
        File(recordingsDirectory(), "$safeId.mp4").delete()
        if (finishedByItself?.id == safeId) finishedByItself = null
    }

    fun listRecordings(): JSArray {
        val list = JSArray()
        val active = recording?.id
        val files = recordingsDirectory().listFiles { file -> file.extension == "mp4" && !file.name.startsWith(".") }
        for (file in files.orEmpty()) {
            if (file.nameWithoutExtension == active) continue
            list.put(
                JSObject()
                    .put("id", file.nameWithoutExtension)
                    .put("path", Uri.fromFile(file).toString())
                    .put("bytes", file.length())
                    .put("modifiedMs", file.lastModified()),
            )
        }
        return list
    }

    // endregion

    // region Lifecycle

    /** The activity left the foreground: CameraX stops the camera (and finishes a recording) by itself. */
    fun onPause() {
        if (details == null) return
        val audio = activity.getSystemService(AudioManager::class.java)
        val inCall = audio != null && (
            audio.mode == AudioManager.MODE_RINGTONE ||
                audio.mode == AudioManager.MODE_IN_CALL ||
                audio.mode == AudioManager.MODE_IN_COMMUNICATION
            )
        emit(
            "interruption",
            JSObject()
                .put("reason", if (inCall) "call" else "background")
                .put("state", "began")
                .put("recording", recording != null),
        )
    }

    /** CameraX starts the camera again when the lifecycle does. */
    fun onResume() {
        if (details == null) return
        emit("interruption", JSObject().put("reason", "background").put("state", "ended").put("recording", false))
    }

    fun destroy() {
        teardown()
    }

    // endregion
}
