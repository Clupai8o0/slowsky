// Roadmap data from BUILD-PLAN.md (spaceapps-melbourne-2026, 14 Nov 2026) and VIDEO-PLAN.md.
// Times are Nepal time (NPT, UTC+05:45). Re-seeding keeps each item's status and progress.

const DAY = { Sat: '2026-11-14', Sun: '2026-11-15' };

function t(day, hm)
{
    return `${DAY[day]}T${hm}:00+05:45`;
}

let order = 0;

function add(list, fields)
{
    order += 10;
    list.push({ sort: order, status: 'todo', progress: 0, ...fields });
}

export const items = [];
const I = (fields) => add(items, fields);

// Versions
I({ id: 'v01', kind: 'version', version: 'v0.1', tier: 'core', title: 'v0.1 Blink anywhere', due_at: t('Sat', '15:15'),
    detail: 'Type RA/Dec or a name and get a short video of real frames at one wavelength. 5 target buttons, a shareable URL, a FOV choice, frame details. First Submit by 16:00 with a 3-slide interim deck.' });
I({ id: 'v02', kind: 'version', version: 'v0.2', tier: 'core', title: 'v0.2 See the change', due_at: t('Sat', '21:00'),
    detail: 'Stacks per detector, A+B and B−A, Gaia rings, RW Aur light curve, honest target cards, offline fallback. Demo recorded; resubmit by 23:30. 21:00 rule: whatever is not green moves to Sunday.' });
I({ id: 'v03', kind: 'version', version: 'v0.3', tier: 'core', title: 'v0.3 Read the light', due_at: t('Sun', '09:00'),
    detail: 'At most 3 overnight branches that passed their gates: flags, spectrum anywhere, rainbow scrub (false colour, R Dra halo or 2MASS replace a failed one). Planet X chart goes on the page. Feature freeze at 09:00.' });
I({ id: 'v04', kind: 'version', version: 'v0.4', tier: 'if-ahead', title: 'v0.4 Stretch', due_at: t('Sun', '09:00'),
    detail: 'Dropped unless all green at 09:00.' });
I({ id: 'v10', kind: 'version', version: 'v1.0', tier: 'core', title: 'v1.0 Submitted', due_at: t('Sun', '12:30'),
    detail: 'Final demo, full project page, code tagged and frozen. Last Submit by 12:30 NPT; 13:00 is the hard stop.' });

// v0.1 features
I({ id: 'f-input', kind: 'feature', version: 'v0.1', tier: 'core', owner: 'Haiku 5.5', title: 'Coordinate and name input',
    detail: 'Decimal or sexagesimal; names from the CfA SIMBAD mirror.' });
I({ id: 'f-sia', kind: 'feature', version: 'v0.1', tier: 'core', owner: 'Codex Terra', title: 'Live frame lookup (SIA passthrough)',
    detail: 'One allowlisted /api/sia function, DR1 + QR3 only, QR2 refused. ACAO *, explicit cache code.' });
I({ id: 'f-s3', kind: 'feature', version: 'v0.1', tier: 'core', owner: 'Codex Sol', title: 'S3 range reader',
    detail: 'Reads only the needed rows; header length and WCS-WAVE grid read from each file.',
    gate: 'Cutout sum matches astropy to 1e-3; a bad range aborts.' });
I({ id: 'f-wcs', kind: 'feature', version: 'v0.1', tier: 'core', owner: 'Sonnet 5.5', title: 'TAN-SIP WCS + north-up regrid',
    detail: 'Stars stay still across frames and the 180° flip between seasons; 1 SPHEREx px ≥ 8 screen px.',
    gate: 'Within 0.01 px of astropy at 9 points, both ways. Field stars within 0.3 px across epochs.' });
I({ id: 'f-wavelock', kind: 'feature', version: 'v0.1', tier: 'core', owner: 'Sonnet 5.5', title: 'Wavelength lock',
    detail: 'One detector; per visit, the frame nearest a chosen wavelength; Δλ shown. Stops colour posing as brightness.' });
I({ id: 'f-blink', kind: 'feature', version: 'v0.1', tier: 'core', owner: 'Opus', title: 'Blink player',
    detail: 'Canvas 2D, shared stretch, step, speed cap, pause on load.' });
I({ id: 'f-landing', kind: 'feature', version: 'v0.1', tier: 'core', owner: 'Opus', title: 'Landing preset',
    detail: 'Bare URL opens RW Aur with a big Play button and a one-line hint.' });
I({ id: 'f-fov', kind: 'feature', version: 'v0.1', tier: 'core', owner: 'Opus', title: 'FOV picker with download size',
    detail: '0.1 to 1°, size shown before loading. Default 0.15°.' });
I({ id: 'f-targets', kind: 'feature', version: 'v0.1', tier: 'core', owner: 'Opus', title: '5 official targets, one click',
    detail: 'Positions moved to each frame\'s date by proper motion.' });
I({ id: 'f-url', kind: 'feature', version: 'v0.1', tier: 'core', owner: 'Opus', title: 'URL state',
    detail: 'Every view is a link to send a friend or a class.' });
I({ id: 'f-details', kind: 'feature', version: 'v0.1', tier: 'core', owner: 'Opus', title: 'Frame details panel',
    detail: 'Date, release, detector, wavelength, pipeline version, S3 link.' });
I({ id: 'f-credits', kind: 'feature', version: 'v0.1', tier: 'core', owner: 'Opus', title: 'Credits, references, AI page',
    detail: 'Kept from hour one. Names every AI tool (Claude, Codex, ElevenLabs, GPT Image).' });
I({ id: 'f-bake', kind: 'feature', version: 'v0.1', tier: 'core', owner: 'Codex Terra', title: 'Snapshot bake script',
    detail: 'Frame lists, raw cutouts, Gaia rows for the 5 targets; the browser stacks them with its live code. Works until 26 Jan.' });

// v0.2 features
I({ id: 'f-stack', kind: 'feature', version: 'v0.2', tier: 'core', owner: 'Sonnet 5.5', title: 'Stack per detector, per visit',
    detail: 'Background off, 4σ clip, refuses to mix pipeline versions.' });
I({ id: 'f-addsub', kind: 'feature', version: 'v0.2', tier: 'core', owner: 'Opus', title: 'Add and subtract visits',
    detail: 'A+B, B−A on a colour-blind-safe diverging colour map.' });
I({ id: 'f-gaia', kind: 'feature', version: 'v0.2', tier: 'core', owner: 'Opus', title: 'Gaia rings that move',
    detail: 'STScI cone, CfA VizieR fallback; measured-vs-predicted readout on Barnard\'s Star.' });
I({ id: 'f-rwaur', kind: 'feature', version: 'v0.2', tier: 'core', owner: 'Sonnet 5.5', title: 'RW Aur light curve',
    detail: 'D1, frames within about 0.02 µm, ratio to field stars.' });
I({ id: 'f-cards', kind: 'feature', version: 'v0.2', tier: 'core', owner: 'Opus', title: 'Honest target cards',
    detail: 'What to look at and what it does NOT show. Every number comes from event-built code or the bake.' });
I({ id: 'f-fallback', kind: 'feature', version: 'v0.2', tier: 'core', owner: 'Opus', title: 'Fallback switch + status strip',
    detail: 'Baked snapshot when IRSA or S3 is down.', gate: 'Playwright with S3 and the API blocked still shows all 5 targets.' });
I({ id: 'f-phone', kind: 'feature', version: 'v0.2', tier: 'core', owner: 'Opus', title: 'Phone layout + web manifest',
    detail: 'Responsive; "Add to Home Screen" works. No service worker, no native app. Real-phone check Sunday 10:00–11:30.' });

// v0.3 features (overnight branches)
I({ id: 'f-flags', kind: 'feature', version: 'v0.3', tier: 'weekend', owner: 'Codex Sol', title: 'Contamination flags (own RICE_1 decoder)',
    detail: 'Overnight branch 1.', gate: 'Bit-exact against astropy.' });
I({ id: 'f-spectrum', kind: 'feature', version: 'v0.3', tier: 'weekend', owner: 'Codex Sol + Opus', title: 'Spectrum: baked Eps Ind B + spectrum anywhere',
    detail: 'Overnight branch 2. Click any spot: a quick-look 0.75–5 µm spectrum from the DR1 all-sky cube on S3, main lines marked. Caption: "quick look, one-year average, not for measurement".',
    gate: 'Offline on ranges saved Saturday: JS cube reader matches astropy at 3 spots; wavelengths within 0.001 µm; a non-206 reply aborts. Sun 06:30 live: one spectrum in under 10 s.' });
I({ id: 'f-rainbow', kind: 'feature', version: 'v0.3', tier: 'weekend', owner: 'Codex Terra + Opus', title: 'Rainbow scrub',
    detail: 'Overnight branch 3. One slider sweeps the same patch of sky through 102 colours. Baked for the 5 targets.',
    gate: 'Offline Playwright: every plane of the Eps Ind B strip loads; wavelengths match; total bake under 6 MB.' });
I({ id: 'f-planetx', kind: 'feature', version: 'v0.3', tier: 'weekend', owner: 'Opus', title: 'Planet X depth chart (page SVG)',
    detail: 'Why SPHEREx can\'t see a Planet Nine: predicted brightness against SPHEREx limits, targets as dots. Every number cited. No merge slot needed.',
    gate: 'Unit test on the brightness model against a cited fixture; chart text has "estimate" and no "discover".' });
I({ id: 'f-falsecolour', kind: 'feature', version: 'v0.3', tier: 'weekend', owner: 'Opus', title: 'Spare: false colour by detector',
    detail: 'Replaces a failed branch. D2 blue, D6 red.', gate: 'D2 and D6 centroids at WISE 0855 differ by 4″ or more (May 2025).' });
I({ id: 'f-rdra', kind: 'feature', version: 'v0.3', tier: 'weekend', owner: 'Sonnet 5.5', title: 'Spare: R Dra halo light curve',
    detail: 'Replaces a failed branch. Ring around the saturated core.', gate: 'Ring flux rises 3–5× over Jul–Aug 2026.' });
I({ id: 'f-2mass', kind: 'feature', version: 'v0.3', tier: 'weekend', owner: 'Codex Terra', title: 'Spare: 2000 to 2026 epoch (2MASS)',
    detail: 'Replaces a failed branch. Baked 2MASS frame (28 May 2000) for Barnard\'s Star. Matches a pre-kick-off idea list: keep only as Sam\'s own logged choice.',
    gate: 'Barnard shift 43–44 px.' });

// v0.4 stretch (only if ahead)
I({ id: 'f-comet', kind: 'feature', version: 'v0.4', tier: 'if-ahead', owner: 'Codex Terra + Opus', title: 'Comet 3I/ATLAS in CO₂ card',
    detail: 'A sixth card: the interstellar comet\'s coma blooms at 4.25 µm. Credit the published SPHEREx result; the change is colour, not time.' });
I({ id: 'f-uptonight', kind: 'feature', version: 'v0.4', tier: 'if-ahead', owner: 'Codex Terra', title: 'Up tonight',
    detail: 'Each card says if that spot is above your horizon tonight (Melbourne by default). Never "visible in a telescope"; store no location.' });
I({ id: 'f-a11y', kind: 'feature', version: 'v0.4', tier: 'if-ahead', owner: 'Opus', title: 'Accessible touch player',
    detail: 'Arrow keys, swipe, hold to compare, screen-reader frame text. Saturday v0.2 lane only, if the player is green by 19:00.' });
I({ id: 'f-share', kind: 'feature', version: 'v0.4', tier: 'if-ahead', owner: 'Codex Terra', title: 'PNG share card',
    detail: 'Share sheet gets the link plus a PNG of A, B and B−A with the credit drawn on. Last in the queue.' });
I({ id: 'f-dss', kind: 'feature', version: 'v0.4', tier: 'if-ahead', owner: 'Opus', title: 'DSS 1950s plates',
    detail: 'Off unless the Local Lead and the GO Team clear CC BY-NC-SA in writing.' });
I({ id: 'f-misc', kind: 'feature', version: 'v0.4', tier: 'if-ahead', owner: 'Opus', title: 'Small extras',
    detail: '12-month pair button, freshness badge, Themis, shift-and-stack, embed.' });

// v1.0 deliverables
I({ id: 'f-demo', kind: 'feature', version: 'v1.0', tier: 'core', owner: 'Session -00 + Sam', title: '30 s demo video',
    detail: 'ElevenLabs paid Starter voice ("Team Clupai, from Melbourne."), original music, English captions, real SPHEREx only. ≤ 30.0 s (ffprobe). AI voice named in description and MP4 metadata.' });
I({ id: 'f-page', kind: 'feature', version: 'v1.0', tier: 'core', owner: 'Opus + Sam', title: 'Project page: Summary + Details',
    detail: 'Open on Best Use of Data. Headings: What it does; How it works; Who it helps; What is new; Design choices; How we checked it; Limits; Tools; AI tools used.' });
I({ id: 'f-readme', kind: 'feature', version: 'v1.0', tier: 'core', owner: 'Opus', title: 'README, licences, AI notes',
    detail: '"Build began 14 Nov after kick-off", run steps, release recipe, credits, DATA-LICENSES (Gaia CC BY-NC 3.0 IGO), AI note in package.json and the snapshot folder.' });
I({ id: 'f-images', kind: 'feature', version: 'v1.0', tier: 'core', owner: 'Session -00', title: 'GPT Image decoration (landing, onboarding)',
    detail: 'Decoration only, never styled like sky data, never over the real player. "AI-generated image" burned in. No NASA logos.' });

// Beyond v1 roadmap (project page "What's next")
I({ id: 'r-colour', kind: 'idea', version: 'beyond', tier: 'roadmap', title: 'Colour screen for cold brown dwarfs',
    detail: 'Candidates for follow-up, never discoveries. Demo future beat.' });
I({ id: 'r-deepfield', kind: 'idea', version: 'beyond', tier: 'roadmap', title: 'Deep-field heartbeat',
    detail: 'Variable-star periods from the north ecliptic pole deep field, folded and played as sound.' });
I({ id: 'r-ice', kind: 'idea', version: 'beyond', tier: 'roadmap', title: 'Ice absorption map in dark clouds',
    detail: 'Water and CO₂ ice absorption at background stars. An index, not an abundance.' });
I({ id: 'r-classroom', kind: 'idea', version: 'beyond', tier: 'roadmap', title: 'Classroom "predict then reveal" links',
    detail: 'Students guess where Barnard\'s Star moves, then reveal the real blink.' });
I({ id: 'r-isitnew', kind: 'idea', version: 'beyond', tier: 'roadmap', title: '"Is it new?" checklist',
    detail: 'Fixed checks (in Gaia? flagged? seen twice? same detector?) before anyone calls a spot interesting.' });
I({ id: 'r-pointer', kind: 'idea', version: 'beyond', tier: 'roadmap', title: 'Phone sky pointer, then a wrapped app',
    detail: 'Rough-aim only (compass error 5–20°).' });
I({ id: 'r-clubs', kind: 'idea', version: 'beyond', tier: 'roadmap', title: 'Southern clubs\' sky pack',
    detail: 'Printable "what changed" pages from each new release. Name no club before asking it.' });

// Timeline blocks (lanes: sam, build, lanes, demo, overnight, rest)
I({ id: 't-plan', kind: 'block', lane: 'build', owner: 'Claude', title: 'Build plan, beyond-v1 judging, names',
    start_at: t('Sat', '04:00'), due_at: t('Sat', '07:15'), status: 'done', progress: 100,
    detail: 'BUILD-PLAN.md written after kick-off; 3-lens review; beyond-v1 tiers; name shortlist.' });
I({ id: 't-admin', kind: 'block', lane: 'sam', owner: 'Sam', title: 'Concept, name, repo, hosting, Local Lead email',
    start_at: t('Sat', '07:15'), due_at: t('Sat', '07:45') });
I({ id: 't-scaffold', kind: 'block', lane: 'build', owner: 'Opus', title: 'Scaffold + hello deploy; fresh fixtures',
    start_at: t('Sat', '07:45'), due_at: t('Sat', '08:30') });
I({ id: 't-l-s3', kind: 'block', lane: 'lanes', owner: 'Codex Sol', title: 'Lane: S3 reader', start_at: t('Sat', '08:30'), due_at: t('Sat', '12:00') });
I({ id: 't-l-sia', kind: 'block', lane: 'lanes', owner: 'Codex Terra', title: 'Lane: SIA function', start_at: t('Sat', '08:30'), due_at: t('Sat', '12:00') });
I({ id: 't-l-bake', kind: 'block', lane: 'lanes', owner: 'Codex Terra', title: 'Lane: snapshot bake', start_at: t('Sat', '08:30'), due_at: t('Sat', '12:00') });
I({ id: 't-l-wcs', kind: 'block', lane: 'lanes', owner: 'Sonnet 5.5', title: 'Lane: WCS maths', start_at: t('Sat', '08:30'), due_at: t('Sat', '12:00') });
I({ id: 't-l-parsers', kind: 'block', lane: 'lanes', owner: 'Haiku 5.5', title: 'Lane: parsers', start_at: t('Sat', '08:30'), due_at: t('Sat', '12:00') });
I({ id: 't-l-ui', kind: 'block', lane: 'lanes', owner: 'Opus', title: 'Lane: UI shell + landing', start_at: t('Sat', '08:30'), due_at: t('Sat', '12:00') });
I({ id: 't-lunch', kind: 'block', lane: 'rest', title: 'Lunch', start_at: t('Sat', '12:00'), due_at: t('Sat', '12:30') });
I({ id: 't-join', kind: 'block', lane: 'build', owner: 'Opus', title: 'Regrid + wavelength lock + blink joined; target buttons',
    start_at: t('Sat', '12:30'), due_at: t('Sat', '14:30') });
I({ id: 't-v01', kind: 'block', lane: 'build', owner: 'Opus', title: 'v0.1 deploy, smoke tests, Codex review, tag',
    start_at: t('Sat', '14:30'), due_at: t('Sat', '15:15'), detail: 'Also the FortiGuard request (Sam).' });
I({ id: 't-deck', kind: 'block', lane: 'sam', owner: 'Sam', title: 'Interim deck, required fields, first Submit',
    start_at: t('Sat', '15:15'), due_at: t('Sat', '16:00') });
I({ id: 't-v02build', kind: 'block', lane: 'build', owner: 'Opus', title: 'v0.2 build (dinner inside)',
    start_at: t('Sat', '16:00'), due_at: t('Sat', '21:00') });
I({ id: 't-bakes', kind: 'block', lane: 'lanes', owner: 'Codex Terra', title: 'Background downloads and bakes',
    start_at: t('Sat', '18:00'), due_at: t('Sat', '21:00'),
    detail: '2MASS frame, Eps Ind B frames, cube byte ranges + astropy values, rainbow strips. Overnight work stays offline.' });
I({ id: 't-v02', kind: 'block', lane: 'build', owner: 'Opus', title: 'v0.2 deploy, Codex review, tag; quota probe',
    start_at: t('Sat', '21:00'), due_at: t('Sat', '21:30') });
I({ id: 't-sam-demo', kind: 'block', lane: 'sam', owner: 'Sam', title: 'Voice-over, Details, resubmit',
    start_at: t('Sat', '21:30'), due_at: t('Sat', '23:30') });
I({ id: 't-night-start', kind: 'block', lane: 'overnight', owner: 'Sam', title: 'Start the Fable orchestrator',
    start_at: t('Sat', '23:30'), due_at: t('Sun', '00:00'), detail: 'MonoCode session on Fable, calling Opus and Codex. caffeinate -dims, at most 3 worktrees.' });
I({ id: 't-overnight', kind: 'block', lane: 'overnight', owner: 'Fable orchestrator', title: 'Overnight branches',
    start_at: t('Sun', '00:00'), due_at: t('Sun', '05:30'),
    detail: 'Queue: flags + RICE, spectrum, rainbow scrub, Planet X chart; spares replace a failed one. No deploys, no merges. Stop at 05:30 or after 3 failed fix rounds.' });
I({ id: 't-sleep', kind: 'block', lane: 'rest', title: 'Sleep', start_at: t('Sun', '00:00'), due_at: t('Sun', '06:00') });
I({ id: 't-morning', kind: 'block', lane: 'sam', owner: 'Sam', title: 'Read results, Local Lead reply, Connect',
    start_at: t('Sun', '06:00'), due_at: t('Sun', '06:30') });
I({ id: 't-merge', kind: 'block', lane: 'build', owner: 'Opus', title: 'Merge ≤ 3 green branches; v0.3 deploy',
    start_at: t('Sun', '06:30'), due_at: t('Sun', '09:00') });
I({ id: 't-review', kind: 'block', lane: 'build', owner: 'Codex', title: 'Codex high-effort review',
    start_at: t('Sun', '09:00'), due_at: t('Sun', '10:00') });
I({ id: 't-fix', kind: 'block', lane: 'build', owner: 'Opus', title: 'Fixes; 3 browsers + a phone; licences; README',
    start_at: t('Sun', '10:00'), due_at: t('Sun', '11:30') });
I({ id: 't-checks', kind: 'block', lane: 'sam', owner: 'Sam', title: 'Logged-out checks, second network',
    start_at: t('Sun', '11:30'), due_at: t('Sun', '12:00') });
I({ id: 't-submit', kind: 'block', lane: 'sam', owner: 'Sam', title: 'Last Submit; Submitted banner; tag',
    start_at: t('Sun', '12:00'), due_at: t('Sun', '12:30') });
I({ id: 't-buffer', kind: 'block', lane: 'rest', title: 'Buffer, then travel', start_at: t('Sun', '12:30'), due_at: t('Sun', '13:00') });
I({ id: 't-vid-skel', kind: 'block', lane: 'demo', owner: 'Session -00', title: 'Video skeleton (Remotion)',
    start_at: t('Sat', '09:00'), due_at: t('Sat', '11:00') });
I({ id: 't-vid-rough', kind: 'block', lane: 'demo', owner: 'Session -00', title: 'Rough cut on v0.1',
    start_at: t('Sat', '15:30'), due_at: t('Sat', '16:30') });
I({ id: 't-vid-final', kind: 'block', lane: 'demo', owner: 'Session -00 + Sam', title: 'Final captures, ElevenLabs voice, render',
    start_at: t('Sat', '21:30'), due_at: t('Sat', '22:45') });
I({ id: 't-vid-upload', kind: 'block', lane: 'demo', owner: 'Sam', title: 'Upload; logged-out check',
    start_at: t('Sat', '22:45'), due_at: t('Sat', '23:15') });
I({ id: 't-vid-recut', kind: 'block', lane: 'demo', owner: 'Session -00', title: 'Re-cut middle (only if v0.3 adds a visible thing)',
    start_at: t('Sun', '09:00'), due_at: t('Sun', '10:00') });

// Milestones
I({ id: 'm-baked', kind: 'milestone', lane: 'build', title: 'Baked-frames check', due_at: t('Sat', '12:00'),
    detail: 'If no real frame has rendered from S3, v0.1 uses baked frames for the 5 targets.' });
I({ id: 'm-submit1', kind: 'milestone', lane: 'sam', title: 'First Submit (v0.1)', due_at: t('Sat', '16:00') });
I({ id: 'm-2100', kind: 'milestone', lane: 'build', title: '21:00 rule', due_at: t('Sat', '21:00'),
    detail: 'Whatever is not green moves to Sunday; the demo and form start on what v0.2 has.' });
I({ id: 'm-resubmit', kind: 'milestone', lane: 'sam', title: 'Resubmit (v0.2 + video)', due_at: t('Sat', '23:30') });
I({ id: 'm-freeze', kind: 'milestone', lane: 'build', title: 'Feature freeze', due_at: t('Sun', '09:00') });
I({ id: 'm-nodeploy', kind: 'milestone', lane: 'build', title: 'No deploys after this', due_at: t('Sun', '11:30'),
    detail: 'Except blocker fixes.' });
I({ id: 'm-last', kind: 'milestone', lane: 'sam', title: 'Last Submit', due_at: t('Sun', '12:30') });
I({ id: 'm-stop', kind: 'milestone', lane: 'rest', title: 'Hard stop', due_at: t('Sun', '13:00'),
    detail: 'No fixes are possible after 13:00 NPT (18:15 AEDT).' });

// Sam's own steps (same as the side checklist)
const steps = [
    ['Read BUILD-PLAN.md (start with "Sam first")', 'Sat', '07:30'],
    ['Write concept + feature cut in own words in DECISIONS.md', 'Sat', '07:45'],
    ['Pick a name', 'Sat', '07:45'],
    ['Create new public GitHub repo (MIT for code)', 'Sat', '07:45'],
    ['Make or confirm Vercel account', 'Sat', '07:45'],
    ['Email the Local Lead: DSS, prep note, judging format, offline Sun 18:15 AEDT', 'Sat', '08:00'],
    ['FortiGuard request', 'Sat', '15:30'],
    ['3-slide interim deck + all required fields', 'Sat', '15:45'],
    ['First Submit (v0.1)', 'Sat', '16:00'],
    ['Watch two 2025 winner demos', 'Sat', '21:00'],
    ['ElevenLabs voice-over; check plan\'s credit terms', 'Sat', '22:30'],
    ['Note AI voice in video description + file metadata', 'Sat', '23:15'],
    ['Name AI tools (incl. ElevenLabs, GPT Image); tick SI incl. Ideation', 'Sat', '23:15'],
    ['Resubmit (v0.2 + video)', 'Sat', '23:30'],
    ['Start the MonoCode Fable orchestrator; Mac on and plugged in', 'Sat', '23:45'],
    ['Check Connect + Local Lead reply', 'Sun', '06:30'],
    ['Logged-out link checks from a second network', 'Sun', '12:00'],
    ['Last Submit; check the Submitted banner', 'Sun', '12:30'],
];
steps.forEach(([title, day, hm], i) => {
    const n = String(i + 1).padStart(2, '0');
    I({ id: `s-${n}`, kind: 'step', lane: 'sam', owner: 'Sam', title, due_at: t(day, hm) });
});
const named = items.find((item) => item.id === 's-03');
named.title = 'Pick a name: Slowsky';
named.status = 'done';
named.progress = 100;

// First log lines, written only when the log is empty.
export const updates = [
    { item_id: 't-plan', author: 'claude-1d', status: 'done', progress: 100, at: t('Sat', '07:15'),
      note: 'BUILD-PLAN.md written and revised for the real cutoff (last Submit Sun 12:30 NPT). Beyond-v1 tiers, phone verdict and name shortlist added.' },
    { item_id: 's-03', author: 'Sam', status: 'done', progress: 100, at: t('Sat', '07:20'),
      note: 'Name picked: Slowsky.' },
];
