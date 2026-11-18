## Attacks

- **Gemini:** On a phone, the visitor watches the star blink before reaching the explanation below the dock; the caveat is inside another closed drawer, so they can mistake an approximate position for a precise measurement.
- **Grok:** A visitor wants to know whether they are seeing current observations, but “Saved copy” is deliberately absent and “Go live” is buried inside “This frame”; they cannot discover the distinction without already understanding it.
- **Claude Opus:** At 320 px, a visitor trying to compare visits encounters mode icons instead of Blink / Stack / Subtract labels; they must guess unfamiliar scientific operations on the device where help is least visible.

## What I concede

Gemini makes the next target easier to discover than my hidden catalogue. I would steal its visible target choices, adding short descriptions so unfamiliar star names communicate what visitors can explore.

## The three directions worth building

1. **Observation Desk:** One sky viewer with a short adjacent explanation, visible target choices and a unified control dock keeps exploration immediately available. Takes Codex’s visible caveat and Gemini’s target access; strongest for visitors who want control.

2. **Guided Discovery:** A single-column sequence—“Watch visits,” “Try another infrared colour,” “Explore another target”—introduces one task at a time around the same viewer, with a persistent “All controls” action exposing every feature. Takes Gemini’s narrative guidance and Codex’s explicit invitation to play; strongest for visitors who need a clear next action.

3. **Two Visits, Together:** Two equally sized, dated images show earlier and later visits simultaneously, with one explanation underneath and optional Blink, Stack and Subtract controls; phones stack the images vertically. Takes Grok’s emphasis on the widest date comparison and Claude’s concise caption, but replaces the inspector layout with direct comparison.

All three retain every feature, visible saved/live status and consequential caveats; secondary details remain expandable.

## Motion and loading

- **First load:** Reserve the sky’s aspect ratio and control dimensions; use static, layout-shaped skeletons, then fade decoded pixels in over 200 ms, ease-out.
- **Target switch:** Keep the layout fixed; retain the previous observation with its old labels until ready, then crossfade the complete observation over 200 ms. Synchronize the new title, dates and rings.
- **Blink and stepping:** Preload frames and use instant cuts; blending would introduce intermediate positions or brightness. Update dates and overlays atomically with pixels.
- **Wavelength:** Keep the old frame and displayed wavelength together; show the requested wavelength with “Loading…” beside the slider, then fade in the ready observation over 180 ms. Only the latest request may appear.
- **Panels:** Animate height and opacity over 180–220 ms, ease-out; preserve focus and return it to the trigger on close.
- **Failure:** Keep the last valid observation labelled accurately; replace loading feedback with a concise error and Retry.
- **Reduced motion:** No autoplay, shimmer or slides; use instant swaps and panel changes. Announce completed user requests, never every playback frame.

## Vote

1. **Codex:** Visible instruction, caveat and labelled controls best support an unfamiliar visitor.
2. **Gemini:** Discoverable targets and a unified dock help, but essential context is less visible on phones.
3. **Claude Opus:** Compact exploration works until hidden caveats and mobile icons demand interpretation.
4. **Grok:** Hiding status and guidance removes information visitors need to understand what they see.
