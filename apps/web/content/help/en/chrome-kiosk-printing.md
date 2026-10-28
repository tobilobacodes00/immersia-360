---
title: 'Print without a dialog: Chrome kiosk printing'
summary: Start Chrome with --kiosk-printing on Windows, macOS or Linux so strips go straight to the default printer, and what to set up first.
category: photo
order: 30
keywords:
  [
    kiosk-printing,
    silent print,
    auto print,
    no dialog,
    chrome flag,
    default printer,
    shortcut,
    command line,
    windows,
    mac,
    linux,
  ]
updated: 2026-10-28
related: [printing-setup, kiosk-locking, setup-check]
---

Normally a web page can't print without asking. The browser shows its print dialog, and someone has to press **Print**. For **Print automatically** at an event that is no good. Chrome (and Chromium-based browsers such as Edge) has a start-up option, `--kiosk-printing`, that skips the dialog and sends the job straight to the **default printer**.

> [!NOTE]
> This works only in Chrome or another Chromium browser on a Windows, macOS or Linux computer. Safari, Firefox, iPads, iPhones and Android devices always show their print dialog.

## Before you start

1. **Set the default printer** in your operating system to the event printer. Silent jobs go only there.
2. **Do one normal print first.** With Chrome open on the booth, print a test (the printer test in the [setup check](help:setup-check) is ideal) and, in the dialog, choose the right **paper size**, **margins: None** and **scale: 100%**. In kiosk printing mode Chrome goes on using the options of the last print, so they have to be right once. See [Print at the right size](help:printing-setup).
3. **Quit Chrome completely.** The option only takes effect when Chrome starts fresh. If Chrome is already running, even in the background, a new window opens in the old process and the option is ignored. On Windows check the system tray; on a Mac use **Chrome > Quit Google Chrome**.

## Windows

1. Right-click the desktop, choose **New > Shortcut**.
2. For the location, enter the path to Chrome with the option after it:

   ```text
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing
   ```

3. Name it _Booth_ and open the booth from this shortcut every time.

For Microsoft Edge use `"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk-printing`. If your Chrome lives elsewhere, right-click its normal shortcut, choose **Properties** and copy the **Target**.

## macOS

In Terminal:

```text
open -na "Google Chrome" --args --kiosk-printing
```

`--args` hands everything after it to Chrome. For a launcher you can double-click, open **Script Editor**, type `do shell script "open -na 'Google Chrome' --args --kiosk-printing"` and choose **File > Export** with the format **Application**.

## Linux

```text
google-chrome --kiosk-printing
```

The program name varies (`google-chrome-stable`, `chromium`). Add it to a launcher or autostart entry if the booth should come up by itself.

## Combine with kiosk mode

For an unattended booth, start Chrome with both options so the page is full screen and prints silently:

```text
chrome.exe --kiosk --kiosk-printing "https://your-address/booth/EVENT-ID"
```

See [Lock the booth for guests](help:kiosk-locking) for how far that lock goes.

## Check it works

Open the booth from the new shortcut, keep a strip and let it print. The job should reach the printer with no dialog. If the dialog still appears, Chrome was already running: quit it fully and start again from the shortcut.

> [!TIP]
> Automatic printing and the **Print** button both use this same path, and a failed job doesn't stop the guest getting their QR code. If a paper jam stops prints, clear it and press **Print** again on the guest's result screen.
