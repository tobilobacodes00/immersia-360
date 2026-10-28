---
title: Offline mode and the upload queue
summary: How the booth keeps working with no internet, what the upload pills mean, what to check before you leave the venue, and what needs a connection.
category: troubleshooting
order: 30
keywords:
  [
    offline,
    no internet,
    wifi,
    connection,
    upload,
    queue,
    waiting,
    sync,
    retry,
    backoff,
    hotspot,
    service worker,
    install,
    pwa,
    cache,
  ]
updated: 2026-10-28
related: [ios-storage-eviction, setup-check, booth-error-messages, devices-and-registration]
---

Venue Wi-Fi fails. The booth is built to carry on: **nothing recorded is lost, and guests still get a working QR code**.

## What keeps working with no connection

- **Capturing.** Every take is written to the device's storage chunk by chunk as it is recorded, before anything else happens to it. A crash, reload or flat battery costs at most the last second; the take comes back as **Recovered**.
- **Rendering.** Videos are made on the device. See [Render speed and the queue](help:render-speed-and-queue).
- **The guest's QR code and short code.** The link is made on the device. The device keeps a stock of short codes reserved for the event, topped up whenever it is online (when fewer than 25 are left it asks for 100 more), so codes are handed out offline. If a long stretch offline uses them all, the guest's page shows the code once the capture reaches the server.
- **Emails you ask the booth to send** wait in the queue and go out when the connection returns.
- **Overlays, intro and outro, music, fonts and pictures** for the event are saved on the device while it is online, and used from there.

## What needs a connection

- **Guests downloading.** A guest who scans while the booth is offline sees **Your files are on their way** and the page updates by itself when the upload lands.
- **Live Display and the Sharing Station** only get new captures once they are uploaded. A display keeps looping what it already has.
- **Changes in the Studio.** Settings changed there reach a booth when it next loads the page while online.
- **The first visit.** A device must open the booth once while online so it can store the app and the event's files. The [setup check](help:setup-check) is a good way to do that.

## The pills in the booth's top bar

| Pill                                                     | Meaning                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Offline**                                              | The device has no connection. Capturing carries on.                                              |
| **3 uploads waiting**                                    | Online, and the queue is working through captures.                                               |
| **Offline · 3 uploads waiting**                          | Captures waiting for a connection.                                                               |
| **1 upload needs attention**                             | The server refused a capture (for example the event no longer exists). The operator should look. |
| **This device was removed: register it again to upload** | The device was revoked. See [Register and manage booth devices](help:devices-and-registration).  |
| **Storage low**                                          | Under 2 GB free on the device. See [iOS storage and eviction](help:ios-storage-eviction).        |

## How uploading works

The queue handles one step at a time, oldest capture first: register the capture with the server, then upload each file straight to storage, and ask the server to check the file arrived whole. Every step can be repeated safely, so a connection that drops in the middle just resumes.

When a step fails because of the network or because the server is busy, the queue waits and tries again: 2 seconds, then 4, 8 and so on up to a longest wait of 5 minutes. The queue also wakes up when the connection comes back and whenever something new is ready.

The event's **Overview** tab shows **Files waiting to upload**, **Booths online** and the **Render queue** for all the devices running the event.

## Before you leave the venue

1. Check the booth's pill says nothing is waiting, and the event's **Overview** says **Everything is uploaded**.
2. If it doesn't, keep the device on and in range of Wi-Fi, or use your phone's hotspot. Leave the booth tab open: the queue works in the page.
3. Don't clear the browser's site data or uninstall the app until it has finished. Files not yet uploaded live only in that storage.

> [!WARNING]
> A device that is wiped or whose browser data is cleared takes with it any capture that has not uploaded yet. If the only copy of an event is on the device, finish the uploads first.

## Updates never interrupt an event

A new version of the app does not take over while the booth is open. It activates once every tab of the app has been closed, so a booth can't change in the middle of an event.
