---
title: Looks, effects and background replacement
summary: Give every capture a colour look, add beat-synced effects to 360 videos, a photo effect to strips, and swap the background behind your guests.
category: design
order: 20
keywords:
  [
    look,
    filter,
    effects,
    colour,
    beat sync,
    music,
    confetti,
    sparkle,
    strobe,
    glitch,
    photo effect,
    background,
    green screen,
    blur,
    replace background,
    segmentation,
    cutout,
  ]
updated: 2026-10-28
related: [templates-and-editor, render-speed-and-queue, booth-error-messages, 360-booth-setup]
---

Open the event's **Branding** tab. The cards **Look and effects** and **Background** are where you set all of this.

## Looks

A **look** is a colour grade applied to every capture of the event: 24 of them, from **Mono**, **Noir** and **Sepia** to **Cinematic**, **Golden hour**, **Rose gold**, **Night neon**, **Midnight duotone** and **Black & gold**. **Original** leaves the colours alone.

The picker shows each look on a sample scene. Choose a **360 video look** and a **Photo look**. The look is applied on the live preview, while each capture is made, and in the final video or strip, using the same maths everywhere, so what the guest sees on the booth is what they get.

## Video effects (360 booth)

Effects play over the guests' footage: **Light rings, Confetti, Sparkle, Hearts, Bubbles, Snowfall, Smoke, Aura, Disco, Prism flare, Light leak, Film burn, Strobe, Glitch, RGB shift, VHS tape, Echo trail** and **Clones**. Pick up to **eight**, in order. Each has a **strength** slider, and some have a **colour** choice (**Colour, White, Silver, Gold**). They don't play over the intro, the outro or your overlay.

### Beat sync

With music added to the event, **Beat sync** makes effects pulse on the music's beats, and makes slow motion start and end on a beat. If the song has no steady beat (ambient or spoken), effects keep their own timing, and a fast song can drive an effect at half time. The option needs music in the event: add it under **Music** on the same page.

> [!WARNING]
> Strobe and other flashing effects can affect people who are sensitive to flashing light. The built-in effects are kept within the general threshold for flashes, but if your guests may be sensitive, leave **Strobe** out.

## Photo effect (photo booth)

Choose one **Photo effect** for the event: **Mirror, Bulge, Pinch, Swirl, Ripple, Glass, Prism, Kaleidoscope, Op art, Halftone, Thermal, Pop art, Pixelate, Sketch, Posterize, Duotone pop, Comic, Neon edges** or **Glitch**. It is applied, together with the photo look, to every photo before the strip is made. Boomerangs and short videos get the same.

## Background replacement

Under **Background**, swap whatever is behind your guests, with no green screen:

| Choice      | What guests get                                                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Off**     | The real background.                                                                                                                                                    |
| **Blur**    | The real background, blurred.                                                                                                                                           |
| **Colour**  | A flat colour.                                                                                                                                                          |
| **Picture** | A picture from your Assets. For a 360 booth it can be a **video** that plays behind the guest and starts over if it is shorter than the spin. Photos use pictures only. |

The booth finds the person in each frame on the device: no picture ever leaves it. The first time the feature is used, the device loads a small model and its runtime from the same server as the app and keeps them, so a booth that has run it once online keeps working offline.

- **Preview**: the card previews with a drawn silhouette. At the booth the cut-out follows each guest.
- **Cost**: finding the person in every frame is real work. It slows rendering, so run the [setup check](help:setup-check) with your settings; the test render includes the background.
- **Not available**: if a device can't start it (no WebGL 2, or the model couldn't be loaded because it was never online), guests get the plain background and the booth says **Background replacement is not available on this device**. See [Booth messages](help:booth-error-messages).
- Light the guests well and put them against a plain, contrasting wall: the cut-out is cleaner when the person stands out.

## What needs WebGL 2

Looks, effects and the thumbnails use the graphics hardware (WebGL 2). A browser without it can't preview them, and says **The preview needs WebGL2**; your choices are still saved and used on devices that have it. If a look or an effect's shader can't run on one device, that device renders without it instead of failing the take.
