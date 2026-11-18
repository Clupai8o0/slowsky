## Attacks
- **Codex:** The visitor lands on a still dark square and must find "Play visits" before anything changes. Four of the five targets also hide behind "Change target".
- **Gemini:** The instruction sits top-left in a 380 px column, far from the plate on the right. By the time the visitor looks across, they have lost which dot to watch, and that left/right split is the pain the brief names.
- **Grok:** Colour is in a rail drawer, so on Epsilon Indi B ("Dim at some colours") nobody finds the control that explains it. It also shows the saved copy without saying so.

## What I concede
Codex keeps the limitation that matters beside the image, while mine is buried in Guide. I'd steal it as one muted line under the sentence, only where the limit changes the reading (R Draconis: "Centre too bright to measure").

## The three directions worth building
1. **Plate and inspector.** One dark plate already blinking, with the sentence and caveat under it, the colour row beside it and the rest in tabs. *From Opus, Codex, Gemini.*
2. **Guided tour (no side panel).** One centred column where the five targets are chapters, each showing only the control its story needs. "Explore freely" unlocks every tool. *From Grok, Gemini.*
3. **Contact sheet.** Dated frames sit side by side with a shared ring and colours sit in rows, so time and colour become space instead of hidden state. Tap a frame to blink it against the first. *From the filmstrip and Codex.*

## Motion and loading
- **One curve:** `cubic-bezier(0.2,0,0,1)`, at 120 ms for state, 200 ms for panels and fades, 250 ms for target crossfades. No springs.
- **First load:** the skeleton uses the real boxes. The plate is a fixed-aspect tray, already dark. Pixels fade in over 200 ms once both blink frames have decoded.
- **Blink and stepping hard-cut.** A crossfade smears the step and shows the star twice. Each blink frame holds 800 ms; a mode change is a 120 ms fade.
- **Target switch:** sizes stay fixed. The old plate dims to 60% under a 2 px progress line, then the new one crossfades in over 250 ms.
- **Wavelength:** the µm label updates live. The old frame stays while a progress line fills ("3 of 6 frames"), then the new frame fades in over 200 ms. A newer request cancels any older ones.
- **Panels:** height and opacity over 200 ms to open, 150 ms to close. Status lines have their space reserved.
- **Reduced motion:** no autoplay; the latest frame holds with Play showing. Fades only, 100 ms or less. Blink still cuts when the visitor presses Play.
- **Failure:** the last good frame stays with "Couldn't load 2.4 µm. Retry". No spinner over the sky.

## Vote
1. **Opus:** you see motion in 2 s, the instruction sits under the image and colour is in reach.
2. **Gemini:** it opens moving with all targets visible, but the instruction is a column away.
3. **Codex:** honest, but it opens static and hides four of the five targets.
4. **Grok:** the best blink, but colour is buried and the saved copy goes unannounced.
