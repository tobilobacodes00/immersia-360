---
title: Render speed and the render queue
summary: How the booth makes videos in the background, what the queue shows, how fast it should be, and what to change when it is slow.
category: booth
order: 40
keywords: [render, queue, slow, speed, encoder, background, waiting, rendering, failed, retry, ipad, laptop, performance]
updated: 2026-10-20
related: [setup-check, 360-booth-setup, booth-error-messages, offline-mode-and-uploads]
---

## What happens after a spin

The booth saves the raw take on the device first, then renders the guest's video from it (slow motion, overlay, intro and outro, music, look and effects) on the same device. Rendering runs in the background, one take at a time, so the next guest can already be spinning.

To keep the camera smooth, rendering pauses while a guest is being captured, from the moment the camera starts until the "Saved" screen has gone, and resumes a couple of seconds after the booth is ready again. In a busy hour the queue can therefore grow and then shrink during quieter moments.

## The render queue

The pill in the booth's top bar shows the state: **Nothing waiting**, **3 takes waiting**, or **Rendering 40%**. Press it to open the **Render queue**. Each take shows when it was made, its length and size, and a status:

| Status              | Meaning                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| **Ready to render** | Saved and waiting its turn.                                             |
| **Rendering**       | Being made now. The **Cancel render** button stops it.                  |
| **Rendered**        | Done. **Play** shows the finished video.                                |
| **Failed**          | Something stopped the render. The reason is shown; **Try again** re-queues it. |
| **Recovered**       | The page was closed or crashed during the recording. What was saved up to then is kept. |
| **Imported**        | A video file you added from disk.                                       |

A take is never deleted by itself. **Delete** removes it and anything rendered from it from this device; files already uploaded are not affected. If the booth tab is closed in the middle of a render, that take simply goes back in the queue when the booth opens again.

After the main video the booth also makes a poster picture and, if **Smaller version for messaging** is on, a lighter copy for WhatsApp and similar apps, always behind any take that is waiting.

## How fast should it be?

The target: a 15 second, 1080p clip renders in **45 seconds or less on a laptop and 90 seconds or less on a 2021 iPad**. The [setup check](help:setup-check) measures your device against this with your event's real settings. A guest's video arrives in about a render, so on target a guest waits a minute or two.

## If it is slow

In order of effect:

1. **Lower the frame rate** to 30 fps in **Setup**. It halves the work.
2. **Lower the resolution** from 4K to 1080p, or 1080p to 720p.
3. **Choose Small or Balanced quality** rather than Original.
4. **Use fewer effects.** Each adds work to every frame. A look is cheap; several effects are not.
5. **Shorten the spin or the slow-motion part.** Slowed segments need extra in-between frames.
6. **Close other tabs and apps**, keep the device cool and on power. Phones and tablets slow down when hot or on battery saver.
7. **Use a faster device** for busy events, or split the load: run a second booth on another device.

> [!NOTE]
> A device with a good camera and a weak processor is common. Record on one device and render on another is not possible yet, but you can import clips (**Import videos**) on a faster device.

## If a render fails

The reason appears next to the take. Common ones are **This device can't read the video format**, **This browser can't encode the video** and **Graphics acceleration is unavailable**. Each has a fix in [Booth error messages](help:booth-error-messages).
