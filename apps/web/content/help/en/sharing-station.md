---
title: The Sharing Station
summary: A second device where guests find their capture by code, tap it and scan its QR code, without touching the booth.
category: sharing
order: 20
keywords: [sharing station, station, second screen, tablet, find by code, scan, queue, guests, line, kiosk]
updated: 2026-10-28
related: [live-display-pairing, live-display-moderation, kiosk-locking, faq-guest-lost-qr]
---

At a busy event the booth's result screen is only on for a short time. The Sharing Station is a second tablet or laptop, set a little way from the booth, where guests can come back for their capture whenever they like: they find it, tap it and scan the QR code that appears.

## Open it

1. Make sure **Show captures on screens** is on in the event's **Live Display** tab. The Sharing Station shows the same captures as the displays and nothing else, so with Live Display off it stays empty.
2. On the **Live Display** tab press **Open the Sharing Station**. It opens in a new tab. You can also go straight to the address `/station/` followed by the event's id.
3. On the device that will be the station, sign in to the Studio with an operator account. The station uses the signed-in account, so a viewer account can't open it.
4. Press **Start the Sharing Station**. It keeps the screen awake, and goes full screen if the event has an exit PIN.

## What guests see

- The newest captures first, as pictures with their six-character codes.
- A box to **Find by code**: typing a few characters narrows the list. A code that isn't there yet says **No capture with that code yet. It may still be on its way.**
- Tapping a capture opens it large, with its QR code, the code in big type and **Scan with your phone's camera to download.** After 45 seconds without a touch the large view closes by itself, so the next guest doesn't see someone else's capture.
- If the connection drops the station keeps what it has and says **Offline: showing what was already here**.

The list follows the rules of Live Display: only captures that are on screen appear, which means a capture you hid, one still waiting for approval, and one whose guest asked to be kept off the screen are not there. See [Moderate what is on screen](help:live-display-moderation). The 200 newest captures are kept.

## Keep guests on the station

The station uses the same exit PIN as the booth. With a PIN set for the event, it runs full screen with the same hidden operator corner (tap the top-left corner three times). See [Lock the booth for guests](help:kiosk-locking).

A guest who scans a code on the station arrives at the same page as one who scanned the booth's code.
