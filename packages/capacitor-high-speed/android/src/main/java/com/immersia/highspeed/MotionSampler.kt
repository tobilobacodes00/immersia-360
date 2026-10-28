package com.immersia.highspeed

import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import androidx.camera.view.PreviewView

/**
 * Samples the preview into the small luma grid the booth's motion trigger reads (GRID_W x GRID_H in
 * @immersia/capture/motion.ts). A CameraX high-speed session carries only the preview and the recorder, so
 * there is no analysis stream to read; the picture the guest sees is read back instead, upright and cropped as
 * shown. Reading a bitmap is not free, so this only runs while the booth waits for a trigger and never faster
 * than every 100 ms.
 */
internal class MotionSampler(
    private val view: PreviewView,
    intervalMs: Long,
    private val onFrame: (ByteArray) -> Unit,
) {
    companion object {
        const val GRID_WIDTH = 64
        const val GRID_HEIGHT = 36
        private const val MINIMUM_INTERVAL_MS = 100L
    }

    private val interval = maxOf(MINIMUM_INTERVAL_MS, intervalMs)
    private val handler = Handler(Looper.getMainLooper())
    private var running = false

    private val tick = object : Runnable {
        override fun run() {
            if (!running) return
            sample()
            handler.postDelayed(this, interval)
        }
    }

    fun start() {
        if (running) return
        running = true
        handler.postDelayed(tick, interval)
    }

    fun stop() {
        running = false
        handler.removeCallbacks(tick)
    }

    private fun sample() {
        // Null until the preview streams; an empty bitmap when the copy failed.
        val full = view.bitmap ?: return
        if (full.width < 2 || full.height < 2) {
            full.recycle()
            return
        }
        val small = Bitmap.createScaledBitmap(full, GRID_WIDTH, GRID_HEIGHT, true)
        if (small !== full) full.recycle()
        val pixels = IntArray(GRID_WIDTH * GRID_HEIGHT)
        small.getPixels(pixels, 0, GRID_WIDTH, 0, 0, GRID_WIDTH, GRID_HEIGHT)
        small.recycle()
        val luma = ByteArray(pixels.size)
        for (i in pixels.indices) {
            val p = pixels[i]
            val r = (p shr 16) and 0xFF
            val g = (p shr 8) and 0xFF
            val b = p and 0xFF
            // The web sampler's weights (77, 150, 29 over 256), so both read the same brightness.
            luma[i] = ((r * 77 + g * 150 + b * 29) shr 8).toByte()
        }
        onFrame(luma)
    }
}
