---
title: iPad and iPhone storage, and browsers that clear data
summary: Why Safari can delete a booth's saved data, how to prevent it with the Home Screen app, and how much free space you need.
category: troubleshooting
order: 40
keywords:
  [
    ios,
    ipad,
    iphone,
    safari,
    storage,
    eviction,
    evicted,
    quota,
    persist,
    home screen,
    pwa,
    clear data,
    space,
    low storage,
    private browsing,
  ]
updated: 2026-10-28
related: [offline-mode-and-uploads, setup-check, kiosk-locking, faq-free-up-space]
---

A booth keeps recordings and renders in the browser's storage until they are uploaded. Browsers are allowed to delete that storage in some situations, and Safari on iPad and iPhone is the strictest. A little preparation removes the risk.

## What can go wrong

- **Safari clears a website's data after a period without use.** WebKit, the engine behind every browser on iOS, deletes a site's saved data if you haven't opened it for about a week, unless the site is installed on the Home Screen. A booth that sits in a drawer between events can lose anything not yet uploaded.
- **The system can clear storage when the device runs low on space**, and may not ask.
- **Clearing history** (Settings, then Safari, then **Clear History and Website Data**) removes everything.
- **A private tab or window** forgets everything when it is closed.

On other platforms Chrome and Edge can also clear a site's data when the device runs low on space, unless the site has been granted persistent storage. The booth asks for that when it starts; the [setup check](help:setup-check) reports whether the browser agreed.

## The fix: use the Home Screen app

1. Open the booth address in Safari.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. From now on, open Immersia 360 from its Home Screen icon.

An installed web app has its own storage that Safari's one-week clean-up does not touch, runs without Safari's bars, and is also better for [kiosk mode](help:kiosk-locking). Register the device and run the setup check from the installed app, because it generally has its own storage, separate from the Safari tab: a device registered in Safari may need registering again in the app.

## Free space

The booth shows **Storage low** when less than 2 GB is free, and the setup check warns at the same point and fails under about 0.5 GB. A 15 second recording at 1080p is tens of megabytes; a full day at a busy event is gigabytes.

To free space:

- Delete rendered takes you no longer need in the **Render queue**. Deleting removes the take and what was rendered from it from the device; files already uploaded are not affected. Check the upload pills first.
- Remove other apps, photos and videos from the device.
- Check **Settings, General, iPhone (or iPad) Storage** for what is using space.

## A few habits that prevent loss

- Don't leave a booth unused for more than a few days with captures still waiting. Let the uploads finish.
- Keep the device charging during the event.
- Don't use a private tab for a booth.
- If you must clear browser data, wait until the pills show nothing is waiting. See [Offline mode and the upload queue](help:offline-mode-and-uploads).
