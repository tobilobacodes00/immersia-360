---
title: Booth messages and what to do about them
summary: Every warning and error the booth can show (camera, recording, saving, rendering, uploads, background) with the fix for each.
category: troubleshooting
order: 20
keywords:
  [
    error,
    warning,
    message,
    failed,
    undecodable,
    encoder,
    gpu,
    webgl,
    hardware acceleration,
    recording unsupported,
    storage,
    recovered,
    h.264,
    hevc,
    render failed,
  ]
updated: 2026-10-28
related: [camera-permissions, render-speed-and-queue, offline-mode-and-uploads, ios-storage-eviction]
---

## Camera messages

These appear on a card titled **The camera isn't available**. Press **Try again** after the fix.

- **Camera access was blocked / No camera was found / Another app is using the camera / This camera can't deliver the event's resolution or frame rate / The camera only works over a secure (https) connection.** Each has steps in [Fix camera access problems](help:camera-permissions).

### The camera disconnected {#lost}

A cable came loose or the device put the camera to sleep. Reconnect it and try again.

### This browser can't record video {#recording_unsupported}

**"Use Chrome, Edge or Safari."** The browser has no video recorder (some Linux and embedded browsers don't). Open the booth in a current Chrome, Edge or Safari.

### Something went wrong starting the camera {#unknown}

Close other apps that use the camera, reload the page and try again. If it keeps happening, restart the device.

## Saving messages

### This device had trouble saving the last take {#storage}

**"Everything up to the problem was kept. Check free storage."** The device couldn't keep writing. Free space (see [iOS storage](help:ios-storage-eviction)), and check the take in the **Render queue**: whatever was written is kept and can be rendered.

### Storage low {#lowStorage}

A pill in the top bar: less than 2 GB is free on the device. Delete takes you no longer need in the **Render queue** and free other space before the next guests.

### Recovered 1 take that was interrupted {#recovered}

The page closed or crashed during a recording. The take was kept up to the last moment saved, marked **Recovered** in the render queue, and will render like any other.

## Rendering messages

These appear next to a take marked **Failed** in the **Render queue**. Press **Try again** after the fix.

### This device can't read the video format {#undecodable}

The recording is in a format the browser can't decode. It happens mostly with imported clips: phone video in HEVC (iPhone's **High Efficiency** setting) on a browser without HEVC support. Re-film in **Most Compatible**, or import on a device whose browser reads HEVC. See [Slow motion and frame rates](help:slow-motion-tips). It is rare for takes recorded by the booth itself.

### This browser can't encode the video {#unsupported_encoder}

The browser has no H.264 video encoder, which the guest's MP4 needs. Use a current Chrome, Edge or Safari. On Linux, use Google Chrome rather than a build of Chromium without proprietary codecs.

### The encoder stopped responding {#encoder_stall}

The video encoder hung, often because the device is short of memory or hot. Close other tabs and apps, let the device cool, and try again. If it repeats, restart the browser.

### Graphics acceleration is unavailable {#gpu}

Videos are composed with WebGL 2, which needs the graphics hardware. Turn on **Use graphics acceleration when available** (in some versions called **Use hardware acceleration when available**) in the browser's settings; in Chrome it is under **Settings, System**, update the graphics driver, and avoid running the booth in a remote-desktop session or virtual machine that has no graphics.

### Cancelled {#cancelled}

You pressed **Cancel render**. The take stays; press **Try again** to render it later.

### Render failed {#failed}

An unexpected problem. Press **Try again**. If it fails again, close other tabs, restart the browser, and run the [setup check](help:setup-check) to find what the device can't do.

## Upload messages

**Offline**, **uploads waiting**, **needs attention** and **This device was removed** are explained in [Offline mode and the upload queue](help:offline-mode-and-uploads).

## Background messages

### Background replacement is not available on this device; guests get the plain background {#background}

The event replaces the background, but this device couldn't start the feature. It needs the person-finding model, which the device downloads the first time it is used while online, and a browser with working WebGL 2 graphics. Connect the device to the internet, reload the booth and run the [setup check](help:setup-check). If it still fails, use a newer browser or a more capable device, or turn the background off in **Branding**.
