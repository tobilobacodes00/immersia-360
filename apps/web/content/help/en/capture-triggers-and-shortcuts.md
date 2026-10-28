---
title: Starting with a keyboard, remote or motion, and keyboard shortcuts
summary: Every way to start and stop a capture, the keys a Bluetooth remote can send, and the shortcuts in the booth, the editor and on a Live Display.
category: booth
order: 30
keywords:
  [
    keyboard,
    shortcuts,
    remote,
    bluetooth,
    clicker,
    presenter,
    page down,
    space,
    enter,
    escape,
    hotkeys,
    motion,
    trigger,
    start,
  ]
updated: 2026-10-20
related: [360-booth-setup, kiosk-locking, templates-and-editor]
---

## Ways to start a capture

In the event's **Setup**, under **Starting a capture**, switch on any of these:

- **Tap the screen.** The guest taps the start button.
- **Keyboard and Bluetooth remotes.** A key press starts the capture. Handy for an operator, or for a guest with a presentation clicker.
- **Motion** (360 booth). The booth watches the camera and starts when the platform starts turning. No countdown, because the platform is already moving. A cool-down stops it starting again straight away. You can also switch motion on and set **Motion needed** in **Booth settings** for this device.

## Keys that start a capture

When the booth is ready for a guest (or on the guest's result screen) any of these keys starts a capture:

| Key                             | Typical source                                                  |
| ------------------------------- | --------------------------------------------------------------- |
| **Space**, **Enter**            | A keyboard                                                      |
| **Page Down**, **Page Up**      | Most presentation clickers                                      |
| **Arrow Right**, **Arrow Down** | Some clickers and keyboards                                     |
| **F4**                          | A few remotes                                                   |
| **Volume Up**                   | Camera shutters, where the system passes the key to the browser |

The keys are ignored while someone is typing in a field, when a modifier key (Ctrl, Alt, Command) is held, and when a key is held down and repeating. They do nothing while the gallery is open, so a stray press cannot start a recording behind it.

To stop a 360 recording early, press **End** or **Escape**, or tap **Stop**. The spin also ends by itself after the **Spin length**.

## Elsewhere

| Where               | Key                                                  | Does                                                          |
| ------------------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| Booth panels        | **Escape**                                           | Closes the settings, the render queue or the gallery.         |
| Kiosk PIN pad       | **0** to **9**, **Backspace**, **Enter**, **Escape** | Types, deletes, unlocks, cancels.                             |
| Live Display screen | **F**                                                | Switches full screen on and off.                              |
| Template editor     | **Ctrl/Cmd+Z**                                       | Undo.                                                         |
|                     | **Ctrl/Cmd+Shift+Z** or **Ctrl/Cmd+Y**               | Redo.                                                         |
|                     | **Ctrl/Cmd+A**                                       | Select everything.                                            |
|                     | **Ctrl/Cmd+D**                                       | Duplicate the selection.                                      |
|                     | **Delete** or **Backspace**                          | Delete the selection.                                         |
|                     | **Escape**                                           | Deselect.                                                     |
|                     | **Ctrl/Cmd+]** and **Ctrl/Cmd+[**                    | Bring forward, send backward (add **Shift** for front, back). |
|                     | **Arrow keys**                                       | Nudge by 1 pixel (hold **Shift** for 10).                     |
| Music trim handles  | **Arrow keys**, **Page Up/Down**, **Home**, **End**  | Move the handle (hold **Shift** for bigger steps).            |

> [!TIP]
> Test your remote with the [setup check](help:setup-check) or on the booth's start screen before the event. If a key does nothing, the remote is probably sending something else: try pressing its other buttons.
