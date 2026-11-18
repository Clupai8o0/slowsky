status SUCCESS | secs 31.731374 | turns 1 | in 17011 out 1657
## Name
The Guided Exhibit Workbench

## Core idea
Replace the three-column cockpit of simultaneous telemetry with a two-column editorial workbench where the narrative brief sits beside a framed sky canvas and a single unified timeline-and-spectrum dock.

## First 10 seconds
1. **0–3s:** The visitor lands on a warm paper-white workspace. Top-left shows the active target ("Barnard's Star — Moves fastest across our sky") next to a bold one-sentence prompt: *"Watch the bright core step north between gold rings from Aug 2025 to Aug 2026."*
2. **3–6s:** Their eye goes straight to the dark SPHEREx cutout on the right, already blinking smoothly with a synchronized highlight stepping across the three dated thumbnails directly beneath it.
3. **6–10s:** They click another square target tab in the top bar (e.g., *WISE 0855-0714*) or drag the infrared ruler under the image to see the star appear and vanish across wavelengths.

## Desktop layout
- **Top header bar (full width, 56 px):** Logo, horizontal target switcher (5 square-cornered cards with bottom-border active indicator + inline search input), and right-aligned utility actions (`Go live`, `Copy link`, theme toggle).
- **Left narrative column (380 px):** Target title, plain-English "What to look for" story, sky/motion mini-diagrams, and collapsible drawers for *Caveats ("What this can't tell you")* and *Frame telemetry & FITS*.
- **Right stage (remaining width):** The framed square sky cutout centered above a unified **Time & Colour Dock** holding playback/mode controls, the dated thumbnail filmstrip, and the 0.75–5 µm infrared slider.

## Phone layout
Single viewport-First flow: compact target dropdown bar at top, full-width square sky canvas Second, compact Time & Colour Dock Third (all above the fold at 390 px), followed by the "What to look for" story and collapsed technical drawers below.

## What you hide or cut
- **Cut:** The "01 / 02 / 03" step numbers and the permanent right-hand metadata table.
- **Hidden behind progressive disclosure:** *This frame* telemetry (detector, release, pixel scale, FITS download) and *Candidate changes* move into closed-by-default accordion drawers at the bottom of the left column. *Flagged pixels*, *False colour*, *Older picture*, and *Field size* move into a single square `Layers & Field ▾` popover in the canvas corner.

## Controls
- **No pills anywhere:** 2 px radius buttons and 1 px structural borders.
- **Mode & stepping:** A square 3-way segmented bar (`Blink | Stack | Subtract`) sits beside square `[ < ] [ ⏸ ] [ > ]` buttons and the 3 thumbnail frames.
- **Overlays:** The two essential guides (*Expected position ring* and *Gaia stars*) stay as square checkboxes in the canvas footer; diagnostic layers live in the `Layers & Field ▾` menu.
- **Colour:** A full-width horizontal ruler below the filmstrip with a visible "Human eye limit (0.70 µm)" tick mark and square drag handle.

## Light and dark
In light mode (`#F8F7F4` surface, `#141413` ink), the dark SPHEREx cutout sits inside a crisp 1 px `#D6D3CD` gallery mat with a `#0D0F14` inner bezel—treating the dark sky like an archival photographic plate on a bright laboratory desk. Dark mode (`#0B0D12` surface) inverts the desk while keeping the plate identical.

## Riskiest assumption
Moving the wavelength slider from its own dedicated right-hand column into the bottom stage dock assumes visitors treat infrared colour as a secondary lens on the image rather than a primary story panel.

