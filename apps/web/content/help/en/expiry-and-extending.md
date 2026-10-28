---
title: How long guest files are kept, and extending them
summary: Choose 7, 30 or 90 days, see when links expire, extend them before they do, and what guests see afterwards.
category: sharing
order: 40
keywords:
  [expiry, expire, retention, delete, days, extend, 7 days, 30 days, 90 days, ended, removed, contact, keep forever]
updated: 2026-10-28
related: [gallery-and-zip-export, connect-google-drive, sharing-with-guests, guest-privacy]
---

Hosted guest files are not kept forever. This keeps the service free and keeps guests' pictures from lingering. Each event has a retention period, and when a guest's files reach the end of it they are deleted.

## Choose the period

When you create an event, and later under **Setup** in **Basics**, set **Keep guest files for**: **7 days**, **30 days** or **90 days**. 30 is the default.

The clock for each capture starts when the server receives it from the booth, not when the event happens, and is counted from the period that applied at that time. Changing the period later affects new captures; use **Extend** below for ones that exist.

## See what is expiring

On the event's **Overview** tab, under **Guest files**:

- **Live guest links**: captures whose files are still there.
- **Next expiry**: when the first of them goes.
- **Expired**: captures whose files have been deleted.

## Extend before they go

Under those numbers, **Extend by 7 days** and **Extend by 30 days** give every live guest link more time. The new date is counted from now, or from the current expiry if that is later, so pressing it again keeps adding. The message afterwards says how many links were extended.

> [!WARNING]
> Files that have already expired can't be brought back. Extend before the date shown, or the files are gone.

## What happens when files expire

A sweep runs every hour and deletes the expired files from storage, then marks the captures expired. If the event copies to your own cloud (see [Connect Google Drive](help:connect-google-drive)), the copies are made before the sweep wherever possible, and the copies in your cloud are never deleted by Immersia.

A guest who opens an expired link sees **This event has ended. Its photos and videos have been removed. Anything you downloaded is still on your device.** If you filled in **Contact for guests** in the event's **Sharing** setup, they also see **Questions? Contact …**, linked when it is an email address or a phone number.

## Keep files for good

To keep a copy beyond the retention period:

- connect **Google Drive** or **Dropbox** and choose it under **Also copy to my cloud**;
- or press **Download every file (ZIP)** on the event's Overview tab before the files expire. See [The event gallery and ZIP export](help:gallery-and-zip-export).

Archiving an event does not delete its guest files, and does not stop them expiring on schedule.
