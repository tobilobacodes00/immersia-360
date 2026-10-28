---
title: Run the setup check
summary: Test a booth device before the event: camera, storage, a test recording, render speed, a QR scan, the printer and uploads.
category: start
order: 20
keywords: [test, check, wizard, fps, benchmark, render speed, calibration, ruler, qr test, readiness]
updated: 2026-10-20
related: [render-speed-and-queue, ios-storage-eviction, printing-setup, offline-mode-and-uploads]
---

The setup check is a short guided test you run on the device that will run the booth. It uses the same camera, recorder, storage, render engine and upload path the booth uses, so a pass means the booth will work. Each step ends in **Good**, **Check** (works, but look at this) or **Fix** (will cause trouble), with what to do about it.

## Where to start it

- On the event page, press **Setup check**.
- In the booth, open **Booth settings** and press **Run** next to **Setup check**.
- The first time a device opens a booth, the start screen offers it. **Skip for now** is remembered for that device in that browser.

Run it on the device and browser you will use at the event, from the same place, on the same network.

## The steps

### Camera and lens

Pick the camera and lens (the same picker as in the booth settings) and look at the picture. The check then counts the frames per second the camera really delivers for about two and a half seconds.

- **Good** when it delivers at least 90% of what the event asks for.
- **Check** when it is slower but still smooth (at least 24 fps), for example a 30 fps webcam on a 60 fps event. Slow motion will be less smooth. You can also lower the event to 30 fps.
- **Fix** below 24 fps, which looks choppy. Close other apps that use the camera, try another camera or port and add light.

### Storage

Recordings live on the device until they are uploaded. The check asks the browser to keep this site's data, reads the free space and notes where recordings are written. It warns below 2 GB free and fails below about 0.5 GB. If the browser will not promise to keep the data you get advice for your browser. See [iOS storage and eviction](help:ios-storage-eviction).

### Test recording

Records four seconds through the booth's own recorder, writes them to the device's storage, reads the file back and checks its size and length. The test file is deleted when the check ends.

### Render speed

Renders the test recording with this event's output settings in the real render engine, then scales the time to a 15 s, 1080p clip, the yardstick we promise:

| Result                  | Meaning                                          |
| ----------------------- | ------------------------------------------------ |
| 45 s or less            | **Good**: on target for a laptop                 |
| 46 to 90 s              | **Check**: on target for a 2021 iPad, slow for a laptop |
| More than 90 s          | **Fix**: guests would wait a long time           |

The estimate is a little pessimistic, because a short clip includes start-up time. The result is saved on the device as its **render path**. See [Render speed and the queue](help:render-speed-and-queue).

### Test QR scan

Shows a QR code. Point a phone at it: the page it opens says **Scanned**, and the check sees that within a couple of seconds. This proves guests' phones can reach the server from where the booth is. The code works for 10 minutes. If the booth is open at a local address such as `localhost`, you get a warning, because phones on other networks cannot open it.

### Printer test (photo booths)

Prints a calibration sheet at the event's print size, 300 DPI, through the same print code as a guest's print. You then check it with a ruler:

- the **50 mm ruler** should measure 50 mm, give or take 1 mm;
- the corner marks are the distance apart printed on the sheet;
- the **20 mm circle** should look round;
- the four thin frames sit 1, 2, 3 and 4 mm in from each edge. Every frame that is missing means about 1 mm is cropped.

You then say what you saw. Within 1 mm and nothing cropped is **Good**. See [Printing at the right size](help:printing-setup). The 9:16 story size is for screens, so it has nothing to print.

### Upload and network

Asks the server for a signed upload, sends 1 MB straight to storage like a guest's file, and has the server confirm it arrived whole and delete it. It reports the speed. Below 2 Mbit/s you get a warning, because a typical 12 MB clip would take over 45 seconds to reach the guest.

## Results

At the end you see every step with its result and what to do. Press **Run the check again** after fixing something.

The device's record is updated with the camera's delivered size and frame rate, the measured render speed, the render path and when the check ran. **Devices** shows the render path next to the device. We also count that a check finished (with its render speed, camera frame rate and browser) in our own analytics, which identify no guest.

> [!NOTE]
> The render path is a hint. Today every booth renders on the device it runs on, so a "slower" or "can't render" result means: use a faster device for this event.
