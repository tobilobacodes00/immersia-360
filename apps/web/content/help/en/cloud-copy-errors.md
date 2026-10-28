---
title: Cloud copy problems and what they mean
summary: Every message on the Integrations page and the event page when connecting or copying to Google Drive or Dropbox fails, with what to do.
category: cloud
order: 30
keywords:
  [
    error,
    reauth,
    sign in again,
    quota,
    full,
    storage full,
    folder,
    deleted,
    denied,
    scope,
    refresh,
    retry,
    failed,
    dropbox,
    google drive,
    integrations,
    connection,
  ]
updated: 2026-10-28
related: [connect-google-drive, connect-dropbox, expiry-and-extending, team-roles]
---

When something stops files reaching your Google Drive or Dropbox, the app tells you what failed and what to do. Find your message below. **Guests are never affected**: their files stay on Immersia, and copies that couldn't be made wait and go through, without duplicates, once the problem is fixed.

## Problems when connecting

These appear in a red box on the Integrations page after you press **Connect**.

### You cancelled the connection {#denied}

**"You cancelled the connection, so nothing changed."** You pressed Cancel on the Google or Dropbox screen. Press **Connect** to try again.

### The sign-in link expired {#state}

**"That sign-in link expired or didn't come from this account."** The connection has to be finished within 10 minutes, by the same person and in the same account. Either the Google or Dropbox page was left open too long, or it was opened from another account. Press **Connect** and finish without pausing.

### The permission wasn't granted {#scope}

**"…didn't grant the permission Immersia needs."** On Google's screen there is a box allowing Immersia to see and create files. If it was unticked, Immersia can't save files. Press **Connect** again and leave it ticked.

### No lasting access was given {#no_refresh}

**"…didn't give Immersia lasting access. Remove Immersia from your connected apps, then connect again."** The provider remembers an earlier connection and doesn't issue a new long-lived key. Remove Immersia 360 from the list of apps with access to your account (in your Google Account's security settings under third-party apps and services, or in Dropbox under **Settings** and **Connected apps**), then press **Connect** again.

### The provider refused the sign-in {#exchange}

**"…refused the sign-in."** Press **Connect** to try once more. If it keeps happening, try in a private window, or without browser extensions that block sign-in pages.

### The provider couldn't be reached {#unreachable}

**"Couldn't reach …"** The provider didn't answer. Check the connection and try again in a minute.

### This server isn't set up for it {#unavailable}

**"This server isn't set up for …"** (also shown as **Not configured** on the card). The Immersia server you're using has no credentials for that provider. If you host Immersia yourself, add its credentials and `INTEGRATION_TOKEN_KEY` to the environment, as described in the README; the hosted service sets this up for you.

### Only the owner can do this {#forbidden}

**"Only the account owner can connect a cloud."** Ask the owner of the account to connect or disconnect it, or have your role changed. See [Team roles](help:team-roles).

### Something else went wrong {#failed}

**"Something went wrong while connecting…"** Try again. If it persists, contact support with the time it happened. See [Contact and status](help:contact-and-status).

## Problems copying files

These appear on a file in **Recent copies**, on the provider's card, and in an amber notice on the event's **Overview** tab.

### You need to sign in again {#reauth_required}

**"Access to … was revoked or has expired."** The provider ended the connection: you removed Immersia from your connected apps, changed your password, or the access timed out. Nothing is lost; new files stay on Immersia and wait. Press **Reconnect** on the card, and every waiting file copies by itself.

If you manage a Google project yourself and its consent screen is still in **Testing** mode, Google ends the connection after 7 days. Publish the consent screen to stop that.

### Your cloud is full {#quota_exceeded}

**"Your … is full. Free up space, then press Retry."** Free space in your Drive or Dropbox, then press **Retry** on the card.

### The provider didn't respond {#transient}

**"Couldn't reach … after several tries. Press Retry."** Immersia tried several times (the pause starts at 30 seconds and doubles each time) and gave up after eight tries. Check that the provider is working, then press **Retry**. While it is still trying, the list says **Didn't respond. Trying again …** and no action is needed.

### The folder was deleted {#folder_missing}

**"The folder was deleted from …"** You (or someone) removed the Immersia folder from your cloud. Choose a folder on the card ("Folder", then **Use this folder**); failed copies restart by themselves.

### Immersia can't write to that folder {#folder_inaccessible}

**"Immersia can't write to that folder."** The folder was moved, or access to it changed. Create a new folder on the card the same way; failed copies restart by themselves.

### The file expired before it could be copied {#source_gone}

**"This file expired on Immersia before it could be copied, so it can't be sent any more."** The guest files reached the end of their retention before the copy could be made, usually because the connection was broken for a long time. That file can't be recovered. To avoid it, fix connection problems quickly and see [Expiry and extending](help:expiry-and-extending): extending the event's links gives the copies time to catch up.

### Couldn't copy this file {#other}

**"Couldn't copy this file. Press Retry; if it keeps failing, reconnect …"** An unusual error. Press **Retry**. If it fails again, press **Disconnect**, then **Connect** again, and contact support if that doesn't help.

## Copy problems on the event page

An amber notice on the event's **Overview** tab says **Copies to … need your attention**, with the same reason, and **Open Integrations** takes you to the card to fix it. If the event is set to copy to a cloud that isn't connected at all, it says so: connect it, and the event's files catch up.
