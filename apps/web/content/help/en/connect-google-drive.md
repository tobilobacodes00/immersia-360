---
title: Copy every file to your Google Drive
summary: Connect Google Drive once, choose a folder, and every finished file is also saved in your own Drive, without Immersia seeing anything else in it.
category: cloud
order: 10
keywords: [google drive, drive, cloud, backup, copy, connect, integrations, folder, archive, oauth]
updated: 2026-10-28
related: [connect-dropbox, cloud-copy-errors, expiry-and-extending, team-roles]
---

Guests always download from Immersia. Connecting Google Drive adds a second copy of every finished video, strip and GIF in your own Drive. The copy is yours to keep after the hosted files expire.

## Connect

1. Open **Integrations** in the Studio. Only the **owner** of the account can connect or disconnect a cloud.
2. On the **Google Drive** card press **Connect Google Drive**.
3. Google asks you to sign in and to allow Immersia 360. **Leave the access box ticked.** Without it, Immersia can't save files.
4. You return to the Integrations page, which says **Google Drive is connected. Copying has started.** and shows **Connected as** your Google account.

If the card says **Not configured**, this Immersia server hasn't been set up for Google Drive. If you host Immersia yourself, see the setup notes in the project's README.

> [!NOTE]
> Immersia asks for the narrowest Google permission there is (`drive.file`). It sees and touches only the files and folders it creates itself, and can never browse the rest of your Drive.

## Choose where files go

Files go into a folder called **Immersia 360**, created in your Drive when the first copy happens. Under **Folder** enter another name and press **Use this folder** if you prefer. Each event gets its own subfolder named with the event and its date, such as _Gala 360 2026-10-19_. Files already copied stay where they are.

Files are named after the event and the guest's code, for example `gala-K7M2QX-mp4.mp4`, so every file in the folder is unique.

## Turn it on for an event

Connecting isn't enough on its own: each event chooses. In the event's **Setup**, under **Sharing**, set **Also copy to my cloud** to **Google Drive**. A cloud that isn't connected can't be chosen, and the list says why.

## Watch it work

The Integrations page lists the last 20 files under **Recent copies** with a status (**Waiting**, **Copying**, **Copied**, **Failed**) and a link to open each in Drive. The event's **Overview** tab shows a notice when copies to your cloud need your attention.

Copies never create duplicates: before uploading, Immersia checks whether a file by that name is already in the folder. Large files are copied in parts, so any size works.

## Disconnect

**Disconnect** stops copying, revokes Immersia's access at Google and deletes the saved connection. Files already copied stay in your Drive. Copies that hadn't happened yet are dropped; connect again later to catch up.

## If something goes wrong

Every message on this page has a fix in [Copy problems and what they mean](help:cloud-copy-errors). The most common is that Google ended the connection (**Google Drive needs you to sign in again**): press **Reconnect Google Drive**, and waiting copies go through by themselves.
