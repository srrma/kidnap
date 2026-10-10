# Design direction

## Direction

> A frankenstein of Apple HIG and Material 3 Expressive.

## Reading

A browser side-panel utility, used repeatedly by one person to save media, in a
structural language borrowed from Apple HIG (sheets, grouped lists, system
typography, restrained color) fused with Material 3 Expressive (expressive
color, shape emphasis, tonal surfaces).

**Dials: ENERGY 2 / RHYTHM 2 / MOTION 1.**

Energy 2 because M3 Expressive contributes genuine boldness and the product has
a clear accent moment (the primary action on a row). Not Energy 3: this is a
tool someone uses many times a day, and shouting at it would be a defect.

Rhythm 2 because the panel is not one repeated unit. The list, the queue, the
sheet, and the empty state each compose differently, and the type filter bar
deliberately breaks the list's grid.

Motion 1 because hover, focus, and state transitions are all a repeated tool
needs. Nothing loops, nothing pulses, nothing enters on scroll. A panel that
animates at you while you are trying to read a list of URLs is wrong.

## Two collisions, and how they were settled

**R-11 (no pill-shaped everything) and R-09 (capsule badges): kept, applied
with limits.** M3 Expressive's signature is very large corner radii and pill
chips. Those are used on the components where the shape carries meaning: type
filter tabs, media-kind badges, primary buttons, and the sheet grabber. List
rows, cards, inputs, and thumbnails use restrained radii. No decorative pills,
and no pill ever carries a word the surface already says.

**R-10 (glassmorphism): sheets only.** The sheet scrim is the single blurred
surface, which is what an Apple HIG sheet already does. Every other surface is
opaque and tonal.

## Consequences that follow from the direction

- Both themes are first class. A tool with no strong reason to force one theme
  ships a working toggle (R-21). Dark mode is not the default.
- Every data view needs an empty state, a loading state, and an error state,
  and each one names the cause and the next action (R-27).
- Contrast is checked in both themes before delivery, against the rows, the
  queue, the sheet and the empty states (R-25).

## Reason for every major decision

Recorded as R-31 requires.

| Decision | Reason |
| --- | --- |
| Sheets for preview, settings, and variant choice | The panel is narrow; a sheet keeps the list behind it, which is Apple HIG structure and matches the direction above. |
| One accent, used on the primary row action | One accent is what makes it an accent. Spreading it across badges, borders, and icons removes the focal point. |
| Opaque tonal surfaces everywhere except the sheet | Keeps hierarchy legible; blur on every surface flattens it (R-10). |
| Large radii on tabs, badges, and primary buttons only | Carries M3 Expressive character where shape signals an action or a category, not on every element (R-11). |
| System font stack | A side panel inherits the user's system font by default and looks native for free. Choosing a display face here would fight the browser chrome. |
| Filter bar is pills, list rows are not | Gives the RHYTHM 2 break: the control strip reads as controls, the list reads as content. |