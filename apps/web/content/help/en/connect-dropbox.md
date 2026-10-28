---
title: Copy every file to your Dropbox
summary: Connect Dropbox once and every finished file is also saved in an Immersia folder in your own Dropbox, without access to anything else.
category: cloud
order: 20
keywords: [dropbox, cloud, backup, copy, connect, integrations, folder, app folder, archive]
updated: 2026-10-28
related: [connect-google-drive, cloud-copy-errors, expiry-and-extending]
---

Guests always download from Immersia. Connecting Dropbox adds a second copy of every finished video, strip and GIF in your own Dropbox. The copy is yours to keep after the hosted files expire.

## Connect

1. Open **Integrations** in the Studio. Only the **owner** of the account can connect or disconnect a cloud.
2. On the **Dropbox** card press **Connect Dropbox**.
3. Dropbox asks you to sign in and to allow Immersia 360. Allow it.
4. You return to the Integrations page, which says **Dropbox is connected. Copying has started.** and shows **Connected as** your Dropbox account.

If the card says **Not configured**, this Immersia server hasn't been set up for Dropbox. If you host Immersia yourself, see the setup notes in the project's README.

> [!NOTE]
> Immersia works only inside the folder it creates in your Dropbox (an "app folder", found under **Apps** in your Dropbox). It never sees the rest of your files.

## Choose where files go

Files go into a folder called **Immersia 360** inside that app folder, created when the first copy happens. Under **Folder** enter another name and press **Use this folder** to change it. Each event gets its own subfolder named with the event and its date, such as _Gala 360 2026-10-19_. Files already copied stay where they are.

## Turn it on for an event

Each event chooses. In the event's **Setup**, under **Sharing**, set **Also copy to my cloud** to **Dropbox**. A cloud that isn't connected can't be chosen, and the list says why.

## Watch it work

The Integrations page lists the last 20 files under **Recent copies** with a status (**Waiting**, **Copying**, **Copied**, **Failed**) and a link to open each in Dropbox. Copies never create duplicates: before uploading, Immersia checks whether a file by that name is already in the folder.

## Disconnect

**Disconnect** stops copying, revokes Immersia's access and deletes the saved connection. Files already copied stay in your Dropbox. Copies that hadn't happened yet are dropped; connect again later to catch up.

## If something goes wrong

Every message has a fix in [Copy problems and what they mean](help:cloud-copy-errors). If Dropbox is full, free some space and press **Retry**. If Dropbox ended the connection, press **Reconnect Dropbox**.
