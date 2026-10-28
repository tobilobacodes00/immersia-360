---
title: Register and manage booth devices
summary: Why a booth runs on a registered device, how to name, check and revoke devices, and what happens when you revoke one.
category: start
order: 30
keywords: [device, register, revoke, token, ipad, laptop, tablet, rename, online, last seen]
updated: 2026-10-20
related: [setup-check, offline-mode-and-uploads, team-roles]
---

A booth only records on a **registered device**, so every take and upload belongs to your account and you can cut a device off at any time. There is no limit on how many devices you register, and no fee for them.

## Register a device

You can register from the booth itself or from the Studio:

- **From the booth.** The first time a device opens a booth it shows **Register this device**. Type a name you will recognise at the venue, such as _Booth A iPad_, and press **Register and continue**.
- **From the Studio.** Open **Devices and team**. On the device itself press **Register device** next to **Use this browser as a booth**.

Registering gives the browser a long random token, stored in that browser. The server keeps only a fingerprint of it. The booth presents the token whenever it uploads a file, asks for short codes or reports its status, so a booth keeps uploading for the whole event even if the operator's own sign-in ends.

> [!NOTE]
> The token lives in the browser's site data. If you clear that data, or use a private window, the device forgets it is registered and asks again. Register it again and rename the old entry or revoke it.

## What the list shows

For each device you see its name, its platform and browser, when it was last seen, and its render path:

| Label                           | Meaning                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| renders on device               | The device can render videos itself at the target speed.            |
| renders on device (slower)      | It can, but slower than the target, or without hardware video encoding. Use a faster device for busy events. |
| renders in the cloud            | The browser lacks what rendering needs (hardware-accelerated graphics or video encoding), or the setup check could not render a test clip. |

A device shows **Online** when it was seen in the last two minutes. A booth that is open reports in every 30 seconds, along with how many takes are waiting to render and how many files are waiting to upload.

The render path starts as a quick guess made at registration and is replaced by a measured one when you run the [setup check](help:setup-check). It is a hint: today every booth renders on the device it runs on.

## Rename and revoke

- **Rename** changes the name in the list, not the device.
- **Revoke** cuts a device off immediately. The next time it talks to the server it is refused, and its booth shows **This device was removed: register it again to upload**. Files already uploaded stay. Anything still waiting on the device stays there; register the device again to upload it.

Owners and operators can register devices and see the list. Only owners can revoke. See [Team roles](help:team-roles).

## Good habits

- Name devices by where they work, not what they are: _Booth A iPad_, _Entrance laptop_.
- Revoke a device that is lost, sold or lent out.
- Register each browser you use as a booth. Chrome and Safari on the same laptop are two devices.
