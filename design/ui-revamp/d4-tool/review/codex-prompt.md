Review a UI change in a static browser mockup (plain JS, no build, opened from file://). You are in its folder, read-only.
Report findings only: real bugs with a concrete input or click sequence that breaks, ranked worst first. No style notes, no praise.

What changed (diff of edited files is at /tmp/d4review/d4-ui.diff; new files are guide.js, guide.css, panels.js, panels.css, paneldata.js, cometdata.js):
- Undo / redo (app.js: viewSnapshot, sameStep, noteStep, commitStep, undoStep, redoStep, applyStep, forgetMineSteps; keys Cmd/Ctrl+Z, Shift+Cmd+Z, Ctrl+Y). Snapshots are debounced 450 ms, max 60. switchTarget now returns a Promise.
- Loading marks inside the picture frame (#stage-load) and on the control being changed (.is-busy): beginBusy, setBusyText, endBusy, withBusy; first-load animation (body.booting -> booted, finishBooting).
- New features: layer toggles (honest "mockup" notes), field-of-view select, A + B (engine render mode 'sum'), Save picture (A, B, B - A PNG), Focus mode, Guide dialog (guide.js) with a tour, inspector Charts and Extras tabs (panels.js), labels on by default (saved in localStorage), tour scrolls targets into view on phones.

Look hardest for:
1. Undo/redo: states that restore wrong (target + date + mode + A/B + zoom), steps lost or duplicated, races with the async target switch, undo while a switch or upload is in flight, history after uploading new frames.
2. Busy marks that never end (a code path that returns or throws before endBusy), or overlap wrongly.
3. Anything that throws in the console, or a control that does nothing.
4. Keyboard shortcuts firing while typing in an input or while the Guide dialog is open.
5. Accessibility breakage: focus lost after closing the guide or tour, aria state out of sync.
Give file:line and the exact steps for each finding.
