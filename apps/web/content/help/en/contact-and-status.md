---
title: Contact support and check service status
summary: How to reach us, how quickly we reply (within 2 business days), what to include, and the public status page.
category: account
order: 20
keywords:
  [support, contact, email, help, status, outage, incident, down, response time, business days, report a problem]
updated: 2026-10-28
related: [setup-check, booth-error-messages, guest-privacy]
---

## Reach us

Use the **Contact us** form at the bottom of the [help centre](/help), or write to the support address shown on the form and on the [status page](/status). Both go to the same inbox, and replying to our answer reaches the person who wrote it.

**We reply within 2 business days** (Monday to Friday), often sooner. If it is urgent because an event is under way, say so at the start of your message; the answer is faster when it comes with the details below.

The help centre is open to everyone, signed in or not, so you can reach us even when you can't get into the Studio. Please don't send passwords or full payment details. We never need them.

## What to include

A good report is mostly facts:

- **What you were doing** and **what you expected**.
- **What happened instead**, with the exact words of any message. The booth messages are listed in [Booth messages and what to do about them](help:booth-error-messages).
- **The device and the browser**: for example "iPad (9th generation), Safari 18", or "Windows laptop, Chrome".
- **The event name** and roughly **when** it happened.
- The result of the [setup check](help:setup-check), if you have run it on that device.

The form adds the page you sent it from and, if you are signed in, your account, so we can look into it.

## Privacy requests

Requests about guests' data, your own data or this product's privacy notice go to the same address. Guests can delete their own files on their page, and operators have tools for the rest. See [Guest privacy](help:guest-privacy).

## The status page

The [status page](/status) shows live checks of what Immersia 360 runs on:

| Service              | What it does                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| **Database**         | Accounts, events, devices and guest links.                                                             |
| **File storage**     | Guests' photos and videos, and downloads.                                                              |
| **Live Display hub** | Sends new captures to displays within a second. Optional: without it, screens check every few seconds. |
| **Email**            | Sign-in links, guest emails and support replies.                                                       |

Each shows **Operational**, **Degraded** (slower than usual), **Down**, or **Not configured** if this deployment doesn't use it. The page's headline reads **All systems operational**, **Some systems are slower than usual**, or **A system is down**. The checks come straight from our own servers, not a third-party status service, and results are kept for about 20 seconds so the page can't be used to overload them.

Below the checks, **Recent incidents** lists anything that went wrong or was planned maintenance in the last 90 days, with when it started and ended, what it affected and what happened. It is written by hand when something happens.

Uptime monitors can read the same checks as JSON at `/api/status`; it answers with a failure status when a core service is down.

If the status page says everything is fine and you still have a problem, it is probably the device or the venue's network. Run the [setup check](help:setup-check), or contact us.
