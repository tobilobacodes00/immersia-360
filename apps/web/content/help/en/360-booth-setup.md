---
title: Set up a 360 booth
summary: The settings that shape a 360 video (resolution, frame rate, spin length, countdown, quality) and how to choose them.
category: booth
order: 10
keywords: [360, spin, platform, video, resolution, 4k, fps, aspect, vertical, countdown, quality, microphone, sound]
updated: 2026-10-20
related: [slow-motion-tips, capture-triggers-and-shortcuts, render-speed-and-queue, setup-check]
---

A 360 booth records one continuous take while the platform turns, then renders the finished video on the device. Open the event, go to **Setup** and find the **360 video** section.

## The video

| Setting          | Choices                              | Notes                                                                 |
| ---------------- | ------------------------------------ | --------------------------------------------------------------------- |
| **Resolution**   | 720p, 1080p, 4K                      | 1080p by default. 4K only where the camera supports it.               |
| **Frame rate**   | 30 fps, 60 fps                       | 60 fps by default. 60 fps gives smoother slow motion.                 |
| **Aspect ratio** | 9:16, 1:1, 16:9                      | 9:16 is a vertical video made for phones.                             |
| **Spin length**  | 3 to 20 seconds, in half seconds     | 8 seconds by default. Recording stops on its own after this.          |
| **Countdown**    | 0 to 10 seconds                      | 3 seconds by default.                                                 |
| **Quality**      | Small, Balanced, Original            | Balanced is about 8 to 12 MB for a 15 s clip at 1080p.                |
| **Record sound** | On or off                            | Off by default: the soundtrack comes from the event's music.          |

At 1080p a 9:16 video is 1080 × 1920 pixels; at 4K it is 2160 × 3840. The recording that comes off the camera is saved on the device at a high bitrate and the guest's video is made from it, so a lower output quality does not lower the original you keep until you delete it.

> [!TIP]
> Higher is not always better. 4K at 60 fps asks a lot of the camera and of the device that renders. Run the [setup check](help:setup-check) with the settings you intend to use. If the render takes too long, 1080p at 30 fps is the sensible fallback.

## Slow motion and reverse

Slow motion slows one part of the spin and plays the rest at normal speed. **Reverse** can play that part back and forth (**Boomerang**) or add the clip again, reversed, at the end (**Reverse**). See [Slow motion and frame rates](help:slow-motion-tips).

## Starting a spin

**Starting a capture** in the same Setup page decides what starts a recording:

- **Tap the screen**: the guest taps the start button.
- **Keyboard and Bluetooth remotes**: Space, Enter or a remote's page buttons. See [Starting with a keyboard or remote](help:capture-triggers-and-shortcuts).
- **Motion**: recording starts when the platform starts turning. The **Motion needed** setting decides how much of the picture must move sideways; a lower value starts sooner.

A guest can also be handed a clip that is already shot: in **Booth settings** press **Choose files** under **Import videos**, or drag video files onto the booth screen. They are rendered like any other take.

## In the booth

Open **Booth settings** (the sliders button in the top corner) to choose the camera and lens, set zoom, the camera's light or an on-screen fill light, and mirror the preview. The mirror only affects the screen; recordings are never mirrored.

The booth asks the screen to stay awake while it is open. Keep the device on power, and stop it from sleeping in its own settings too. See [Kiosk lock](help:kiosk-locking).

## What the guest gets

Right after the spin the booth shows a QR code and a short code. The guest's page opens at once and fills in when the video is ready, usually within a minute or two. See [Sharing with guests](help:sharing-with-guests) and [Render speed and the queue](help:render-speed-and-queue).
