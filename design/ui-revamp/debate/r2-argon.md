status SUCCESS | secs 42.086352 | turns 1 | in 19825 out 1696
## Attacks

- **Codex (Sky First Workspace):** Landing on a static image and making a first-time visitor read an instruction and click "Play visits" before anything moves wastes the critical first five seconds; if they miss the button or click a thumbnail once, they see a static noisy grey square and never grasp that the star is moving.
- **Grok (Open on the blink):** Hiding the target switcher behind an underlined title drawer, the wavelength slider behind a "0.85 µm" text button, and "What this can't tell you" inside a collapsed rail turns a two-minute visit into a blind scavenger hunt—a visitor switching to *WISE 0855-0714* has no visible colour slider on screen to discover *why* the coldest brown dwarf only appears at longer wavelengths.
- **Claude Opus (Plate and inspector):** Putting five bare target names ("RW Aurigae", "Epsilon Indi B") in the top bar without their one-line plain-English hooks ("Changes its brightness", "Dim at some colours") forces a non-astronomer to guess what random star names mean, while burying "Colour (µm, detector)" inside a second inspector tab duplicates or competes with the stage colour row.

## What I concede

**Claude Opus** puts the one-sentence observation prompt *directly beneath the sky plate, tight to the transport*, rather than in a separate 380 px left column like my proposal. On a 1440 px screen, my left column still asks the visitor's eyes to ping-pong horizontally between text on the left and the blinking star on the right. I would steal Opus's tight vertical coupling: place the plain-English prompt ("Watch the gold ring: the star steps north to meet it on each date") immediately under the plate so the eye takes in both the motion and its meaning in a single fixation.

## The three directions worth building

1. **The Focused Theater (Centered Single-Column + Sheet Drawers)** — *From Grok & Opus:* Break away completely from the "big sky + side panel" split by centering a single high-craft column: a top target ribbon (with one-line hooks), the dark sky plate, the one-sentence prompt, and a unified time-and-wavelength dock directly underneath, while full prose ("What to look for", "What this can't tell you", and "This frame") slides over the margin on demand or expands below the fold.
2. **The Guided Workbench (Editorial Brief + Stage & Spectrum Dock)** — *From Gemini & Codex:* A two-column laboratory desk where a 340 px left narrative panel keeps the story, motion diagram, and caveats ("What this can't tell you") readable at a glance without clicking, paired with a dominant right-hand sky plate and unified bottom control dock.
3. **The Comparative Filmstrip (Multi-Epoch Storyboard First)** — *New synthesis from Gemini & Codex:* Instead of hiding the visits inside tiny thumbnails below a single viewport, display the visits side-by-side in a horizontal comparison strip above the active Blink/Stack/Subtract plate so visitors immediately understand *before/after* time steps at a glance, then scrub wavelength across all frames simultaneously.

## Motion and loading

- **First load & layout stability:** Reserve exact aspect-ratio boxes (`1:1` sky plate, fixed-height control dock and target cards) using subtle `#EAE8E3` (light) / `#161922` (dark) shimmer-free pulse skeletons; when pixel data arrives, fade the sky plate in over `220 ms` (`cubic-bezier(0.22, 1, 0.36, 1)`) with zero layout shift.
- **Blink vs. manual frame stepping:** Use an **instant hard cut (`0 ms`)** during Blink and frame stepping (`800 ms` cadence). In astronomy, crossfading two noisy infrared frames creates a misleading ghost double-star or fake brightness dip; only the thumbnail highlight and date indicator slide smoothly (`150 ms ease-out`).
- **Wavelength changes (double-buffered):** Never blank the canvas on slider release. Keep the current wavelength frame visible while showing a thin `2 px` top-edge progress line on the plate border; once the new cutout resolves, crossfade old to new over `180 ms ease-out`.
- **Target switching:** Crossfade the narrative text and sky plate simultaneously over `200 ms ease-out` while holding surrounding chrome, dock geometry, and scroll position rock-steady.
- **Drawers & accordions:** Expand and collapse height and opacity over `180 ms` (`cubic-bezier(0.16, 1, 0.3, 1)`), never pushing or resizing the sky canvas.
- **Reduced motion (`prefers-reduced-motion: reduce`):** Disable autoplay blink on load (start paused on the latest frame with a prominent Play button), disable panel height animations in favour of instant state swaps, and replace crossfades with `0 ms` swaps.

## Vote

1. **Gemini (The Guided Exhibit Workbench):** Keeps the five targets' plain-English hooks, the blinking sky, the timeline, and the wavelength ruler all immediately visible and usable on screen without opening drawers.
2. **Claude Opus (Plate and inspector):** Nails the tight vertical pairing of blinking plate, one-line sentence, and timeline, losing points only for stripping the descriptive hooks off the target tabs.
3. **Codex (Sky First Workspace):** Clean hierarchy and honest handling of caveats on screen, but failing to autoplay the blink on load slows down the "aha" moment.
4. **Grok (Open on the blink):** Boldest minimalism, but hiding target selection, the wavelength slider, and key caveats inside drawers makes second-step exploration too opaque for a casual visitor.

