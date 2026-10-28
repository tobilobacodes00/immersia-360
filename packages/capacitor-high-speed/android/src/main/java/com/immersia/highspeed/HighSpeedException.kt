package com.immersia.highspeed

/** An error the web layer can show: `code` is one of HighSpeedErrorCode in src/definitions.ts. */
internal class HighSpeedException(val code: String, message: String) : Exception(message) {
    companion object {
        const val PERMISSION_DENIED = "permission_denied"
        const val NO_HIGH_SPEED_FORMAT = "no_high_speed_format"
        const val LENS_NOT_FOUND = "lens_not_found"
        const val UNSUPPORTED = "unsupported"
        const val NOT_PREVIEWING = "not_previewing"
        const val NOT_RECORDING = "not_recording"
        const val ALREADY_RECORDING = "already_recording"
        const val STORAGE = "storage"
        const val RECORDING_FAILED = "recording_failed"
        const val SESSION_FAILED = "session_failed"
        const val BUSY = "busy"
    }
}
