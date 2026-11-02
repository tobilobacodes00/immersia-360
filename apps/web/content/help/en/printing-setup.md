---
title: Print at the right size
summary: Print sizes, how the booth prints, the print dialog settings that matter, two strips on a 4×6 sheet, and how to check the result with a ruler.
category: photo
order: 20
keywords:
  [
    print,
    printer,
    size,
    4x6,
    2x6,
    5x7,
    dpi,
    scale,
    margins,
    dye-sub,
    two-up,
    double strip,
    airprint,
    copies,
    calibration,
  ]
updated: 2026-10-28
related: [chrome-kiosk-printing, photo-booth-and-layouts, setup-check]
---

## How printing works

The booth makes the print as an image at **300 DPI** at the exact paper size (a 4×6 print is 1200 × 1800 pixels) and hands it to the browser's print function on a page of the same size with no margins. Your computer's or tablet's own printer system takes it from there. Immersia does not talk to printers directly, so any printer your device can print to works: office printers, photo printers, dye-sub event printers and AirPrint printers.

Sizes: **2×6** strip, **4×4**, **4×6** portrait, **6×4** landscape and **5×7** inches. The 9:16 story size is for screens and has no paper size.

## Turn printing on {#turn-on}

In the event's **Setup**, **Photo booth** section:

- **Printing** on.
- **Print automatically** sends each kept strip to the printer without the guest pressing anything. It needs silent printing: see [Print without a dialog](help:chrome-kiosk-printing). Without it, the print dialog opens on every strip.
- **Copies per session**, 1 to 10, is how many copies each print job makes.
- On the result screen guests get a **Print** button. It is limited to two prints per session, so a printer can't be run dry; an automatic print counts as one. When they reach the limit the button says so.
- **Two strips on a 4×6 sheet** (2×6 size only) is described below.

## The print dialog

Whatever printer you use, three settings decide whether the print is the right size:

1. **Paper size**: the real size of the paper in the printer (4×6 in, 5×7 in).
2. **Scale**: **100%**, not "Fit to page" or "Shrink to fit". Fitting changes the size.
3. **Margins**: **None** (or borderless printing, if the printer offers it). Leave headers and footers off.

The booth asks for a page with the right size and no margin, and Chrome and Edge usually pick that up, but printer drivers often add their own margins or scaling. Check the result as described below.

On an **iPad, iPhone or Android device** the system print dialog always appears; those systems cannot print silently from a web page. A computer running Chrome can, see the next article.

## Two strips on one 4×6 sheet

Most dye-sublimation event printers take 4×6 paper. A 2×6 strip fits twice on it. Choose the **2×6** layout size, switch printing on and switch on **Two strips on a 4×6 sheet**: the booth prints the same strip twice, side by side, on one 4×6 page. Load 4×6 paper. Cut the sheet down the middle, by hand or, if your printer has the option, with its built-in cutter (look in the printer's driver for a 2-inch or 2×6 cut setting).

The option does not appear for other sizes.

## Check the print with a ruler

The [setup check](help:setup-check) includes a printer test for photo booths. It prints a calibration sheet at your event's print size with:

- a **50 mm ruler** on the sheet, which should measure 50 mm give or take 1 mm;
- **corner marks** whose distance apart is printed on the sheet;
- a **20 mm circle** that must look round;
- four thin frames **1, 2, 3 and 4 mm** from each edge: every missing frame means about 1 mm is cropped.

Within 1 mm and nothing cropped means the guests' prints will come out at the size you chose. Keep faces and text at least 4 mm from the edge in your designs, because printers that crop need that margin.

## If the print is off

| What you see                | What to try                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| Ruler too short or too long | Set the scale to 100% and turn off "Fit to page". Check the driver's own scaling.                 |
| Edges cut off               | Margins to none, or borderless printing; the right paper size.                                    |
| White border all round      | Borderless printing, or margins none; the right paper size.                                       |
| Prints on the wrong paper   | Choose the correct paper size, and the right tray, in the driver.                                 |
| Nothing prints              | Check the printer is on, loaded and set as the default; try printing a test page from the system. |
