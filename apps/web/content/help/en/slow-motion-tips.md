---
title: Slow motion and frame rates
summary: Choose the slow-motion segment and speed, and get smooth results with 60 fps cameras or clips shot on an iPhone.
category: booth
order: 20
keywords:
  [
    slow motion,
    slowmo,
    240 fps,
    120 fps,
    60 fps,
    iphone,
    most compatible,
    hevc,
    h.264,
    import,
    interpolation,
    boomerang,
  ]
updated: 2026-10-28
related: [360-booth-setup, render-speed-and-queue, booth-error-messages]
---

## How it works

In the event's **Setup**, **Slow motion** slows down one part of the spin; the rest plays at normal speed.

- **Slow-motion segment** is given in seconds from the start of the spin, for example 2 to 6 seconds of an 8 second spin. It must end within the spin, otherwise the page tells you: _The slow-motion segment must end within the spin._
- **Slow-motion speed** can be 0.125×, 0.25×, 0.5× (the default), 0.75× or 1×.
- **Reverse** can play the segment back and forth (**Boomerang**) or add it reversed at the end (**Reverse**).

## Smooth results

Slow motion needs frames to show. To use only real frames, the camera must deliver the video's frame rate divided by the speed: a 30 fps video at 0.5× needs a 60 fps camera, and a 60 fps video at 0.25× needs 240 fps. Where the camera delivers fewer, the renderer creates the frames in between by following how things move from one real frame to the next (motion-compensated interpolation). That looks smooth for steady turning motion, though quick hand waves can smear slightly.

So:

- **Use a 60 fps camera or camera mode** and set **Frame rate** to 60 fps. Many webcams quietly deliver 30 fps; the [setup check](help:setup-check) measures what yours really does.
- **Light the platform well.** Cameras slow down in dim rooms to gather light, and a camera that drops to 24 fps cannot give smooth slow motion.
- **Keep the slow part short.** A 4 second segment at 0.25× becomes 16 seconds of video. Two to three seconds of slow motion is usually plenty.
- If a render looks smeared at a very low speed, raise the speed or lower the segment length.

## Clips shot on a phone (120 or 240 fps)

You can import video files into a 360 booth: **Booth settings**, **Import videos**, **Choose files**, or drag files onto the booth screen. Clips shot at 120 or 240 fps keep their real frames, so slow motion from them is as smooth as it gets. Each imported clip becomes a take, gets a guest QR code, and is rendered in the background.

### iPhone: choose "Most Compatible"

An iPhone records in the **High Efficiency** format by default, which stores video as HEVC. Some browsers cannot read HEVC, for example Chrome on a computer without a hardware HEVC decoder. Such a clip fails to render with **This device can't read the video format**.

Before you shoot:

1. Open **Settings**, then **Camera**, then **Formats**.
2. Choose **Most Compatible**. The phone then saves H.264 video, which every browser can read.
3. Open **Settings**, **Camera**, **Record Slo-mo** and pick the frame rate you want from the options your model offers.

If you already shot in High Efficiency, shoot it again in **Most Compatible**, or import the clip on a device whose browser can read HEVC, such as Safari on an iPad or a Mac.

> [!NOTE]
> A device that cannot read a clip does not lose it. The take stays in the render queue marked **Failed** with the reason, and you can import a compatible copy. See [Booth error messages](help:booth-error-messages).
