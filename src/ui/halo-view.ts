// "Halo over time": for a target whose card says its centre is too bright to measure (R Draconis), the light in a
// ring around the blank centre, look by look, against steady Gaia stars (src/lib/halo.ts). It says what was
// measured, never that the star changed. Only looks the module marks valid are used; each look's caveats are shown
// as text. A line needs MIN_VISITS visits in one narrow colour window; otherwise a table. Which targets get it is decided by the
// card (kind 'saturated'), never by finding a blank centre: Barnard's Star's centre is often blank too.
import { HaloError, haloCurve, ringFor, type HaloCurve } from '../lib/halo';
import type { SkyResult } from '../lib/source';
import type { PixelCoord, RegriddedFrame } from '../lib/types';
import { apertureFor, frameMjd, lockedFrames, middleMjd, pickRefs, steadyRefs, trackNear } from './measure';

// Stand-ins for the module in tests.
export interface HaloDeps {
    curve?: typeof haloCurve;
    ring?: typeof ringFor;
}

export interface HaloPoint {
    mjd: number;
    k: number; // index in result.frames
    lambda: number; // µm this look was measured at
    relative: number; // ring light over the comparison stars, divided by its median over the looks
    err: number; // the module's relativeNoise, same units
}

export interface HaloView {
    kind: 'curve' | 'table' | 'none' | 'nofit';
    lambda: number;
    ringIn: number; // arcsec from the centre
    ringOut: number;
    refs: number;
    points: HaloPoint[]; // looks drawn, by date
    looks: number; // looks measured at this colour
    dropped: number; // frames too far off this colour
    caveats: { text: string; mjds: number[] }[];
    ringStars: number[]; // Gaia G of catalogued stars in or at the edge of the ring, brightest first
}

// A line is drawn only from looks on at least MIN_VISITS visits, all within CURVE_WIDTH_UM of colour. Otherwise
// the readings go in a table. Two points always make a line that looks like a trend. On real R Draconis frames,
// same-date looks about 0.02 µm apart disagreed by up to 5.9 error bars while an ordinary star on the same frames
// agreed, so looks at different colours are not put on one line (probe, 14 Nov). No wider window is validated.
export const MIN_VISITS = 3;
export const CURVE_WIDTH_UM = 0.005;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

function date(mjd: number, withDay: boolean): string
{
    const d = new Date((mjd - 40587) * 86400000);
    return `${withDay ? `${d.getUTCDate()} ` : ''}${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// Null when there is nothing to say: no track, too few frames or comparison stars, or the module cannot measure
// this view for a reason other than the ring not fitting. The caller decides whether the target gets a panel.
export function haloFor(result: SkyResult, deps: HaloDeps = {}): HaloView | null
{
    const track = result.track;
    if (!track?.length || result.frames.length < 2) {
        return null;
    }
    const mid = middleMjd(result);
    const centre = trackNear(track, mid);
    if (!centre) {
        return null;
    }
    const refs = pickRefs(result, centre.pix, mid);
    if (refs.length < 2) {
        return null;
    }
    // The catalogue position moved to each look's date; the module adds its uncertainty to the error bar.
    const at = (f: RegriddedFrame): PixelCoord => trackNear(track, frameMjd(f))?.pix ?? { x: NaN, y: NaN };
    const { frames, maxDeltaUm } = lockedFrames(result);
    const wl = { lambda: result.lambda, maxDeltaUm };
    const px = result.grid.pixelArcsec;
    const base = { lambda: result.lambda, ringIn: NaN, ringOut: NaN, refs: refs.length, points: [], looks: 0, dropped: 0, caveats: [], ringStars: [] };
    let ring: { ringIn: number; ringOut: number };
    try {
        ring = (deps.ring ?? ringFor)(frames, (f) => at(f), wl);
    } catch (e) {
        if (e instanceof HaloError) {
            return /does not fit/i.test(e.message) ? { kind: 'nofit', ...base } : null;
        }
        throw e;
    }
    // A comparison star's own sky ring must sit outside the halo ring, or the halo light leaks into the reference.
    const { annulusOut } = apertureFor(result.grid);
    const clear = refs.filter((r) => Math.hypot(r.pix.x - centre.pix.x, r.pix.y - centre.pix.y) > ring.ringOut + annulusOut);
    if (clear.length < 2) {
        return null;
    }
    const curve = deps.curve ?? haloCurve;
    let order: number[] = []; // the module asks for the target once per kept frame, in point order
    let lc: HaloCurve;
    try {
        lc = steadyRefs(clear, (pix) => {
            order = [];
            return curve(frames, (f, i) => {
                order.push(i);
                return at(f);
            }, pix, { ...apertureFor(result.grid), ...ring, ...wl });
        });
    } catch (e) {
        if (e instanceof HaloError) {
            return null;
        }
        throw e;
    }
    const points: HaloPoint[] = [];
    const caveats = new Map<string, number[]>();
    lc.points.forEach((p, i) => {
        for (const text of p.caveats) {
            caveats.set(text, [...(caveats.get(text) ?? []), p.mjd]);
        }
        const err = p.relativeNoise;
        const k = order[i];
        if (p.valid === true && Number.isFinite(p.relative) && Number.isFinite(err) && err >= 0
            && Number.isFinite(p.mjd) && k !== undefined) {
            points.push({ mjd: p.mjd, k, lambda: p.lambda, relative: p.relative, err });
        }
    });
    points.sort((a, b) => a.mjd - b.mjd);
    const lams = points.map((p) => p.lambda);
    const oneColour = lams.every(Number.isFinite) && Math.max(...lams) - Math.min(...lams) <= CURVE_WIDTH_UM + 1e-9;
    const line = points.length >= MIN_VISITS && visitCount(points.map((p) => p.mjd)) >= MIN_VISITS && oneColour;
    return {
        kind: line ? 'curve' : points.length > 0 ? 'table' : 'none',
        lambda: Number.isFinite(lc.lambda) ? lc.lambda : result.lambda,
        ringIn: ring.ringIn * px,
        ringOut: ring.ringOut * px,
        refs: clear.length,
        points,
        looks: lc.points.length,
        dropped: lc.dropped,
        caveats: [...caveats].map(([text, mjds]) => ({ text, mjds })),
        ringStars: starsInRing(result, centre.pix, ring),
    };
}

// Gaia stars whose light can fall in the ring: centre between the ring's edges, widened by one aperture radius.
// Positions are at the Gaia epoch; this is a warning, not a correction.
function starsInRing(result: SkyResult, at: PixelCoord, ring: { ringIn: number; ringOut: number }): number[]
{
    const margin = apertureFor(result.grid).radius;
    return result.stars
        .filter((s) => {
            const d = Math.hypot(s.pix.x - at.x, s.pix.y - at.y);
            return Number.isFinite(d) && Number.isFinite(s.g) && d >= ring.ringIn - margin && d <= ring.ringOut + margin;
        })
        .map((s) => s.g)
        .sort((a, b) => a - b);
}

// Looks less than 10 days apart count as one visit (as visitsOf in measure.ts).
function visitCount(mjds: number[]): number
{
    // Same rule as the rest of the page: a gap of 10 days or more from the previous look starts a new visit.
    const t = [...mjds].sort((a, b) => a - b);
    return t.filter((v, i) => i === 0 || v - t[i - 1]! >= 10).length;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// The panel body. `on` is the frame on screen in Blink (its dot is drawn larger), or -1.
export function haloHtml(h: HaloView, name: string, on: number): string
{
    const who = esc(name);
    if (h.kind === 'nofit') {
        return `<p class="sk-body mute">The ring around ${who}’s blank centre does not fit in this view. Choose a wider field to measure it.</p>`;
    }
    const arcsec = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)}″`;
    const where = `the light in a ring ${arcsec(h.ringIn)} to ${arcsec(h.ringOut)} from ${who}’s centre, outside the part the frames leave blank`;
    const off = h.dropped > 0 ? ` ${plural(h.dropped, 'frame was', 'frames were')} too far off this colour.` : '';
    const notes = h.caveats.length
        ? `<ul class="sk-notes">${h.caveats.map((c) => `<li>${esc([...new Set([...c.mjds].sort((a, b) => a - b).map((t) => date(t, true)))].join(', '))}: ${esc(c.text)}</li>`).join('')}</ul>`
        : '';
    const pct = (v: number) => `${v >= 1 ? '+' : '−'}${Math.abs((v - 1) * 100).toFixed(Math.abs(v - 1) < 0.1 ? 1 : 0)}%`;
    const lams = h.points.map((p) => p.lambda).filter(Number.isFinite);
    const lamLo = Math.min(...lams);
    const lamHi = Math.max(...lams);
    // The ring and the comparison stars need not share a colour, so looks a little apart in wavelength can differ.
    const colours = lams.length > 1 && lamHi - lamLo >= CURVE_WIDTH_UM - 1e-9
        ? ` These looks were taken from ${lamLo.toFixed(3)} to ${lamHi.toFixed(3)} µm; looks at slightly different colours can read differently for that reason alone.`
        : '';
    const visits = visitCount(h.points.map((p) => p.mjd));
    const gs = h.ringStars;
    const inRing = gs.length
        ? ` ${gs.length === 1 ? `A catalogued Gaia star (G ${gs[0]!.toFixed(1)}) sits` : `${gs.length} catalogued Gaia stars (brightest G ${gs[0]!.toFixed(1)}) sit`}`
            + ` in or at the edge of the ring, so some of ${gs.length === 1 ? 'its' : 'their'} light is in every reading.`
        : '';
    if (h.kind === 'none' || h.kind === 'table') {
        const head = `Near ${h.lambda.toFixed(2)} µm, ${where}, could be measured in ${h.points.length} of ${plural(h.looks, 'look', 'looks')}`
            + `${h.points.length ? `, taken on ${plural(visits, 'visit', 'visits')}` : ''}.`
            + ` A curve is drawn only from looks on at least ${MIN_VISITS} visits, all within ${CURVE_WIDTH_UM} µm of colour;`
            + ` these looks do not meet that, so ${h.kind === 'none' ? 'there is no curve' : h.points.length === 1 ? 'the one reading is listed instead' : 'each reading is listed instead'}.${off}`;
        if (h.kind === 'none') {
            return `<p class="sk-body mute">${head}</p>${notes}`;
        }
        // One reading compared with its own median always reads +0.0%, so show only its noise.
        const one = h.points.length === 1;
        const rows = h.points.map((p) => `<tr><td>${date(p.mjd, true)}</td><td>${p.lambda.toFixed(3)} µm</td>`
            + `<td>${one ? `one reading, nothing to compare (noise ± ${(p.err * 100).toFixed(1)}%)` : `${pct(p.relative)} ± ${(p.err * 100).toFixed(1)}%`}</td></tr>`).join('');
        const table = `<table class="sk-halo-t"><caption class="sk-sr">Light in the ring, each look</caption>`
            + '<thead><tr><th scope="col">Look</th><th scope="col">Colour</th><th scope="col">Ring light vs the median of these looks</th></tr></thead>'
            + `<tbody>${rows}</tbody></table>`;
        return `<p class="sk-body mute">${head}</p>${table}<p class="sk-body mute">Measured against ${h.refs} nearby comparison stars from Gaia. `
            + `The ± is each reading’s noise: the sky around the ring and around the comparison stars, and how far off the star’s catalogue position could be.${colours}${inRing}</p>${notes}`;
    }
    const W = 300;
    const H = 100;
    const pts = h.points;
    let lo = Math.min(1, ...pts.map((p) => p.relative - p.err));
    let hi = Math.max(1, ...pts.map((p) => p.relative + p.err));
    const pad = Math.max((hi - lo) * 0.18, 0.01);
    lo -= pad;
    hi += pad;
    const t0 = pts[0]!.mjd;
    const t1 = pts[pts.length - 1]!.mjd;
    const x = (t: number) => (6 + ((t - t0) / (t1 - t0 || 1)) * (W - 12)).toFixed(1);
    const y = (v: number) => (((hi - v) / (hi - lo)) * H).toFixed(1);
    const ys = pts.map((p) => p.relative);
    const label = `Light in the ring over ${pts.length} looks, from ${pct(Math.min(...ys))} to ${pct(Math.max(...ys))} relative to the median.`;
    const svg = `<svg role="img" aria-label="${esc(label)}" preserveAspectRatio="none" viewBox="0 0 ${W} ${H}">`
        + `<path d="M0 ${y(1)}H${W}" class="base" vector-effect="non-scaling-stroke"/>`
        + `<polyline points="${pts.map((p) => `${x(p.mjd)},${y(p.relative)}`).join(' ')}" class="line" vector-effect="non-scaling-stroke"/>`
        + `<g class="err">${pts.map((p) => `<path d="M${x(p.mjd)} ${y(p.relative + p.err)}V${y(p.relative - p.err)}" vector-effect="non-scaling-stroke"/>`).join('')}</g>`
        + `<g class="dots">${pts.map((p) => `<path d="M${x(p.mjd)} ${y(p.relative)}h0" class="${p.k === on ? 'on' : ''}" data-k="${p.k}" vector-effect="non-scaling-stroke"/>`).join('')}</g>`
        + '</svg>';
    const axis = `<div class="sk-lcy" aria-hidden="true"><span style="top:0">${pct(hi)}</span>`
        + `<span style="top:${((hi - 1) / (hi - lo) * 100).toFixed(1)}%">median</span><span style="top:100%">${pct(lo)}</span></div>`;
    const dates = `<div class="sk-lcx" aria-hidden="true"><span>${date(t0, false)}</span><span>${date(t1, false)}</span></div>`;
    const bad = h.looks - pts.length;
    const left = off + (bad > 0 ? ` ${plural(bad, 'look', 'looks')} could not be measured.` : '');
    const note = `At ${h.lambda.toFixed(2)} µm: ${where}, measured against ${h.refs} nearby comparison stars from Gaia, look by look. `
        + 'The bar on each dot is its noise: the sky around the ring and around the comparison stars, and how far off the '
        + `star’s catalogue position could be. A change inside its bar may be noise.${colours}${inRing}${left}`;
    return `<div class="sk-lc">${svg}${axis}</div>${dates}<p class="sk-body mute">${note}</p>${notes}`;
}
