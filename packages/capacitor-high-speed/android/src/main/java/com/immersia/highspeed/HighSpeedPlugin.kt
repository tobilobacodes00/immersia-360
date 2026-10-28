package com.immersia.highspeed

import android.Manifest
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.util.UUID

/**
 * The `HighSpeed` Capacitor plugin on Android (CAP-14): the JavaScript API in src/definitions.ts, backed by
 * HighSpeedCamera (CameraX high-speed video). Capacitor calls plugin methods on a worker thread; CameraX and
 * the views need the main one, so every method hops there.
 */
@CapacitorPlugin(
    name = "HighSpeed",
    permissions = [
        Permission(strings = [Manifest.permission.CAMERA], alias = "camera"),
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone"),
    ],
)
class HighSpeedPlugin : Plugin() {
    private var engine: HighSpeedCamera? = null

    private fun camera(): HighSpeedCamera {
        engine?.let { return it }
        val created = HighSpeedCamera(activity, bridge.webView) { name, data -> notifyListeners(name, data) }
        engine = created
        return created
    }

    private fun onMain(block: () -> Unit) {
        bridge.executeOnMainThread { block() }
    }

    private fun reject(call: PluginCall, error: HighSpeedException) {
        call.reject(error.message ?: error.code, error.code)
    }

    @PluginMethod
    fun capabilities(call: PluginCall) {
        onMain {
            camera().capabilities({ call.resolve(it) }, { reject(call, it) })
        }
    }

    // checkPermissions() and requestPermissions() come from Plugin: they answer for the aliases above.

    @PluginMethod
    fun startPreview(call: PluginCall) {
        val missing = mutableListOf<String>()
        if (getPermissionState("camera") != PermissionState.GRANTED) missing.add("camera")
        if (call.getBoolean("audio", false) == true && getPermissionState("microphone") != PermissionState.GRANTED) {
            missing.add("microphone")
        }
        if (missing.isEmpty()) {
            beginPreview(call)
        } else {
            requestPermissionForAliases(missing.toTypedArray(), call, "previewPermissionResult")
        }
    }

    @PermissionCallback
    private fun previewPermissionResult(call: PluginCall) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            call.reject("Permission to use the camera was refused.", HighSpeedException.PERMISSION_DENIED)
        } else if (call.getBoolean("audio", false) == true && getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Permission to use the microphone was refused.", HighSpeedException.PERMISSION_DENIED)
        } else {
            beginPreview(call)
        }
    }

    private fun beginPreview(call: PluginCall) {
        val fps = call.getInt("fps")
        val width = call.getInt("width")
        val height = call.getInt("height")
        if (fps == null || width == null || height == null) {
            call.reject("fps, width and height are required.", HighSpeedException.UNSUPPORTED)
            return
        }
        val request = PreviewRequest(
            lensId = call.getString("lens"),
            fps = fps,
            width = width,
            height = height,
            mirror = call.getBoolean("mirror", false) == true,
            audio = call.getBoolean("audio", false) == true,
        )
        onMain {
            camera().startPreview(request, { call.resolve(it) }, { reject(call, it) })
        }
    }

    @PluginMethod
    fun setMirrored(call: PluginCall) {
        val mirrored = call.getBoolean("mirrored", false) == true
        onMain {
            camera().setMirrored(mirrored)
            call.resolve()
        }
    }

    @PluginMethod
    fun stopPreview(call: PluginCall) {
        onMain {
            camera().stopPreview()
            call.resolve()
        }
    }

    @PluginMethod
    fun startMotionSampling(call: PluginCall) {
        val interval = (call.getInt("intervalMs", 100) ?: 100).toLong()
        onMain {
            camera().startMotion(interval, { reject(call, it) }, { call.resolve() })
        }
    }

    @PluginMethod
    fun stopMotionSampling(call: PluginCall) {
        onMain {
            camera().stopMotion()
            call.resolve()
        }
    }

    @PluginMethod
    fun startRecording(call: PluginCall) {
        // The booth names the file after its take; without a name the plugin makes one up.
        val requested = call.getString("id")
        val id = if (requested.isNullOrEmpty()) UUID.randomUUID().toString() else requested
        onMain {
            camera().startRecording(id, { call.resolve(JSObject().put("id", id)) }, { reject(call, it) })
        }
    }

    @PluginMethod
    fun stopRecording(call: PluginCall) {
        onMain {
            camera().stopRecording({ call.resolve(it) }, { reject(call, it) })
        }
    }

    @PluginMethod
    fun deleteRecording(call: PluginCall) {
        val id = call.getString("id")
        onMain {
            if (!id.isNullOrEmpty()) camera().deleteRecording(id)
            call.resolve()
        }
    }

    @PluginMethod
    fun listRecordings(call: PluginCall) {
        onMain {
            call.resolve(JSObject().put("recordings", camera().listRecordings()))
        }
    }

    override fun handleOnPause() {
        engine?.let { engineInstance -> onMain { engineInstance.onPause() } }
    }

    override fun handleOnResume() {
        engine?.let { engineInstance -> onMain { engineInstance.onResume() } }
    }

    override fun handleOnDestroy() {
        engine?.let { engineInstance -> onMain { engineInstance.destroy() } }
        engine = null
    }
}
