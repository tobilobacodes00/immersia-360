---
title: Templates and the design editor
summary: Start from a ready-made photo layout or video overlay, edit it in the editor, save your own, and upload your own logos, fonts, music and frames.
category: design
order: 10
keywords:
  [
    template,
    editor,
    layout,
    overlay,
    design,
    library,
    wedding,
    birthday,
    text,
    font,
    logo,
    qr,
    tokens,
    dynamic fields,
    assets,
    upload,
    png,
    frame,
  ]
updated: 2026-10-28
related: [photo-booth-and-layouts, looks-and-effects, 360-booth-setup, printing-setup]
---

Two kinds of designs share one editor:

- A **layout** is the print or strip a photo-booth guest takes home: photo slots, text, logos and the guest's QR code.
- An **overlay** is a transparent frame drawn over every 360 video: the event name, a logo, a border.

## Start from the library

Open **Templates** in the Studio. It holds ready-made designs for **Wedding, Birthday, Graduation, Baby shower, Christmas, Halloween, Quinceañera** and **Corporate** events, in many styles and in every print size and overlay shape. Filter by occasion and size, or search by name. **Mine** shows templates your team has saved.

Open one to preview it, then **Use for an event…**: pick the event and **Use this design**. It replaces the event's current design, and you can still edit it afterwards. If the template is for a different size, the matching style made for the event's size is used where there is one, or the design is fitted to the size. A warning tells you if the layout has more photo slots than the event takes photos. **Save to my templates** keeps a copy for reuse.

You can also reach the library from the editor's **Templates** panel.

## The editor

In an event, open **Branding**. Under **Print layout** (photo) or **Video overlay** (360), press **Open the editor**, or **Design one** if the event has none yet.

Add things with the toolbar:

| Tool                          | What it adds                                          |
| ----------------------------- | ----------------------------------------------------- |
| **Add a photo slot**          | Where one of the guest's photos goes (photo layouts). |
| **Add text**                  | Text in any font, with dynamic fields (below).        |
| **Add an image**              | A logo or picture from your Assets.                   |
| **Add a rectangle / ellipse** | A shape with a fill and an outline.                   |
| **Add the guest QR code**     | The code that opens the guest's page (photo layouts). |
| **Add a decoration**          | An ornament from the built-in set.                    |

Click an element to select it; drag to move, drag the handles to resize or rotate. The **Properties** panel has exact position, size, rotation, opacity, and settings for the kind of element. The **Layers** panel orders, shows, hides and locks them. Select several with Shift-click or by dragging across the canvas, then align them. The shortcuts, such as undo and duplicate, are listed in [Keyboard shortcuts](help:capture-triggers-and-shortcuts).

The editor saves by itself (**All changes saved**). If the design was changed in another tab or on another device, it asks whether to **Load their version** or **Keep mine**.

### Sizes

A print canvas is made at **300 DPI**, so what you see is what prints: a 4×6 is 1200 × 1800 pixels. A **QR code** on a print must be at least **18 mm** wide for phones to read it; the editor warns with **QR under 18 mm**.

An overlay is transparent so the video shows through. Keep the background empty.

### Dynamic fields {#fields}

Text can contain fields that fill in for each event or guest, picked from the `{ }` button in the text box:

| Field                                   | Gives                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `{eventName}`, `{eventDate}`            | The event's name and date.                                                                     |
| `{hashtag}`, `{custom1}` to `{custom3}` | Text you set under **Branding**, **Dynamic fields**.                                           |
| `{shortCode}`, `{sessionUrl}`           | The guest's short code and link.                                                               |
| `{shotNumber}`, `{shotCount}`           | Which photo this is, and how many.                                                             |
| `%d %B %Y`, `%d.%m.%Y`, `%H:%M`         | The date and time in a format.                                                                 |
| `{upper,{eventName}}` and others        | Functions: upper case, a fallback when empty, a condition, the first characters, URL-encoding. |

A live preview underneath the box shows the result.

## Your own files in Assets {#assets}

**Assets** holds files shared by every event on the account: overlays and frames, intros and outros, music, fonts, logos and backgrounds. Upload once, use anywhere. The limits:

| Kind            | Formats                                       | Limit                                                  |
| --------------- | --------------------------------------------- | ------------------------------------------------------ |
| Overlay         | PNG or WebP with transparency                 | 25 MB                                                  |
| Frame           | PNG, JPEG or WebP                             | 25 MB                                                  |
| Intro and outro | MP4, MOV, WebM, or an image (PNG, JPEG, WebP) | 200 MB for video, up to 30 seconds; 25 MB for an image |
| Music           | MP3, M4A/AAC, WAV                             | 50 MB, up to 15 minutes                                |
| Fonts           | WOFF2, WOFF, TTF, OTF                         | 10 MB                                                  |
| Logos           | PNG, JPEG or WebP (SVG is not supported)      | 10 MB                                                  |
| Backgrounds     | PNG, JPEG, WebP, MP4 or WebM                  | 25 MB for an image, 200 MB for a video                 |

The editor also offers a library of open-licence fonts (free for print and video) to choose from. Uploaded fonts appear under **Uploaded**.

The account's library holds up to 5 GB. A file's real type is checked from its contents, not its name. A file that is in use can't be deleted until you switch the events and templates that use it to something else. Everything your events use is saved on the booth device while it is online, so it works offline.
