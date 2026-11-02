---
title: Fix camera access problems
summary: The camera is blocked, in use, missing or not delivering what the event needs, with steps for Chrome, Edge, Safari, Firefox, iPad and Android.
category: troubleshooting
order: 10
keywords:
  [
    camera,
    permission,
    blocked,
    denied,
    allow,
    not found,
    in use,
    webcam,
    chrome,
    safari,
    firefox,
    edge,
    android,
    ios,
    https,
    overconstrained,
    usb,
    zoom,
  ]
updated: 2026-10-28
related: [booth-error-messages, setup-check, 360-booth-setup]
---

The booth's error card names the problem. Find it below. After changing anything, press **Try again** on the card (or reload the page).

## Camera access was blocked {#permission}

The browser asks once whether this site may use the camera. If someone pressed **Block**, or the setting was off, the browser remembers.

**Chrome and Edge (computer)**

1. Click the icon at the left of the address bar (a lock or sliders icon).
2. Set **Camera** to **Allow**.
3. Reload the page.

Or open `chrome://settings/content/camera` (`edge://settings/content/camera` in Edge) and remove this site from **Not allowed to use your camera**. When the browser asks, choose **Allow on every visit** rather than allowing just this time, so the question doesn't come back.

**Safari on a Mac**: choose **Safari, Settings, Websites, Camera** and set this website to **Allow**.

**Safari on an iPad or iPhone**: tap **aA** in the address bar, then **Website Settings**, then **Camera**, and choose **Allow**. If you use the Home Screen app, delete it and add it again, or look under **Settings, Apps, Safari, Camera** (on older versions **Settings, Safari, Camera**).

**Firefox**: click the camera icon in the address bar and remove the block, or open `about:preferences#privacy`, find **Permissions, Camera, Settings** and remove the block.

**Chrome on Android**: tap the lock icon in the address bar, then **Permissions**, then **Camera**, and allow it. If it is greyed out, open the phone's **Settings, Apps, Chrome, Permissions, Camera** and allow it there.

**Windows and macOS system settings.** Even if the browser allows the camera, the operating system can still block it: in Windows open **Settings, Privacy & security, Camera** and make sure camera access and access for desktop apps are on; on a Mac open **System Settings, Privacy & Security, Camera** and switch on your browser.

## No camera was found {#not_found}

The browser can't see any camera.

- Plug the camera in, or reseat its cable. Try another USB port; avoid unpowered hubs.
- Capture cards and cameras that use a phone as a webcam must be running first.
- Open **Booth settings** and pick the camera from the list: the right one may not be the default. The list ends with **Simulated camera (no hardware)**, which is only for trying the booth with no camera.
- A device with no camera, or a browser that has none to offer, can't run a booth. Use a different device.

## Another app is using the camera {#in_use}

Only one app can use most cameras at a time. Close video-call apps (Zoom, Teams, Meet), other browser tabs that use the camera, and camera or photo apps. Then press **Try again**. If it still says so, unplug and replug the camera or restart the browser. On Windows, another desktop app may be holding it even when closed to the tray.

## The camera can't deliver what the event needs {#overconstrained}

The event asks for a resolution and frame rate (for example 4K at 60 fps) that this camera can't give. Choose another camera or lens in **Booth settings**, or lower the resolution or frame rate under **Setup**. The [setup check](help:setup-check) shows what your camera really delivers.

## The camera needs a secure connection {#insecure}

Browsers only allow camera access on pages opened with **https**, or on `localhost`. A booth opened from a plain `http://` address, or from an IP address, can't use the camera. Open it from the address the Studio gives you.

## The camera disconnected {#lost}

The camera stopped while the booth was running: a loose cable, a sleeping USB port, a phone that went to sleep. Reconnect it and press **Try again**. For a long event use a powered USB hub or a cable that locks, and turn off USB power saving in the system settings.

## It works but the picture looks wrong

- **Wrong lens**: phones and tablets list each lens as a separate camera (wide, ultra-wide, telephoto, front). Pick another in **Booth settings**.
- **Mirrored**: the **Mirror the preview** switch only changes the screen, never the recording.
- **Dark or choppy**: add light. Many cameras lower their frame rate in dim rooms.
