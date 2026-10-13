# Design direction

The visual and structural direction for Kidnap, and the reasoning behind it. A
contributor should be able to read this and make a decision that fits without
having to ask why anything is the way it is.

## Direction

A browser side panel that one person uses repeatedly to save media. It borrows
its structure from Apple HIG (sheets, grouped lists, system typography,
restrained colour) and its expression from Material 3 Expressive: confident
colour, shape used for meaning, tonal surfaces.

The two are in tension on purpose. Material 3 Expressive wants very large corner
radii and pill shapes nearly everywhere; a tool you open twenty times a day does
not. The resolution is that shape is spent where it carries meaning and withheld
where it would only decorate.

## Where the expression is allowed

Large radii and pill shapes appear on: type filter tabs, media-kind badges,
primary buttons, and the sheet grabber.

Every one of those is a control or a category. Pills on list rows, cards, inputs
or thumbnails would say nothing, so they use restrained radii instead. No
decorative pill, and never a pill carrying a word the surface already says.

## Where the blur is allowed

One surface: the sheet scrim. That is what a sheet does, and blurring it separates
the sheet from the list without moving anything.

Every other surface is opaque. Blur on every surface flattens the hierarchy
instead of creating it.

## Colour and theme

Both themes are first class. A tool with no strong reason to force a theme ships
a working toggle rather than a preference. Dark mode is not the default.

There is exactly one accent, used on the primary action of a row. One accent is
what makes it an accent; spreading it across badges, borders and icons removes
the focal point.

## States

Every data view needs an empty state, a loading state and an error state. Each
one names the cause and the next action, rather than showing a generic apology.
A state that says what happened and what to do about it is worth more than a
state that is merely attractive.

Contrast is checked in both themes before delivery, against the rows, the queue,
the sheet and the empty states. A side panel is small and often sits next to
other windows, so it has to hold up at a glance.

## Rhythm

The panel is not one repeated unit. The list, the queue, the sheet and the empty
state each compose differently.

The type filter bar is the deliberate break in the list's grid. It reads as a
strip of controls rather than as more content, which is what tells you it can be
used to filter and not just read.

## Motion

Hover, focus and state transitions are a repeated tool's worth of motion, and
that is the limit. Nothing loops, nothing pulses, nothing enters on scroll. A
panel that animates at you while you are trying to read a list of URLs is wrong
however good the animation looks in isolation.

## Decisions and their reasons

| Decision | Reason |
| --- | --- |
| Sheets for preview, settings, and variant choice | The panel is narrow; a sheet keeps the list behind it, which is how Apple HIG handles a detail view over a list. |
| One accent, used on the primary row action | One accent is what makes it an accent. Spreading it across badges, borders and icons removes the focal point. |
| Opaque tonal surfaces everywhere except the sheet | Keeps hierarchy legible; blur on every surface flattens it. |
| Large radii on tabs, badges and primary buttons only | Carries Material 3 Expressive character where shape signals an action or a category, rather than on every element. |
| System font stack | A side panel inherits the user's system font by default and looks native for free. A display face would fight the browser chrome. |
| Filter bar is pills, list rows are not | The control strip reads as controls and the list reads as content. |
| Both themes ship with a toggle | Nothing about this product justifies forcing one. |
| System font, no display face | As above. |
| Character glyphs for the picker and export, no icon font | An icon library would add a dependency to draw three marks. The picker is a circled dot (`◎` armed, `○` idle) because it is a pointer, and export is a brace pair (`{}`) because the output is JSON. Both carry an `aria-label` and a tooltip, so the shape is the fast path rather than the only one. |
| Minimum 44px on anything clickable | A target smaller than a fingertip is a target that misses. Rows stay dense, but every control is a comfortable size. |

Further decisions, each with its context and its alternatives, are in
[`docs/adr/`](adr/). New decisions go in new files rather than as rewrites of
old ones.