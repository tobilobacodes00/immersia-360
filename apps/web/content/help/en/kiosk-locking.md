---
title: Lock the booth for guests (kiosk mode)
summary: Set an exit PIN, and add iOS Guided Access, Android screen pinning or Chrome kiosk mode when guests must not leave the booth. A browser can't lock a device completely.
category: booth
order: 50
keywords:
  [
    kiosk,
    lock,
    pin,
    guided access,
    screen pinning,
    app pinning,
    full screen,
    unattended,
    ipad,
    tablet,
    exit,
    operator,
    triple tap,
  ]
updated: 2026-10-28
related: [chrome-kiosk-printing, 360-booth-setup, sharing-station]
---

> [!WARNING]
> A web page cannot fully lock a device. Immersia's kiosk lock keeps curious hands out of the booth screen, but a determined guest can still leave full screen, close the tab or switch apps. For an event nobody watches, combine it with your device's own lock: Guided Access, screen pinning or Chrome's kiosk mode, described below.

## The kiosk lock built into the booth {#lock}

In the event's **Setup**, under **Kiosk**, press **Set PIN** and choose 4 to 8 digits. With a PIN set:

- Pressing **Start booth** puts the booth in full screen, where the browser allows it (iPhone browsers generally do not).
- The operator's controls disappear: the back link, the render queue, the gallery and the settings. Guests see the event name and the booth.
- Leaving full screen (for example with Escape) shows a **Tap to return to the booth** screen.
- The browser asks for confirmation before the tab is closed or reloaded (most browsers only do this once the page has been touched).

The PIN is checked on the booth itself, so it works with no internet. The device receives only a fingerprint of the PIN, never the PIN itself.

### Getting out as the operator

1. **Tap the top-left corner of the screen three times** within a second and a half. The corner has no visible button, but it is a generous target.
2. Type the PIN and press **Unlock**.
3. Five wrong PINs pause the keypad for 30 seconds.

Remove or change the PIN in **Setup** to turn the lock off for the next event: **Remove PIN**.

The Sharing Station uses the same lock. See [Sharing Station](help:sharing-station).

## iPad and iPhone: Guided Access

Guided Access keeps the device in one app and can switch off the hardware buttons and parts of the screen.

1. Open **Settings**, then **Accessibility**, then **Guided Access**, and turn it on.
2. Set a passcode.
3. Open the booth in Safari, or better, from the Home Screen icon (Share, then **Add to Home Screen**), which runs without Safari's bars.
4. Triple-click the side button (or the Home button on models that have one) and choose **Guided Access**. Under **Options** you can turn off the buttons, the keyboard and touch.
5. Press **Start**.

To end it, triple-click again and enter the passcode.

## Android: screen pinning

1. Open **Settings**, search for **App pinning** (on Samsung phones it is called **Pin windows**) and turn it on. Turn on the option to ask for a PIN before unpinning, so guests can't undo it.
2. Open the booth in Chrome.
3. Open the Recents screen, tap the app's icon at the top of its card and choose **Pin**.

To unpin, touch and hold the Back and Recents buttons together, or swipe up and hold, depending on your navigation style, then enter the PIN.

## Windows, macOS and Linux: Chrome kiosk mode

Starting Chrome with `--kiosk` opens a page full screen with no address bar or tabs:

```text
chrome.exe --kiosk "https://your-address/booth/EVENT-ID"
```

This hides the controls but does not block the keyboard: Alt+F4 on Windows or Command+Q on a Mac still closes it. Hide the keyboard, or give the booth its own limited user account. Windows has an Assigned Access (kiosk) mode for that, and a managed device policy gives real lockdown on any platform.

You can add `--kiosk-printing` as well for silent printing, see [Print without a dialog](help:chrome-kiosk-printing).

## Also stop the screen sleeping

The booth asks the screen to stay awake while it is open, but the browser can decline (battery saver, for one). Keep the device on power, and set auto-lock to **Never** in the device's own settings.
